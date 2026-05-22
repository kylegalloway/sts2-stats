import type Database from 'better-sqlite3';
import fs from 'node:fs';
import { normalizeRun } from './normalize.js';
import { rebuildElo } from '../analytics/cards.js';

export type IngestResult = 'inserted' | 'skipped' | 'error';

export function ingestRun(db: Database.Database, filePath: string): IngestResult {
  const fileName = filePath.split('/').pop()!;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const run = normalizeRun(raw, fileName);

    const existing = db.prepare('SELECT id FROM runs WHERE file_name = ?').get(fileName);
    if (existing) return 'skipped';

    insertRun(db, run, raw);
    rebuildElo(db, run.character);
    db.prepare(`INSERT INTO ingestion_log (file_name, status) VALUES (?, 'ok')`).run(fileName);
    return 'inserted';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(`INSERT INTO ingestion_log (file_name, status, message) VALUES (?, 'error', ?)`).run(fileName, msg);
    console.warn(`[ingest] skipping ${fileName}: ${msg}`);
    return 'error';
  }
}

export function reIngestRun(db: Database.Database, filePath: string): IngestResult {
  const fileName = filePath.split('/').pop()!;
  db.prepare('DELETE FROM runs WHERE file_name = ?').run(fileName);
  return ingestRun(db, filePath);
}

function insertRun(db: Database.Database, run: ReturnType<typeof normalizeRun>, raw: unknown) {
  const insertRunStmt = db.prepare(`
    INSERT INTO runs (file_name, character, victory, ascension, floor_reached, final_gold, run_time, killed_by, timestamp, acts, raw_json)
    VALUES (@file_name, @character, @victory, @ascension, @floor_reached, @final_gold, @run_time, @killed_by, @timestamp, @acts, @raw_json)
  `);

  const insertChoice = db.prepare(`
    INSERT INTO card_choices (run_id, floor, card_id, was_picked, act)
    VALUES (@run_id, @floor, @card_id, @was_picked, @act)
  `);

  const insertRelic = db.prepare(`
    INSERT INTO relics_obtained (run_id, relic_key, floor, act)
    VALUES (@run_id, @relic_key, @floor, @act)
  `);

  const insertHpGold = db.prepare(`
    INSERT OR IGNORE INTO hp_gold_per_floor (run_id, floor, hp, max_hp, gold)
    VALUES (@run_id, @floor, @hp, @max_hp, @gold)
  `);

  db.transaction(() => {
    const { lastInsertRowid } = insertRunStmt.run({
      ...run,
      victory: run.victory ? 1 : 0,
      acts: JSON.stringify(run.acts),
      raw_json: JSON.stringify(raw),
    });
    const runId = Number(lastInsertRowid);

    for (const choice of run.card_choices) {
      if (choice.picked) {
        insertChoice.run({ run_id: runId, floor: choice.floor, card_id: choice.picked, was_picked: 1, act: choice.act });
      }
      for (const notPicked of choice.not_picked) {
        insertChoice.run({ run_id: runId, floor: choice.floor, card_id: notPicked, was_picked: 0, act: choice.act });
      }
    }

    for (const relic of run.relics_obtained) {
      insertRelic.run({ run_id: runId, relic_key: relic.key, floor: relic.floor, act: relic.act });
    }

    for (let i = 0; i < run.hp_per_floor.length; i++) {
      insertHpGold.run({
        run_id: runId,
        floor: i + 1,
        hp: run.hp_per_floor[i],
        max_hp: run.max_hp_per_floor[i],
        gold: run.gold_per_floor[i],
      });
    }
  })();
}
