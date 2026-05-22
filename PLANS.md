# STS2 Stats — Implementation Plans

Two parallel research outputs captured here for future implementation work.

---

## Plan A: Tech Stack Migration (Python/HTML → Node/React/SQLite)

### Goal

Replace the single-file Python + static HTML approach with a dynamic stack:
- **SQLite** — persistent store for runs and computed stats
- **Node.js + Hono** — API server with SSE for real-time updates
- **React + Vite + TypeScript** — interactive frontend
- **chokidar watcher** — auto-ingests new `.run` files as you finish games

---

### Project Structure

```
sts2-stats/
├── package.json              # workspace root (concurrently)
├── packages/
│   ├── server/
│   │   └── src/
│   │       ├── index.ts          # Hono app entrypoint
│   │       ├── db/
│   │       │   ├── schema.ts     # DDL as strings
│   │       │   ├── migrations.ts # sequential migration runner
│   │       │   └── index.ts      # db singleton
│   │       ├── ingestion/
│   │       │   ├── normalize.ts  # TS port of _normalize_run (most complex file)
│   │       │   ├── ingest.ts     # idempotent DB insert + ELO rebuild
│   │       │   └── watcher.ts    # chokidar + bootstrap scan
│   │       ├── analytics/        # cards.ts, relics.ts, synergies.ts, hpgold.ts, kills.ts, overview.ts
│   │       └── routes/           # one file per endpoint group
│   └── client/
│       └── src/
│           ├── api/client.ts     # typed fetch wrappers + SSE hook
│           ├── components/       # KpiCard, SortableTable, chart wrappers
│           ├── tabs/             # Overview, Cards, Relics, Synergies, Deaths, HpGold, RunLog
│           └── hooks/
│               ├── useRunsUpdated.ts   # SSE → invalidate all queries
│               └── useQuery.ts
└── scripts/bootstrap.ts      # one-time import of all existing .run files
```

---

### DB Schema

```sql
-- runs: one row per .run file
CREATE TABLE runs (
  id            INTEGER PRIMARY KEY,
  file_name     TEXT UNIQUE NOT NULL,   -- idempotency key
  character     TEXT NOT NULL,
  victory       INTEGER NOT NULL,       -- 0 or 1
  ascension     INTEGER NOT NULL DEFAULT 0,
  floor_reached INTEGER,
  final_gold    INTEGER,
  run_time      INTEGER,                -- seconds
  killed_by     TEXT,
  timestamp     TEXT,                   -- ISO string from start_time
  acts          TEXT,                   -- JSON array: ["Underdocks","Hive"]
  raw_json      TEXT NOT NULL,          -- full normalized run blob for reprocessing
  ingested_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- card_choices: one row per card offered at a choice event
CREATE TABLE card_choices (
  id         INTEGER PRIMARY KEY,
  run_id     INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  floor      INTEGER,
  card_id    TEXT NOT NULL,
  was_picked INTEGER NOT NULL,          -- 0 or 1
  act        TEXT                       -- "Act 1" | "Act 2" | "Act 3+"
);

-- relics_obtained: one row per relic per run
CREATE TABLE relics_obtained (
  id        INTEGER PRIMARY KEY,
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  relic_key TEXT NOT NULL,
  floor     INTEGER,
  act       TEXT
);

-- hp_gold_per_floor: one row per floor per run
CREATE TABLE hp_gold_per_floor (
  run_id  INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  floor   INTEGER NOT NULL,
  hp      INTEGER,
  max_hp  INTEGER,
  gold    INTEGER,
  PRIMARY KEY (run_id, floor)
);

-- card_elo: computed cache, rebuilt on every new run ingestion
CREATE TABLE card_elo (
  character TEXT NOT NULL,
  card_id   TEXT NOT NULL,
  elo       REAL NOT NULL DEFAULT 1000,
  PRIMARY KEY (character, card_id)
);

-- ingestion_log: watcher event debugging
CREATE TABLE ingestion_log (
  id        INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  status    TEXT NOT NULL,              -- 'ok' | 'skipped' | 'error'
  message   TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE schema_version (version INTEGER PRIMARY KEY);

-- Indexes
CREATE INDEX idx_runs_character ON runs(character);
CREATE INDEX idx_runs_victory ON runs(victory);
CREATE INDEX idx_card_choices_run_id ON card_choices(run_id);
CREATE INDEX idx_card_choices_card_id ON card_choices(card_id);
CREATE INDEX idx_relics_run_id ON relics_obtained(run_id);
CREATE INDEX idx_hp_gold_run_id ON hp_gold_per_floor(run_id);
```

