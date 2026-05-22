import type Database from 'better-sqlite3';

export function getOverview(db: Database.Database, character?: string) {
  const where = character ? 'WHERE character = ?' : '';
  const params = character ? [character] : [];

  const kpis = db.prepare(`
    SELECT
      COUNT(*) AS total_runs,
      SUM(victory) AS total_wins,
      CAST(SUM(victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate,
      AVG(floor_reached) AS avg_floor,
      AVG(run_time) AS avg_run_time
    FROM runs ${where}
  `).get(...params);

  const winByChar = db.prepare(`
    SELECT character, COUNT(*) AS total, SUM(victory) AS wins,
      CAST(SUM(victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate
    FROM runs ${where}
    GROUP BY character ORDER BY win_rate DESC
  `).all(...params);

  const timeline = db.prepare(`
    SELECT id, character, victory, floor_reached, timestamp, ascension
    FROM runs ${where}
    ORDER BY timestamp, id
  `).all(...params);

  return { kpis, winByChar, timeline };
}

export function getActRoutes(db: Database.Database, character?: string) {
  const where = character ? 'WHERE character = ?' : '';
  const params = character ? [character] : [];
  return db.prepare(`
    SELECT acts, COUNT(*) AS total, SUM(victory) AS wins,
      CAST(SUM(victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate
    FROM runs ${where}
    GROUP BY acts ORDER BY total DESC
  `).all(...params);
}
