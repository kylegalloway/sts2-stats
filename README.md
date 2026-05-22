# sts2-stats

A local analytics dashboard for [Slay the Spire 2](https://store.steampowered.com/app/1916760/Slay_the_Spire_2/) run history. Watches your save directory for new runs and updates the dashboard in real time.

## Features

- **Live ingestion** — chokidar watches your STS2 history folder; new `.run` files are ingested automatically
- **Run log** — sortable table of all runs with outcome, character, score, and floor reached
- **Overview** — win rate, average score, and per-character KPIs
- **Cards** — pick rate, win rate, and ELO rating for every card
- **Relics** — relic usage and win-rate impact
- **Synergies** — card-pair lift analysis
- **HP & Gold** — HP and gold trends across floors
- **Deaths** — enemy kill/death breakdown

## Tech stack

| Layer | Tech |
|---|---|
| Server | [Hono](https://hono.dev/) + Node.js, [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Client | React 19, [TanStack Query](https://tanstack.com/query), [Recharts](https://recharts.org/), [Zustand](https://zustand-demo.pmnd.rs/) |
| Build | Vite (client), tsx (server dev), TypeScript throughout |
| Live updates | Server-Sent Events (SSE) |

## Getting started

### Prerequisites

- Node.js 20+
- A local Slay the Spire 2 installation with at least one completed run

### Install

```bash
npm install
```

### Bootstrap existing runs

Import all `.run` files already on disk into SQLite:

```bash
npm run bootstrap
```

The script auto-detects your STS2 history directory on macOS, Linux, and Windows. Pass flags to override:

```bash
# Explicit path
npm run bootstrap -- --path ~/Library/Application\ Support/.../history

# Different Steam profile slot (default: 1)
npm run bootstrap -- --profile 2
```

### Run in development

```bash
npm run dev
```

This starts both the API server (`http://localhost:3001`) and the Vite dev server (`http://localhost:5173`) concurrently. Open the latter in your browser.

### Build for production

```bash
npm run build
```

### Run with Docker

The Docker image builds both the server and client, serves everything from a single container on port 3001, and watches a mounted save directory for new `.run` files.

**Build the image:**

```bash
docker build -t sts2-stats .
```

**Run the container:**

```bash
docker run -d \
  --name sts2-stats \
  -p 3001:3001 \
  -v sts2-data:/data \
  -v "/path/to/your/STS2/history:/saves:ro" \
  sts2-stats
```

Then open `http://localhost:3001` in your browser.

**Volume mounts:**

| Mount | Purpose |
|---|---|
| `/data` | SQLite database (`sts2.db`). Use a named volume so data persists across container restarts. |
| `/saves` | Your STS2 run history directory (read-only). The container watches this for new `.run` files. |

**Finding your history directory:**

| OS | Default path |
|---|---|
| macOS | `~/Library/Application Support/SlayTheSpire2/steam/<id>/profile1/saves/history` |
| Linux | `~/.local/share/SlayTheSpire2/steam/<id>/profile1/saves/history` |
| Windows | `%APPDATA%\SlayTheSpire2\steam\<id>\profile1\saves\history` |

**macOS example (auto-expanding the glob):**

```bash
HISTORY=$(ls -d "$HOME/Library/Application Support/SlayTheSpire2/steam/"*/profile1/saves/history 2>/dev/null | head -1)
docker run -d \
  --name sts2-stats \
  -p 3001:3001 \
  -v sts2-data:/data \
  -v "$HISTORY:/saves:ro" \
  sts2-stats
```

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `DB_PATH` | `/data/sts2.db` | Absolute path to the SQLite database file |
| `STS2_HISTORY_DIR` | `/saves` | Directory watched for `.run` files |
| `CLIENT_ORIGIN` | `*` | CORS `Access-Control-Allow-Origin` header value |

## Project structure

```
packages/
  server/         Hono API + SQLite ingestion
    src/
      db/         Schema, migrations, DB singleton
      ingestion/  .run file normalization, idempotent insert, chokidar watcher
      analytics/  Query modules: cards, relics, synergies, overview, hpgold, kills
      routes/     API route handlers
  client/         React SPA
    src/
      tabs/       One component per dashboard tab
      components/ Shared charts and UI primitives
      api/        Typed fetch wrappers
      hooks/      SSE → query invalidation
scripts/
  bootstrap.ts    One-time bulk importer
archived_python_impl/
  sts2_export.py  Original Python reference implementation
```

## macOS note

On macOS, the STS2 save path includes a wildcard Steam user ID. The watcher resolves it via glob automatically. If you see a permission error, grant **Full Disk Access** to Terminal in **System Settings → Privacy & Security → Full Disk Access**.

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | Total run count, last ingested timestamp |
| GET | `/api/events` | SSE stream of ingestion events |
| GET | `/api/runs` | Paginated run log |
| GET | `/api/overview` | Aggregate KPIs |
| GET | `/api/cards` | Card stats |
| GET | `/api/relics` | Relic stats |
| GET | `/api/synergies` | Card-pair synergy lift |
| GET | `/api/hp-gold` | HP/gold floor curves |
| GET | `/api/kills` | Enemy kill/death data |