**Design philosophy:** Aggregate stats (card win rate, relic quality score, synergy lift) are computed at query time via SQL GROUP BY — fast enough for a personal dataset. ELO is the exception (requires chronological ordering); it's recomputed in JS after every ingestion and cached in `card_elo`.

The `raw_json` column stores the normalized run blob as an escape hatch — if the schema changes you can re-ingest from DB without re-reading the filesystem.

---

### API Endpoints

```
GET /api/overview?character=
GET /api/runs?character=&result=&page=1&limit=50
GET /api/cards?character=
GET /api/relics?character=
GET /api/synergies?character=&min_occurrences=2
GET /api/hp-gold?character=
GET /api/kills?character=
GET /api/act-routes
GET /api/status
GET /api/events          ← SSE stream: {"type":"run_added","file":"x.run","total_runs":42}
```

---

### Ingestion Pipeline

**macOS gotcha:** The save path has a glob-wildcard Steam user ID (`steam/*/profile1/`). Cannot watch a glob directly. At startup, use the `glob` npm package to resolve the wildcard to a concrete absolute path, then pass that to chokidar.

```typescript
// Critical chokidar config
chokidar.watch(path.join(resolvedDir, '*.run'), {
  ignoreInitial: true,          // existing files handled by bootstrap scan
  awaitWriteFinish: {
    stabilityThreshold: 500,    // wait 500ms after last write — prevents reading mid-write partial JSON
    pollInterval: 100,
  },
});
```

**Idempotency:** `ingestRun` checks `SELECT id FROM runs WHERE file_name = ?` before inserting. `reIngestRun` (for `change` events) DELETEs existing rows (cascades to child tables) then re-inserts.

**ELO rebuild:** After every new run, fetch all card_choices in chronological order (`ORDER BY r.timestamp, r.id, cc.floor`), run the K=32 ELO loop in JS (same as Python), write results to `card_elo`. Under 10ms for a personal dataset.

---

### Real-Time Flow

1. Game ends → STS2 writes `.run` file
2. chokidar fires `add` event after 500ms stabilization
3. Server ingests, rebuilds ELO, emits SSE event
4. Browser `EventSource` receives event → `queryClient.invalidateQueries()`
5. All mounted tab queries silently refetch

---

### Frontend Architecture

**Libraries:**
- **Recharts** — React-native charting, no imperative `chart.destroy()` footguns (unlike Chart.js)
- **TanStack Query** — server state, loading/error, stale-time, SSE-triggered invalidation
- **Zustand** — one small store for active tab + selected character filter

**Component tree:**
```
App
└── Layout
      ├── Header (status, SSE indicator)
      ├── TabBar
      └── <ActiveTab>
            ├── Overview    → KpiRow, CharWinRateChart, FloorDistChart, ActRouteChart, RecentRunsTable
            ├── Cards       → CharacterSelect, QualityChart, EloChart, SortableTable
            ├── Relics      → CharacterSelect, QualityChart, WinRateChart, SortableTable
            ├── Synergies   → CharacterSelect, MinOccInput, SortableTable
            ├── Deaths      → CharacterSelect, KillerBarChart, SortableTable
            ├── HpGold      → CharacterSelect, HpLineChart, GoldLineChart
            └── RunLog      → CharacterSelect, ResultSelect, SearchInput, SortableTable (paginated)
```

---

### Key Dependencies

```json
// server
"hono", "@hono/node-server", "better-sqlite3", "chokidar", "glob"

// client
"react", "react-dom", "@tanstack/react-query", "recharts", "zustand"

// dev
"tsx", "concurrently", "vite", "@vitejs/plugin-react", "typescript"
```

---

### Migration Path

1. **`scripts/bootstrap.ts`** — runs once, imports all existing `.run` files via `ingestRun` (idempotent, safe to run again)
2. **Keep `sts2_export.py`** as reference during dev — compare API output against its embedded data to catch mis-ports
3. The most likely mis-port bugs: ELO ordering (must be chronological), HP delta boundary condition (`fi + 3 < len(hp_c)` in Python)
4. Go live once analytics parity is confirmed

