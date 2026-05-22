import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from './db/index.js';
import { startWatcher, type WatchEvent } from './ingestion/watcher.js';
import { setBroadcast } from './events.js';
import overviewRoutes from './routes/overview.js';
import runsRoutes from './routes/runs.js';
import cardsRoutes from './routes/cards.js';
import relicsRoutes from './routes/relics.js';
import synergiesRoutes from './routes/synergies.js';
import hpGoldRoutes from './routes/hpgold.js';
import killsRoutes from './routes/kills.js';
import potionsRoutes from './routes/potions.js';
import codexRoutes from './routes/codex.js';

const app = new Hono();

// SSE clients set — broadcast watch events to all connected browsers
const sseClients = new Set<(event: WatchEvent) => void>();

const CLIENT_ORIGIN = process.env.E2E === '1' ? 'http://localhost:5174' : 'http://localhost:5173';

app.use('*', async (c, next) => {
  c.res.headers.set('Access-Control-Allow-Origin', CLIENT_ORIGIN);
  await next();
});

app.route('/api/overview', overviewRoutes);
app.route('/api/runs', runsRoutes);
app.route('/api/cards', cardsRoutes);
app.route('/api/relics', relicsRoutes);
app.route('/api/synergies', synergiesRoutes);
app.route('/api/hp-gold', hpGoldRoutes);
app.route('/api/kills', killsRoutes);
app.route('/api/potions', potionsRoutes);
app.route('/api/codex', codexRoutes);

app.get('/api/status', (c) => {
  const total = (db.prepare('SELECT COUNT(*) as n FROM runs').get() as { n: number }).n;
  const last = db.prepare('SELECT ingested_at FROM runs ORDER BY ingested_at DESC LIMIT 1').get() as { ingested_at: string } | undefined;
  return c.json({
    total_runs: total,
    last_ingested: last?.ingested_at ?? null,
    sse_clients: sseClients.size,
  });
});

app.get('/api/events', (c) => {
  return streamSSE(c, async (stream) => {
    let resolve: () => void;
    const done = new Promise<void>((r) => { resolve = r; });

    const send = (event: WatchEvent) => {
      const total = (db.prepare('SELECT COUNT(*) as n FROM runs').get() as { n: number }).n;
      stream.writeSSE({ data: JSON.stringify({ ...event, total_runs: total }) }).catch(() => {
        sseClients.delete(send);
        resolve();
      });
    };

    sseClients.add(send);
    stream.writeSSE({ data: JSON.stringify({ type: 'connected' }) });

    c.req.raw.signal.addEventListener('abort', () => {
      sseClients.delete(send);
      resolve();
    });

    await done;
  });
});

app.get('/', (c) => c.text('STS2 Stats API — see /api/status'));

const PORT = Number(process.env.PORT ?? 3001);

const broadcastEvent = (event: WatchEvent) => {
  console.log('[watcher]', event);
  for (const client of sseClients) client(event);
};

setBroadcast(broadcastEvent);

startWatcher(db, broadcastEvent);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
