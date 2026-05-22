import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { db } from './db/index.js';
import { startWatcher } from './ingestion/watcher.js';

const app = new Hono();

// TODO: mount routes
// app.route('/api/overview', overviewRoutes)
// app.route('/api/runs', runsRoutes)
// app.route('/api/cards', cardsRoutes)
// app.route('/api/relics', relicsRoutes)
// app.route('/api/synergies', synergiesRoutes)
// app.route('/api/hp-gold', hpGoldRoutes)
// app.route('/api/kills', killsRoutes)
// app.route('/api/act-routes', actRoutesRoutes)
// app.route('/api/status', statusRoutes)
// app.route('/api/events', eventsRoutes)

app.get('/', (c) => c.text('STS2 Stats API'));

const PORT = 3001;

startWatcher(db, (event) => {
  console.log('[watcher]', event);
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
