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

CREATE INDEX IF NOT EXISTS idx_runs_character ON runs(character);
CREATE INDEX IF NOT EXISTS idx_runs_victory ON runs(victory);
CREATE INDEX IF NOT EXISTS idx_card_choices_run_id ON card_choices(run_id);
CREATE INDEX IF NOT EXISTS idx_card_choices_card_id ON card_choices(card_id);
CREATE INDEX IF NOT EXISTS idx_relics_run_id ON relics_obtained(run_id);
CREATE INDEX IF NOT EXISTS idx_hp_gold_run_id ON hp_gold_per_floor(run_id);
`;
