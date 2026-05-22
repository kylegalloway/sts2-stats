/**
 * Helpers for seeding the E2E test database via the server's ingest API.
 * Each test that needs data should call seedRun() directly inside the test.
 *
 * The server exposes POST /api/runs/ingest-raw (E2E only) which accepts a
 * raw .run JSON object and calls ingestRun() internally, so tests don't need
 * filesystem access.
 */

export interface RunSeed {
  character?: string;
  victory?: boolean;
  ascension?: number;
  floors?: number;
  finalGold?: number;
}

/**
 * Minimal valid .run payload that normalizeRun() can parse.
 * `floors` controls how many map_point_history entries are generated.
 */
export function buildRunPayload(opts: RunSeed = {}): Record<string, unknown> {
  const {
    character = 'Ironclad',
    victory = false,
    ascension = 0,
    floors = 10,
    finalGold = 100,
  } = opts;

  const mapPoints = Array.from({ length: floors }, (_, i) => ({
    player_stats: [
      {
        current_hp: 70,
        max_hp: 80,
        current_gold: finalGold,
        damage_taken: 5,
        card_choices: [],
        potion_choices: [],
        potion_used: [],
        potion_discarded: [],
      },
    ],
    rooms: [{ room_type: 'ROOM_TYPE.MONSTER_ROOM', model_id: `ENCOUNTER.CULTIST_${i}` }],
  }));

  return {
    players: [
      {
        character: `CHARACTER.${character.toUpperCase()}`,
        relics: [],
      },
    ],
    map_point_history: mapPoints.map((p) => [p]),
    victory,
    ascension_level: ascension,
    final_gold: finalGold,
    run_time: 1200,
    killed_by: victory ? null : 'ENCOUNTER.CULTIST',
    timestamp: new Date().toISOString(),
  };
}

export async function seedRun(
  baseURL: string,
  opts: RunSeed & { fileName?: string } = {}
): Promise<void> {
  const { fileName = `test-${Date.now()}-${Math.random().toString(36).slice(2)}.run`, ...runOpts } = opts;
  const payload = buildRunPayload(runOpts);

  const res = await fetch(`${baseURL}/api/runs/ingest-raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, payload }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`seedRun failed: ${res.status} ${text}`);
  }
}

export async function resetDatabase(baseURL: string): Promise<void> {
  const res = await fetch(`${baseURL}/api/runs/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`resetDatabase failed: ${res.status}`);
}
