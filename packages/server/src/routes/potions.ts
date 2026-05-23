import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getPotionStats, getPotionUsageByRoom, getPotionBossUsage } from '../analytics/potions.js';
import { extractFilter } from './utils.js';

const router = new Hono();

router.get('/', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({
    stats: getPotionStats(db, character, ascension, sinceRunId),
    usageByRoom: getPotionUsageByRoom(db, character, ascension, sinceRunId),
    bossUsage: getPotionBossUsage(db, character, ascension, sinceRunId),
  });
});

export default router;
