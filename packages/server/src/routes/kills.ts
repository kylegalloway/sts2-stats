import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getKills, getBossStats, getEnemyInflectionStats } from '../analytics/kills.js';

const router = new Hono();

router.get('/', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({ kills: getKills(db, character) });
});

router.get('/bosses', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({ bosses: getBossStats(db, character) });
});

router.get('/inflection', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({ enemies: getEnemyInflectionStats(db, character) });
});

export default router;
