import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getRelicStats } from '../analytics/relics.js';
import { extractFilter } from './utils.js';

const router = new Hono();

router.get('/', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({ relics: getRelicStats(db, character, ascension, sinceRunId) });
});

export default router;
