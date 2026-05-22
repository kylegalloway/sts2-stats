import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getRelicStats } from '../analytics/relics.js';

const router = new Hono();

router.get('/', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({ relics: getRelicStats(db, character) });
});

export default router;
