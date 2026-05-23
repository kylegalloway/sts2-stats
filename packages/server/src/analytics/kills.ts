import type Database from 'better-sqlite3';
import { rf } from './stats-utils.js';

export interface BossStat {
  boss: string;
  act: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  avg_hp_pct_wins: number | null;
  avg_hp_pct_losses: number | null;
}

export function getBossStats(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): BossStat[] {
  const fR = rf({ character, ascension, sinceRunId }, 'r');
  return db.prepare(`
    SELECT
      fn.encounter_id AS boss,
      fn.act,
      COUNT(*) AS total,
      SUM(r.victory) AS wins,
      COUNT(*) - SUM(r.victory) AS losses,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate,
      AVG(CASE WHEN r.victory = 1 THEN CAST(hg.hp AS REAL) / NULLIF(hg.max_hp, 0) END) AS avg_hp_pct_wins,
      AVG(CASE WHEN r.victory = 0 THEN CAST(hg.hp AS REAL) / NULLIF(hg.max_hp, 0) END) AS avg_hp_pct_losses
    FROM floor_nodes fn
    JOIN runs r ON r.id = fn.run_id
    LEFT JOIN hp_gold_per_floor hg ON hg.run_id = fn.run_id AND hg.floor = fn.floor
    WHERE fn.node_type = 'boss' AND fn.encounter_id IS NOT NULL ${fR.and}
    GROUP BY fn.encounter_id, fn.act
    ORDER BY total DESC
  `).all(...fR.params) as BossStat[];
}

export interface KillStat {
  killed_by: string;
  count: number;
  pct: number;
}

export function getKills(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): KillStat[] {
  const f = rf({ character, ascension, sinceRunId });
  const defeatBase = f.params.length
    ? `WHERE victory = 0 ${f.and}`
    : 'WHERE victory = 0';

  const total = (db.prepare(`SELECT COUNT(*) as n FROM runs ${defeatBase}`).get(...f.params) as { n: number }).n;

  return db.prepare(`
    SELECT killed_by, COUNT(*) AS count
    FROM runs ${defeatBase} AND killed_by IS NOT NULL AND killed_by != 'NONE.NONE'
    GROUP BY killed_by ORDER BY count DESC
  `).all(...f.params).map((row: unknown) => {
    const r = row as { killed_by: string; count: number };
    return { ...r, pct: total > 0 ? r.count / total : 0 };
  });
}

export interface KillByFloorBand {
  floor_band: string;
  killed_by: string;
  count: number;
  pct_of_band: number;
}

export interface EnemyInflectionStat {
  encounter_id: string;
  room_type: string | null;
  // Number of runs where this encounter fell inside the worst 3-floor HP window.
  inflection_appearances: number;
  avg_damage_in_window: number | null;
  avg_hp_deficit: number | null;
  avg_floor_reached: number | null;
  win_rate: number | null;
  // How often this encounter is the kill shot (from runs.killed_by).
  kill_count: number;
}

// Encounters that most frequently appear inside a run's worst 3-floor HP drain
// window, and how bad those moments were. Identifies enemies that break you
// rather than just finish you.
export function getEnemyInflectionStats(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): EnemyInflectionStat[] {
  const fR = rf({ character, ascension, sinceRunId }, 'r');
  const fR2 = rf({ character, ascension, sinceRunId }, 'r2');

  return db.prepare(`
    WITH inflection_window AS (
      SELECT
        dpf.run_id,
        dpf.encounter_id,
        dpf.room_type,
        dpf.damage_taken,
        ri.hp_deficit,
        ri.inflection_floor
      FROM damage_per_floor dpf
      JOIN run_inflection ri ON ri.run_id = dpf.run_id
      WHERE dpf.floor > ri.inflection_floor - 3
        AND dpf.floor <= ri.inflection_floor
        AND dpf.encounter_id IS NOT NULL
        AND dpf.damage_taken > 0
    )
    SELECT
      iw.encounter_id,
      iw.room_type,
      COUNT(DISTINCT iw.run_id) AS inflection_appearances,
      AVG(iw.damage_taken) AS avg_damage_in_window,
      AVG(iw.hp_deficit) AS avg_hp_deficit,
      AVG(r.floor_reached) AS avg_floor_reached,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(DISTINCT iw.run_id), 0) AS win_rate,
      COALESCE((
        SELECT COUNT(*) FROM runs r2
        WHERE r2.killed_by = iw.encounter_id ${fR2.and}
      ), 0) AS kill_count
    FROM inflection_window iw
    JOIN runs r ON r.id = iw.run_id
    WHERE 1=1 ${fR.and}
    GROUP BY iw.encounter_id, iw.room_type
    HAVING COUNT(DISTINCT iw.run_id) >= 2
    ORDER BY avg_hp_deficit ASC
  `).all(...fR2.params, ...fR.params) as EnemyInflectionStat[];
}

// Groups deaths by act label (from floor_nodes at the death floor).
// Uses the act column instead of hardcoded floor ranges, so 17-floor Act 1 runs count correctly.
export function getKillsByFloorBand(db: Database.Database, character?: string): KillByFloorBand[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  const bandTotals = db.prepare(`
    SELECT COALESCE(fn.act, 'Unknown') AS floor_band, COUNT(*) AS n
    FROM runs r
    LEFT JOIN floor_nodes fn ON fn.run_id = r.id AND fn.floor = r.floor_reached
    WHERE r.victory = 0 ${charAnd}
    GROUP BY fn.act
  `).all(...params) as { floor_band: string; n: number }[];

  const totalsMap = new Map<string, number>(bandTotals.map((b) => [b.floor_band, b.n]));

  const rows = db.prepare(`
    SELECT COALESCE(fn.act, 'Unknown') AS floor_band, r.killed_by, COUNT(*) AS count
    FROM runs r
    LEFT JOIN floor_nodes fn ON fn.run_id = r.id AND fn.floor = r.floor_reached
    WHERE r.victory = 0 AND r.killed_by IS NOT NULL ${charAnd}
    GROUP BY fn.act, r.killed_by
    ORDER BY fn.act, count DESC
  `).all(...params) as { floor_band: string; killed_by: string; count: number }[];

  return rows.map((row) => ({
    floor_band: row.floor_band,
    killed_by: row.killed_by,
    count: row.count,
    pct_of_band: (totalsMap.get(row.floor_band) ?? 0) > 0
      ? row.count / totalsMap.get(row.floor_band)!
      : 0,
  }));
}
