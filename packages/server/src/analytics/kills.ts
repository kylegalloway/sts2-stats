import type Database from 'better-sqlite3';

export interface KillStat {
  killed_by: string;
  count: number;
  pct: number;
}

export function getKills(db: Database.Database, character?: string): KillStat[] {
  const where = character
    ? 'WHERE victory = 0 AND character = ?'
    : 'WHERE victory = 0';
  const params = character ? [character] : [];

  const total = (db.prepare(`SELECT COUNT(*) as n FROM runs ${where}`).get(...params) as { n: number }).n;

  return db.prepare(`
    SELECT killed_by, COUNT(*) AS count
    FROM runs ${where} AND killed_by IS NOT NULL
    GROUP BY killed_by ORDER BY count DESC
  `).all(...params).map((row: unknown) => {
    const r = row as { killed_by: string; count: number };
    return { ...r, pct: total > 0 ? r.count / total : 0 };
  });
}
