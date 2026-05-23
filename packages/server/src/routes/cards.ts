import { Hono } from 'hono';
import { db } from '../db/index.js';
import { getCardStats, getCardElo, getCardProgressionStats, getSkipRates, getCardStatsByDimension, getUpgradeImpact, getEnchantments } from '../analytics/cards.js';
import { extractFilter } from './utils.js';

const router = new Hono();

router.get('/', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({
    cards: getCardStats(db, character, ascension, sinceRunId),
    elo: getCardElo(db, character),
    progression: getCardProgressionStats(db, character, ascension, sinceRunId),
  });
});

router.get('/skip-rates', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json(getSkipRates(db, character, ascension, sinceRunId));
});

router.get('/by-dimension', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({
    rarity: getCardStatsByDimension(db, 'rarity', character, ascension, sinceRunId),
    type: getCardStatsByDimension(db, 'type', character, ascension, sinceRunId),
    color: getCardStatsByDimension(db, 'color', character, ascension, sinceRunId),
    cost: getCardStatsByDimension(db, 'cost', character, ascension, sinceRunId),
  });
});

router.get('/upgrade-impact', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({ upgrade_impact: getUpgradeImpact(db, character, ascension, sinceRunId) });
});

router.get('/enchantments', (c) => {
  const { character, ascension, sinceRunId } = extractFilter(c);
  return c.json({ enchantments: getEnchantments(db, character, ascension, sinceRunId) });
});

export default router;
