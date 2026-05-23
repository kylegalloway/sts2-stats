import type Database from 'better-sqlite3';
import { wilsonLower, rf } from './stats-utils.js';

export const STARTING_RELICS = new Set([
  'BURNING BLOOD',     // Ironclad
  'RING OF THE SNAKE', // Silent
  'DIVINE RIGHT',      // Regent
  'BOUND PHYLACTERY',  // Necrobinder
  'CRACKED CORE',      // Defect
]);

const STARTING_RELIC_PARAMS = [...STARTING_RELICS];
const NOT_STARTING_RELIC = `ro.relic_key NOT IN (${STARTING_RELIC_PARAMS.map(() => '?').join(',')})`;

export interface RelicStat {
  relic_key: string;
  obtain_count: number;
  obtain_rate: number;
  win_rate: number;
  quality_score: number;
  avg_floor: number | null;
}

export function getRelicStats(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): RelicStat[] {
  const f = rf({ character, ascension, sinceRunId });
  const fR = rf({ character, ascension, sinceRunId }, 'r');

  const totalRuns = (db.prepare(`SELECT COUNT(*) as n FROM runs ${f.where}`).get(...f.params) as { n: number }).n;

  return db.prepare(`
    SELECT
      ro.relic_key,
      COUNT(DISTINCT ro.run_id) AS obtain_count,
      CAST(COUNT(DISTINCT ro.run_id) AS REAL) / ? AS obtain_rate,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(DISTINCT ro.run_id), 0) AS win_rate,
      AVG(ro.floor) AS avg_floor
    FROM relics_obtained ro
    JOIN runs r ON r.id = ro.run_id
    WHERE ${NOT_STARTING_RELIC} ${fR.and}
    GROUP BY ro.relic_key
    ORDER BY obtain_count DESC
  `).all(totalRuns, ...STARTING_RELIC_PARAMS, ...fR.params).map((row: unknown) => {
    const r = row as RelicStat;
    return { ...r, quality_score: (r.obtain_rate ?? 0) * wilsonLower(Math.round((r.win_rate ?? 0) * r.obtain_count), r.obtain_count) };
  });
}

export interface RelicFloorLift {
  relic_key: string;
  obtain_count: number;
  avg_floor_with: number | null;
  avg_floor_without: number | null;
  floor_lift: number | null;
}

// Difference in avg floor_reached for runs with vs. without the relic.
export function getRelicFloorLifts(db: Database.Database, character?: string): RelicFloorLift[] {
  const charWhere = character ? 'WHERE character = ?' : '';
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  const globalAvg = (db.prepare(`SELECT AVG(floor_reached) as a FROM runs ${charWhere}`).get(...params) as { a: number | null }).a;

  return db.prepare(`
    SELECT
      ro.relic_key,
      COUNT(DISTINCT ro.run_id) AS obtain_count,
      AVG(r.floor_reached) AS avg_floor_with,
      (
        SELECT AVG(r2.floor_reached) FROM runs r2
        WHERE NOT EXISTS (
          SELECT 1 FROM relics_obtained ro2
          WHERE ro2.run_id = r2.id AND ro2.relic_key = ro.relic_key
        ) ${charAnd}
      ) AS avg_floor_without
    FROM relics_obtained ro
    JOIN runs r ON r.id = ro.run_id
    WHERE ${NOT_STARTING_RELIC} ${charAnd}
    GROUP BY ro.relic_key
    HAVING COUNT(DISTINCT ro.run_id) >= 3
    ORDER BY obtain_count DESC
  `).all(...STARTING_RELIC_PARAMS, ...params, ...params).map((row: unknown) => {
    const r = row as Omit<RelicFloorLift, 'floor_lift'>;
    const without = r.avg_floor_without ?? globalAvg;
    return {
      ...r,
      floor_lift: r.avg_floor_with != null && without != null ? r.avg_floor_with - without : null,
    };
  }) as RelicFloorLift[];
}

export interface RelicActObtainRate {
  relic_key: string;
  act: string;
  obtain_count: number;
  obtain_rate: number;
  win_rate: number | null;
}