---

### Dev Experience

```bash
npm run dev   # starts server (tsx --watch) + client (vite) via concurrently
```

```json
// root package.json scripts
"dev": "concurrently -n server,client -c blue,green \"npm run dev -w packages/server\" \"npm run dev -w packages/client\""
```

Vite proxies `/api/*` → `localhost:3001`. Full hot reload on both sides.

---

### Gotchas

1. **macOS permissions:** If Terminal doesn't have Full Disk Access, chokidar silently fails on `~/Library/Application Support`. At startup, attempt a test read and catch `EACCES` with a clear error message pointing to System Settings → Privacy.
2. **Multiple Steam accounts:** Glob may return multiple matches. Log a warning, use first match.
3. **In-progress `.run` files:** STS2 may write partial JSON mid-run. `awaitWriteFinish` handles the common case; the try/catch in `ingestRun` handles the rest — logs the error, skips the file, retries on the next `change` event.
4. **Card skip (no pick):** When a player skips a reward, all cards have `was_picked = 0`. Card stats queries must handle this to avoid miscounting pick rates.

---

---

## Plan B: STS2 Analytics Gaps & Game Knowledge

### STS2 Context (as of EA 2025)

- **Characters in EA:** Ironclad, Silent, Defect, Watcher, Necrobinder (and possibly Regent — both appear in the script's `charColor` map)
- **Acts are named worlds** (Underdocks, Hive, etc.) chosen at junctures — STS2's biggest structural departure from STS1
- **Non-linear branching map** — more open path decisions than STS1's column-based map; `map_point_history` is nested list-of-lists per act
- **Energy/orb system** updated for Defect; Watcher keeps Calm/Wrath stance mechanic
- **Potions** function similarly to STS1 with new types

---

### A. Missing Data to Capture from `.run` Files

Priority ordered by player-improvement ROI:

**1. Map node type per floor (HIGHEST)**
`map_point_type` is only used to detect shops — elite, boss, rest, event, chest nodes are all discarded. This single field unlocks the entire path analytics category. Fix: in the per-point loop in `normalize.ts`, store `pt.get("map_point_type")` for each floor.

**2. Encounter/event ID per floor (HIGHEST)**
`killed_by_encounter` is parsed at run level (death only), but there's no record of encounters on floors you *survived*. Without this, boss-specific win rates are impossible. Each `pt` almost certainly has an encounter or event ID — capture it.

**3. Boss identity per act (HIGH)**
Likely in the encounter field of the final floor node per act, or a dedicated run-level field. Boss win rate is one of the highest-leverage metrics for targeted improvement.

**4. Final deck state (HIGH)**
Cards removed via events, upgraded, or purchased at shops may not all be captured. Currently only draft picks are stored. The final deck composition reveals what archetypes you actually *complete* runs with, vs. what you draft along the way.

**5. Potion usage/inventory (MEDIUM)**
STS1 `.run` files tracked potions per floor. STS2 almost certainly does too. Potion hoarding (never using potions at boss fights) is one of the most common mistakes in roguelikes.

**6. Card upgrades (MEDIUM)**
Rest-site upgrade vs. rest choice and Smith event upgrades aren't tracked. Upgraded vs. unupgraded versions of the same card can perform very differently.

**7. Score (LOW — easy win)**
Line 165 of `sts2_export.py` explicitly sets `r["score"] = None` despite it existing in the save data. Add it back.

---

### B. New Analytics Views Worth Building

Priority ordered by player-improvement ROI:

**1. Boss kill/loss rate matrix (HIGHEST)**
`Boss | Faced | Won | Lost | Win%` — the single most actionable improvement metric. Requires boss encounter IDs (see A.2/A.3 above). A player dying to Act 2 boss 60% of the time has a clear target.

**2. Path composition: wins vs. losses (HIGHEST)**
With node types per floor, compute: elite density, rest rate, shop visit rate per act — then compare across win/loss outcomes. e.g., "in my wins I average 2.3 elites in Act 2; in losses I average 3.1" is directly actionable.

**3. Win rate by ascension level (EASY WIN — zero new data)**
`ascension_level` is already captured. Just needs a `GROUP BY ascension_level` query and a chart. Shows exactly where the player's current ceiling is.

**4. HP% entering each act boss (HIGH)**
Segment runs by HP bucket (>75%, 50-75%, 25-50%, <25%) at the boss entry floor, show win rate per bucket. Directly quantifies the value of arriving at bosses healthy. Requires knowing which floor is a boss node (needs node type from A.1).

**5. Rolling win rate trend (EASY WIN — zero new data)**
10-run rolling average of win rate shows the learning curve over time. Pure morale/improvement tracker. ~10 lines of JS from existing `summaries` data.

**6. Rest vs. upgrade decision analytics (MEDIUM)**
If rest-site node data exposes whether the player rested or upgraded, track "rest rate by HP threshold entering rest site." Players upgrading when they should be healing is a common mistake.

**7. Card draft skip rate by act (MEDIUM)**
When `was_picked = 0` for all cards at a choice — player skipped entirely. Skip rate by act: high Act 1 skip rate often means not building a win condition. Requires distinguishing "no card offered" from "skipped by choice."

**8. HP% at boss entry vs. outcome segmentation (MEDIUM)**
Specifically for each act boss: what was your HP% going in, and did you win? A scatter plot of boss-entry HP vs. run outcome would clearly show the HP threshold below which winning becomes unlikely.

---

### C. STS2-Specific Mechanics Currently Untracked

**1. Named act worlds + world order**
Script captures `acts_clean` and `compute_act_routes()` breaks win rate by Act 1 choice. But no multi-act route combination analysis (e.g., "Underdocks → Hive vs. other orderings"), no "which acts do you perform best in?" per character. This is STS2-native with no STS1 equivalent.

**2. Non-linear branching map structure**
`map_point_history` is nested per-act but flattened to a linear sequence. If points have x/y coordinates or branch metadata, which branches you take and how they perform would be STS2-native analysis. Currently invisible.

**3. Necrobinder/Regent mechanics**
New characters in STS2 may have unique trackable resources (like Watcher's stances in STS1 analytics). Current analytics treat all characters identically. No character-specific resource tracking.

**4. Card type tagging (attack/skill/power/curse)**
No distinction between card types anywhere in the analytics. Blight/curse accumulation rate completely untracked. Card IDs likely encode type via naming convention — worth parsing.

**5. Shop inventory + gold efficiency**
Visit rate and spend tracked, but not what was *available* at shops or what the player chose not to buy. Can't answer "am I missing good relics because I'm broke at shops?" without this.

---

### Top 5 Highest-ROI Implementation Targets

Combining plans A and B, in priority order:

1. **Node type per floor** — one field added to the normalize loop; unlocks all path analytics
2. **Encounter ID per floor** — companion to node type; enables boss-specific win rates
3. **Win rate by ascension level** — zero new data, just a new SQL query + chart
4. **HP% at act boss entry, segmented by outcome** — needs node type; most vivid actionable insight
5. **Rolling win rate trend** — zero new data, ~10 lines of JS, clear learning-curve visualization

---

### Implementation Order Recommendation

```
Phase 1 — Scaffold & Bootstrap
  [ ] Monorepo structure (already done)
  [ ] DB schema + migrations
  [ ] normalize.ts (TS port of _normalize_run — most complex, everything depends on this)
  [ ] ingest.ts (idempotent insert + ELO rebuild)
  [ ] bootstrap script (import all existing .run files)
  [ ] Validate row counts match Python script output

Phase 2 — API + Basic UI
  [ ] Hono server with all endpoints
  [ ] React app scaffolding (Vite + TanStack Query + Zustand)
  [ ] Port all existing dashboard tabs
  [ ] Validate analytics parity with Python script (ELO + synergy lift are highest-risk)

Phase 3 — New Analytics (Plan B)
  [ ] Add node_type + encounter_id columns to card_choices / new floor_nodes table
  [ ] Re-ingest all runs (raw_json escape hatch)
  [ ] Win rate by ascension chart
  [ ] Boss kill/loss matrix
  [ ] Path composition analysis (elite density wins vs. losses)
  [ ] HP% at boss entry segmentation
  [ ] Rolling win rate trend

Phase 4 — STS2-Specific
  [ ] Multi-act route combination analysis
  [ ] Card type tagging from ID naming convention
  [ ] Character-specific resource tracking (when data format is understood)
```
