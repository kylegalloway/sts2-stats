import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getHpGold } from '../analytics/hpgold.js';

const router = new Hono();

router.get('/', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({ floors: getHpGold(db, character) });
});

export default router;
