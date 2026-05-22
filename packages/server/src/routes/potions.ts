import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getPotionStats, getPotionUsageByRoom, getPotionBossUsage } from '../analytics/potions.js';

const router = new Hono();

router.get('/', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({
    stats: getPotionStats(db, character),
    usageByRoom: getPotionUsageByRoom(db, character),
    bossUsage: getPotionBossUsage(db, character),
  });
});

export default router;
