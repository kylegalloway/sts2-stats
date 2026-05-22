export const DDL = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);

CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY,
  file_name     TEXT UNIQUE NOT NULL,
  character     TEXT NOT NULL,
  victory       INTEGER NOT NULL,
  ascension     INTEGER NOT NULL DEFAULT 0,
  floor_reached INTEGER,
  final_gold    INTEGER,
  run_time      INTEGER,
  killed_by     TEXT,
  timestamp     TEXT,
  acts          TEXT,
  raw_json      TEXT NOT NULL,
  ingested_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_choices (
  id         INTEGER PRIMARY KEY,
  run_id     INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  floor      INTEGER,
  card_id    TEXT NOT NULL,
  was_picked INTEGER NOT NULL,
  act        TEXT
);

CREATE TABLE IF NOT EXISTS relics_obtained (
  id        INTEGER PRIMARY KEY,
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  relic_key TEXT NOT NULL,
  floor     INTEGER,
  act       TEXT
);

CREATE TABLE IF NOT EXISTS hp_gold_per_floor (
  run_id  INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  floor   INTEGER NOT NULL,
  hp      INTEGER,
  max_hp  INTEGER,
  gold    INTEGER,
  PRIMARY KEY (run_id, floor)
);

CREATE TABLE IF NOT EXISTS card_elo (
  character TEXT NOT NULL,
  card_id   TEXT NOT NULL,
  elo       REAL NOT NULL DEFAULT 1000,
  PRIMARY KEY (character, card_id)
);

CREATE TABLE IF NOT EXISTS ingestion_log (
  id        INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  status    TEXT NOT NULL,
  message   TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS damage_per_floor (
  run_id       INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  floor        INTEGER NOT NULL,
  room_type    TEXT,
  encounter_id TEXT,
  damage_taken INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, floor)
);

CREATE TABLE IF NOT EXISTS run_inflection (
  run_id             INTEGER PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  inflection_floor   INTEGER NOT NULL,
  hp_pct_drop        REAL NOT NULL,
  hp_pct_at_inflection REAL,
  hp_deficit         REAL
);

CREATE TABLE IF NOT EXISTS floor_nodes (
  run_id       INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  floor        INTEGER NOT NULL,
  node_type    TEXT,
  encounter_id TEXT,
  act          TEXT,
  PRIMARY KEY (run_id, floor)
);

CREATE INDEX IF NOT EXISTS idx_runs_character ON runs(character);
CREATE INDEX IF NOT EXISTS idx_runs_victory ON runs(victory);
CREATE INDEX IF NOT EXISTS idx_card_choices_run_id ON card_choices(run_id);
CREATE INDEX IF NOT EXISTS idx_card_choices_card_id ON card_choices(card_id);
CREATE INDEX IF NOT EXISTS idx_relics_run_id ON relics_obtained(run_id);
CREATE INDEX IF NOT EXISTS idx_hp_gold_run_id ON hp_gold_per_floor(run_id);
CREATE INDEX IF NOT EXISTS idx_run_inflection_floor ON run_inflection(inflection_floor);
CREATE INDEX IF NOT EXISTS idx_damage_per_floor_run_id ON damage_per_floor(run_id);
CREATE INDEX IF NOT EXISTS idx_damage_per_floor_encounter ON damage_per_floor(encounter_id);
CREATE INDEX IF NOT EXISTS idx_floor_nodes_run_id ON floor_nodes(run_id);
CREATE INDEX IF NOT EXISTS idx_floor_nodes_node_type ON floor_nodes(node_type);

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

CREATE TABLE IF NOT EXISTS spire_codex_cache (
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  data_json    TEXT NOT NULL,
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_codex_cache_type ON spire_codex_cache(entity_type);

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
`;
