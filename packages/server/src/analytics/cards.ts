import type Database from 'better-sqlite3';
import { wilsonLower } from './stats-utils.js';

export interface CardStat {
  card_id: string;
  offered: number;
  picked: number;
  pick_rate: number;
  win_rate: number;
  // Wilson lower bound of pick_rate × win_rate — shrinks toward 0 for small samples.
  quality_score: number;
}

export interface CardElo {
  card_id: string;
  elo: number;
}

export function getCardStats(db: Database.Database, character?: string): CardStat[] {
  const where = character ? 'WHERE r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      cc.card_id,
      COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END) +
        COUNT(DISTINCT CASE WHEN cc.was_picked = 0 THEN cc.run_id END) AS offered,
      COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END) AS picked,
      CAST(COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END) AS REAL) /
        NULLIF(COUNT(DISTINCT cc.run_id), 0) AS pick_rate,
      CAST(SUM(CASE WHEN cc.was_picked = 1 THEN r.victory ELSE 0 END) AS REAL) /
        NULLIF(COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END), 0) AS win_rate,
      0 AS quality_score
    FROM card_choices cc
    JOIN runs r ON r.id = cc.run_id
    ${where}
    GROUP BY cc.card_id
    ORDER BY pick_rate DESC
  `).all(...params).map((row: unknown) => {
    const r = row as CardStat;
    // pick_rate has large n (offered), so raw value is stable.
    // win_rate only has n=picked, so apply Wilson lower bound to dampen small samples.
    return { ...r, quality_score: (r.pick_rate ?? 0) * wilsonLower(Math.round((r.win_rate ?? 0) * r.picked), r.picked) };
  });
}

export function getCardElo(db: Database.Database, character?: string): CardElo[] {
  const where = character ? 'WHERE character = ?' : '';
  const params = character ? [character] : [];
  return db.prepare(`SELECT card_id, elo FROM card_elo ${where} ORDER BY elo DESC`).all(...params) as CardElo[];
}

export interface CardProgressionStat {
  card_id: string;
  times_offered: number;
  times_picked: number;
  pick_rate: number;
  avg_floor_when_picked: number | null;
  avg_floor_when_passed: number | null;
  floor_delta: number | null;
  global_avg_floor: number;
  overrated_score: number;
  underrated_score: number;
}

export function getCardProgressionStats(db: Database.Database, character?: string): CardProgressionStat[] {
  const charWhere = character ? 'WHERE r.character = ?' : '';
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character, character, character] : [];

  const rows = db.prepare(`
    WITH global_stats AS (
      SELECT AVG(CAST(floor_reached AS REAL)) as avg_floor
      FROM runs r
      ${charWhere}
    ),
    picked_floors AS (
      SELECT DISTINCT cc.run_id, cc.floor
      FROM card_choices cc
      JOIN runs r ON r.id = cc.run_id
      WHERE cc.was_picked = 1 ${charAnd}
    )
    SELECT
      cc.card_id,
      COUNT(DISTINCT cc.run_id) as times_offered,
      COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END) as times_picked,
      CAST(COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END) AS REAL) /
        NULLIF(COUNT(DISTINCT cc.run_id), 0) as pick_rate,
      AVG(CASE WHEN cc.was_picked = 1 THEN r.floor_reached END) as avg_floor_when_picked,
      AVG(CASE WHEN cc.was_picked = 0 AND pf.run_id IS NOT NULL THEN r.floor_reached END) as avg_floor_when_passed,
      (SELECT avg_floor FROM global_stats) as global_avg_floor
    FROM card_choices cc
    JOIN runs r ON r.id = cc.run_id
    LEFT JOIN picked_floors pf ON pf.run_id = cc.run_id AND pf.floor = cc.floor AND cc.was_picked = 0
    ${charWhere}
    GROUP BY cc.card_id
    HAVING COUNT(DISTINCT cc.run_id) >= 3
    ORDER BY cc.card_id
  `).all(...params) as Array<{
    card_id: string;
    times_offered: number;
    times_picked: number;
    pick_rate: number;
    avg_floor_when_picked: number | null;
    avg_floor_when_passed: number | null;
    global_avg_floor: number;
  }>;

  return rows.map((r) => {
    const delta =
      r.avg_floor_when_picked != null && r.avg_floor_when_passed != null
        ? r.avg_floor_when_picked - r.avg_floor_when_passed
        : null;
    return {
      ...r,
      floor_delta: delta,
      overrated_score: delta != null && delta < 0 ? r.pick_rate * -delta : 0,
      underrated_score: delta != null && delta > 0 ? (1 - r.pick_rate) * delta : 0,
    };
  });
}

export interface CardActWinRate {
  card_id: string;
  act: string;
  times_picked: number;
  win_rate: number | null;
}

export function getCardActWinRates(db: Database.Database, character?: string): CardActWinRate[] {
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      cc.card_id,
      cc.act,
      COUNT(DISTINCT cc.run_id) AS times_picked,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(DISTINCT cc.run_id), 0) AS win_rate
    FROM card_choices cc
    JOIN runs r ON r.id = cc.run_id
    WHERE cc.was_picked = 1
      AND cc.act IS NOT NULL
      ${character ? 'AND r.character = ?' : ''}
    GROUP BY cc.card_id, cc.act
    HAVING COUNT(DISTINCT cc.run_id) >= 3
    ORDER BY cc.card_id, cc.act
  `).all(...params) as CardActWinRate[];
}

