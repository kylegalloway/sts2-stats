import type Database from 'better-sqlite3';
import { rf } from './stats-utils.js';

export interface PotionStat {
  potion_id: string;
  times_offered: number;
  times_obtained: number;
  pick_rate: number | null;
  times_used: number;
  times_discarded: number;
  use_rate: number | null;
  discard_rate: number | null;
}

export function getPotionStats(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): PotionStat[] {
  const fR = rf({ character, ascension, sinceRunId }, 'r');
  const hasFilter = fR.params.length > 0;

  return db.prepare(`
    SELECT
      potion_id,
      SUM(CASE WHEN event_type IN ('obtained', 'declined') THEN 1 ELSE 0 END) AS times_offered,
      SUM(CASE WHEN event_type = 'obtained' THEN 1 ELSE 0 END) AS times_obtained,
      CAST(SUM(CASE WHEN event_type = 'obtained' THEN 1 ELSE 0 END) AS REAL) /
        NULLIF(SUM(CASE WHEN event_type IN ('obtained', 'declined') THEN 1 ELSE 0 END), 0) AS pick_rate,
      SUM(CASE WHEN event_type = 'used' THEN 1 ELSE 0 END) AS times_used,
      SUM(CASE WHEN event_type = 'discarded' THEN 1 ELSE 0 END) AS times_discarded,
      CAST(SUM(CASE WHEN event_type = 'used' THEN 1 ELSE 0 END) AS REAL) /
        NULLIF(SUM(CASE WHEN event_type = 'obtained' THEN 1 ELSE 0 END), 0) AS use_rate,
      CAST(SUM(CASE WHEN event_type = 'discarded' THEN 1 ELSE 0 END) AS REAL) /
        NULLIF(SUM(CASE WHEN event_type = 'obtained' THEN 1 ELSE 0 END), 0) AS discard_rate
    FROM potion_events pe
    ${hasFilter ? 'JOIN runs r ON r.id = pe.run_id' : ''}
    ${fR.where}
    GROUP BY potion_id
    HAVING times_offered >= 2
    ORDER BY times_offered DESC
  `).all(...fR.params) as PotionStat[];
}

export interface PotionUsageByRoom {
  room_type: string;
  times_used: number;
}

export function getPotionUsageByRoom(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): PotionUsageByRoom[] {
  const fR = rf({ character, ascension, sinceRunId }, 'r');
  const hasFilter = fR.params.length > 0;
  const whereBase = `WHERE pe.event_type = 'used'`;
  const whereClause = hasFilter ? `${whereBase} ${fR.and}` : whereBase;

  return db.prepare(`
    SELECT
      COALESCE(pe.room_type, 'unknown') AS room_type,
      COUNT(*) AS times_used
    FROM potion_events pe
    ${hasFilter ? 'JOIN runs r ON r.id = pe.run_id' : ''}
    ${whereClause}
    GROUP BY room_type
    ORDER BY times_used DESC
  `).all(...fR.params) as PotionUsageByRoom[];
}

export interface PotionBossUsageStat {
  potion_id: string;
  used_at_boss: number;
  used_elsewhere: number;
  total_used: number;
  boss_use_pct: number | null;
}

export function getPotionBossUsage(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): PotionBossUsageStat[] {
  const fR = rf({ character, ascension, sinceRunId }, 'r');
  const hasFilter = fR.params.length > 0;
  const whereBase = `WHERE pe.event_type = 'used'`;
  const whereClause = hasFilter ? `${whereBase} ${fR.and}` : whereBase;

  return db.prepare(`
    SELECT
      potion_id,
      SUM(CASE WHEN room_type = 'boss' THEN 1 ELSE 0 END) AS used_at_boss,
      SUM(CASE WHEN room_type != 'boss' THEN 1 ELSE 0 END) AS used_elsewhere,
      COUNT(*) AS total_used,
      CAST(SUM(CASE WHEN room_type = 'boss' THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) AS boss_use_pct
    FROM potion_events pe
    ${hasFilter ? 'JOIN runs r ON r.id = pe.run_id' : ''}
    ${whereClause}
    GROUP BY potion_id
    HAVING total_used >= 2
    ORDER BY total_used DESC
  `).all(...fR.params) as PotionBossUsageStat[];
}
