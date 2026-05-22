# Plan: Codex Warmup on Startup + EntityTooltip on Charts

## Context

Two follow-on tasks from the codex-enriched card analytics work:

1. **Codex warmup**: The `spire_codex_cache` table starts empty and the new dimension analytics are useless until it's populated. Currently a manual "Seed Codex Data" button exists, but users shouldn't need to click it. The cache should warm automatically when the server starts, if it's sparse.

2. **Tooltips on chart bars**: `EntityTooltip` is already wired in all sortable tables, but the horizontal bar charts (relics, cards, enemies/bosses, etc.) show only a label string — hovering over them produces no codex popup. The tooltip component already works via `onMouseEnter/Leave/Move` on a wrapper `<span>`, so the fix is making chart labels hoverable with the same component.

---

## Part 1: Codex Cache Warmup on Server Start

### Approach

Extract the seed logic from `packages/server/src/routes/codex.ts` into a standalone async function, then call it from `packages/server/src/index.ts` after the DB is initialized.

**Extraction target** — `packages/server/src/routes/codex.ts` lines 21–45 (the `POST /seed-cards` handler). Extract into a new file:

**New file:** `packages/server/src/codex/warmup.ts`

```ts
export async function warmCodexCards(db: Database.Database): Promise<void> {
  // Check if already warm — if ≥ 500 cards cached, skip
  const count = (db.prepare(
    `SELECT COUNT(*) as n FROM spire_codex_cache WHERE entity_type = 'card'`
  ).get() as { n: number }).n;
  if (count >= 500) return;

  const res = await fetch('https://spire-codex.com/api/cards?limit=600', {
    headers: { Accept: 'application/json', 'User-Agent': 'sts2-stats/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.warn(`[codex] warmup failed: spire-codex returned ${res.status}`);
    return;
  }

  const cards = (await res.json()) as { id: string; [key: string]: unknown }[];
  const upsert = db.prepare(`
    INSERT INTO spire_codex_cache (entity_type, entity_id, data_json, fetched_at)
    VALUES ('card', ?, ?, datetime('now'))
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      data_json = excluded.data_json, fetched_at = excluded.fetched_at
  `);
  db.transaction(() => {
    for (const card of cards) {
      upsert.run(card.id.toLowerCase(), JSON.stringify(card));
    }
  })();
  console.log(`[codex] warmed ${cards.length} cards`);
}
```

**Update `packages/server/src/routes/codex.ts`** — the `POST /seed-cards` handler becomes a thin wrapper that calls `warmCodexCards(db)` with `force: true` (skipping the count check) and returns the inserted count.

**Update `packages/server/src/index.ts`** — fire warmup after startup, non-blocking:

```ts
import { warmCodexCards } from './codex/warmup.js';

// After serve() call:
warmCodexCards(db).catch((e) => console.warn('[codex] warmup error:', e));
```

Calling it after `serve()` means the server is already accepting requests while the fetch happens in the background — no startup delay. The E2E env (`process.env.E2E === '1'`) should skip warmup to avoid flaky network calls in tests.

**Also update the `POST /seed-cards` route** to reuse `warmCodexCards` with a force flag (bypass the ≥500 check) and return `{ inserted: cards.length }` as before.

---

## Part 2: EntityTooltip on Chart Bar Labels

### Approach

HBarChart renders bar labels via Recharts' `<YAxis>` tick. Recharts renders these as SVG `<text>` nodes — we can't wrap them with a React component directly.

**Recommended approach: Custom YAxis tick with `foreignObject`**

Recharts supports a `tick` prop as a React component on `<YAxis>`. We render an SVG `<foreignObject>` containing a regular HTML `<span>` wrapped in `EntityTooltip`.

Add optional props to `HBarChart`:

```ts
interface HBarChartProps {
  // existing props...
  entityType?: 'card' | 'relic' | 'monster' | 'event';  // if set, wrap labels with EntityTooltip
}
```

Add a `CustomTick` component inside the file:

```tsx
function CustomTick({ x, y, payload, entityType, width }: {
  x: number; y: number;
  payload: { value: string };
  entityType: 'card' | 'relic' | 'monster' | 'event';
  width: number;
}) {
  return (
    <foreignObject x={x - width} y={y - 10} width={width} height={20}>
      <EntityTooltip name={payload.value} entityType={entityType}>
        <span style={{ fontSize: 11, color: '#ccc8c0', whiteSpace: 'nowrap', cursor: 'default' }}>
          {payload.value}
        </span>
      </EntityTooltip>
    </foreignObject>
  );
}
```

Then in HBarChart:

```tsx
<YAxis
  type="category"
  dataKey="label"
  tick={entityType
    ? (props) => <CustomTick {...props} entityType={entityType} width={110} />
    : { fill: '#ccc8c0', fontSize: 11 }
  }
  axisLine={false}
  tickLine={false}
  width={110}
/>
```

**Call sites to update** — add `entityType` prop wherever the label is a card/relic/enemy name:

| File | Chart | entityType |
|------|-------|------------|
| `packages/client/src/tabs/Cards.tsx` | Top 20 by ELO, Top 20 by Quality Score, Taking Too Often, Worth Picking More | `"card"` |
| `packages/client/src/tabs/Relics.tsx` | Top 20 by Quality, Top 20 by Win Rate | `"relic"` |
| `packages/client/src/tabs/Deaths.tsx` | Kill counts / boss stats charts (if any use HBarChart) | `"monster"` |

**Note on dimension breakdown charts**: those use inline `<table>` rows, not HBarChart — add `EntityTooltip` wrappers directly to the `td` cells in that same pass.

---

## Critical Files

| File | Change |
|------|--------|
| `packages/server/src/codex/warmup.ts` | New — extracted + extended warmup logic |
| `packages/server/src/routes/codex.ts` | `POST /seed-cards` delegates to `warmCodexCards` |
| `packages/server/src/index.ts` | Fire `warmCodexCards(db)` after `serve()`, non-blocking |
| `packages/client/src/components/charts/HBarChart.tsx` | Add `entityType?` prop + `CustomTick` using `foreignObject` + `EntityTooltip` |
| `packages/client/src/tabs/Cards.tsx` | Add `entityType="card"` to relevant HBarCharts + EntityTooltip in dimension tables |
| `packages/client/src/tabs/Relics.tsx` | Add `entityType="relic"` to HBarCharts |
| `packages/client/src/tabs/Deaths.tsx` | Add `entityType="monster"` to any HBarCharts with enemy labels |

---

## Verification

1. Start server with `npm run dev` — check logs for `[codex] warmed 576 cards` within ~2s of startup
2. Restart server — log should say nothing (cache already warm, ≥500 cards present)
3. Navigate to Cards tab → hover a bar label on the ELO/Quality charts → EntityTooltip popup appears
4. Navigate to Relics tab → hover a bar label → relic tooltip appears
5. Run `npm test` — existing tests still pass (warmup uses same upsert logic as before)
6. Run `npm run lint` — no errors
