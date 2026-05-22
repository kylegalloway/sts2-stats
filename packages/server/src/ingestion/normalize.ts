// TypeScript port of sts2_export.py's _normalize_run() function.
// See PLANS.md for the full migration plan and gotcha notes.

const ACT_BOUNDS: [string, number, number][] = [
  ['Act 1', 1, 16],
  ['Act 2', 17, 33],
  ['Act 3+', 34, 999],
];

function floorToAct(floor: number | null): string {
  if (floor == null) return 'Unknown';
  for (const [name, lo, hi] of ACT_BOUNDS) {
    if (floor >= lo && floor <= hi) return name;
  }
  return 'Act 3+';
}

function cleanId(raw: string, prefix = ''): string {
  let s = raw ?? '';
  if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length);
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function g(d: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (d && typeof d === 'object' && k in d) return d[k];
  }
  return null;
}

export interface CardChoice {
  floor: number;
  picked: string | null;
  not_picked: string[];
  act: string;
}

export interface RelicObtained {
  key: string;
  floor: number | null;
  act: string;
}

export interface NormalizedRun {
  file_name: string;
  character: string;
  victory: boolean;
  ascension: number;
  floor_reached: number;
  final_gold: number | null;
  run_time: number | null;
  killed_by: string | null;
  timestamp: string | null;
  acts: string[];
  card_choices: CardChoice[];
  relics_obtained: RelicObtained[];
  hp_per_floor: (number | null)[];
  max_hp_per_floor: (number | null)[];
  gold_per_floor: (number | null)[];
}

export function normalizeRun(raw: Record<string, unknown>, fileName: string): NormalizedRun {
  const players = (raw.players as Record<string, unknown>[] | undefined) ?? [{}];
  const player = players[0] ?? {};

  const charRaw = (g(player, 'character') as string | null) ?? 'Unknown';
  const character = charRaw.replace('CHARACTER.', '');

  const mph = (raw.map_point_history as unknown[][] | undefined) ?? [];
  const points = mph.flat() as Record<string, unknown>[];
  const floorReached = points.length;

  const hpPerFloor: (number | null)[] = [];
  const maxHpPerFloor: (number | null)[] = [];
  const goldPerFloor: (number | null)[] = [];
  const cardChoices: CardChoice[] = [];
  const relicsMap = new Map<string, RelicObtained>();

  for (let idx = 0; idx < points.length; idx++) {
    const pt = points[idx];
    const floor = idx + 1;
    const act = floorToAct(floor);
    const psList = (pt.player_stats as Record<string, unknown>[] | undefined) ?? [];
    const ps = psList[0] ?? {};

    hpPerFloor.push((g(ps, 'current_hp') as number | null) ?? null);
    maxHpPerFloor.push((g(ps, 'max_hp') as number | null) ?? null);
    goldPerFloor.push((g(ps, 'current_gold') as number | null) ?? null);

    const choicesRaw = (ps.card_choices as Record<string, unknown>[] | undefined) ?? [];
    for (const choice of choicesRaw) {
      const cards = (choice.cards as Record<string, unknown>[] | undefined) ?? [];
      let picked: string | null = null;
      const notPicked: string[] = [];
      for (const card of cards) {
        const id = cleanId((g(card, 'id') as string | null) ?? '', 'CARD.');
        if (g(card, 'was_picked')) picked = id;
        else notPicked.push(id);
      }
      cardChoices.push({ floor, picked, not_picked: notPicked, act });
    }

    const relicsRaw = (ps.relics as Record<string, unknown>[] | undefined) ?? [];
    for (const relic of relicsRaw) {
      const key = cleanId((g(relic, 'id') as string | null) ?? '', 'RELIC.');
      if (key && !relicsMap.has(key)) {
        relicsMap.set(key, { key, floor, act });
      }
    }
  }

  const actsRaw = (raw.acts as string[] | undefined) ?? [];
  const acts = actsRaw.map((a) => cleanId(a, 'ACT.'));

  const killedByEncounter = g(raw, 'killed_by_encounter') as string | null;
  const killedByEvent = g(raw, 'killed_by_event') as string | null;
  const killedBy = killedByEncounter
    ? cleanId(killedByEncounter, 'ENCOUNTER.')
    : killedByEvent
    ? cleanId(killedByEvent, 'EVENT.')
    : null;

  return {
    file_name: fileName,
    character,
    victory: Boolean(g(raw, 'win') ?? g(raw, 'victory')),
    ascension: (g(raw, 'ascension') as number | null) ?? 0,
    floor_reached: floorReached,
    final_gold: goldPerFloor[goldPerFloor.length - 1] ?? null,
    run_time: (g(raw, 'run_time') as number | null) ?? null,
    killed_by: killedBy,
    timestamp: (g(raw, 'start_time') as string | null) ?? null,
    acts,
    card_choices: cardChoices,
    relics_obtained: Array.from(relicsMap.values()),
    hp_per_floor: hpPerFloor,
    max_hp_per_floor: maxHpPerFloor,
    gold_per_floor: goldPerFloor,
  };
}
