import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getPersonalBests, getStreaks, getFunStats } from '../analytics/records.js';

const router = new Hono();

router.get('/', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({
    personal_bests: getPersonalBests(db, character),
    streaks: getStreaks(db, character),
    fun_stats: getFunStats(db, character),
  });
});

export default router;
