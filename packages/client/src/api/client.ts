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

export const api = {
  getOverview: (character?: string) => get('/overview', character ? { character } : {}),
  getRuns: (params?: Record<string, string>) => get('/runs', params),
  getCards: (character?: string) => get('/cards', character ? { character } : {}),
  getRelics: (character?: string) => get('/relics', character ? { character } : {}),
  getSynergies: (character?: string, minOccurrences = 2) =>
    get('/synergies', { ...(character ? { character } : {}), min_occurrences: String(minOccurrences) }),
  getCores: (character?: string, minRuns = 3) =>
    get('/synergies/cores', { ...(character ? { character } : {}), min_runs: String(minRuns) }),
  getHpGold: (character?: string) => get('/hp-gold', character ? { character } : {}),
  getKills: (character?: string) => get('/kills', character ? { character } : {}),
  getActRoutes: () => get('/overview/act-routes'),
  getAscensionStats: (character?: string) => get('/overview/ascension', character ? { character } : {}),
  getPathComposition: (character?: string) => get('/overview/path-composition', character ? { character } : {}),
  getBossStats: (character?: string) => get('/kills/bosses', character ? { character } : {}),
  getEnemyInflection: (character?: string) => get('/kills/inflection', character ? { character } : {}),
  getCardSkipRates: (character?: string) => get('/cards/skip-rates', character ? { character } : {}),
  getPotions: (character?: string) => get('/potions', character ? { character } : {}),
  getStatus: () => get('/status'),
  getCardsByDimension: (character?: string) => get('/cards/by-dimension', character ? { character } : {}),
  getUpgradeImpact: (character?: string) => get('/cards/upgrade-impact', character ? { character } : {}),
  getCodexEntity: (type: 'card' | 'relic' | 'monster' | 'event', name: string) =>
    get(`/codex/${type}/${encodeURIComponent(name)}`),
  getCodexCachedCards: () => get<{ id: string; rarity: string | null; color: string | null }[]>('/codex/cached/cards'),
  getCodexCachedRelics: () => get<{ id: string; rarity: string | null }[]>('/codex/cached/relics'),
  seedCodexCards: () => fetch(`${BASE}/codex/seed-cards`, { method: 'POST' }).then((r) => r.json()),
  getRecords: (character?: string) => get('/records', character ? { character } : {}),
  getWinFingerprint: (character?: string) => get('/overview/win-fingerprint', character ? { character } : {}),
  getActVariants: (character?: string) => get('/overview/act-variants', character ? { character } : {}),
  getEnchantments: (character?: string) => get('/cards/enchantments', character ? { character } : {}),
};
