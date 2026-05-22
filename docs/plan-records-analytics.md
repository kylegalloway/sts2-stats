# Plan: Records, Fun Stats, Win Fingerprint, Enchantments & Run Metadata

Inspired by analytics gaps identified in the STS2_Tracker reference project.
Excludes multiplayer support.

---

## New Features

- **Run metadata**: persist `seed`, `game_mode`, `was_abandoned`, `build_id` from every `.run` file
- **Per-run aggregates**: deck size, cards upgraded/removed/transformed, campfire smiths/heals, total damage taken, elite count
- **Final deck storage**: `players[0].deck` with card IDs, upgrade levels, and enchantment IDs
- **Records & Streaks**: personal bests (fastest win, least damage, smallest deck, most elites, highest ascension) + current/longest win and loss streaks
- **Fun Stats**: career aggregates (total time played, total floors, total damage, gold hoarded at death, most common death floor, luckiest win, unluckiest loss)
- **Win Condition Fingerprint**: wins vs losses compared on avg deck size, upgrade rate, cards purged
- **Act Variant Win Rates**: per-individual-act win rate via SQLite `json_each` on existing `runs.acts`
- **Enchantment Analytics**: win rate per enchantment type using new `final_deck` table

---

## Schema — Migration 8

### New columns on `runs`

```sql
ALTER TABLE runs ADD COLUMN seed TEXT;
ALTER TABLE runs ADD COLUMN game_mode TEXT;
ALTER TABLE runs ADD COLUMN was_abandoned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN build_id TEXT;
ALTER TABLE runs ADD COLUMN deck_size INTEGER;
ALTER TABLE runs ADD COLUMN cards_upgraded INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN cards_removed_count INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN cards_transformed INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN campfire_smiths INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN campfire_heals INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN total_damage_taken INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN elite_count INTEGER DEFAULT 0;
```

### New table `final_deck`

```sql
CREATE TABLE final_deck (
  run_id        INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  card_id       TEXT NOT NULL,
  upgrade_level INTEGER NOT NULL DEFAULT 0,
  enchantment_id TEXT,
  PRIMARY KEY (run_id, position)
);
CREATE INDEX idx_final_deck_run_id ON final_deck(run_id);
CREATE INDEX idx_final_deck_enchantment ON final_deck(enchantment_id);
```

### Backfill

Walk `raw_json` for all existing runs (same pattern as migrations 3/4/6):
- Extract top-level `seed`, `game_mode`, `was_abandoned`, `build_id`
- Walk `map_point_history` to accumulate `cards_upgraded` (from `upgraded_cards` array),
  `cards_removed_count` (from `cards_removed` array), `cards_transformed`, `campfire_smiths`/`campfire_heals`
  (from `rest_site_choices`), `total_damage_taken` (sum of `damage_taken`), `elite_count`
  (count floors where `room_type == 'elite'`)
- Extract `players[0].deck` for `final_deck` rows and `deck_size`

All these fields are confirmed present in real run files.

---

## Files to Change

| File | Change |
|------|--------|
| `packages/server/src/db/schema.ts` | Add `final_deck` table DDL |
| `packages/server/src/db/migrations.ts` | Add migration 8 (ALTER columns + CREATE final_deck + backfill) |
| `packages/server/src/ingestion/normalize.ts` | Add new fields to `NormalizedRun` + extraction logic |
| `packages/server/src/ingestion/ingest.ts` | Store new columns + insert `final_deck` rows |
| `packages/server/src/analytics/records.ts` | **New**: personal bests, streaks, fun stats |
| `packages/server/src/analytics/overview.ts` | Add `getWinFingerprint()` + `getActVariants()` |
| `packages/server/src/analytics/cards.ts` | Add `getEnchantments()` |
| `packages/server/src/routes/records.ts` | **New**: `GET /` → `{ personal_bests, streaks, fun_stats }` |
| `packages/server/src/routes/overview.ts` | Add `GET /win-fingerprint` + `GET /act-variants` |
| `packages/server/src/routes/cards.ts` | Add `GET /enchantments` |
| `packages/server/src/index.ts` | Mount `app.route('/api/records', recordsRoutes)` |
| `packages/client/src/api/client.ts` | Add `getRecords`, `getWinFingerprint`, `getActVariants`, `getEnchantments` |
| `packages/client/src/tabs/Records.tsx` | **New tab**: personal bests, streaks, fun stats, win fingerprint |
| `packages/client/src/App.tsx` | Register "Records" tab |
| `packages/client/src/tabs/Overview.tsx` | Add act variants table |
| `packages/client/src/tabs/Cards.tsx` | Add enchantments table |

