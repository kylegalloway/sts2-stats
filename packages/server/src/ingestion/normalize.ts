// TypeScript port of sts2_export.py's _normalize_run() function.

const ACT_LABELS = ['Act 1', 'Act 2', 'Act 3+', 'Act 4+'];

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

export interface DamageFloor {
  floor: number;
  room_type: string | null;
  encounter_id: string | null;
  damage_taken: number;
}

export interface FloorNode {
  floor: number;
  node_type: string | null;
  encounter_id: string | null;
  act: string;
}

export interface PotionEvent {
  floor: number;
  room_type: string | null;
  act: string;
  potion_id: string;
  event_type: 'obtained' | 'declined' | 'used' | 'discarded';
}

export interface FinalDeckCard {
  position: number;
  card_id: string;
  upgrade_level: number;
  enchantment_id: string | null;
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
  seed: string | null;
  game_mode: string | null;
  was_abandoned: boolean;
  build_id: string | null;
  deck_size: number;
  cards_upgraded: number;
  cards_removed_count: number;
  cards_transformed: number;
  campfire_smiths: number;
  campfire_heals: number;
  total_damage_taken: number;
  elite_count: number;
  card_choices: CardChoice[];
  relics_obtained: RelicObtained[];
  damage_per_floor: DamageFloor[];
  floor_nodes: FloorNode[];
  hp_per_floor: (number | null)[];
  max_hp_per_floor: (number | null)[];
  gold_per_floor: (number | null)[];
  potion_events: PotionEvent[];
  final_deck: FinalDeckCard[];
}

