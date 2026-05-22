import { Hono } from 'hono';
import { db } from '../db/index.js';
import { type EntityType } from '../codex/nameToId.js';
import { fetchCodexEntity } from '../codex/service.js';
import { warmCodexCards } from '../codex/warmup.js';

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

router.get('/cached/relics', (c) => {
  const rows = db.prepare(
    `SELECT entity_id, data_json FROM spire_codex_cache WHERE entity_type = 'relic'`
  ).all() as { entity_id: string; data_json: string }[];

  const result = rows.map((r) => {
    const d = JSON.parse(r.data_json) as { rarity?: string };
    return { id: r.entity_id, rarity: d.rarity ?? null };
  });
  return c.json(result);
});

router.post('/seed-cards', async (c) => {
  try {
    const inserted = await warmCodexCards(db, true);
    return c.json({ inserted });
  } catch {
    return c.json({ error: 'upstream error' }, 502);
  }
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