---

## Analytics Detail

### `analytics/records.ts` (new)

```typescript
getPersonalBests(db, character?) → {
  fastest_win: RunSummary | null,        // MIN(run_time) WHERE victory=1
  least_damage_win: RunSummary | null,   // MIN(total_damage_taken) WHERE victory=1
  smallest_deck_win: RunSummary | null,  // MIN(deck_size) WHERE victory=1
  most_elites_win: RunSummary | null,    // MAX(elite_count) WHERE victory=1
  highest_asc_win: RunSummary | null,    // MAX(ascension) WHERE victory=1
}
// RunSummary = { character, ascension, seed, run_time, floor_reached, deck_size,
//               total_damage_taken, elite_count }

getStreaks(db, character?) → {
  current_win_streak: number,
  current_loss_streak: number,
  longest_win_streak: number,
  longest_loss_streak: number,
}
// Computed in TS from: SELECT victory FROM runs [WHERE] ORDER BY timestamp, id

getFunStats(db, character?) → {
  total_runs: number,
  total_time_played_s: number,
  total_floors_climbed: number,
  total_damage_taken: number,
  total_gold_earned: number,            // SUM(final_gold)
  gold_hoarded_at_death: number,        // SUM(final_gold) WHERE victory=0
  most_common_death_floor: number | null,
  most_common_death_floor_count: number | null,
  luckiest_win: RunSummary | null,      // MAX(total_damage_taken) WHERE victory=1
  unluckiest_loss: RunSummary | null,   // MAX(floor_reached) WHERE victory=0
}
```

### `analytics/overview.ts` additions

```typescript
getWinFingerprint(db, character?) → {
  win_avg_deck_size: number,
  loss_avg_deck_size: number,
  win_avg_upgrade_rate: number,    // AVG(cards_upgraded * 1.0 / deck_size) WHERE victory=1
  loss_avg_upgrade_rate: number,
  win_avg_cards_purged: number,    // AVG(cards_removed_count) WHERE victory=1
  loss_avg_cards_purged: number,
}

getActVariants(db, character?) → { act_name: string, total: number, wins: number, win_rate: number }[]
// SQL: SELECT je.value, COUNT(*), SUM(r.victory) FROM runs r, json_each(r.acts) je GROUP BY je.value
```

### `analytics/cards.ts` addition

```typescript
getEnchantments(db, character?) → {
  enchantment_id: string,
  total_runs: number,    // distinct runs containing ≥1 of this enchantment
  wins: number,
  win_rate: number,
}[]
// SQL: JOIN final_deck → runs, WHERE enchantment_id IS NOT NULL, GROUP BY enchantment_id
```

---

## Client UI

### New "Records" tab (`tabs/Records.tsx`)

- **Character filter** at top (reuse `CharacterSelect`)
- **Personal Bests** — row of 5 `KpiCard`s: fastest win time, least damage win, smallest deck win,
  most elites win, highest ascension win — each with char + ascension + seed as subtitle
- **Streaks** — row of 4 `KpiCard`s: current win streak, longest win streak, current loss streak,
  longest loss streak
- **Fun Stats** — grid of `KpiCard`s: total time, total floors, total damage, gold earned,
  gold hoarded at death, most common death floor, luckiest win summary, unluckiest loss summary
- **Win Condition Fingerprint** — `SortableTable` with rows: Avg Deck Size, Avg Upgrade Rate,
  Avg Cards Purged; columns: Metric | Wins | Losses

### Overview tab additions

- "Act Variant Win Rates" table below existing "Act Routes" table

### Cards tab additions

- "Enchantments" table at the bottom (enchantment name | runs | wins | win%)

---

## Reuse

- `CharacterSelect`, `KpiCard`, `SortableTable` from `components/shared/`
- `formatName` from `utils/format.ts` for enchantment display names
- Migration backfill pattern from migrations 3, 4, 6
- `mCleanId` / `mFloorToAct` helpers already in `migrations.ts`

---

## Verification

```bash
npm run dev                          # migration 8 logs "applied version 8"
sqlite3 sts2.db "SELECT seed, game_mode, was_abandoned, deck_size FROM runs LIMIT 5"
sqlite3 sts2.db "SELECT COUNT(*) FROM final_deck"
# Browser: http://localhost:5173 → Records tab visible, all sections populated
npm test                             # no regressions
```
