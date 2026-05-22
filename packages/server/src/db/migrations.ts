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
