import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getCores, getSynergies } from '../analytics/synergies.js';
import { extractFilter } from './utils.js';

const router = new Hono();

router.get('/', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  const minOcc = parseInt(c.req.query('min_occurrences') || '2', 10);
  return c.json({ synergies: getSynergies(db, character, minOcc, ascension, sinceRunId) });
});

router.get('/cores', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  const minRuns = parseInt(c.req.query('min_runs') || '3', 10);
  return c.json({ cores: getCores(db, character, minRuns, ascension, sinceRunId) });
});

export default router;
