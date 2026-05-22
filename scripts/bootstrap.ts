/**
 * One-time import of all existing .run files into SQLite.
 * Safe to run multiple times — ingestRun is idempotent by file_name.
 *
 * Usage:
 *   npx tsx scripts/bootstrap.ts
 *   npx tsx scripts/bootstrap.ts --path ~/Library/Application\ Support/.../history
 *   npx tsx scripts/bootstrap.ts --profile 2
 */

import { glob } from 'glob';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { db } from '../packages/server/src/db/index.js';
import { ingestRun } from '../packages/server/src/ingestion/ingest.js';
import { resolveHistoryDir } from '../packages/server/src/ingestion/watcher.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    path: { type: 'string' },
    profile: { type: 'string', default: '1' },
  },
});

const historyDir = values.path
  ? path.resolve(values.path.replace('~', process.env.HOME!))
  : await resolveHistoryDir(Number(values.profile));

if (!historyDir) {
  console.error('Could not find history directory. Pass --path manually.');
  process.exit(1);
}

console.log(`Scanning: ${historyDir}`);
const files = await glob(path.join(historyDir, '*.run'));
console.log(`Found ${files.length} .run files`);

let inserted = 0;
let skipped = 0;
let errors = 0;

for (const f of files) {
  const result = ingestRun(db, f);
  if (result === 'inserted') inserted++;
  else if (result === 'skipped') skipped++;
  else errors++;
}

console.log(`\nBootstrap complete:`);
console.log(`  Inserted: ${inserted}`);
console.log(`  Skipped (already in DB): ${skipped}`);
console.log(`  Errors: ${errors}`);

const total = (db.prepare('SELECT COUNT(*) as n FROM runs').get() as { n: number }).n;
console.log(`  Total runs in DB: ${total}`);
