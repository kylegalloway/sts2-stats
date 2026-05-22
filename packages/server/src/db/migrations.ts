import type Database from 'better-sqlite3';
import { rebuildElo } from '../analytics/cards.js';

const ACT_BOUNDS: [string, number, number][] = [
  ['Act 1', 1, 16], ['Act 2', 17, 33], ['Act 3+', 34, 999],
];
function mFloorToAct(floor: number): string {
  for (const [name, lo, hi] of ACT_BOUNDS) {
    if (floor >= lo && floor <= hi) return name;
  }
  return 'Act 3+';
}
function mCleanId(raw: string, prefix = ''): string {
  let s = raw ?? '';
  if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length);
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Add migration functions here as the schema evolves.
// Each migration is keyed by version number and runs exactly once.
const MIGRATIONS: Record<number, (db: Database.Database) => void> = {
  2: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS floor_nodes (
      run_id       INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      floor        INTEGER NOT NULL,
      node_type    TEXT,
      encounter_id TEXT,
      act          TEXT,
      PRIMARY KEY (run_id, floor)
    );
    CREATE INDEX IF NOT EXISTS idx_floor_nodes_run_id ON floor_nodes(run_id);
    CREATE INDEX IF NOT EXISTS idx_floor_nodes_node_type ON floor_nodes(node_type);
  `),
  3: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS potion_events (
        id         INTEGER PRIMARY KEY,
        run_id     INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        floor      INTEGER NOT NULL,
        room_type  TEXT,
        act        TEXT,
        potion_id  TEXT NOT NULL,
        event_type TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_potion_events_run_id ON potion_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_potion_events_potion_id ON potion_events(potion_id);
    `);

    const runs = db.prepare('SELECT id, raw_json FROM runs').all() as { id: number; raw_json: string }[];
    const insert = db.prepare(
      'INSERT OR IGNORE INTO potion_events (run_id, floor, room_type, act, potion_id, event_type) VALUES (?, ?, ?, ?, ?, ?)'
    );

    db.transaction(() => {
      for (const run of runs) {
        try {
          const raw = JSON.parse(run.raw_json) as Record<string, unknown>;
          const mph = ((raw.map_point_history as unknown[][] | undefined) ?? []).flat() as Record<string, unknown>[];
          for (let idx = 0; idx < mph.length; idx++) {
            const pt = mph[idx] as Record<string, unknown>;
            const floor = idx + 1;
            const act = mFloorToAct(floor);
            const roomsRaw = (pt.rooms as Record<string, unknown>[] | undefined) ?? [];
            const roomType = (roomsRaw[0]?.room_type as string | null) ?? null;
            const psList = (pt.player_stats as Record<string, unknown>[] | undefined) ?? [];
            const ps = psList[0] ?? {};

            for (const pc of (ps.potion_choices as Record<string, unknown>[] | undefined) ?? []) {
              const potionId = mCleanId((pc.choice as string | null) ?? '', 'POTION.');
              if (potionId) insert.run(run.id, floor, roomType, act, potionId, pc.was_picked ? 'obtained' : 'declined');
            }
            for (const p of (ps.potion_used as string[] | undefined) ?? []) {
              const potionId = mCleanId(p, 'POTION.');
              if (potionId) insert.run(run.id, floor, roomType, act, potionId, 'used');
            }
            for (const p of (ps.potion_discarded as string[] | undefined) ?? []) {
              const potionId = mCleanId(p, 'POTION.');
              if (potionId) insert.run(run.id, floor, roomType, act, potionId, 'discarded');
            }
          }
        } catch { /* skip malformed */ }
      }
    })();
  },
  4: (db) => {
    // Backfill card_choices from raw_json using the corrected format:
    // each entry in ps.card_choices is {card: {id, ...}, was_picked: bool},
    // not {cards: [...]} as the original normalize code assumed.
    const runs = db.prepare('SELECT id, raw_json FROM runs').all() as { id: number; raw_json: string }[];
    const insert = db.prepare(
      'INSERT OR IGNORE INTO card_choices (run_id, floor, card_id, was_picked, act) VALUES (?, ?, ?, ?, ?)'
    );

    db.transaction(() => {
      for (const run of runs) {
        try {
          const raw = JSON.parse(run.raw_json) as Record<string, unknown>;
          const mph = ((raw.map_point_history as unknown[][] | undefined) ?? []).flat() as Record<string, unknown>[];
          for (let idx = 0; idx < mph.length; idx++) {
            const pt = mph[idx] as Record<string, unknown>;
            const floor = idx + 1;
            const act = mFloorToAct(floor);
            const psList = (pt.player_stats as Record<string, unknown>[] | undefined) ?? [];
            const ps = psList[0] ?? {};
            const choicesRaw = (ps.card_choices as Record<string, unknown>[] | undefined) ?? [];
            if (choicesRaw.length === 0) continue;
            let picked: string | null = null;
            const notPicked: string[] = [];
            for (const entry of choicesRaw) {
              const cardObj = (entry.card as Record<string, unknown> | null) ?? {};
              const idRaw = (cardObj.id as string | null) ?? '';
              const id = mCleanId(idRaw, 'CARD.');
              if (entry.was_picked) picked = id;
              else if (id) notPicked.push(id);
            }
            if (picked) insert.run(run.id, floor, picked, 1, act);
            for (const np of notPicked) insert.run(run.id, floor, np, 0, act);
          }
        } catch { /* skip malformed */ }
      }
    })();

    const characters = (db.prepare('SELECT DISTINCT character FROM runs').all() as { character: string }[]).map((r) => r.character);
    for (const character of characters) rebuildElo(db, character);
  },
  5: (db) => {
    // ELO rebuild after card_choices backfill in migration 4.
    const characters = (db.prepare('SELECT DISTINCT character FROM runs').all() as { character: string }[]).map((r) => r.character);
    for (const character of characters) rebuildElo(db, character);
  },
  6: (db) => {
    // Backfill relics_obtained from players[0].relics — the original normalize code
    // incorrectly looked for relics in player_stats[i].relics which doesn't exist.
    const runs = db.prepare('SELECT id, raw_json FROM runs').all() as { id: number; raw_json: string }[];
    const insert = db.prepare(
      'INSERT OR IGNORE INTO relics_obtained (run_id, relic_key, floor, act) VALUES (?, ?, ?, ?)'
    );
    const ACT_BOUNDS_M: [string, number, number][] = [
      ['Act 1', 1, 16], ['Act 2', 17, 33], ['Act 3+', 34, 999],
    ];
    function mFloorToAct2(floor: number | null): string {
      if (floor == null) return 'Unknown';
      for (const [name, lo, hi] of ACT_BOUNDS_M) {
        if (floor >= lo && floor <= hi) return name;
      }
      return 'Act 3+';
    }
    db.transaction(() => {
      for (const run of runs) {
        try {
          const raw = JSON.parse(run.raw_json) as Record<string, unknown>;
          const player = ((raw.players as Record<string, unknown>[] | undefined) ?? [{}])[0] ?? {};
          const relics = (player.relics as Record<string, unknown>[] | undefined) ?? [];
          for (const relic of relics) {
            const idRaw = (relic.id as string | null) ?? '';
            let key = idRaw.startsWith('RELIC.') ? idRaw.slice('RELIC.'.length) : idRaw;
            key = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            const floor = (relic.floor_added_to_deck as number | null) ?? null;
            const act = mFloorToAct2(floor);
            if (key) insert.run(run.id, key, floor, act);
          }
        } catch { /* skip malformed */ }
      }
    })();
  },
  7: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS spire_codex_cache (
        entity_type  TEXT NOT NULL,
        entity_id    TEXT NOT NULL,
        data_json    TEXT NOT NULL,
        fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (entity_type, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_codex_cache_type ON spire_codex_cache(entity_type);
    `);
  },
  8: (db) => {
    // Re-derive act labels from the 2D map_point_history structure instead of
    // the old hardcoded floor-range approach (Act 1: 1-16, Act 2: 17-33).
    // Fixes: 17-floor Act 1 runs had floor 17 (the act 1 boss) mislabeled "Act 2".
    const ACT_LABELS = ['Act 1', 'Act 2', 'Act 3+', 'Act 4+'];
    const runs = db.prepare('SELECT id, raw_json FROM runs').all() as { id: number; raw_json: string }[];

    const updateFloorNode = db.prepare(`UPDATE floor_nodes SET act = ? WHERE run_id = ? AND floor = ?`);
    const updateCardChoice = db.prepare(`UPDATE card_choices SET act = ? WHERE run_id = ? AND floor = ?`);
    const updatePotionEvent = db.prepare(`UPDATE potion_events SET act = ? WHERE run_id = ? AND floor = ?`);
    const updateRelic = db.prepare(`UPDATE relics_obtained SET act = ? WHERE run_id = ? AND relic_key = ?`);

    db.transaction(() => {
      for (const run of runs) {
        try {
          const raw = JSON.parse(run.raw_json) as Record<string, unknown>;
          const mph = (raw.map_point_history as unknown[][] | undefined) ?? [];
          const floorActMap = new Map<number, string>();
          let f = 0;
          for (let ai = 0; ai < mph.length; ai++) {
            const actPoints = mph[ai] as unknown[];
            const actLabel = ACT_LABELS[ai] ?? `Act ${ai + 1}`;
            for (let _pi = 0; _pi < actPoints.length; _pi++) {
              f++;
              floorActMap.set(f, actLabel);
            }
          }
          for (const [floor, act] of floorActMap) {
            updateFloorNode.run(act, run.id, floor);
            updateCardChoice.run(act, run.id, floor);
            updatePotionEvent.run(act, run.id, floor);
          }
          const player = ((raw.players as Record<string, unknown>[] | undefined) ?? [{}])[0] ?? {};
          for (const relic of (player.relics as Record<string, unknown>[] | undefined) ?? []) {
            const idRaw = (relic.id as string | null) ?? '';
            let key = idRaw.startsWith('RELIC.') ? idRaw.slice('RELIC.'.length) : idRaw;
            key = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            const relicFloor = (relic.floor_added_to_deck as number | null) ?? null;
            if (relicFloor == null || !key) continue;
            const act = floorActMap.get(relicFloor) ?? 'Unknown';
            updateRelic.run(act, run.id, key);
          }
        } catch { /* skip malformed */ }
      }
    })();
  },
  9: (db) => {
    db.exec(`
      ALTER TABLE runs ADD COLUMN seed TEXT;
      ALTER TABLE runs ADD COLUMN game_mode TEXT;
      ALTER TABLE runs ADD COLUMN was_abandoned INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE runs ADD COLUMN build_id TEXT;
      ALTER TABLE runs ADD COLUMN deck_size INTEGER;
      ALTER TABLE runs ADD COLUMN cards_upgraded INTEGER DEFAULT 0;
      ALTER TABLE runs ADD COLUMN cards_removed_count INTEGER DEFAULT 0;
      ALTER TABLE runs ADD COLUMN cards_transformed INTEGER DEFAULT 0;
      ALTER TABLE runs ADD COLUMN campfire_smiths INTEGER DEFAULT 0;
      ALTER TABLE runs ADD COLUMN campfire_heals INTEGER DEFAULT 0;
      ALTER TABLE runs ADD COLUMN total_damage_taken INTEGER DEFAULT 0;
      ALTER TABLE runs ADD COLUMN elite_count INTEGER DEFAULT 0;

      CREATE TABLE IF NOT EXISTS final_deck (
        run_id         INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        position       INTEGER NOT NULL,
        card_id        TEXT NOT NULL,
        upgrade_level  INTEGER NOT NULL DEFAULT 0,
        enchantment_id TEXT,
        PRIMARY KEY (run_id, position)
      );
      CREATE INDEX IF NOT EXISTS idx_final_deck_run_id ON final_deck(run_id);
      CREATE INDEX IF NOT EXISTS idx_final_deck_enchantment ON final_deck(enchantment_id);
    `);

    const runs = db.prepare('SELECT id, raw_json FROM runs').all() as { id: number; raw_json: string }[];
    const updateRun = db.prepare(`
      UPDATE runs SET
        seed = ?, game_mode = ?, was_abandoned = ?, build_id = ?,
        deck_size = ?, cards_upgraded = ?, cards_removed_count = ?,
        cards_transformed = ?, campfire_smiths = ?, campfire_heals = ?,
        total_damage_taken = ?, elite_count = ?
      WHERE id = ?
    `);
    const insertDeckCard = db.prepare(`
      INSERT OR IGNORE INTO final_deck (run_id, position, card_id, upgrade_level, enchantment_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const run of runs) {
        try {
          const raw = JSON.parse(run.raw_json) as Record<string, unknown>;
          const player = ((raw.players as Record<string, unknown>[] | undefined) ?? [{}])[0] ?? {};
          const mph = (raw.map_point_history as unknown[][] | undefined) ?? [];

          let cardsUpgraded = 0;
          let cardsRemovedCount = 0;
          let cardsTransformed = 0;
          let campfireSmiths = 0;
          let campfireHeals = 0;
          let totalDamageTaken = 0;
          let eliteCount = 0;

          for (const actPoints of mph) {
            for (const pt of actPoints as Record<string, unknown>[]) {
              const rooms = (pt.rooms as Record<string, unknown>[] | undefined) ?? [];
              const room = rooms[0] ?? {};
              const roomType = (room.room_type as string | null) ?? '';
              if (roomType.toUpperCase().includes('ELITE')) eliteCount++;

              const psList = (pt.player_stats as Record<string, unknown>[] | undefined) ?? [];
              const ps = psList[0] ?? {};

              totalDamageTaken += (ps.damage_taken as number | null) ?? 0;
              cardsUpgraded += ((ps.cards_upgraded as unknown[] | undefined) ?? []).length;
              cardsRemovedCount += ((ps.cards_removed as unknown[] | undefined) ?? []).length;
              cardsTransformed += ((ps.cards_transformed as unknown[] | undefined) ?? []).length;

              for (const choice of (ps.rest_site_choices as string[] | undefined) ?? []) {
                const c = (choice as string).toUpperCase();
                if (c.includes('SMITH') || c.includes('UPGRADE')) campfireSmiths++;
                else if (c.includes('HEAL') || c.includes('REST')) campfireHeals++;
              }
            }
          }

          const deck = (player.deck as Record<string, unknown>[] | undefined) ?? [];
          updateRun.run(
            (raw.seed as string | null) ?? null,
            (raw.game_mode as string | null) ?? null,
            (raw.was_abandoned as boolean | null) ? 1 : 0,
            (raw.build_id as string | null) ?? null,
            deck.length,
            cardsUpgraded, cardsRemovedCount, cardsTransformed,
            campfireSmiths, campfireHeals, totalDamageTaken, eliteCount,
            run.id
          );

          for (let i = 0; i < deck.length; i++) {
            const card = deck[i];
            const idRaw = (card.id as string | null) ?? '';
            const cardId = idRaw.startsWith('CARD.') ? idRaw.slice('CARD.'.length) : idRaw;
            const cleanCardId = cardId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            const upgradeLevel = (card.current_upgrade_level as number | null) ?? 0;
            const enchantmentId = (card.enchantment as string | null) ?? null;
            insertDeckCard.run(run.id, i, cleanCardId, upgradeLevel, enchantmentId);
          }
        } catch { /* skip malformed */ }
      }
    })();
  },
};

export function runMigrations(db: Database.Database) {
  const current = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null }).v ?? 0;
  for (const [vStr, migrate] of Object.entries(MIGRATIONS)) {
    const v = Number(vStr);
    if (v > current) {
      migrate(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);
      console.log(`[migrations] applied version ${v}`);
    }
  }
}
