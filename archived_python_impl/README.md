# Spire Codex — STS2 Analytics Dashboard

Parses your Slay the Spire 2 run history and generates a self-contained
HTML dashboard with charts, sortable tables, and analytics to help you
make better decisions in future runs.

---

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/getting-started/installation/) — install with:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

No other dependencies. The script uses only the standard library; `uv`
handles the Python version requirement automatically.

---

## Quick Start

```bash
uv run sts2_export.py
```

This auto-detects your run history, computes all analytics, and writes
`sts2_dashboard.html` to the current directory. Open it in any browser.

To refresh after more runs, just run the same command again.

---

## Step 1 — Verify your data (recommended first time)

```bash
uv run sts2_export.py --discover
```

Prints the raw key structure of your most recent `.run` file without
writing anything. Since STS2 is in early access, field names may change
between patches. If some columns show `—` in the dashboard, the
`--discover` output will tell you what the actual key names are — share
them and the script can be updated quickly.

---

## All Options

```
--discover        Print raw keys from a sample .run file, then exit
--path PATH       Manual path to your history folder
--output FILE     Output filename (default: sts2_dashboard.html)
--profile N       Profile slot to use: 1, 2, or 3 (default: 1)
```

---

## If auto-detection fails

The script tries several common paths. If yours isn't found:

1. In Finder, hold **Option** and click **Go → Library**
2. Navigate into **Application Support**
3. Look for a folder named `SlayTheSpire2` or similar
4. Drill down to `.../steam/YOUR_STEAM_ID/profile1/saves/history`
5. Pass that path manually:

```bash
uv run sts2_export.py --path "~/Library/Application Support/SlayTheSpire2/steam/123456789/profile1/saves/history"
```

---

## Dashboard Tabs

### Overview
High-level picture of your run history.
- **KPI cards** — total runs, win rate, avg score, avg floor reached,
  top character, and current win/loss streak
- **Win rate by character** — horizontal bar chart
- **Score over time** — scatter by run index, coloured green/red by result
- **Floor reached over time** — line chart with act progression visible
- **Recent runs** — sortable table of your last 20 runs

### Cards
Everything you need to decide whether to pick a card.

| Column | What it means |
|---|---|
| ELO | Head-to-head preference rating. When you're offered card A and card B and pick A, A's ELO goes up. Higher = you tend to prefer it when given the choice. |
| Pick Rate | How often you chose this card when it was offered |
| Win Rate | Win rate across all runs where you held this card |
| Quality Score | Pick Rate × Win Rate — rewards cards you pick often *and* win with |
| Seen | How many times it was offered (low = small sample, treat with caution) |
| HP Δ/3F | Average change in your HP over the 3 floors after picking this card. Positive = you tended to be healthier after picking it. |
| Shop WR | Win rate on runs where you bought this card at a shop |
| Act 1/2/3+ PR | Pick rate broken down by act — useful for cards that are strong early but dead weight late, or vice versa |

Click any column header to sort. Use the search box to filter by name.

### Relics
Same treatment as cards, minus ELO (relics aren't head-to-head choices).

| Column | What it means |
|---|---|
| Obtain Rate | % of runs where you had this relic |
| Win Rate | Win rate on runs where you held it |
| Quality Score | Obtain Rate × Win Rate |
| Avg Floor | Average floor at which you acquired it |
| Act 1/2/3+ | How many times you picked it up in each act |

### Synergies
Card + relic co-occurrence analysis. Answers: *"does having both X and Y
actually make me win more?"*

| Column | What it means |
|---|---|
| Co-occurs | Number of runs where you held both this card and relic |
| Win Rate | Win rate on those runs |
| Baseline WR | Your overall win rate for that character |
| Lift | Win Rate ÷ Baseline WR. 1.3x means you win 30% more often when holding this pair than average. |

Sorted by Lift descending. Requires at least 2 co-occurrences to appear —
high lift on a single occurrence is noise, not signal.

### HP & Gold
Per-character line charts of average HP% and gold at every floor,
averaged across all your runs. Useful for spotting:
- Which floors consistently drain you (combat spikes, boss fights)
- Whether you're entering acts with enough resources
- How your gold curves look relative to your performance

### Run Log
Full filterable run history. Filter by character, result, or free-text
search across all fields. Sortable by any column.

---

## Notes

- The script **never modifies your save files** — it only reads them.
- All data is embedded directly in the HTML — no server needed, no
  internet required after the initial Google Fonts request on first open.
- The more runs you have, the more meaningful the analytics become.
  ELO and synergy lift are especially noisy under ~20 runs.
- Corrupted or unparseable `.run` files are skipped with a warning, so
  partial saves won't break the whole export.
