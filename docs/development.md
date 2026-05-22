# Developer Guide

This guide explains how the app is built, how all the pieces connect, and how to make changes using a test-driven workflow. It's written for developers who are comfortable with JavaScript/TypeScript but may not have worked with this particular stack before.

## What the app does

STS2 Stats reads Slay the Spire 2 save files (`.run` files that the game writes to disk after each run), stores their contents in a local SQLite database, and displays a live-updating analytics dashboard in the browser.

There is no cloud, no auth, no deployment. It runs entirely on your machine.

---

## Architecture overview

```
STS2 game ──writes──▶ .run files on disk
                             │
                             ▼
                    [chokidar file watcher]
                             │ detects new/changed file
                             ▼
                    [ingestion pipeline]
                      parse JSON → normalize → upsert to SQLite
                             │
                             ├──▶ SSE broadcast to browser
                             │
                             ▼
                        [SQLite DB]
                             │
                             ▼
                    [analytics queries]
                             │
                             ▼
                     [Hono HTTP routes]   ◀── browser requests
                             │
                             ▼
                    [React + TanStack Query]
                             │
                             ▼
                       charts in browser
```

The server and client are two separate Node processes that run at the same time during development:

| Process | Port | Started by |
|---------|------|------------|
| Hono server | 3001 | `npm run dev -w packages/server` |
| Vite dev server | 5173 | `npm run dev -w packages/client` |

Running `npm run dev` at the repo root starts both concurrently.

---

## The parts, explained

### Server (`packages/server/src/`)

The server has four distinct layers. Each has a clear job and only talks to adjacent layers.

#### 1. Database layer (`db/`)

**`db/index.ts`** opens the SQLite file (`sts2.db` at the repo root), applies two pragmas, runs the schema DDL, then runs any pending migrations. This file exports a single `db` instance that every other module imports.

```
db/
  index.ts      ← opens the file, applies pragmas, runs DDL + migrations
  schema.ts     ← raw SQL string: CREATE TABLE ... for every table
  migrations.ts ← ALTER TABLE and backfill statements for schema changes
```

SQLite "WAL mode" (`journal_mode = WAL`) means readers and writers don't block each other — the watcher can insert a row while the browser is fetching analytics without either waiting.

