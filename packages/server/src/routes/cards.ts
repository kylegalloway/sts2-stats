import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getCardStats, getCardElo, getCardProgressionStats, getSkipRates, getCardStatsByDimension, getUpgradeImpact } from '../analytics/cards.js';

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

router.get('/by-dimension', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({
    rarity: getCardStatsByDimension(db, 'rarity', character),
    type: getCardStatsByDimension(db, 'type', character),
    color: getCardStatsByDimension(db, 'color', character),
    cost: getCardStatsByDimension(db, 'cost', character),
  });
});

router.get('/upgrade-impact', (c) => {
  const character = c.req.query('character') || undefined;
  return c.json({ upgrade_impact: getUpgradeImpact(db, character) });
});

export default router;
