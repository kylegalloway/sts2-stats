import type Database from 'better-sqlite3';
import { rf } from './stats-utils.js';

export interface FloorStat {
  floor: number;
  avg_hp_pct: number | null;
  avg_gold: number | null;
  sample_size: number;
}

export function getHpGold(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): FloorStat[] {
  const fR = rf({ character, ascension, sinceRunId }, 'r');

  return db.prepare(`
    SELECT
      hg.floor,
      AVG(CAST(hg.hp AS REAL) / NULLIF(hg.max_hp, 0)) AS avg_hp_pct,
      AVG(hg.gold) AS avg_gold,
      COUNT(*) AS sample_size
    FROM hp_gold_per_floor hg
    JOIN runs r ON r.id = hg.run_id
    ${fR.where}
    GROUP BY hg.floor
    ORDER BY hg.floor
  `).all(...fR.params) as FloorStat[];
}

export interface ResourceEfficiencyStat {
  run_id: number;
  character: string;
  floor_reached: number;
  victory: number;
  hp_pct_at_act1_end: number | null;
  gold_at_act1_end: number | null;
  resource_efficiency_score: number | null;
}

// HP% × gold at the actual Act 1 end floor (derived from floor_nodes) as a leading
// indicator of run health. Uses the per-run act boundary instead of a hardcoded floor.
export function getResourceEfficiencyStats(db: Database.Database, character?: string): ResourceEfficiencyStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    WITH act1_end AS (
      SELECT run_id, MAX(floor) AS end_floor
      FROM floor_nodes
      WHERE act = 'Act 1'
      GROUP BY run_id
    )
    SELECT
      r.id AS run_id,
      r.character,
      r.floor_reached,
      r.victory,
      CAST(hg.hp AS REAL) / NULLIF(hg.max_hp, 0) AS hp_pct_at_act1_end,
      hg.gold AS gold_at_act1_end
    FROM runs r
    JOIN act1_end ae ON ae.run_id = r.id
    JOIN hp_gold_per_floor hg ON hg.run_id = r.id AND hg.floor = ae.end_floor
    WHERE 1=1 ${charAnd}
    ORDER BY r.timestamp, r.id
  `).all(...params).map((row: unknown) => {
    const r = row as Omit<ResourceEfficiencyStat, 'resource_efficiency_score'>;
    return {
      ...r,
      resource_efficiency_score:
        r.hp_pct_at_act1_end != null && r.gold_at_act1_end != null
          ? r.hp_pct_at_act1_end * r.gold_at_act1_end
          : null,
    };
  }) as ResourceEfficiencyStat[];
}

export interface ResourceEfficiencyCorrelation {
  floor_bucket: number;
  avg_floor_reached: number | null;
  avg_resource_score: number | null;
  sample_size: number;
}

// Buckets runs by their Act 1 end resource score and shows avg floor_reached
// per bucket — lets you see the score-to-progression relationship.
export function getResourceEfficiencyCorrelation(db: Database.Database, character?: string, bucketSize = 50): ResourceEfficiencyCorrelation[] {
  const rows = getResourceEfficiencyStats(db, character)
    .filter((r) => r.resource_efficiency_score != null);

  const buckets = new Map<number, { floors: number[]; scores: number[] }>();
  for (const row of rows) {
    const bucket = Math.floor((row.resource_efficiency_score ?? 0) / bucketSize) * bucketSize;
    if (!buckets.has(bucket)) buckets.set(bucket, { floors: [], scores: [] });
    buckets.get(bucket)!.floors.push(row.floor_reached);
    buckets.get(bucket)!.scores.push(row.resource_efficiency_score!);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucket, { floors, scores }]) => ({
      floor_bucket: bucket,
      avg_floor_reached: floors.length ? floors.reduce((a, b) => a + b, 0) / floors.length : null,
      avg_resource_score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      sample_size: floors.length,
    }));
}
