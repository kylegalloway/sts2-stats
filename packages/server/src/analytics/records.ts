import type Database from 'better-sqlite3';
import { rf } from './stats-utils.js';

export interface RunSummary {
  id: number;
  character: string;
  ascension: number;
  seed: string | null;
  run_time: number | null;
  floor_reached: number;
  deck_size: number | null;
  total_damage_taken: number | null;
  elite_count: number | null;
  victory: number;
}

export interface PersonalBests {
  fastest_win: RunSummary | null;
  least_damage_win: RunSummary | null;
  smallest_deck_win: RunSummary | null;
  most_elites_win: RunSummary | null;
  highest_asc_win: RunSummary | null;
}

export interface Streaks {
  current_win_streak: number;
  current_loss_streak: number;
  longest_win_streak: number;
  longest_loss_streak: number;
}

export interface FunStats {
  total_runs: number;
  total_time_played_s: number;
  total_floors_climbed: number;
  total_damage_taken: number;
  total_gold_earned: number;
  gold_hoarded_at_death: number;
  most_common_death_floor: number | null;
  most_common_death_floor_count: number | null;
  luckiest_win: RunSummary | null;
  unluckiest_loss: RunSummary | null;
}

const SUMMARY_COLS = `
  r.id, r.character, r.ascension, r.seed, r.run_time, r.floor_reached,
  r.deck_size, r.total_damage_taken, r.elite_count, r.victory
`;

export function getPersonalBests(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): PersonalBests {
  const f = rf({ character, ascension, sinceRunId }, 'r');

  function bestWin(orderBy: string): RunSummary | null {
    return db.prepare(`
      SELECT ${SUMMARY_COLS} FROM runs r
      WHERE r.victory = 1 ${f.and}
      ORDER BY ${orderBy}
      LIMIT 1
    `).get(...f.params) as RunSummary | null;
  }

  return {
    fastest_win: bestWin('r.run_time ASC NULLS LAST'),
    least_damage_win: bestWin('r.total_damage_taken ASC NULLS LAST'),
    smallest_deck_win: bestWin('r.deck_size ASC NULLS LAST'),
    most_elites_win: bestWin('r.elite_count DESC NULLS LAST'),
    highest_asc_win: bestWin('r.ascension DESC'),
  };
}

export function getStreaks(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): Streaks {
  const f = rf({ character, ascension, sinceRunId });

  const rows = db.prepare(
    `SELECT victory FROM runs ${f.where} ORDER BY timestamp, id`
  ).all(...f.params) as { victory: number }[];

  let currentWin = 0, currentLoss = 0, longestWin = 0, longestLoss = 0;
  let runWin = 0, runLoss = 0;

  for (const row of rows) {
    if (row.victory) {
      runWin++;
      runLoss = 0;
    } else {
      runLoss++;
      runWin = 0;
    }
    if (runWin > longestWin) longestWin = runWin;
    if (runLoss > longestLoss) longestLoss = runLoss;
  }
  currentWin = runWin;
  currentLoss = runLoss;

  return { current_win_streak: currentWin, current_loss_streak: currentLoss, longest_win_streak: longestWin, longest_loss_streak: longestLoss };
}

export function getFunStats(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): FunStats {
  const f = rf({ character, ascension, sinceRunId });
  const fR = rf({ character, ascension, sinceRunId }, 'r');

  const agg = db.prepare(`
    SELECT
      COUNT(*) AS total_runs,
      SUM(run_time) AS total_time_played_s,
      SUM(floor_reached) AS total_floors_climbed,
      SUM(total_damage_taken) AS total_damage_taken,
      SUM(final_gold) AS total_gold_earned,
      SUM(CASE WHEN victory = 0 THEN final_gold ELSE 0 END) AS gold_hoarded_at_death
    FROM runs ${f.where}
  `).get(...f.params) as {
    total_runs: number; total_time_played_s: number | null; total_floors_climbed: number | null;
    total_damage_taken: number | null; total_gold_earned: number | null; gold_hoarded_at_death: number | null;
  };

  const deathFloor = db.prepare(`
    SELECT floor_reached, COUNT(*) AS cnt FROM runs
    WHERE victory = 0 ${f.and}
    GROUP BY floor_reached ORDER BY cnt DESC LIMIT 1
  `).get(...f.params) as { floor_reached: number; cnt: number } | null;

  const luckiestWin = db.prepare(`
    SELECT ${SUMMARY_COLS} FROM runs r
    WHERE r.victory = 1 ${fR.and}
    ORDER BY r.total_damage_taken DESC NULLS LAST
    LIMIT 1
  `).get(...fR.params) as RunSummary | null;

  const unluckiestLoss = db.prepare(`
    SELECT ${SUMMARY_COLS} FROM runs r
    WHERE r.victory = 0 ${fR.and}
    ORDER BY r.floor_reached DESC
    LIMIT 1
  `).get(...fR.params) as RunSummary | null;

  return {
    total_runs: agg.total_runs,
    total_time_played_s: agg.total_time_played_s ?? 0,
    total_floors_climbed: agg.total_floors_climbed ?? 0,
    total_damage_taken: agg.total_damage_taken ?? 0,
    total_gold_earned: agg.total_gold_earned ?? 0,
    gold_hoarded_at_death: agg.gold_hoarded_at_death ?? 0,
    most_common_death_floor: deathFloor?.floor_reached ?? null,
    most_common_death_floor_count: deathFloor?.cnt ?? null,
    luckiest_win: luckiestWin,
    unluckiest_loss: unluckiestLoss,
  };
}