export interface CardFloorAdjustedWinRate {
  card_id: string;
  times_offered_picked: number;
  floor_adjusted_win_rate: number | null;
}

// Win rate among runs that reached the floor where the card was offered —
// eliminates survivorship bias from runs that never got that deep.
export function getCardFloorAdjustedWinRates(db: Database.Database, character?: string): CardFloorAdjustedWinRate[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    WITH offer_floors AS (
      SELECT cc.card_id, cc.run_id, cc.floor, cc.was_picked, r.victory
      FROM card_choices cc
      JOIN runs r ON r.id = cc.run_id
      WHERE cc.was_picked = 1 ${charAnd}
    ),
    eligible AS (
      SELECT of1.card_id, of1.run_id, of1.floor, of1.victory
      FROM offer_floors of1
      WHERE EXISTS (
        SELECT 1 FROM runs r2
        WHERE r2.id != of1.run_id
          AND r2.floor_reached >= of1.floor
          ${charAnd}
      )
    )
    SELECT
      card_id,
      COUNT(DISTINCT run_id) AS times_offered_picked,
      CAST(SUM(victory) AS REAL) / NULLIF(COUNT(DISTINCT run_id), 0) AS floor_adjusted_win_rate
    FROM eligible
    GROUP BY card_id
    HAVING COUNT(DISTINCT run_id) >= 3
    ORDER BY floor_adjusted_win_rate DESC
  `).all(...params, ...params) as CardFloorAdjustedWinRate[];
}

export interface CardSynergyFloor {
  card_id: string;
  paired_card_id: string;
  co_occurrence_count: number;
  avg_floor_both: number | null;
  avg_floor_card_only: number | null;
  avg_floor_paired_only: number | null;
  floor_lift: number | null;
}

// Average floor reached when both cards are picked vs. each alone.
export function getCardSynergyFloors(db: Database.Database, character?: string, minOccurrences = 3): CardSynergyFloor[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params: unknown[] = character ? [character, character, character] : [];
  params.push(minOccurrences);

  return db.prepare(`
    WITH picked AS (
      SELECT cc.run_id, cc.card_id
      FROM card_choices cc
      JOIN runs r ON r.id = cc.run_id
      WHERE cc.was_picked = 1 ${charAnd}
    )
    SELECT
      a.card_id,
      b.card_id AS paired_card_id,
      COUNT(*) AS co_occurrence_count,
      AVG(r.floor_reached) AS avg_floor_both,
      (
        SELECT AVG(r2.floor_reached) FROM picked p2
        JOIN runs r2 ON r2.id = p2.run_id
        WHERE p2.card_id = a.card_id
          AND NOT EXISTS (SELECT 1 FROM picked p3 WHERE p3.run_id = p2.run_id AND p3.card_id = b.card_id)
      ) AS avg_floor_card_only,
      (
        SELECT AVG(r2.floor_reached) FROM picked p2
        JOIN runs r2 ON r2.id = p2.run_id
        WHERE p2.card_id = b.card_id
          AND NOT EXISTS (SELECT 1 FROM picked p3 WHERE p3.run_id = p2.run_id AND p3.card_id = a.card_id)
      ) AS avg_floor_paired_only
    FROM picked a
    JOIN picked b ON b.run_id = a.run_id AND b.card_id > a.card_id
    JOIN runs r ON r.id = a.run_id
    GROUP BY a.card_id, b.card_id
    HAVING COUNT(*) >= ?
    ORDER BY co_occurrence_count DESC
  `).all(...params).map((row: unknown) => {
    const r = row as Omit<CardSynergyFloor, 'floor_lift'>;
    const baseline = r.avg_floor_card_only != null && r.avg_floor_paired_only != null
      ? Math.max(r.avg_floor_card_only, r.avg_floor_paired_only)
      : null;
    return {
      ...r,
      floor_lift: r.avg_floor_both != null && baseline != null ? r.avg_floor_both - baseline : null,
    };
  }) as CardSynergyFloor[];
}

export interface CardDivergence {
  card_id: string;
  pick_rate: number;
  win_rate: number | null;
  divergence: number;
  type: 'overrated' | 'underrated' | 'neutral';
}

// pick_rate - win_rate: positive = overrated (picked more than it wins), negative = underrated.
export function getCardDivergence(db: Database.Database, character?: string): CardDivergence[] {
  return getCardStats(db, character)
    .filter((c) => c.offered >= 3 && c.win_rate != null)
    .map((c) => {
      const divergence = c.pick_rate - (c.win_rate ?? 0);
      return {
        card_id: c.card_id,
        pick_rate: c.pick_rate,
        win_rate: c.win_rate,
        divergence,
        type: (divergence > 0.1 ? 'overrated' : divergence < -0.1 ? 'underrated' : 'neutral') as CardDivergence['type'],
      };
    })
    .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));
}

export interface CardCarryingStat {
  card_id: string;
  times_picked: number;
  avg_floors_carried: number | null;
  avg_pick_floor: number | null;
  avg_final_floor: number | null;
}

// avg(floor_reached - floor_when_picked) for runs where the card was picked.
// High value = card appears early and you go deep; low = picked late in a short run.
export function getCardCarryingStats(db: Database.Database, character?: string): CardCarryingStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      cc.card_id,
      COUNT(DISTINCT cc.run_id) AS times_picked,
      AVG(CAST(r.floor_reached - cc.floor AS REAL)) AS avg_floors_carried,
      AVG(cc.floor) AS avg_pick_floor,
      AVG(r.floor_reached) AS avg_final_floor
    FROM card_choices cc
    JOIN runs r ON r.id = cc.run_id
    WHERE cc.was_picked = 1 ${charAnd}
    GROUP BY cc.card_id
    HAVING COUNT(DISTINCT cc.run_id) >= 3
    ORDER BY avg_floors_carried DESC
  `).all(...params) as CardCarryingStat[];
}

