import type Database from 'better-sqlite3';

export interface FloorStat {
  floor: number;
  avg_hp_pct: number | null;
  avg_gold: number | null;
  sample_size: number;
}

export function getHpGold(db: Database.Database, character?: string): FloorStat[] {
  const where = character ? 'WHERE r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      hg.floor,
      AVG(CAST(hg.hp AS REAL) / NULLIF(hg.max_hp, 0)) AS avg_hp_pct,
      AVG(hg.gold) AS avg_gold,
      COUNT(*) AS sample_size
    FROM hp_gold_per_floor hg
    JOIN runs r ON r.id = hg.run_id
    ${where}
    GROUP BY hg.floor
    ORDER BY hg.floor
  `).all(...params) as FloorStat[];
}
