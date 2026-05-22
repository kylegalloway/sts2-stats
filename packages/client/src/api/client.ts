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
  getHpGold: (character?: string) => get('/hp-gold', character ? { character } : {}),
  getKills: (character?: string) => get('/kills', character ? { character } : {}),
  getActRoutes: () => get('/overview/act-routes'),
  getAscensionStats: (character?: string) => get('/overview/ascension', character ? { character } : {}),
  getPathComposition: (character?: string) => get('/overview/path-composition', character ? { character } : {}),
  getBossStats: (character?: string) => get('/kills/bosses', character ? { character } : {}),
  getCardSkipRates: (character?: string) => get('/cards/skip-rates', character ? { character } : {}),
  getPotions: (character?: string) => get('/potions', character ? { character } : {}),
  getStatus: () => get('/status'),
};
