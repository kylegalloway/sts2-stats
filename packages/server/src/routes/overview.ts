import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getOverview, getActRoutes, getAscensionStats, getPathComposition, getWinFingerprint, getActVariants } from '../analytics/overview.js';
import { extractFilter } from './utils.js';

const router = new Hono();

router.get('/', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json(getOverview(db, character, ascension, sinceRunId));
});

router.get('/act-routes', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json(getActRoutes(db, character, ascension, sinceRunId));
});

router.get('/ascension', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json(getAscensionStats(db, character, ascension, sinceRunId));
});

router.get('/path-composition', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json(getPathComposition(db, character, ascension, sinceRunId));
});

router.get('/win-fingerprint', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json(getWinFingerprint(db, character, ascension, sinceRunId));
});

router.get('/act-variants', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json(getActVariants(db, character, ascension, sinceRunId));
});

export default router;