export function getRelicActObtainRates(db: Database.Database, character?: string): RelicActObtainRate[] {
  const charWhere = character ? 'WHERE character = ?' : '';
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  const totalRuns = (db.prepare(`SELECT COUNT(*) as n FROM runs ${charWhere}`).get(...params) as { n: number }).n;

  return db.prepare(`
    SELECT
      ro.relic_key,
      ro.act,
      COUNT(DISTINCT ro.run_id) AS obtain_count,
      CAST(COUNT(DISTINCT ro.run_id) AS REAL) / ? AS obtain_rate,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(DISTINCT ro.run_id), 0) AS win_rate
    FROM relics_obtained ro
    JOIN runs r ON r.id = ro.run_id
    WHERE ${NOT_STARTING_RELIC} AND ro.act IS NOT NULL ${charAnd}
    GROUP BY ro.relic_key, ro.act
    HAVING COUNT(DISTINCT ro.run_id) >= 3
    ORDER BY ro.relic_key, ro.act
  `).all(totalRuns, ...STARTING_RELIC_PARAMS, ...params) as RelicActObtainRate[];
}

export interface RelicTimingStat {
  relic_key: string;
  early_count: number;
  early_win_rate: number | null;
  early_avg_floor: number | null;
  late_count: number;
  late_win_rate: number | null;
  late_avg_floor: number | null;
}

// "Early" = obtained before floor 10; "late" = floor 10+.
export function getRelicTimingStats(db: Database.Database, character?: string, earlyFloor = 10): RelicTimingStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      ro.relic_key,
      COUNT(DISTINCT CASE WHEN ro.floor < ? THEN ro.run_id END) AS early_count,
      CAST(SUM(CASE WHEN ro.floor < ? THEN r.victory END) AS REAL) /
        NULLIF(COUNT(DISTINCT CASE WHEN ro.floor < ? THEN ro.run_id END), 0) AS early_win_rate,
      AVG(CASE WHEN ro.floor < ? THEN r.floor_reached END) AS early_avg_floor,
      COUNT(DISTINCT CASE WHEN ro.floor >= ? THEN ro.run_id END) AS late_count,
      CAST(SUM(CASE WHEN ro.floor >= ? THEN r.victory END) AS REAL) /
        NULLIF(COUNT(DISTINCT CASE WHEN ro.floor >= ? THEN ro.run_id END), 0) AS late_win_rate,
      AVG(CASE WHEN ro.floor >= ? THEN r.floor_reached END) AS late_avg_floor
    FROM relics_obtained ro
    JOIN runs r ON r.id = ro.run_id
    WHERE ${NOT_STARTING_RELIC} ${charAnd}
    GROUP BY ro.relic_key
    HAVING (early_count + late_count) >= 3
    ORDER BY ro.relic_key
  `).all(earlyFloor, earlyFloor, earlyFloor, earlyFloor, earlyFloor, earlyFloor, earlyFloor, earlyFloor, ...STARTING_RELIC_PARAMS, ...params) as RelicTimingStat[];
}

export interface RelicBreakthroughStat {
  relic_key: string;
  obtain_count: number;
  pct_clearing_threshold: number | null;
  baseline_pct_clearing_threshold: number | null;
  breakthrough_lift: number | null;
}

// For a given floor threshold (default: most common death floor), what fraction
// of runs with this relic clear it vs. the population baseline?
export function getRelicBreakthroughStats(
  db: Database.Database,
  character?: string,
  floorThreshold?: number
): RelicBreakthroughStat[] {
  const charWhere = character ? 'WHERE character = ?' : '';
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  let threshold = floorThreshold;
  if (threshold == null) {
    const deathRow = db.prepare(`
      SELECT floor_reached, COUNT(*) as n FROM runs
      WHERE victory = 0 AND floor_reached IS NOT NULL ${charAnd}
      GROUP BY floor_reached ORDER BY n DESC LIMIT 1
    `).get(...params) as { floor_reached: number } | undefined;
    threshold = deathRow ? deathRow.floor_reached + 1 : 17;
  }

  const baselineRow = db.prepare(`
    SELECT CAST(SUM(CASE WHEN floor_reached >= ? THEN 1 ELSE 0 END) AS REAL) /
      NULLIF(COUNT(*), 0) AS pct FROM runs ${charWhere}
  `).get(threshold, ...params) as { pct: number | null };
  const baseline = baselineRow.pct;

  return db.prepare(`
    SELECT
      ro.relic_key,
      COUNT(DISTINCT ro.run_id) AS obtain_count,
      CAST(SUM(CASE WHEN r.floor_reached >= ? THEN 1 ELSE 0 END) AS REAL) /
        NULLIF(COUNT(DISTINCT ro.run_id), 0) AS pct_clearing_threshold
    FROM relics_obtained ro
    JOIN runs r ON r.id = ro.run_id
    WHERE ${NOT_STARTING_RELIC} ${charAnd}
    GROUP BY ro.relic_key
    HAVING COUNT(DISTINCT ro.run_id) >= 3
    ORDER BY pct_clearing_threshold DESC
  `).all(threshold, ...STARTING_RELIC_PARAMS, ...params).map((row: unknown) => {
    const r = row as Omit<RelicBreakthroughStat, 'baseline_pct_clearing_threshold' | 'breakthrough_lift'>;
    return {
      ...r,
      baseline_pct_clearing_threshold: baseline,
      breakthrough_lift: r.pct_clearing_threshold != null && baseline != null
        ? r.pct_clearing_threshold - baseline
        : null,
    };
  }) as RelicBreakthroughStat[];
}

export interface RelicComboLift {
  relic_a: string;
  relic_b: string;
  co_occurrence_count: number;
  avg_floor_both: number | null;
  avg_floor_a_only: number | null;
  avg_floor_b_only: number | null;
  floor_lift: number | null;
}

export interface RelicInflectionStat {
  relic_key: string;
  // Runs where this relic was held at or before the inflection floor.
  runs_present_at_inflection: number;
  avg_hp_pct_drop: number | null;
  avg_hp_deficit: number | null;
  avg_floor_reached: number | null;
  win_rate: number | null;
}

// For each relic: among runs where the relic was obtained before or at the
// inflection floor, how bad was the inflection on average?
export function getRelicInflectionStats(db: Database.Database, character?: string): RelicInflectionStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      ro.relic_key,
      COUNT(DISTINCT ro.run_id) AS runs_present_at_inflection,
      AVG(ri.hp_pct_drop) AS avg_hp_pct_drop,
      AVG(ri.hp_deficit) AS avg_hp_deficit,
      AVG(r.floor_reached) AS avg_floor_reached,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(DISTINCT ro.run_id), 0) AS win_rate
    FROM relics_obtained ro
    JOIN runs r ON r.id = ro.run_id
    JOIN run_inflection ri ON ri.run_id = ro.run_id
    WHERE ${NOT_STARTING_RELIC}
      AND ro.floor <= ri.inflection_floor
      ${charAnd}
    GROUP BY ro.relic_key
    HAVING COUNT(DISTINCT ro.run_id) >= 3
    ORDER BY avg_hp_deficit ASC
  `).all(...STARTING_RELIC_PARAMS, ...params) as RelicInflectionStat[];
}