export function normalizeRun(raw: Record<string, unknown>, fileName: string): NormalizedRun {
  const players = (raw.players as Record<string, unknown>[] | undefined) ?? [{}];
  const player = players[0] ?? {};

  const charRaw = (g(player, 'character') as string | null) ?? 'Unknown';
  const character = charRaw.replace('CHARACTER.', '');

  const mph = (raw.map_point_history as unknown[][] | undefined) ?? [];
  const floorActMap = new Map<number, string>();
  let floorReached = 0;
  const pointsWithAct: { pt: Record<string, unknown>; floor: number; act: string }[] = [];
  for (let actIdx = 0; actIdx < mph.length; actIdx++) {
    const actPoints = mph[actIdx] as Record<string, unknown>[];
    const actLabel = ACT_LABELS[actIdx] ?? `Act ${actIdx + 1}`;
    for (const pt of actPoints) {
      floorReached++;
      floorActMap.set(floorReached, actLabel);
      pointsWithAct.push({ pt, floor: floorReached, act: actLabel });
    }
  }

  const hpPerFloor: (number | null)[] = [];
  const maxHpPerFloor: (number | null)[] = [];
  const goldPerFloor: (number | null)[] = [];
  const cardChoices: CardChoice[] = [];
  const relicsMap = new Map<string, RelicObtained>();
  const damagePerFloor: DamageFloor[] = [];
  const floorNodes: FloorNode[] = [];
  const potionEvents: PotionEvent[] = [];

  for (const { pt, floor, act } of pointsWithAct) {
    const psList = (pt.player_stats as Record<string, unknown>[] | undefined) ?? [];
    const ps = psList[0] ?? {};

    const roomsRaw = (pt.rooms as Record<string, unknown>[] | undefined) ?? [];
    const firstRoom = roomsRaw[0] ?? {};
    const roomType = (firstRoom.room_type as string | null) ?? null;
    const encounterRaw = (firstRoom.model_id as string | null) ?? null;
    const encounterId = encounterRaw
      ? cleanId(encounterRaw.replace(/^EVENT\./, 'ENCOUNTER.'), 'ENCOUNTER.')
      : null;
    const damageTaken = (g(ps, 'damage_taken') as number | null) ?? 0;
    damagePerFloor.push({ floor, room_type: roomType, encounter_id: encounterId, damage_taken: damageTaken });

    const nodeType = roomType
      ? roomType.replace(/^ROOM_TYPE\./i, '').replace(/_ROOM$/i, '').toLowerCase()
      : null;
    floorNodes.push({ floor, node_type: nodeType, encounter_id: encounterId, act });

    hpPerFloor.push((g(ps, 'current_hp') as number | null) ?? null);
    maxHpPerFloor.push((g(ps, 'max_hp') as number | null) ?? null);
    goldPerFloor.push((g(ps, 'current_gold') as number | null) ?? null);

    const choicesRaw = (ps.card_choices as Record<string, unknown>[] | undefined) ?? [];
    if (choicesRaw.length > 0) {
      let picked: string | null = null;
      const notPicked: string[] = [];
      for (const entry of choicesRaw) {
        const cardObj = (entry.card as Record<string, unknown> | null) ?? {};
        const id = cleanId((g(cardObj, 'id') as string | null) ?? '', 'CARD.');
        if (entry.was_picked) picked = id;
        else if (id) notPicked.push(id);
      }
      cardChoices.push({ floor, picked, not_picked: notPicked, act });
    }

    for (const pc of (ps.potion_choices as Record<string, unknown>[] | undefined) ?? []) {
      const potionId = cleanId((pc.choice as string | null) ?? '', 'POTION.');
      if (potionId) potionEvents.push({ floor, room_type: roomType, act, potion_id: potionId, event_type: pc.was_picked ? 'obtained' : 'declined' });
    }
    for (const p of (ps.potion_used as string[] | undefined) ?? []) {
      const potionId = cleanId(p, 'POTION.');
      if (potionId) potionEvents.push({ floor, room_type: roomType, act, potion_id: potionId, event_type: 'used' });
    }
    for (const p of (ps.potion_discarded as string[] | undefined) ?? []) {
      const potionId = cleanId(p, 'POTION.');
      if (potionId) potionEvents.push({ floor, room_type: roomType, act, potion_id: potionId, event_type: 'discarded' });
    }
  }

  const playerRelics = (player.relics as Record<string, unknown>[] | undefined) ?? [];
  for (const relic of playerRelics) {
    const key = cleanId((relic.id as string | null) ?? '', 'RELIC.');
    const floor = (relic.floor_added_to_deck as number | null) ?? null;
    const act = floor != null ? (floorActMap.get(floor) ?? 'Unknown') : 'Unknown';
    if (key) relicsMap.set(key, { key, floor, act });
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

  // Per-run aggregate stats
  let cardsUpgraded = 0;
  let cardsRemovedCount = 0;
  let cardsTransformed = 0;
  let campfireSmiths = 0;
  let campfireHeals = 0;
  let totalDamageTaken = 0;
  let eliteCount = 0;

  for (const { pt } of pointsWithAct) {
    const rooms = (pt.rooms as Record<string, unknown>[] | undefined) ?? [];
    const room = rooms[0] ?? {};
    const roomType = (room.room_type as string | null) ?? '';
    if (roomType.toUpperCase().includes('ELITE')) eliteCount++;

    const psList = (pt.player_stats as Record<string, unknown>[] | undefined) ?? [];
    const ps = psList[0] ?? {};
    totalDamageTaken += (ps.damage_taken as number | null) ?? 0;
    cardsUpgraded += ((ps.cards_upgraded as unknown[] | undefined) ?? []).length;
    cardsRemovedCount += ((ps.cards_removed as unknown[] | undefined) ?? []).length;
    cardsTransformed += ((ps.cards_transformed as unknown[] | undefined) ?? []).length;
    for (const choice of (ps.rest_site_choices as string[] | undefined) ?? []) {
      const c = choice.toUpperCase();
      if (c.includes('SMITH') || c.includes('UPGRADE')) campfireSmiths++;
      else if (c.includes('HEAL') || c.includes('REST')) campfireHeals++;
    }
  }

  // Final deck
  const deckRaw = (player.deck as Record<string, unknown>[] | undefined) ?? [];
  const finalDeck: FinalDeckCard[] = deckRaw.map((card, i) => {
    const idRaw = (card.id as string | null) ?? '';
    const cardId = cleanId(idRaw, 'CARD.');
    return {
      position: i,
      card_id: cardId,
      upgrade_level: (card.current_upgrade_level as number | null) ?? 0,
      enchantment_id: (card.enchantment as string | null) ?? null,
    };
  });

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
    seed: (g(raw, 'seed') as string | null) ?? null,
    game_mode: (g(raw, 'game_mode') as string | null) ?? null,
    was_abandoned: Boolean(g(raw, 'was_abandoned')),
    build_id: (g(raw, 'build_id') as string | null) ?? null,
    deck_size: deckRaw.length,
    cards_upgraded: finalDeck.filter((c) => c.upgrade_level > 0).length,
    cards_removed_count: cardsRemovedCount,
    cards_transformed: cardsTransformed,
    campfire_smiths: campfireSmiths,
    campfire_heals: campfireHeals,
    total_damage_taken: totalDamageTaken,
    elite_count: eliteCount,
    card_choices: cardChoices,
    relics_obtained: Array.from(relicsMap.values()),
    damage_per_floor: damagePerFloor,
    floor_nodes: floorNodes,
    hp_per_floor: hpPerFloor,
    max_hp_per_floor: maxHpPerFloor,
    gold_per_floor: goldPerFloor,
    potion_events: potionEvents,
    final_deck: finalDeck,
  };
}
