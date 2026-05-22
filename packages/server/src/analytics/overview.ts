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

export function getAscensionStats(db: Database.Database, character?: string) {
  const where = character ? 'WHERE character = ?' : '';
  const params = character ? [character] : [];
  return db.prepare(`
    SELECT ascension, COUNT(*) AS total, SUM(victory) AS wins,
      CAST(SUM(victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate
    FROM runs ${where}
    GROUP BY ascension ORDER BY ascension
  `).all(...params);
}

export function getPathComposition(db: Database.Database, character?: string) {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];
  return db.prepare(`
    SELECT r.victory, fn.act, fn.node_type,
      COUNT(*) AS node_count,
      COUNT(DISTINCT fn.run_id) AS run_count
    FROM floor_nodes fn
    JOIN runs r ON r.id = fn.run_id
    WHERE fn.node_type IN ('elite', 'rest_site', 'shop', 'boss') ${charAnd}
    GROUP BY r.victory, fn.act, fn.node_type
  `).all(...params);
}
