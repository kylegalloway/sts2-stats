import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getKills, getBossStats, getEnemyInflectionStats } from '../analytics/kills.js';
import { extractFilter } from './utils.js';

const router = new Hono();

router.get('/', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({ kills: getKills(db, character, ascension, sinceRunId) });
});

router.get('/bosses', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({ bosses: getBossStats(db, character, ascension, sinceRunId) });
});

router.get('/inflection', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({ enemies: getEnemyInflectionStats(db, character, ascension, sinceRunId) });
});

export default router;
