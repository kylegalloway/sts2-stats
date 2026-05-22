import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DDL } from './schema.js';
import { runMigrations } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.E2E_DB_PATH ?? 'sts2.db';
const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../../', DB_FILE);

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(DDL);
runMigrations(db);