export function getRelicComboLifts(db: Database.Database, character?: string, minOccurrences = 3): RelicComboLift[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params: unknown[] = character ? [character] : [];
  params.push(minOccurrences);

  return db.prepare(`
    WITH obtained AS (
      SELECT ro.run_id, ro.relic_key
      FROM relics_obtained ro
      JOIN runs r ON r.id = ro.run_id
      WHERE ${NOT_STARTING_RELIC} ${charAnd}
    )
    SELECT
      a.relic_key AS relic_a,
      b.relic_key AS relic_b,
      COUNT(*) AS co_occurrence_count,
      AVG(r.floor_reached) AS avg_floor_both,
      (
        SELECT AVG(r2.floor_reached) FROM obtained o2
        JOIN runs r2 ON r2.id = o2.run_id
        WHERE o2.relic_key = a.relic_key
          AND NOT EXISTS (SELECT 1 FROM obtained o3 WHERE o3.run_id = o2.run_id AND o3.relic_key = b.relic_key)
      ) AS avg_floor_a_only,
      (
        SELECT AVG(r2.floor_reached) FROM obtained o2
        JOIN runs r2 ON r2.id = o2.run_id
        WHERE o2.relic_key = b.relic_key
          AND NOT EXISTS (SELECT 1 FROM obtained o3 WHERE o3.run_id = o2.run_id AND o3.relic_key = a.relic_key)
      ) AS avg_floor_b_only
    FROM obtained a
    JOIN obtained b ON b.run_id = a.run_id AND b.relic_key > a.relic_key
    JOIN runs r ON r.id = a.run_id
    GROUP BY a.relic_key, b.relic_key
    HAVING COUNT(*) >= ?
    ORDER BY co_occurrence_count DESC
  `).all(...STARTING_RELIC_PARAMS, ...params).map((row: unknown) => {
    const r = row as Omit<RelicComboLift, 'floor_lift'>;
    const baseline = r.avg_floor_a_only != null && r.avg_floor_b_only != null
      ? Math.max(r.avg_floor_a_only, r.avg_floor_b_only)
      : (r.avg_floor_a_only ?? r.avg_floor_b_only);
    return {
      ...r,
      floor_lift: r.avg_floor_both != null && baseline != null ? r.avg_floor_both - baseline : null,
    };
  }) as RelicComboLift[];
}
