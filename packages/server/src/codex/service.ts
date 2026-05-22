import type Database from 'better-sqlite3';
import type { EntityType } from './nameToId.js';

const BASE = 'https://spire-codex.com/api';
const TTL_MS = 24 * 60 * 60 * 1000;

const PATH: Record<EntityType, string> = {
  card: 'cards',
  relic: 'relics',
  monster: 'monsters',
  event: 'events',
};

export interface CodexData {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  rarity?: string;
  type?: string;
  cost?: string | number;
  color?: string;
  [key: string]: unknown;
}

// In-memory monster name→ID index, built lazily from the API list endpoint.
// Maps uppercased display name → SCREAMING_SNAKE_CASE id.
let monsterIndex: Map<string, string> | null = null;

export function resetMonsterIndex() { monsterIndex = null; }

async function getMonsterIndex(): Promise<Map<string, string>> {
  if (monsterIndex) return monsterIndex;
  const res = await fetch(`${BASE}/monsters?limit=500`, {
    headers: { Accept: 'application/json', 'User-Agent': 'sts2-stats/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`spire-codex monster list returned ${res.status}`);
  const list = (await res.json()) as { id: string; name: string }[];
  monsterIndex = new Map(list.map((m) => [m.name.toUpperCase(), m.id]));
  return monsterIndex;
}

// Strip trailing 's' to handle plural game names (AXEBOTS → AXEBOT, CHOMPERS → CHOMPER).
function depluralize(s: string): string {
  return s.endsWith('S') ? s.slice(0, -1) : s;
}

// Resolve a display name (e.g. "Axebots") to a spire-codex monster ID.
// Tries exact match, then depluralized match.
async function resolveMonsterName(displayName: string): Promise<string | null> {
  const index = await getMonsterIndex();
  const upper = displayName.toUpperCase();
  if (index.has(upper)) return index.get(upper)!;
  const singular = depluralize(upper);
  if (index.has(singular)) return index.get(singular)!;
  return null;
}

async function resolveId(type: EntityType, displayName: string): Promise<string | null> {
  if (type === 'monster') return resolveMonsterName(displayName);
  // Cards and relics use lowercase snake_case
  return displayName.toLowerCase().replace(/ /g, '_');
}

export async function fetchCodexEntity(
  db: Database.Database,
  type: EntityType,
  displayName: string,
): Promise<CodexData | null> {
  const id = await resolveId(type, displayName);
  if (!id) return null;

  const cached = db.prepare(
    `SELECT data_json, fetched_at FROM spire_codex_cache WHERE entity_type = ? AND entity_id = ?`
  ).get(type, id) as { data_json: string; fetched_at: string } | undefined;

  if (cached) {
    const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
    if (ageMs < TTL_MS) return JSON.parse(cached.data_json) as CodexData;
  }

  const url = `${BASE}/${PATH[type]}/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'sts2-stats/1.0' },
    signal: AbortSignal.timeout(5000),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`spire-codex returned ${res.status} for ${url}`);

  const data = (await res.json()) as CodexData;

  db.prepare(`
    INSERT INTO spire_codex_cache (entity_type, entity_id, data_json, fetched_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      data_json = excluded.data_json,
      fetched_at = excluded.fetched_at
  `).run(type, id, JSON.stringify(data));

  return data;
}
