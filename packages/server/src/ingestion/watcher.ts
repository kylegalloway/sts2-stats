import chokidar from 'chokidar';
import { glob } from 'glob';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { ingestRun, reIngestRun } from './ingest.js';

export interface WatchEvent {
  type: 'run_added' | 'run_updated';
  file: string;
}

const CANDIDATE_PATTERNS = [
  '~/Library/Application Support/SlayTheSpire2/steam/*/profile{p}/saves/history',
  '~/Library/Application Support/com.megacrit.SlayTheSpire2/steam/*/profile{p}/saves/history',
  '~/Library/Application Support/Slay the Spire 2/steam/*/profile{p}/saves/history',
  '~/.local/share/SlayTheSpire2/steam/*/profile{p}/saves/history',
  '~/AppData/Roaming/SlayTheSpire2/steam/*/profile{p}/saves/history',
];

export async function resolveHistoryDir(profile = 1): Promise<string | null> {
  for (const pattern of CANDIDATE_PATTERNS) {
    const expanded = pattern.replace('{p}', String(profile)).replace('~', os.homedir());
    const matches = await glob(expanded);
    if (matches.length > 1) {
      console.warn(`[watcher] multiple history dirs found, using first: ${matches[0]}`);
    }
    if (matches.length) return matches[0];
  }
  return null;
}

function checkReadAccess(dir: string): boolean {
  try {
    fs.readdirSync(dir);
    return true;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EACCES') {
      console.error(
        `[watcher] Permission denied reading ${dir}.\n` +
        `Grant Full Disk Access to Terminal in System Settings → Privacy & Security → Full Disk Access.`
      );
    }
    return false;
  }
}

export async function startWatcher(
  db: Database.Database,
  onEvent: (e: WatchEvent) => void,
  profile = 1
) {
  if (process.env.E2E === '1') {
    console.log('[watcher] E2E mode — file watching disabled');
    return;
  }

  const dir = await resolveHistoryDir(profile);
  if (!dir) {
    console.warn('[watcher] History directory not found. Use --path to specify manually.');
    return;
  }

  if (!checkReadAccess(dir)) return;

  // Bootstrap: ingest all existing .run files
  const existing = await glob(path.join(dir, '*.run'));
  let imported = 0;
  for (const f of existing) {
    const result = ingestRun(db, f);
    if (result === 'inserted') imported++;
  }
  console.log(`[watcher] bootstrap complete: ${imported} new runs ingested from ${existing.length} files`);

  // Watch for new/changed files going forward
  chokidar
    .watch(path.join(dir, '*.run'), {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    })
    .on('add', (f) => {
      const result = ingestRun(db, f);
      if (result === 'inserted') onEvent({ type: 'run_added', file: path.basename(f) });
    })
    .on('change', (f) => {
      const result = reIngestRun(db, f);
      if (result === 'inserted') onEvent({ type: 'run_updated', file: path.basename(f) });
    });

  console.log(`[watcher] watching ${dir}`);
}
