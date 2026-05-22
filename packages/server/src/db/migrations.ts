import type Database from 'better-sqlite3';

// Add migration functions here as the schema evolves.
// Each migration is keyed by version number and runs exactly once.
const MIGRATIONS: Record<number, (db: Database.Database) => void> = {
  // example:
  // 2: (db) => db.exec(`ALTER TABLE runs ADD COLUMN node_type TEXT`),
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
