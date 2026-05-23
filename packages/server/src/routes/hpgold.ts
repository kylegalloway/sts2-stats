import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getHpGold } from '../analytics/hpgold.js';
import { extractFilter } from './utils.js';

const router = new Hono();

router.get('/', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({ floors: getHpGold(db, character, ascension, sinceRunId) });
});

export default router;