`foreign_keys = ON` means SQLite enforces `REFERENCES` constraints (they're off by default). All the child tables (`card_choices`, `hp_gold_per_floor`, etc.) cascade-delete when a run row is deleted.

#### 2. Ingestion pipeline (`ingestion/`)

```
ingestion/
  watcher.ts    ← finds the STS2 save directory, watches it with chokidar
  ingest.ts     ← reads a .run file, calls normalizeRun, upserts to DB
  normalize.ts  ← converts raw .run JSON to a typed NormalizedRun object
```

**How a run gets in:**

1. `watcher.ts` globs several candidate paths (macOS, Linux, Windows variants) to find the STS2 history directory. On startup it also bulk-ingests any existing `.run` files.
2. When chokidar fires an `add` or `change` event, `ingest.ts` reads the file as JSON and calls `normalizeRun()`.
3. `normalizeRun()` in `normalize.ts` turns the raw game JSON into a typed `NormalizedRun` object — stripping prefixes like `CHARACTER.`, `CARD.`, `ENCOUNTER.`, computing act labels from floor numbers, etc.
4. `ingest.ts` upserts the normalized data across all tables in a single SQLite transaction. The `file_name` column has a `UNIQUE` constraint, so re-ingesting the same file is safe.
5. After a successful insert, `watcher.ts` calls the `onEvent` callback, which broadcasts an SSE event to all connected browsers.

#### 3. Analytics queries (`analytics/`)

Each file in `analytics/` exports pure functions that take a `db` instance (and optional filters like `character`) and return typed arrays from SQL queries. They do not own any state — they just execute a prepared statement and return the result.

```
analytics/
  kills.ts      ← death counts, boss stats, enemy inflection window analysis
  cards.ts      ← pick rates, win rates, ELO
  relics.ts     ← relic usage and win-rate impact
  overview.ts   ← aggregate KPIs (win rate, avg score, per-character)
  synergies.ts  ← card-pair lift analysis
  hpgold.ts     ← HP/gold trends by floor
  potions.ts    ← potion obtained/used/skipped rates
```

Analytics functions don't import from routes or ingestion — they only see `db`. This makes them easy to unit test by passing in a real in-memory database.

#### 4. Routes (`routes/`)

Each file in `routes/` creates a small Hono router that wires HTTP endpoints to analytics functions. A route file is typically 10-20 lines: extract query params, call an analytics function, return `c.json(result)`.

```
routes/kills.ts:

  router.get('/', (c) => {
    const character = c.req.query('character') || undefined;
    return c.json({ kills: getKills(db, character) });
  });
```

All routers are mounted under `/api/` in `index.ts`. The only things in `index.ts` that don't fit elsewhere are the SSE endpoint (`/api/events`) and the status endpoint (`/api/status`), which are short enough to live inline.

---

### Client (`packages/client/src/`)

The client is a standard React SPA. The stack choices reduce boilerplate: TanStack Query handles all data fetching and caching so there's almost no manual `useEffect` + `useState` for server data, and Zustand manages the small amount of local UI state (e.g., the active character filter).

```
src/
  main.tsx          ← React root + TanStack Query client setup
  App.tsx           ← tab navigation
  tabs/             ← one component per dashboard tab (Overview, Cards, ...)
  components/       ← shared chart primitives used across tabs
  api/              ← typed fetch wrappers for each API endpoint
  hooks/
    useRunsUpdated.ts ← SSE listener; invalidates TanStack Query cache on events
  store.ts          ← Zustand store (character filter, active tab)
  utils/
    format.ts       ← display formatting helpers (title-case, em-dash fallback)
```

#### How the browser gets live updates

The client opens a persistent SSE connection to `/api/events` when it mounts (`useRunsUpdated` hook). When the server broadcasts a `run_added` or `run_updated` event, the hook calls `queryClient.invalidateQueries()`, which tells TanStack Query that all cached data is stale. TanStack Query then re-fetches whatever the currently visible tab needs.

This is why you never need to manually refresh the page — finishing a run in-game triggers the whole chain: file written → watcher fires → DB updated → SSE sent → cache invalidated → queries re-fetch → charts update.

#### How `api/` and tabs fit together

`api/client.ts` exports one async function per endpoint. Each function calls `fetch`, parses the JSON, and returns a typed result.

A tab component calls one of those functions via `useQuery`:

```ts
const { data } = useQuery({
  queryKey: ['kills', character],
  queryFn: () => fetchKills(character),
});
```

TanStack Query caches the result under the `queryKey`. When `useRunsUpdated` invalidates all queries, any `queryKey` that is currently mounted re-fetches automatically.

---

## Setting up for development

```bash
git clone <repo>
cd sts2-stats
npm install
npm run dev          # starts server on :3001 and client on :5173
```

On first run the watcher will try to auto-detect your STS2 save directory. If it can't find it, the server logs a warning — you can still use the app once you have some data in the DB. Use `npm run bootstrap` to bulk-import existing runs:

```bash
npm run bootstrap                             # auto-detect STS2 directory
npm run bootstrap -- --path ~/path/to/history # explicit path
```

**macOS note:** If you see `Permission denied` in the server logs, go to System Settings → Privacy & Security → Full Disk Access and enable Terminal.

---

## Development workflow

The repo uses a red-green-refactor cycle:

1. **Write a failing test** that describes the behaviour you want.
2. **Write the minimum code** to make it pass.
3. **Refactor** — clean up without changing behaviour (tests stay green).

Run tests at any time with:

```bash
npm test                        # run everything once
npm test -- --watch             # re-run on save (useful while coding)
npm test -- --watch packages/server/src/ingestion/normalize.test.ts  # one file
```

Run the linter with:

```bash
npm run lint
```

---

## End-to-end (E2E) testing with Playwright

Unit and integration tests (Vitest) cover individual functions with in-memory databases. Playwright covers the full stack: a real browser, a real server, a real SQLite database, and the SSE live-update pipeline.

### Running E2E tests

```bash
npm run e2e          # headless, one run
npm run e2e:ui       # opens Playwright's interactive UI explorer
```

Playwright automatically starts an isolated server on port 3002 and a Vite dev server on port 5174 before the tests run, and tears them down afterwards. They won't conflict with your normal `npm run dev` processes (which use 3001/5173).

### How isolation works

| Concern | Mechanism |
|---------|-----------|
| Separate database | `E2E_DB_PATH=sts2-e2e.db` env var; the server picks a different file |
| No file watcher | `E2E=1` env var disables chokidar in `watcher.ts` |
| Seeding data | `POST /api/runs/ingest-raw` (E2E-only endpoint) accepts raw `.run` JSON |
| Cleaning between tests | `POST /api/runs/reset` (E2E-only endpoint) deletes all rows |
| SSE broadcasts | `ingest-raw` fires the broadcast after a successful insert, so live-update tests work end-to-end |

The two E2E-only endpoints are gated behind `if (process.env.E2E === '1')` in the router and do not exist in production builds.

### Writing a new E2E test

Tests live in `e2e/tests/`. The `seedRun()` and `resetDatabase()` helpers in `e2e/fixtures/seed.ts` handle setup:

```ts
import { test, expect } from '@playwright/test';
import { seedRun, resetDatabase } from '../fixtures/seed.js';

const SERVER = 'http://localhost:3002';

test.beforeEach(async () => {
  await resetDatabase(SERVER);   // wipe between tests
});

test('my feature works', async ({ page }) => {
  // Given: some run data exists
  await seedRun(SERVER, { character: 'Ironclad', victory: true, floors: 20 });

  // When: the user navigates to the dashboard
  await page.goto('/');
  await page.getByRole('button', { name: 'Run Log' }).click();

  // Then: the run appears in the table
  await expect(page.locator('.badge-win')).toBeVisible();
});
```

**Selector tips:**
- Use `.badge-win` / `.badge-loss` for result badges (avoids matching dropdown options that also contain "Win"/"Loss")
- Use `page.locator('.tcard-head').getByText(/runs/)` for the run count (avoids the header count in the status bar)
- Use `page.locator('td').filter({ hasText: 'Ironclad' }).first()` for character names in table cells
- Avoid `waitForLoadState('networkidle')` — the SSE connection keeps the page from ever reaching network idle; wait for a specific DOM element instead

### What is covered

| File | Scenarios |
|------|-----------|
| `e2e/tests/overview.spec.ts` | Zero-state, total run count, win rate KPI, per-character breakdown |
| `e2e/tests/navigation.spec.ts` | All tabs visible, tab switching, active state, Cards/Enemies load |
| `e2e/tests/run-log.spec.ts` | Run table population, Win/Loss badges, result filter, character filter |
| `e2e/tests/live-update.spec.ts` | Run Log and Overview update via SSE without page refresh, SSE connection established |

---

### Worked example: adding a new analytics function

This walkthrough adds a function that returns the average floor reached per character — a useful KPI. It touches the server only (analytics + route). The client side is omitted here but follows the same pattern: add a fetch function in `api/`, add a `useQuery` call in a component.

#### Step 1 — Write a failing test

Create `packages/server/src/analytics/overview.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DDL } from '../db/schema.js';
import { getAvgFloorPerCharacter } from './overview.js';

// Create a fresh in-memory DB for each test so tests don't share state.
let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
});

describe('getAvgFloorPerCharacter', () => {
  it('returns empty array when there are no runs', () => {
    expect(getAvgFloorPerCharacter(db)).toEqual([]);
  });

  it('calculates average floor reached per character', () => {
    db.prepare(`
      INSERT INTO runs (file_name, character, victory, ascension, floor_reached, raw_json, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run('a.run', 'IRONCLAD', 0, 0, 10, '{}');
    db.prepare(`
      INSERT INTO runs (file_name, character, victory, ascension, floor_reached, raw_json, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run('b.run', 'IRONCLAD', 0, 0, 20, '{}');

    const result = getAvgFloorPerCharacter(db);
    expect(result).toEqual([{ character: 'IRONCLAD', avg_floor: 15 }]);
  });

  it('groups by character separately', () => {
    db.prepare(`INSERT INTO runs (file_name, character, victory, ascension, floor_reached, raw_json, ingested_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run('a.run', 'IRONCLAD', 0, 0, 10, '{}');
    db.prepare(`INSERT INTO runs (file_name, character, victory, ascension, floor_reached, raw_json, ingested_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run('b.run', 'SILENT', 0, 0, 30, '{}');

    const result = getAvgFloorPerCharacter(db);
    expect(result).toHaveLength(2);

    const ironclad = result.find((r) => r.character === 'IRONCLAD')!;
    const silent = result.find((r) => r.character === 'SILENT')!;
    expect(ironclad.avg_floor).toBe(10);
    expect(silent.avg_floor).toBe(30);
  });
});
```

Run `npm test` — these tests fail because `getAvgFloorPerCharacter` doesn't exist yet. That's expected.

```
FAIL  packages/server/src/analytics/overview.test.ts
  × returns empty array when there are no runs
```

#### Step 2 — Write the minimum code to pass

Open `packages/server/src/analytics/overview.ts` and add the function:

```ts
export interface AvgFloorRow {
  character: string;
  avg_floor: number;
}

export function getAvgFloorPerCharacter(db: Database.Database): AvgFloorRow[] {
  return db.prepare(`
    SELECT character, AVG(floor_reached) AS avg_floor
    FROM runs
    WHERE floor_reached IS NOT NULL
    GROUP BY character
    ORDER BY avg_floor DESC
  `).all() as AvgFloorRow[];
}
```

Run `npm test` — all three new tests pass.

#### Step 3 — Wire up the route

Open `packages/server/src/routes/overview.ts` and add:

```ts
import { getAvgFloorPerCharacter } from '../analytics/overview.js';

router.get('/avg-floor', (c) => {
  return c.json({ avg_floor: getAvgFloorPerCharacter(db) });
});
```

This is now live at `GET /api/overview/avg-floor`. No server restart needed during dev — `tsx --watch` picks up the change.

#### Step 4 — Refactor (if needed)

If you notice the INSERT boilerplate in the test repeating, extract a helper:

```ts
function insertRun(db: Database.Database, file: string, character: string, floor: number) {
  db.prepare(`INSERT INTO runs (file_name, character, victory, ascension, floor_reached, raw_json, ingested_at) VALUES (?, ?, 0, 0, ?, '{}', datetime('now'))`)
    .run(file, character, floor);
}
```

Run `npm test` again to confirm nothing broke.

---

### Worked example: adding a client-side utility

Client utilities (like those in `utils/format.ts`) are pure functions — no DOM, no fetch. They're the simplest thing to test.

Say you want a function that formats a run time in seconds as `"m:ss"`:

**`packages/client/src/utils/format.test.ts`** (add to existing file):

```ts
describe('formatRunTime', () => {
  it('returns em dash for null', () => {
    expect(formatRunTime(null)).toBe('—');
  });

  it('formats seconds as m:ss', () => {
    expect(formatRunTime(125)).toBe('2:05');
    expect(formatRunTime(60)).toBe('1:00');
    expect(formatRunTime(9)).toBe('0:09');
  });
});
```

Run `npm test` — fails. Now add to `utils/format.ts`:

```ts
export function formatRunTime(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
```

Green. Done.

---

## Database schema quick reference

| Table | What it stores |
|-------|---------------|
| `runs` | One row per run. Core stats + full raw JSON for debugging. |
| `card_choices` | Every card offer in a run — which was picked, which wasn't. |
| `relics_obtained` | Relics picked up, with floor and act. |
| `hp_gold_per_floor` | HP and gold snapshot at each floor. |
| `damage_per_floor` | Damage taken at each floor, with room type and encounter. |
| `floor_nodes` | Map node type (combat, elite, boss, rest, shop…) at each floor. |
| `run_inflection` | Pre-computed worst 3-floor HP drain window per run. |
| `card_elo` | Running ELO score per card per character, updated on each ingest. |
| `potion_events` | Potions obtained, declined, used, or discarded, with floor context. |
| `ingestion_log` | Audit log of every file processed, with status and error message. |

All child tables `ON DELETE CASCADE` from `runs` — deleting a run row cleans up all its related rows automatically.

---

## Adding a new analytics tab (end-to-end checklist)

1. Add analytics functions to `packages/server/src/analytics/<name>.ts`
2. Write tests for them in `<name>.test.ts` — use an in-memory DB (see example above)
3. Add a route file at `packages/server/src/routes/<name>.ts`
4. Mount it in `packages/server/src/index.ts`: `app.route('/api/<name>', nameRoutes)`
5. Add a typed fetch function to `packages/client/src/api/client.ts`
6. Create a tab component at `packages/client/src/tabs/<Name>.tsx` using `useQuery`
7. Register the tab in `packages/client/src/App.tsx`