export interface CardInflectionStat {
  card_id: string;
  // Runs where this card was in-hand (picked) at or before the inflection floor.
  runs_present_at_inflection: number;
  avg_hp_pct_drop: number | null;
  avg_hp_deficit: number | null;
  avg_floor_reached: number | null;
  win_rate: number | null;
}

// For each card: among runs where the card was picked before or at the inflection
// floor, how bad was the inflection on average? Low hp_deficit (very negative)
// means the card was present during your worst HP crises.
export function getCardInflectionStats(db: Database.Database, character?: string): CardInflectionStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    SELECT
      cc.card_id,
      COUNT(DISTINCT cc.run_id) AS runs_present_at_inflection,
      AVG(ri.hp_pct_drop) AS avg_hp_pct_drop,
      AVG(ri.hp_deficit) AS avg_hp_deficit,
      AVG(r.floor_reached) AS avg_floor_reached,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(DISTINCT cc.run_id), 0) AS win_rate
    FROM card_choices cc
    JOIN runs r ON r.id = cc.run_id
    JOIN run_inflection ri ON ri.run_id = cc.run_id
    WHERE cc.was_picked = 1
      AND cc.floor <= ri.inflection_floor
      ${charAnd}
    GROUP BY cc.card_id
    HAVING COUNT(DISTINCT cc.run_id) >= 3
    ORDER BY avg_hp_deficit ASC
  `).all(...params) as CardInflectionStat[];
}

export type CardDimension = 'rarity' | 'type' | 'color' | 'cost';

export interface DimensionStat {
  group: string;
  total_cards: number;
  total_offered: number;
  total_picked: number;
  pick_rate: number;
  win_rate: number | null;
  avg_elo: number | null;
}

export function getCardStatsByDimension(
  db: Database.Database,
  dimension: CardDimension,
  character?: string,
): DimensionStat[] {
  const field = `json_extract(c.data_json, '$.${dimension}')`;
  const charWhere = character ? 'AND r.character = ?' : '';
  const charAnd2 = character ? 'AND ce.character = ?' : '';
  const params: unknown[] = character ? [character, character] : [];

  return db.prepare(`
    SELECT
      CAST(${field} AS TEXT) AS "group",
      COUNT(DISTINCT cc.card_id) AS total_cards,
      COUNT(DISTINCT CASE WHEN cc.was_picked = 0 THEN cc.run_id || ':' || cc.card_id END) +
        COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id || ':' || cc.card_id END) AS total_offered,
      COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id || ':' || cc.card_id END) AS total_picked,
      CAST(COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id || ':' || cc.card_id END) AS REAL) /
        NULLIF(COUNT(DISTINCT cc.run_id || ':' || cc.card_id), 0) AS pick_rate,
      CAST(SUM(CASE WHEN cc.was_picked = 1 THEN r.victory ELSE 0 END) AS REAL) /
        NULLIF(COUNT(DISTINCT CASE WHEN cc.was_picked = 1 THEN cc.run_id END), 0) AS win_rate,
      AVG(ce.elo) AS avg_elo
    FROM card_choices cc
    JOIN runs r ON r.id = cc.run_id
    JOIN spire_codex_cache c ON c.entity_type = 'card'
      AND c.entity_id = LOWER(REPLACE(cc.card_id, ' ', '_'))
    LEFT JOIN card_elo ce ON ce.card_id = cc.card_id ${charAnd2}
    WHERE ${field} IS NOT NULL ${charWhere}
    GROUP BY CAST(${field} AS TEXT)
    ORDER BY pick_rate DESC
  `).all(...params) as DimensionStat[];
}

export interface UpgradeImpact {
  card_id: string;
  runs_with_upgraded: number;
  runs_with_base: number;
  win_rate_upgraded: number | null;
  win_rate_base: number | null;
  avg_floor_upgraded: number | null;
  avg_floor_base: number | null;
}

function cleanCardId(raw: string): string {
  let s = raw ?? '';
  if (s.startsWith('CARD.')) s = s.slice(5);
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getUpgradeImpact(db: Database.Database, character?: string): UpgradeImpact[] {
  const charWhere = character ? 'WHERE character = ?' : '';
  const params: unknown[] = character ? [character] : [];

  const runs = db.prepare(
    `SELECT id, raw_json, victory, floor_reached FROM runs ${charWhere}`
  ).all(...params) as { id: number; raw_json: string; victory: number; floor_reached: number }[];

  const buckets = new Map<string, {
    upgraded_wins: number; upgraded_total: number; upgraded_floors: number;
    base_wins: number; base_total: number; base_floors: number;
  }>();

  for (const run of runs) {
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(run.raw_json) as Record<string, unknown>; } catch { continue; }
    const player = ((raw.players as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
    const deck = (player.deck as Record<string, unknown>[] | undefined) ?? [];

    const seen = new Set<string>();
    for (const card of deck) {
      const id = cleanCardId((card.id as string | null) ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const upgraded = ((card.current_upgrade_level as number | null) ?? 0) > 0;
      if (!buckets.has(id)) {
        buckets.set(id, { upgraded_wins: 0, upgraded_total: 0, upgraded_floors: 0, base_wins: 0, base_total: 0, base_floors: 0 });
      }
      const b = buckets.get(id)!;
      if (upgraded) {
        b.upgraded_total++;
        b.upgraded_wins += run.victory;
        b.upgraded_floors += run.floor_reached ?? 0;
      } else {
        b.base_total++;
        b.base_wins += run.victory;
        b.base_floors += run.floor_reached ?? 0;
      }
    }
  }

  const MIN = 3;
  const results: UpgradeImpact[] = [];
  for (const [card_id, b] of buckets.entries()) {
    if (b.upgraded_total < MIN && b.base_total < MIN) continue;
    results.push({
      card_id,
      runs_with_upgraded: b.upgraded_total,
      runs_with_base: b.base_total,
      win_rate_upgraded: b.upgraded_total >= MIN ? b.upgraded_wins / b.upgraded_total : null,
      win_rate_base: b.base_total >= MIN ? b.base_wins / b.base_total : null,
      avg_floor_upgraded: b.upgraded_total >= MIN ? b.upgraded_floors / b.upgraded_total : null,
      avg_floor_base: b.base_total >= MIN ? b.base_floors / b.base_total : null,
    });
  }

  return results.sort((a, b) => {
    const da = (a.win_rate_upgraded ?? 0) - (a.win_rate_base ?? 0);
    const db2 = (b.win_rate_upgraded ?? 0) - (b.win_rate_base ?? 0);
    return Math.abs(db2) - Math.abs(da);
  });
}

export interface SkipRateStat {
  act: string;
  total_choices: number;
  skipped: number;
  skip_rate: number;
}

export function getSkipRates(db: Database.Database, character?: string): SkipRateStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    WITH choice_floors AS (
      SELECT cc.run_id, cc.floor, cc.act,
        MAX(cc.was_picked) AS any_picked
      FROM card_choices cc
      JOIN runs r ON r.id = cc.run_id
      WHERE cc.act IS NOT NULL ${charAnd}
      GROUP BY cc.run_id, cc.floor, cc.act
    )
    SELECT
      act,
      COUNT(*) AS total_choices,
      SUM(CASE WHEN any_picked = 0 THEN 1 ELSE 0 END) AS skipped,
      CAST(SUM(CASE WHEN any_picked = 0 THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) AS skip_rate
    FROM choice_floors
    GROUP BY act
    ORDER BY act
  `).all(...params) as SkipRateStat[];
}

