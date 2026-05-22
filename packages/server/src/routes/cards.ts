import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getCardStats, getCardElo, getCardProgressionStats, getSkipRates } from '../analytics/cards.js';

const router = new Hono();

router.get('/', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({
    cards: getCardStats(db, character),
    elo: getCardElo(db, character),
    progression: getCardProgressionStats(db, character),
  });
});

router.get('/skip-rates', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json(getSkipRates(db, character));
});

export default router;
