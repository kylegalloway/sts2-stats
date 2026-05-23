import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getPersonalBests, getStreaks, getFunStats } from '../analytics/records.js';
import { extractFilter } from './utils.js';

const router = new Hono();

router.get('/', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({
    personal_bests: getPersonalBests(db, character, ascension, sinceRunId),
    streaks: getStreaks(db, character, ascension, sinceRunId),
    fun_stats: getFunStats(db, character, ascension, sinceRunId),
  });
});

export default router;
