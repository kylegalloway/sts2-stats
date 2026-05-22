import type Database from 'better-sqlite3';

export interface CardStat {
  card_id: string;
  offered: number;
  picked: number;
  pick_rate: number;
  win_rate: number;
  quality_score: number;
}

export interface CardElo {
  card_id: string;
  elo: number;
}

export function getCardStats(db: Database.Database, character?: string): CardStat[] {
  const where = character ? 'WHERE r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      cc.card_id,
      COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END) +
        COUNT(DISTINCT CASE WHEN cc.was_picked = 0 THEN cc.run_id END) AS offered,
      COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END) AS picked,
      CAST(COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END) AS REAL) /
        NULLIF(COUNT(DISTINCT cc.run_id), 0) AS pick_rate,
      CAST(SUM(CASE WHEN cc.was_picked = 1 THEN r.victory ELSE 0 END) AS REAL) /
        NULLIF(COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END), 0) AS win_rate,
      0 AS quality_score
    FROM card_choices cc
    JOIN runs r ON r.id = cc.run_id
    ${where}
    GROUP BY cc.card_id
    ORDER BY pick_rate DESC
  `).all(...params).map((row: unknown) => {
    const r = row as CardStat;
    return { ...r, quality_score: (r.pick_rate ?? 0) * (r.win_rate ?? 0) };
  });
}

export function getCardElo(db: Database.Database, character?: string): CardElo[] {
  const where = character ? 'WHERE character = ?' : '';
  const params = character ? [character] : [];
  return db.prepare(`SELECT card_id, elo FROM card_elo ${where} ORDER BY elo DESC`).all(...params) as CardElo[];
}

// Rebuild ELO for a character from scratch in chronological order (K=32).
export function rebuildElo(db: Database.Database, character: string) {
  const choices = db.prepare(`
    SELECT cc.floor, cc.card_id, cc.was_picked, r.id as run_id
    FROM card_choices cc
    JOIN runs r ON r.id = cc.run_id
    WHERE r.character = ?
    ORDER BY r.timestamp, r.id, cc.floor
  `).all(character) as { floor: number; card_id: string; was_picked: number; run_id: number }[];

  // Group choices into matchups per (run, floor)
  const matchups = new Map<string, { picked: string; notPicked: string[] }>();
  for (const row of choices) {
    const key = `${row.run_id}:${row.floor}`;
    if (!matchups.has(key)) matchups.set(key, { picked: '', notPicked: [] });
    const m = matchups.get(key)!;
    if (row.was_picked) m.picked = row.card_id;
    else m.notPicked.push(row.card_id);
  }

  const elo: Record<string, number> = {};
  const K = 32;

  for (const { picked, notPicked } of matchups.values()) {
    if (!picked) continue;
    elo[picked] ??= 1000;
    for (const opp of notPicked) {
      elo[opp] ??= 1000;
      const expected = 1 / (1 + Math.pow(10, (elo[opp] - elo[picked]) / 400));
      elo[picked] += K * (1 - expected);
      elo[opp] += K * (0 - (1 - expected));
    }
  }

  const upsert = db.prepare(`
    INSERT INTO card_elo (character, card_id, elo) VALUES (?, ?, ?)
    ON CONFLICT (character, card_id) DO UPDATE SET elo = excluded.elo
  `);

  db.transaction(() => {
    for (const [card_id, eloVal] of Object.entries(elo)) {
      upsert.run(character, card_id, eloVal);
    }
  })();
}
