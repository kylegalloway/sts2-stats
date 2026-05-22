import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DDL } from '../db/schema.js';
import { getCardStatsByDimension, getUpgradeImpact } from './cards.js';

let db: Database.Database;

function insertRun(
  id: number,
  character: string,
  victory: number,
  floorReached: number,
  rawJson?: Record<string, unknown>,
) {
  const defaultRaw = { players: [{ character: `CHARACTER.${character}`, deck: [], relics: [] }], acts: [], win: Boolean(victory) };
  db.prepare(`
    INSERT INTO runs (id, file_name, character, victory, ascension, floor_reached, raw_json, ingested_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, datetime('now'))
  `).run(id, `run_${id}.run`, character, victory, floorReached, JSON.stringify(rawJson ?? defaultRaw));
}

function insertCardChoice(runId: number, cardId: string, wasPicked: number, floor = 5) {
  db.prepare(`
    INSERT INTO card_choices (run_id, floor, card_id, was_picked, act)
    VALUES (?, ?, ?, ?, 'Act 1')
  `).run(runId, floor, cardId, wasPicked);
}

function insertCodexCard(id: string, rarity: string, type: string, color: string, cost: number) {
  db.prepare(`
    INSERT INTO spire_codex_cache (entity_type, entity_id, data_json, fetched_at)
    VALUES ('card', ?, ?, datetime('now'))
  `).run(id, JSON.stringify({ id, rarity, type, color, cost }));
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
});

describe('getCardStatsByDimension', () => {
  it('returns empty array when no codex data cached', () => {
    insertRun(1, 'IRONCLAD', 0, 10);
    insertCardChoice(1, 'STRIKE', 1);
    expect(getCardStatsByDimension(db, 'rarity')).toEqual([]);
  });

  it('groups cards by rarity', () => {
    insertRun(1, 'IRONCLAD', 1, 20);
    insertRun(2, 'IRONCLAD', 0, 10);

    insertCardChoice(1, 'BASH', 1);      // Common, picked in run 1
    insertCardChoice(2, 'BASH', 0);      // Common, not picked in run 2
    insertCardChoice(1, 'TWIN STRIKE', 1); // Uncommon, picked

    insertCodexCard('bash', 'Common', 'Attack', 'ironclad', 2);
    insertCodexCard('twin_strike', 'Uncommon', 'Attack', 'ironclad', 1);

    const result = getCardStatsByDimension(db, 'rarity');
    expect(result.length).toBe(2);

    const common = result.find((r) => r.group === 'Common')!;
    expect(common).toBeDefined();
    expect(common.total_cards).toBe(1);
  });

  it('filters by character', () => {
    insertRun(1, 'IRONCLAD', 1, 20);
    insertRun(2, 'SILENT', 1, 20);

    insertCardChoice(1, 'BASH', 1);
    insertCardChoice(2, 'ACROBATICS', 1);

    insertCodexCard('bash', 'Common', 'Attack', 'ironclad', 2);
    insertCodexCard('acrobatics', 'Common', 'Skill', 'silent', 0);

    const allResult = getCardStatsByDimension(db, 'rarity');
    const ironcladResult = getCardStatsByDimension(db, 'rarity', 'IRONCLAD');

    // Both characters contribute Common picks when no filter
    expect(allResult.find((r) => r.group === 'Common')!.total_cards).toBe(2);
    // Only Ironclad's card when filtered
    expect(ironcladResult.find((r) => r.group === 'Common')!.total_cards).toBe(1);
  });

  it('groups by type correctly', () => {
    insertRun(1, 'IRONCLAD', 1, 20);
    insertCardChoice(1, 'BASH', 1);
    insertCardChoice(1, 'ARMAMENTS', 1);

    insertCodexCard('bash', 'Common', 'Attack', 'ironclad', 2);
    insertCodexCard('armaments', 'Common', 'Skill', 'ironclad', 1);

    const result = getCardStatsByDimension(db, 'type');
    expect(result.map((r) => r.group).sort()).toEqual(['Attack', 'Skill'].sort());
  });

  it('groups by cost', () => {
    insertRun(1, 'IRONCLAD', 1, 20);
    insertCardChoice(1, 'BASH', 1);
    insertCardChoice(1, 'ARMAMENTS', 1);

    insertCodexCard('bash', 'Common', 'Attack', 'ironclad', 2);
    insertCodexCard('armaments', 'Common', 'Skill', 'ironclad', 1);

    const result = getCardStatsByDimension(db, 'cost');
    expect(result.map((r) => r.group).sort()).toEqual(['1', '2'].sort());
  });
});

