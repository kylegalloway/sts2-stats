import type Database from 'better-sqlite3';

export async function warmCodexCards(db: Database.Database, force = false): Promise<number> {
  if (!force) {
    const { n } = db.prepare(
      `SELECT COUNT(*) as n FROM spire_codex_cache WHERE entity_type = 'card'`
    ).get() as { n: number };
    if (n >= 500) return 0;
  }

  const res = await fetch('https://spire-codex.com/api/cards?limit=600', {
    headers: { Accept: 'application/json', 'User-Agent': 'sts2-stats/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.warn(`[codex] warmup failed: spire-codex returned ${res.status}`);
    return 0;
  }

  const cards = (await res.json()) as { id: string; [key: string]: unknown }[];

  const upsert = db.prepare(`
    INSERT INTO spire_codex_cache (entity_type, entity_id, data_json, fetched_at)
    VALUES ('card', ?, ?, datetime('now'))
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      data_json = excluded.data_json,
      fetched_at = excluded.fetched_at
  `);

  db.transaction(() => {
    for (const card of cards) {
      upsert.run(card.id.toLowerCase(), JSON.stringify(card));
    }
  })();

  console.log(`[codex] warmed ${cards.length} cards`);
  return cards.length;
}
