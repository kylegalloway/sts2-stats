import type Database from 'better-sqlite3';
import { rf } from './stats-utils.js';

export function getOverview(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number) {
  const f = rf({ character, ascension, sinceRunId });

  const kpis = db.prepare(`
    SELECT
      COUNT(*) AS total_runs,
      SUM(victory) AS total_wins,
      CAST(SUM(victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate,
      AVG(floor_reached) AS avg_floor,
      AVG(run_time) AS avg_run_time
    FROM runs ${f.where}
  `).get(...f.params);

  const winByChar = db.prepare(`
    SELECT character, COUNT(*) AS total, SUM(victory) AS wins,
      CAST(SUM(victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate
    FROM runs ${f.where}
    GROUP BY character ORDER BY win_rate DESC
  `).all(...f.params);

  const timeline = db.prepare(`
    SELECT id, character, victory, floor_reached, timestamp, ascension
    FROM runs ${f.where}
    ORDER BY timestamp, id
  `).all(...f.params);

  return { kpis, winByChar, timeline };
}

export function getActRoutes(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number) {
  const f = rf({ character, ascension, sinceRunId });
  return db.prepare(`
    SELECT acts, COUNT(*) AS total, SUM(victory) AS wins,
      CAST(SUM(victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate
    FROM runs ${f.where}
    GROUP BY acts ORDER BY total DESC
  `).all(...f.params);
}

export function getAscensionStats(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number) {
  const f = rf({ character, ascension, sinceRunId });
  return db.prepare(`
    SELECT ascension, COUNT(*) AS total, SUM(victory) AS wins,
      CAST(SUM(victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate
    FROM runs ${f.where}
    GROUP BY ascension ORDER BY ascension
  `).all(...f.params);
}

export interface WinFingerprint {
  win_avg_deck_size: number | null;
  loss_avg_deck_size: number | null;
  win_avg_upgrade_rate: number | null;
  loss_avg_upgrade_rate: number | null;
  win_avg_cards_purged: number | null;
  loss_avg_cards_purged: number | null;
}

export function getWinFingerprint(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): WinFingerprint {
  const f = rf({ character, ascension, sinceRunId });
  return db.prepare(`
    SELECT
      AVG(CASE WHEN victory = 1 THEN deck_size END) AS win_avg_deck_size,
      AVG(CASE WHEN victory = 0 THEN deck_size END) AS loss_avg_deck_size,
      AVG(CASE WHEN victory = 1 AND deck_size > 0 THEN CAST(cards_upgraded AS REAL) / deck_size END) AS win_avg_upgrade_rate,
      AVG(CASE WHEN victory = 0 AND deck_size > 0 THEN CAST(cards_upgraded AS REAL) / deck_size END) AS loss_avg_upgrade_rate,
      AVG(CASE WHEN victory = 1 THEN cards_removed_count END) AS win_avg_cards_purged,
      AVG(CASE WHEN victory = 0 THEN cards_removed_count END) AS loss_avg_cards_purged
    FROM runs ${f.where}
  `).get(...f.params) as WinFingerprint;
}

export interface ActVariant {
  act_name: string;
  total: number;
  wins: number;
  win_rate: number;
}

export function getActVariants(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number): ActVariant[] {
  const fR = rf({ character, ascension, sinceRunId }, 'r');
  return db.prepare(`
    SELECT
      je.value AS act_name,
      COUNT(*) AS total,
      SUM(r.victory) AS wins,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate
    FROM runs r, json_each(r.acts) je
    WHERE r.acts IS NOT NULL ${fR.and}
    GROUP BY je.value
    ORDER BY total DESC
  `).all(...fR.params) as ActVariant[];
}

export function getPathComposition(db: Database.Database, character?: string, ascension?: number, sinceRunId?: number) {
  const fR = rf({ character, ascension, sinceRunId }, 'r');
  return db.prepare(`
    SELECT r.victory, fn.act, fn.node_type,
      COUNT(*) AS node_count,
      COUNT(DISTINCT fn.run_id) AS run_count
    FROM floor_nodes fn
    JOIN runs r ON r.id = fn.run_id
    WHERE fn.node_type IN ('elite', 'rest_site', 'shop', 'boss') ${fR.and}
    GROUP BY r.victory, fn.act, fn.node_type
  `).all(...fR.params);
}