// Rebuild ELO for a character from scratch in chronological order (K=32).
export function rebuildElo(db: Database.Database, character: string) {
  const choices = db.prepare(`
    SELECT cc.floor, cc.card_id, cc.was_picked, r.id as run_id
    FROM card_choices cc
    JOIN runs r ON r.id = cc.run_id
    WHERE r.character = ?
    ORDER BY r.timestamp, r.id, cc.floor
  `).all(character) as { floor: number; card_id: string; was_picked: number; run_id: number }[];

  // Group choices into matchups per (run, floor)
  const matchups = new Map<string, { picked: string; notPicked: string[] }>();
  for (const row of choices) {
    const key = `${row.run_id}:${row.floor}`;
    if (!matchups.has(key)) matchups.set(key, { picked: '', notPicked: [] });
    const m = matchups.get(key)!;
    if (row.was_picked) m.picked = row.card_id;
    else m.notPicked.push(row.card_id);
  }

  const elo: Record<string, number> = {};
  const K = 32;

  for (const { picked, notPicked } of matchups.values()) {
    if (!picked) continue;
    elo[picked] ??= 1000;
    for (const opp of notPicked) {
      elo[opp] ??= 1000;
      const expected = 1 / (1 + Math.pow(10, (elo[opp] - elo[picked]) / 400));
      elo[picked] += K * (1 - expected);
      elo[opp] += K * (0 - (1 - expected));
    }
  }

  const upsert = db.prepare(`
    INSERT INTO card_elo (character, card_id, elo) VALUES (?, ?, ?)
    ON CONFLICT (character, card_id) DO UPDATE SET elo = excluded.elo
  `);

  db.transaction(() => {
    for (const [card_id, eloVal] of Object.entries(elo)) {
      upsert.run(character, card_id, eloVal);
    }
  })();
}

export interface EnchantmentStat {
  enchantment_id: string;
  total_runs: number;
  wins: number;
  win_rate: number;
}

export function getEnchantments(db: Database.Database, character?: string): EnchantmentStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const p = character ? [character] : [];

  return db.prepare(`
    SELECT
      fd.enchantment_id,
      COUNT(DISTINCT fd.run_id) AS total_runs,
      SUM(r.victory) AS wins,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(DISTINCT fd.run_id), 0) AS win_rate
    FROM final_deck fd
    JOIN runs r ON r.id = fd.run_id
    WHERE fd.enchantment_id IS NOT NULL ${charAnd}
    GROUP BY fd.enchantment_id
    ORDER BY total_runs DESC
  `).all(...p) as EnchantmentStat[];
}
