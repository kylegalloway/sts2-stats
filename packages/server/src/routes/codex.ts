import { Hono } from 'hono';
import { db } from '../db/index.js';
import { type EntityType } from '../codex/nameToId.js';
import { fetchCodexEntity } from '../codex/service.js';

const router = new Hono();
const VALID_TYPES: EntityType[] = ['card', 'relic', 'monster', 'event'];

router.get('/cached/cards', (c) => {
  const rows = db.prepare(
    `SELECT entity_id, data_json FROM spire_codex_cache WHERE entity_type = 'card'`
  ).all() as { entity_id: string; data_json: string }[];

  const result = rows.map((r) => {
    const d = JSON.parse(r.data_json) as { rarity?: string; color?: string };
    return { id: r.entity_id, rarity: d.rarity ?? null, color: d.color ?? null };
  });
  return c.json(result);
});

router.post('/seed-cards', async (c) => {
  const res = await fetch('https://spire-codex.com/api/cards?limit=600', {
    headers: { Accept: 'application/json', 'User-Agent': 'sts2-stats/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return c.json({ error: `spire-codex returned ${res.status}` }, 502);

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
      upsert.run(card.id.toLowerCase().replace(/_/g, '_'), JSON.stringify(card));
    }
  })();

  return c.json({ inserted: cards.length });
});

router.get('/:type/:name', async (c) => {
  const type = c.req.param('type') as EntityType;
  if (!VALID_TYPES.includes(type)) {
    return c.json({ error: 'Invalid entity type' }, 400);
  }

  const displayName = decodeURIComponent(c.req.param('name'));

  try {
    const data = await fetchCodexEntity(db, type, displayName);
    if (!data) return c.json({ error: 'Not found' }, 404);
    return c.json(data);
  } catch (err) {
    console.error('[codex] fetch error:', err);
    return c.json({ error: 'upstream error' }, 502);
  }
});

export default router;
