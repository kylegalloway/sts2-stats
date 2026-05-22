import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getOverview, getActRoutes, getAscensionStats, getPathComposition } from '../analytics/overview.js';

const router = new Hono();

router.get('/', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json(getOverview(db, character));
});

router.get('/act-routes', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json(getActRoutes(db, character));
});

router.get('/ascension', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json(getAscensionStats(db, character));
});

router.get('/path-composition', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json(getPathComposition(db, character));
});

export default router;
