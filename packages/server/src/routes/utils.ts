import type { Context } from 'hono';
import { db } from '../db/index.js';

export interface RouteFilter {
  character?: string;
  ascension?: number;
  sinceRunId?: number;
}

// Extracts character, ascension, and last_n from query params.
// When last_n is set, computes sinceRunId = the minimum run ID in the last N matching runs.
export function extractFilter(c: Context): RouteFilter {
  const character = c.req.query('character') || undefined;
  const ascStr = c.req.query('ascension');
  const ascension = ascStr != null && ascStr !== '' ? parseInt(ascStr, 10) : undefined;
  const lastNStr = c.req.query('last_n');
  const lastN = lastNStr ? parseInt(lastNStr, 10) : undefined;

  const asc = ascension != null && !isNaN(ascension) ? ascension : undefined;

  let sinceRunId: number | undefined;
  if (lastN && lastN > 0) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (character) { conditions.push('character = ?'); params.push(character); }
    if (asc != null) { conditions.push('ascension >= ?'); params.push(asc); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const cutoff = db.prepare(
      `SELECT id FROM runs ${where} ORDER BY id DESC LIMIT 1 OFFSET ?`
    ).get(...params, lastN - 1) as { id: number } | undefined;
    sinceRunId = cutoff?.id;
  }

  return { character, ascension: asc, sinceRunId };
}
