import { Hono } from 'hono';
import { db } from '../db/index.js';

const router = new Hono();

router.get('/', (c) => {
  const character = c.req.query('character') || undefined;
  const result = c.req.query('result') || undefined;
  const search = c.req.query('search') || undefined;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (character) { conditions.push('character = ?'); params.push(character); }
  if (result === 'win') { conditions.push('victory = 1'); }
  else if (result === 'loss') { conditions.push('victory = 0'); }
  if (search) {
    conditions.push('(character LIKE ? OR killed_by LIKE ? OR acts LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as n FROM runs ${where}`).get(...params) as { n: number }).n;
  const runs = db.prepare(
    `SELECT id, file_name, character, victory, ascension, floor_reached, final_gold, run_time, killed_by, timestamp, acts
     FROM runs ${where} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return c.json({ runs, total, page, limit });
});

export default router;
