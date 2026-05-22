import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getCores, getSynergies } from '../analytics/synergies.js';

const router = new Hono();

router.get('/', (c) => {
  const character = c.req.query('character') || undefined;
  const minOcc = parseInt(c.req.query('min_occurrences') || '2', 10);
  return c.json({ synergies: getSynergies(db, character, minOcc) });
});

router.get('/cores', (c) => {
  const character = c.req.query('character') || undefined;
  const minRuns = parseInt(c.req.query('min_runs') || '3', 10);
  return c.json({ cores: getCores(db, character, minRuns) });
});

export default router;
