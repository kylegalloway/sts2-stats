import type Database from 'better-sqlite3';
import { STARTING_RELICS } from './relics.js';

// Basic/curse cards that appear in every run and add no signal.
const BASIC_CARDS = new Set([
  'Strike', 'Defend', 'Bash', 'Neutralize', 'Survivor', 'Zap', 'Dualcast',
  'Eruption', 'Vigilance', 'Smite', 'Icicle', 'Wound', 'Slimed', 'Dazed',
  'Burn', 'Void', 'Curse Of The Bell', 'Pride', 'Shame', 'Normality', 'Parasite',
  'Clumsy', 'Pain', 'Writhe', 'Regret', 'Doubt', 'Injury', 'Decay',
]);

const STARTING_RELIC_LIST = [...STARTING_RELICS];
const NOT_STARTER_RELIC = `ro.relic_key NOT IN (${STARTING_RELIC_LIST.map(() => '?').join(',')})`;

export interface Core {
  character: string;
  relics: string[];
  cards: string[];
  run_count: number;
  win_rate: number;
  baseline_wr: number;
  lift: number;
  avg_floor: number;
  baseline_avg_floor: number;
  floor_delta: number;
}

export interface Synergy {
  character: string;
  card_id: string;
  relic_key: string;
  occurrences: number;
  win_rate: number;
  baseline_wr: number;
  lift: number;
  avg_floor: number;
  baseline_avg_floor: number;
  floor_delta: number;
}

export function getCores(
  db: Database.Database,
  character?: string,
  minRuns = 3
): Core[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const charParams = character ? [character] : [];

  const baselineRows = db.prepare(
    `SELECT character, AVG(victory) as wr, AVG(floor_reached) as avg_floor FROM runs ${character ? 'WHERE character = ?' : ''} GROUP BY character`
  ).all(...charParams) as { character: string; wr: number; avg_floor: number }[];
  const baseline = new Map(baselineRows.map((r) => [r.character, r]));

  // Find relic pairs that anchor winning cores.
  const pairRows = db.prepare(`
    WITH relics AS (
      SELECT ro.run_id, ro.relic_key
      FROM relics_obtained ro
      JOIN runs r ON r.id = ro.run_id
      WHERE ${NOT_STARTER_RELIC} ${charAnd}
    )
    SELECT
      r.character,
      a.relic_key AS relic_a,
      b.relic_key AS relic_b,
      COUNT(*) AS run_count,
      CAST(SUM(r.victory) AS REAL) / COUNT(*) AS win_rate,
      AVG(r.floor_reached) AS avg_floor
    FROM relics a
    JOIN relics b ON b.run_id = a.run_id AND b.relic_key > a.relic_key
    JOIN runs r ON r.id = a.run_id
    GROUP BY r.character, a.relic_key, b.relic_key
    HAVING COUNT(*) >= ?
    ORDER BY win_rate DESC, run_count DESC
  `).all(...STARTING_RELIC_LIST, ...charParams, minRuns) as {
    character: string;
    relic_a: string;
    relic_b: string;
    run_count: number;
    win_rate: number;
    avg_floor: number;
  }[];

  // For each pair, collect run IDs and find the most-picked cards in those runs.
  const cores: Core[] = [];

  for (const pair of pairRows) {
    const b = baseline.get(pair.character);
    const bwr = b?.wr ?? 0;
    const bfloor = b?.avg_floor ?? 0;
    const lift = bwr > 0 ? pair.win_rate / bwr : 0;
    if (lift < 1.1) continue;

    // Get run IDs that contain both relics.
    const runIds = db.prepare(`
      SELECT a.run_id
      FROM relics_obtained a
      JOIN relics_obtained b ON b.run_id = a.run_id AND b.relic_key = ?
      JOIN runs r ON r.id = a.run_id
      WHERE a.relic_key = ? ${charAnd}
    `).all(pair.relic_b, pair.relic_a, ...charParams) as { run_id: number }[];

    if (runIds.length < minRuns) continue;

    const ids = runIds.map((r) => r.run_id);
    const placeholders = ids.map(() => '?').join(',');

    // Find cards picked in at least 60% of these runs (excluding basics).
    const cardRows = db.prepare(`
      SELECT card_id, COUNT(DISTINCT run_id) AS pick_count
      FROM card_choices
      WHERE was_picked = 1 AND run_id IN (${placeholders})
      GROUP BY card_id
      HAVING COUNT(DISTINCT run_id) >= ?
      ORDER BY pick_count DESC
      LIMIT 10
    `).all(...ids, Math.ceil(ids.length * 0.6)) as { card_id: string; pick_count: number }[];

    const cards = cardRows
      .map((r) => r.card_id)
      .filter((id) => !BASIC_CARDS.has(id));

    if (cards.length < 2) continue;

    cores.push({
      character: pair.character,
      relics: [pair.relic_a, pair.relic_b],
      cards,
      run_count: pair.run_count,
      win_rate: pair.win_rate,
      baseline_wr: bwr,
      lift,
      avg_floor: pair.avg_floor,
      baseline_avg_floor: bfloor,
      floor_delta: pair.avg_floor - bfloor,
    });
  }

  return cores;
}

export function getSynergies(
  db: Database.Database,
  character?: string,
  minOccurrences = 5
): Synergy[] {
  const charFilter = character ? 'AND r.character = ?' : '';
  const params: unknown[] = [];
  if (character) params.push(character);
  params.push(minOccurrences);

  const baselineRows = db.prepare(
    `SELECT character, AVG(victory) as wr, AVG(floor_reached) as avg_floor FROM runs ${character ? 'WHERE character = ?' : ''} GROUP BY character`
  ).all(...(character ? [character] : [])) as { character: string; wr: number; avg_floor: number }[];

  const baseline = new Map(baselineRows.map((r) => [r.character, r]));

  const rows = db.prepare(`
    SELECT
      r.character,
      cc.card_id,
      ro.relic_key,
      COUNT(*) AS occurrences,
      CAST(SUM(r.victory) AS REAL) / COUNT(*) AS win_rate,
      AVG(r.floor_reached) AS avg_floor
    FROM card_choices cc
    JOIN relics_obtained ro ON ro.run_id = cc.run_id
    JOIN runs r ON r.id = cc.run_id
    WHERE cc.was_picked = 1
      ${charFilter}
    GROUP BY r.character, cc.card_id, ro.relic_key
    HAVING COUNT(*) >= ?
    ORDER BY win_rate DESC
  `).all(...params) as Omit<Synergy, 'baseline_wr' | 'lift' | 'baseline_avg_floor' | 'floor_delta'>[];

  return rows.map((row) => {
    const b = baseline.get(row.character);
    const bwr = b?.wr ?? 0;
    const bfloor = b?.avg_floor ?? 0;
    return {
      ...row,
      baseline_wr: bwr,
      lift: bwr > 0 ? row.win_rate / bwr : 0,
      baseline_avg_floor: bfloor,
      floor_delta: row.avg_floor - bfloor,
    };
  });
}
