import type Database from 'better-sqlite3';

export interface Synergy {
  character: string;
  card_id: string;
  relic_key: string;
  occurrences: number;
  win_rate: number;
  baseline_wr: number;
  lift: number;
}

export function getSynergies(
  db: Database.Database,
  character?: string,
  minOccurrences = 5
): Synergy[] {
  const charFilter = character ? 'AND r.character = ?' : '';
  const params: unknown[] = [];
  if (character) params.push(character);
  params.push(minOccurrences);

  const baselineRows = db.prepare(
    `SELECT character, AVG(victory) as wr FROM runs ${character ? 'WHERE character = ?' : ''} GROUP BY character`
  ).all(...(character ? [character] : [])) as { character: string; wr: number }[];

  const baseline = new Map(baselineRows.map((r) => [r.character, r.wr]));

  const rows = db.prepare(`
    SELECT
      r.character,
      cc.card_id,
      ro.relic_key,
      COUNT(*) AS occurrences,
      CAST(SUM(r.victory) AS REAL) / COUNT(*) AS win_rate
    FROM card_choices cc
    JOIN relics_obtained ro ON ro.run_id = cc.run_id
    JOIN runs r ON r.id = cc.run_id
    WHERE cc.was_picked = 1
      ${charFilter}
    GROUP BY r.character, cc.card_id, ro.relic_key
    HAVING COUNT(*) >= ?
    ORDER BY win_rate DESC
  `).all(...params) as Omit<Synergy, 'baseline_wr' | 'lift'>[];

  return rows.map((row) => {
    const bwr = baseline.get(row.character) ?? 0;
    return {
      ...row,
      baseline_wr: bwr,
      lift: bwr > 0 ? row.win_rate / bwr : 0,
    };
  });
}
