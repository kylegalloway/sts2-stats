import type Database from 'better-sqlite3';

export interface RelicStat {
  relic_key: string;
  obtain_count: number;
  obtain_rate: number;
  win_rate: number;
  quality_score: number;
  avg_floor: number | null;
}

export function getRelicStats(db: Database.Database, character?: string): RelicStat[] {
  const where = character ? 'WHERE r.character = ?' : '';
  const params = character ? [character] : [];

  const totalRuns = (db.prepare(`SELECT COUNT(*) as n FROM runs ${where}`).get(...params) as { n: number }).n;

  return db.prepare(`
    SELECT
      ro.relic_key,
      COUNT(DISTINCT ro.run_id) AS obtain_count,
      CAST(COUNT(DISTINCT ro.run_id) AS REAL) / ? AS obtain_rate,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(DISTINCT ro.run_id), 0) AS win_rate,
      AVG(ro.floor) AS avg_floor
    FROM relics_obtained ro
    JOIN runs r ON r.id = ro.run_id
    ${where}
    GROUP BY ro.relic_key
    ORDER BY obtain_count DESC
  `).all(totalRuns, ...params).map((row: unknown) => {
    const r = row as RelicStat;
    return { ...r, quality_score: (r.obtain_rate ?? 0) * (r.win_rate ?? 0) };
  });
}
