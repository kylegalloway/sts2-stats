import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DDL } from '../db/schema.js';
import { fetchCodexEntity, type CodexData, resetMonsterIndex } from './service.js';

const MOCK_CARD: CodexData = {
  id: 'strike',
  name: 'Strike',
  description: 'Deal 6 damage.',
  rarity: 'Starter',
  type: 'Attack',
  cost: 1,
  color: 'red',
};

const MOCK_MONSTER: CodexData = {
  id: 'AXEBOT',
  name: 'Axebot',
  description: 'A robot with axes.',
};

const MONSTER_LIST = [
  { id: 'AXEBOT', name: 'Axebot' },
  { id: 'CHOMPER', name: 'Chomper' },
  { id: 'BYGONE_EFFIGY', name: 'Bygone Effigy' },
];

function makeFreshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
  return db;
}

function mockFetchSequence(...responses: { status: number; body: unknown }[]) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[Math.min(call++, responses.length - 1)];
    return Promise.resolve({
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: () => Promise.resolve(r.body),
    });
  });
}

function mockFetch(status: number, body: unknown) {
  return mockFetchSequence({ status, body });
}

let db: Database.Database;

beforeEach(() => {
  db = makeFreshDb();
  resetMonsterIndex();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchCodexEntity — cards', () => {
  it('fetches from API on cache miss and stores result', async () => {
    vi.stubGlobal('fetch', mockFetch(200, MOCK_CARD));

    const result = await fetchCodexEntity(db, 'card', 'Strike');
    expect(result).toMatchObject({ id: 'strike', name: 'Strike' });

    const cached = db.prepare(
      `SELECT data_json FROM spire_codex_cache WHERE entity_type = 'card' AND entity_id = 'strike'`
    ).get() as { data_json: string } | undefined;
    expect(cached).toBeDefined();
    expect(JSON.parse(cached!.data_json).name).toBe('Strike');
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it('returns cached data without calling fetch when cache is fresh', async () => {
    db.prepare(
      `INSERT INTO spire_codex_cache (entity_type, entity_id, data_json, fetched_at) VALUES (?, ?, ?, datetime('now'))`
    ).run('card', 'strike', JSON.stringify(MOCK_CARD));

    vi.stubGlobal('fetch', mockFetch(200, {}));

    const result = await fetchCodexEntity(db, 'card', 'Strike');
    expect(result?.name).toBe('Strike');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('re-fetches when cached data is older than 24h', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO spire_codex_cache (entity_type, entity_id, data_json, fetched_at) VALUES (?, ?, ?, ?)`
    ).run('card', 'strike', JSON.stringify({ id: 'strike', name: 'OldName' }), oldDate);

    vi.stubGlobal('fetch', mockFetch(200, MOCK_CARD));

    const result = await fetchCodexEntity(db, 'card', 'Strike');
    expect(result?.name).toBe('Strike');
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', mockFetch(404, null));
    const result = await fetchCodexEntity(db, 'card', 'Nonexistent Card');
    expect(result).toBeNull();
  });

  it('throws on non-404 error status', async () => {
    vi.stubGlobal('fetch', mockFetch(500, null));
    await expect(fetchCodexEntity(db, 'card', 'Strike')).rejects.toThrow('500');
  });

  it('upserts cache on stale re-fetch', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO spire_codex_cache (entity_type, entity_id, data_json, fetched_at) VALUES (?, ?, ?, ?)`
    ).run('card', 'strike', JSON.stringify({ id: 'strike', name: 'Old' }), oldDate);

    vi.stubGlobal('fetch', mockFetch(200, MOCK_CARD));
    await fetchCodexEntity(db, 'card', 'Strike');

    const row = db.prepare(
      `SELECT data_json FROM spire_codex_cache WHERE entity_type = 'card' AND entity_id = 'strike'`
    ).get() as { data_json: string };
    expect(JSON.parse(row.data_json).name).toBe('Strike');
  });
});

describe('fetchCodexEntity — monsters', () => {
  it('resolves monster name via index and fetches data', async () => {
    // First call: monster list. Second call: individual monster.
    vi.stubGlobal('fetch', mockFetchSequence(
      { status: 200, body: MONSTER_LIST },
      { status: 200, body: MOCK_MONSTER },
    ));

    const result = await fetchCodexEntity(db, 'monster', 'Axebot');
    expect(result?.name).toBe('Axebot');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('resolves plural game names (Axebots → Axebot)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      { status: 200, body: MONSTER_LIST },
      { status: 200, body: MOCK_MONSTER },
    ));

    const result = await fetchCodexEntity(db, 'monster', 'Axebots');
    expect(result?.name).toBe('Axebot');
  });

  it('returns null when monster name not in index', async () => {
    vi.stubGlobal('fetch', mockFetch(200, MONSTER_LIST));

    const result = await fetchCodexEntity(db, 'monster', 'Unknown Beast');
    expect(result).toBeNull();
    // Only the list fetch should have fired, not an individual lookup
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it('reuses cached monster index across calls', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      { status: 200, body: MONSTER_LIST },
      { status: 200, body: MOCK_MONSTER },
      { status: 200, body: MOCK_MONSTER },
    ));

    await fetchCodexEntity(db, 'monster', 'Axebot');
    await fetchCodexEntity(db, 'monster', 'Chomper');
    // List should only be fetched once
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3); // 1 list + 2 individuals
  });
});