describe('getUpgradeImpact', () => {
  it('returns empty array when no runs', () => {
    expect(getUpgradeImpact(db)).toEqual([]);
  });

  it('buckets cards by upgrade level', () => {
    // 3 runs with BASH upgraded (level 1), 3 runs with BASH base (level 0)
    for (let i = 1; i <= 3; i++) {
      const rawUpgraded = {
        players: [{ character: 'CHARACTER.IRONCLAD', deck: [{ id: 'CARD.BASH', current_upgrade_level: 1, floor_added_to_deck: 1 }], relics: [] }],
        acts: [], win: true,
      };
      insertRun(i, 'IRONCLAD', 1, 20, rawUpgraded);
    }
    for (let i = 4; i <= 6; i++) {
      const rawBase = {
        players: [{ character: 'CHARACTER.IRONCLAD', deck: [{ id: 'CARD.BASH', current_upgrade_level: 0, floor_added_to_deck: 1 }], relics: [] }],
        acts: [], win: false,
      };
      insertRun(i, 'IRONCLAD', 0, 10, rawBase);
    }

    const result = getUpgradeImpact(db);
    const bash = result.find((r) => r.card_id === 'BASH')!;
    expect(bash).toBeDefined();
    expect(bash.runs_with_upgraded).toBe(3);
    expect(bash.runs_with_base).toBe(3);
    expect(bash.win_rate_upgraded).toBe(1);
    expect(bash.win_rate_base).toBe(0);
  });

  it('excludes cards with fewer than 3 runs in both buckets', () => {
    // Only 2 upgraded runs, 2 base runs — below threshold
    for (let i = 1; i <= 2; i++) {
      const raw = {
        players: [{ character: 'CHARACTER.IRONCLAD', deck: [{ id: 'CARD.BASH', current_upgrade_level: 1, floor_added_to_deck: 1 }], relics: [] }],
        acts: [], win: true,
      };
      insertRun(i, 'IRONCLAD', 1, 20, raw);
    }
    for (let i = 3; i <= 4; i++) {
      const raw = {
        players: [{ character: 'CHARACTER.IRONCLAD', deck: [{ id: 'CARD.BASH', current_upgrade_level: 0, floor_added_to_deck: 1 }], relics: [] }],
        acts: [], win: false,
      };
      insertRun(i, 'IRONCLAD', 0, 10, raw);
    }

    const result = getUpgradeImpact(db);
    // Both buckets have 2 runs each — below MIN=3 for both, but each is below threshold
    // The function includes cards where at least one bucket meets MIN
    const bash = result.find((r) => r.card_id === 'BASH');
    // Both buckets < 3, so bash should be absent
    expect(bash).toBeUndefined();
  });

  it('filters by character', () => {
    for (let i = 1; i <= 3; i++) {
      const rawIronclad = {
        players: [{ character: 'CHARACTER.IRONCLAD', deck: [{ id: 'CARD.BASH', current_upgrade_level: 1, floor_added_to_deck: 1 }], relics: [] }],
        acts: [], win: true,
      };
      insertRun(i, 'IRONCLAD', 1, 20, rawIronclad);
    }
    for (let i = 4; i <= 6; i++) {
      const rawSilent = {
        players: [{ character: 'CHARACTER.SILENT', deck: [{ id: 'CARD.ACROBATICS', current_upgrade_level: 1, floor_added_to_deck: 1 }], relics: [] }],
        acts: [], win: true,
      };
      insertRun(i, 'SILENT', 1, 20, rawSilent);
    }

    const ironcladResult = getUpgradeImpact(db, 'IRONCLAD');
    // BASH has 3 upgraded runs but 0 base runs — included with null base stats
    const bash = ironcladResult.find((r) => r.card_id === 'BASH');
    expect(bash).toBeDefined();
    expect(bash!.runs_with_upgraded).toBe(3);
    expect(bash!.win_rate_base).toBeNull();
    // ACROBATICS belongs to Silent runs, not included when filtered to IRONCLAD
    expect(ironcladResult.some((r) => r.card_id === 'ACROBATICS')).toBe(false);
  });
});
