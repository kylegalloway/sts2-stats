const BASE = '/api';

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function runParams(character?: string, ascension?: string, lastN?: string): Record<string, string> {
  const p: Record<string, string> = {};
  if (character) p.character = character;
  if (ascension) p.ascension = ascension;
  if (lastN) p.last_n = lastN;
  return p;
}

export const api = {
  getOverview: (character?: string, ascension?: string, lastN?: string) =>
    get('/overview', runParams(character, ascension, lastN)),
  getRuns: (params?: Record<string, string>) => get('/runs', params),
  getCards: (character?: string, ascension?: string, lastN?: string) =>
    get('/cards', runParams(character, ascension, lastN)),
  getRelics: (character?: string, ascension?: string, lastN?: string) =>
    get('/relics', runParams(character, ascension, lastN)),
  getSynergies: (character?: string, minOccurrences = 2, ascension?: string, lastN?: string) =>
    get('/synergies', { ...runParams(character, ascension, lastN), min_occurrences: String(minOccurrences) }),
  getCores: (character?: string, minRuns = 3, ascension?: string, lastN?: string) =>
    get('/synergies/cores', { ...runParams(character, ascension, lastN), min_runs: String(minRuns) }),
  getHpGold: (character?: string, ascension?: string, lastN?: string) =>
    get('/hp-gold', runParams(character, ascension, lastN)),
  getKills: (character?: string, ascension?: string, lastN?: string) =>
    get('/kills', runParams(character, ascension, lastN)),
  getActRoutes: (character?: string, ascension?: string, lastN?: string) =>
    get('/overview/act-routes', runParams(character, ascension, lastN)),
  getAscensionStats: (character?: string, ascension?: string, lastN?: string) =>
    get('/overview/ascension', runParams(character, ascension, lastN)),
  getPathComposition: (character?: string, ascension?: string, lastN?: string) =>
    get('/overview/path-composition', runParams(character, ascension, lastN)),
  getBossStats: (character?: string, ascension?: string, lastN?: string) =>
    get('/kills/bosses', runParams(character, ascension, lastN)),
  getEnemyInflection: (character?: string, ascension?: string, lastN?: string) =>
    get('/kills/inflection', runParams(character, ascension, lastN)),
  getCardSkipRates: (character?: string, ascension?: string, lastN?: string) =>
    get('/cards/skip-rates', runParams(character, ascension, lastN)),
  getPotions: (character?: string, ascension?: string, lastN?: string) =>
    get('/potions', runParams(character, ascension, lastN)),
  getStatus: () => get('/status'),
  getCardsByDimension: (character?: string, ascension?: string, lastN?: string) =>
    get('/cards/by-dimension', runParams(character, ascension, lastN)),
  getUpgradeImpact: (character?: string, ascension?: string, lastN?: string) =>
    get('/cards/upgrade-impact', runParams(character, ascension, lastN)),
  getCodexEntity: (type: 'card' | 'relic' | 'monster' | 'event', name: string) =>
    get(`/codex/${type}/${encodeURIComponent(name)}`),
  getCodexCachedCards: () => get<{ id: string; rarity: string | null; color: string | null }[]>('/codex/cached/cards'),
  getCodexCachedRelics: () => get<{ id: string; rarity: string | null }[]>('/codex/cached/relics'),
  seedCodexCards: () => fetch(`${BASE}/codex/seed-cards`, { method: 'POST' }).then((r) => r.json()),
  getRecords: (character?: string, ascension?: string, lastN?: string) =>
    get('/records', runParams(character, ascension, lastN)),
  getWinFingerprint: (character?: string, ascension?: string, lastN?: string) =>
    get('/overview/win-fingerprint', runParams(character, ascension, lastN)),
  getActVariants: (character?: string, ascension?: string, lastN?: string) =>
    get('/overview/act-variants', runParams(character, ascension, lastN)),
  getEnchantments: (character?: string, ascension?: string, lastN?: string) =>
    get('/cards/enchantments', runParams(character, ascension, lastN)),
};
