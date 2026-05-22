import { describe, it, expect } from 'vitest';
import { normalizeRun } from './normalize.js';

const makeFloor = (stats: Record<string, unknown> = {}) => ({
  player_stats: [stats],
  rooms: [],
});

describe('normalizeRun', () => {
  it('strips CHARACTER. prefix from character name', () => {
    const raw = { players: [{ character: 'CHARACTER.IRONCLAD' }], map_point_history: [] };
    expect(normalizeRun(raw, 'run.run').character).toBe('IRONCLAD');
  });

  it('counts floor_reached from map_point_history entries', () => {
    const raw = { players: [{}], map_point_history: [[makeFloor(), makeFloor()], [makeFloor()]] };
    expect(normalizeRun(raw, 'run.run').floor_reached).toBe(3);
  });

  it('marks victory true when win field is set', () => {
    const raw = { players: [{}], map_point_history: [], win: true };
    expect(normalizeRun(raw, 'run.run').victory).toBe(true);
  });

  it('strips ENCOUNTER. prefix and replaces underscores in killed_by', () => {
    // cleanId uppercases word-boundary chars but does not lowercase the rest,
    // so all-caps input stays all-caps after the underscore→space replacement.
    const raw = { players: [{}], map_point_history: [], killed_by_encounter: 'ENCOUNTER.SLIME_BOSS' };
    expect(normalizeRun(raw, 'run.run').killed_by).toBe('SLIME BOSS');
  });

  it('stores the file_name as provided', () => {
    const raw = { players: [{}], map_point_history: [] };
    expect(normalizeRun(raw, 'my_run.run').file_name).toBe('my_run.run');
  });
});
