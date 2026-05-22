import type Database from 'better-sqlite3';

export interface RunInflection {
  run_id: number;
  inflection_floor: number;
  hp_pct_drop: number;
  hp_pct_at_inflection: number | null;
  hp_deficit: number | null;
}

// Finds the worst 3-floor sliding window by cumulative HP% drop for every run,
// then stores the result. hp_deficit = your HP% at inflection minus population
// avg HP% at that floor — negative means you were below average (in trouble).
export function rebuildInflection(db: Database.Database) {
  // Population avg HP% per floor across all runs, used to compute hp_deficit.
  const popAvgRows = db.prepare(`
    SELECT floor, AVG(CAST(hp AS REAL) / NULLIF(max_hp, 0)) AS avg_hp_pct
    FROM hp_gold_per_floor
    WHERE hp IS NOT NULL AND max_hp IS NOT NULL
    GROUP BY floor
  `).all() as { floor: number; avg_hp_pct: number }[];
  const popAvg = new Map(popAvgRows.map((r) => [r.floor, r.avg_hp_pct]));

  // All HP data ordered by run then floor.
  const allRows = db.prepare(`
    SELECT run_id, floor, hp, max_hp
    FROM hp_gold_per_floor
    WHERE hp IS NOT NULL AND max_hp IS NOT NULL
    ORDER BY run_id, floor
  `).all() as { run_id: number; floor: number; hp: number; max_hp: number }[];

  // Group by run.
  const byRun = new Map<number, { floor: number; hp_pct: number }[]>();
  for (const row of allRows) {
    if (!byRun.has(row.run_id)) byRun.set(row.run_id, []);
    byRun.get(row.run_id)!.push({ floor: row.floor, hp_pct: row.hp / row.max_hp });
  }

  const upsert = db.prepare(`
    INSERT INTO run_inflection (run_id, inflection_floor, hp_pct_drop, hp_pct_at_inflection, hp_deficit)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (run_id) DO UPDATE SET
      inflection_floor = excluded.inflection_floor,
      hp_pct_drop = excluded.hp_pct_drop,
      hp_pct_at_inflection = excluded.hp_pct_at_inflection,
      hp_deficit = excluded.hp_deficit
  `);

  db.transaction(() => {
    for (const [run_id, floors] of byRun) {
      if (floors.length < 2) continue;

      let worstDrop = -Infinity;
      let worstFloor = floors[0].floor;
      let worstHpPct: number | null = null;

      // Slide a window of up to 3 floors and find max cumulative HP% drop.
      for (let i = 0; i < floors.length; i++) {
        const windowEnd = Math.min(i + 2, floors.length - 1);
        const drop = floors[i].hp_pct - floors[windowEnd].hp_pct;
        if (drop > worstDrop) {
          worstDrop = drop;
          worstFloor = floors[windowEnd].floor;
          worstHpPct = floors[windowEnd].hp_pct;
        }
      }

      const pop = popAvg.get(worstFloor) ?? null;
      const deficit = worstHpPct != null && pop != null ? worstHpPct - pop : null;

      upsert.run(run_id, worstFloor, worstDrop, worstHpPct, deficit);
    }
  })();
}

export interface InflectionStat {
  run_id: number;
  character: string;
  floor_reached: number;
  victory: number;
  inflection_floor: number;
  hp_pct_drop: number;
  hp_pct_at_inflection: number | null;
  hp_deficit: number | null;
}

export function getInflectionStats(db: Database.Database, character?: string): InflectionStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      r.id AS run_id,
      r.character,
      r.floor_reached,
      r.victory,
      ri.inflection_floor,
      ri.hp_pct_drop,
      ri.hp_pct_at_inflection,
      ri.hp_deficit
    FROM run_inflection ri
    JOIN runs r ON r.id = ri.run_id
    WHERE 1=1 ${charAnd}
    ORDER BY ri.hp_pct_drop DESC
  `).all(...params) as InflectionStat[];
}

export interface InflectionFloorDistribution {
  inflection_floor: number;
  count: number;
  avg_hp_pct_drop: number | null;
  avg_hp_deficit: number | null;
  win_rate: number | null;
}

// How often each floor is the inflection point, and how bad those moments are.
export function getInflectionFloorDistribution(db: Database.Database, character?: string): InflectionFloorDistribution[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      ri.inflection_floor,
      COUNT(*) AS count,
      AVG(ri.hp_pct_drop) AS avg_hp_pct_drop,
      AVG(ri.hp_deficit) AS avg_hp_deficit,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate
    FROM run_inflection ri
    JOIN runs r ON r.id = ri.run_id
    WHERE 1=1 ${charAnd}
    GROUP BY ri.inflection_floor
    ORDER BY count DESC
  `).all(...params) as InflectionFloorDistribution[];
}
