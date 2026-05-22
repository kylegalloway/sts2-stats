#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
sts2_export.py  —  Slay the Spire 2 run history dashboard generator

Usage:
    uv run sts2_export.py                   # auto-detect history, write sts2_dashboard.html
    uv run sts2_export.py --discover        # print raw keys of one .run file, then exit
    uv run sts2_export.py --path ~/path/to/history
    uv run sts2_export.py --output run.html
    uv run sts2_export.py --profile 2       # use profile2 instead of profile1
"""

import argparse, glob, json, os, sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Act floor boundaries — tweak if STS2 layout differs
ACT_BOUNDS = [("Act 1", 1, 16), ("Act 2", 17, 33), ("Act 3+", 34, 999)]

def floor_to_act(floor):
    if floor is None: return "Unknown"
    try: floor = int(floor)
    except: return "Unknown"
    for name, lo, hi in ACT_BOUNDS:
        if lo <= floor <= hi: return name
    return "Act 3+"

def _clean_id(raw, prefix=""):
    """Strip a known prefix and title-case the remainder, replacing _ with space."""
    if not raw: return raw
    s = raw
    if prefix and s.startswith(prefix):
        s = s[len(prefix):]
    return s.replace("_", " ").title()

# ── Path detection ─────────────────────────────────────────────────────────────

CANDIDATE_PATTERNS = [
    "~/Library/Application Support/SlayTheSpire2/steam/*/profile{p}/saves/history",
    "~/Library/Application Support/com.megacrit.SlayTheSpire2/steam/*/profile{p}/saves/history",
    "~/Library/Application Support/Slay the Spire 2/steam/*/profile{p}/saves/history",
    "~/.local/share/SlayTheSpire2/steam/*/profile{p}/saves/history",
    "~/AppData/Roaming/SlayTheSpire2/steam/*/profile{p}/saves/history",
]

def find_history_dir(profile=1):
    for pat in CANDIDATE_PATTERNS:
        matches = glob.glob(os.path.expanduser(pat.format(p=profile)))
        if matches:
            return Path(matches[0])
    return None

# ── File loading ───────────────────────────────────────────────────────────────

def _g(d, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and k in d: return d[k]
    return default

def load_runs(history_dir):
    runs = []
    for p in sorted(history_dir.glob("*.run")):
        try:
            data = json.loads(p.read_text())
            data["_file"] = p.name
            runs.append(_normalize_run(data))
        except Exception as e:
            print(f"  Warning: skipping {p.name}: {e}", file=sys.stderr)
    return runs

def _normalize_run(r):
    """
    Flatten STS2's nested map_point_history format into the flat fields
    the analytics functions expect.
    """
    player = (r.get("players") or [{}])[0]
    char_raw = player.get("character", "Unknown")
    # Strip "CHARACTER." prefix, e.g. "CHARACTER.DEFECT" → "DEFECT"
    char = char_raw.replace("CHARACTER.", "") if char_raw else "Unknown"

    # map_point_history is [[point, point, ...]] — one list per act, we flatten all acts
    mph = r.get("map_point_history") or []
    points = [pt for act_pts in mph for pt in act_pts]

    floor_reached = len(points)

    hp_per_floor = []
    max_hp_per_floor = []
    gold_per_floor = []
    card_choices = []
    items_purchased = []

    for idx, pt in enumerate(points):
        ps_list = pt.get("player_stats") or []
        ps = ps_list[0] if ps_list else {}

        hp_per_floor.append(ps.get("current_hp"))
        max_hp_per_floor.append(ps.get("max_hp"))
        gold_per_floor.append(ps.get("current_gold"))

        floor_num = idx + 1  # 1-indexed

        # Card choices: [{"card": {"id": "CARD.X"}, "was_picked": bool}, ...]
        for cc in (ps.get("card_choices") or []):
            card_obj = cc.get("card") or {}
            card_id = card_obj.get("id", "")
            if not card_id:
                continue
            was_picked = cc.get("was_picked", False)
            # Accumulate into a single choice group per floor event
            # Find existing group for this floor or create a new one
            existing = next((c for c in card_choices if c.get("_floor") == floor_num), None)
            if existing is None:
                existing = {"_floor": floor_num, "floor": floor_num, "picked": None, "not_picked": []}
                card_choices.append(existing)
            if was_picked:
                existing["picked"] = card_id
            else:
                existing["not_picked"].append(card_id)

        # Shop purchases: cards_gained at a "shop" map point
        if pt.get("map_point_type") == "shop":
            for cg in (ps.get("cards_gained") or []):
                cid = cg.get("id")
                if cid:
                    items_purchased.append(cid)

    # Relics: players[0].relics = [{"id": "RELIC.X", "floor_added_to_deck": N}, ...]
    relics_raw = player.get("relics") or []
    relics_obtained = []
    for rr in relics_raw:
        rid = rr.get("id", "")
        if rid:
            key = rid.replace("RELIC.", "")
            floor = rr.get("floor_added_to_deck")
            relics_obtained.append({"key": key, "floor": floor})

    # Act route: ["ACT.UNDERDOCKS", "ACT.HIVE", ...] → ["Underdocks", "Hive", ...]
    acts_raw = r.get("acts") or []
    acts_clean = [_clean_id(a, "ACT.") for a in acts_raw]

    # Kill source
    ke = r.get("killed_by_encounter", "")
    kev = r.get("killed_by_event", "")
    if r.get("win"):
        killed_by = None
    elif ke and ke not in ("NONE", "NONE.NONE"):
        killed_by = _clean_id(ke, "ENCOUNTER.")
    elif kev and kev not in ("NONE", "NONE.NONE"):
        killed_by = _clean_id(kev, "EVENT.")
    else:
        killed_by = None

    r["character_chosen"] = char
    r["victory"] = bool(r.get("win", False))
    r["timestamp"] = r.get("start_time")
    r["floor_reached"] = floor_reached
    r["ascension_level"] = r.get("ascension", 0)
    r["gold"] = gold_per_floor[-1] if gold_per_floor else None
    r["score"] = None
    r["run_time"] = r.get("run_time")
    r["acts"] = acts_clean
    r["killed_by"] = killed_by
    r["current_hp_per_floor"] = hp_per_floor
    r["max_hp_per_floor"] = max_hp_per_floor
    r["gold_per_floor"] = gold_per_floor
    r["card_choices"] = card_choices
    r["relics_obtained"] = relics_obtained
    r["items_purchased"] = items_purchased
    return r

def discover(history_dir):
    files = list(history_dir.glob("*.run"))
    if not files:
        print(f"No .run files in: {history_dir}"); return
    with open(files[-1]) as f:
        data = json.load(f)
    print(f"\n=== Sample: {files[-1].name} ({len(files)} total) ===\n")
    for k, v in data.items():
        if isinstance(v, list):
            t = f"[list x {len(v)}]"
            if v and isinstance(v[0], dict): t += f"  keys: {list(v[0].keys())}"
            elif v: t += f"  e.g. {v[0]!r}"
        else: t = repr(v)[:80]
        print(f"  {k:<35} {t}")

# ── Analytics ──────────────────────────────────────────────────────────────────

def compute_summaries(runs):
    out = []
    for r in runs:
        v = _g(r, "victory", "won")
        out.append({
            "file":      r["_file"],
            "character": _g(r, "character_chosen", "character", "char", default="Unknown"),
            "victory":   bool(v) if v is not None else None,
            "ascension": _g(r, "ascension_level", "ascension") or 0,
            "floor":     _g(r, "floor_reached", "floors_reached"),
            "gold":      _g(r, "gold", "final_gold"),
            "run_time":  r.get("run_time"),
            "acts":      r.get("acts") or [],
            "killed_by": r.get("killed_by"),
            "timestamp": _g(r, "timestamp"),
        })
    return sorted(out, key=lambda x: x.get("timestamp") or 0)

def compute_overview(summaries):
    by_char = defaultdict(lambda: {"wins": 0, "total": 0})
    for s in summaries:
        c = s["character"]
        by_char[c]["total"] += 1
        if s.get("victory"): by_char[c]["wins"] += 1
    chars = sorted(by_char.keys())
    return {
        "win_by_char": {
            "labels":    chars,
            "wins":      [by_char[c]["wins"] for c in chars],
            "losses":    [by_char[c]["total"] - by_char[c]["wins"] for c in chars],
            "rates":     [round(by_char[c]["wins"]/by_char[c]["total"]*100, 1) if by_char[c]["total"] else 0 for c in chars],
        },
        "timeline": {
            "x":        list(range(1, len(summaries)+1)),
            "floor":    [s.get("floor") for s in summaries],
            "won":      [s.get("victory") for s in summaries],
            "chars":    [s.get("character") for s in summaries],
            "run_time": [s.get("run_time") for s in summaries],
        },
    }

def compute_card_stats(runs):
    S = defaultdict(lambda: defaultdict(lambda: {
        "offered": 0, "picked": 0, "wins": 0, "losses": 0,
        "act": defaultdict(lambda: {"o": 0, "p": 0}),
        "shop_wins": 0, "shop_count": 0, "hp_deltas": [], "run_floors": [],
    }))
    for r in runs:
        char  = _g(r, "character_chosen", "character", "char", default="Unknown")
        won   = bool(_g(r, "victory", "won", default=False))
        hp_c  = _g(r, "current_hp_per_floor", default=[]) or []
        shop_i = _g(r, "items_purchased", default=[]) or []
        floor_reached = _g(r, "floor_reached", "floor") or 0
        picked_set = set()

        for c in (_g(r, "card_choices", "cardChoices", default=[]) or []):
            if not isinstance(c, dict): continue
            floor = _g(c, "floor"); act = floor_to_act(floor)
            picked = _g(c, "picked", "chosen", "card_picked")
            skip   = _g(c, "not_picked", "skipped", "cards_not_picked", default=[])
            if isinstance(skip, str): skip = [skip] if skip else []
            all_c = ([picked] if picked and isinstance(picked, str) else []) + \
                    [x for x in (skip or []) if isinstance(x, str)]
            for card in all_c:
                S[char][card]["offered"] += 1
                S[char][card]["act"][act]["o"] += 1
            if picked and isinstance(picked, str):
                S[char][picked]["picked"] += 1
                S[char][picked]["act"][act]["p"] += 1
                picked_set.add(picked)
                if floor:
                    fi = int(floor) - 1
                    if 0 <= fi and fi + 3 < len(hp_c):
                        S[char][picked]["hp_deltas"].append(hp_c[fi+3] - hp_c[fi])

        for card in picked_set:
            if won: S[char][card]["wins"] += 1
            else:   S[char][card]["losses"] += 1
            if floor_reached: S[char][card]["run_floors"].append(floor_reached)
        for item in shop_i:
            if isinstance(item, str):
                S[char][item]["shop_count"] += 1
                if won: S[char][item]["shop_wins"] += 1

    result = {}
    for char, cards in S.items():
        result[char] = []
        for card, s in cards.items():
            off = s["offered"]; pk = s["picked"]
            rw  = s["wins"] + s["losses"]
            pr  = pk / off if off else 0
            wr  = s["wins"] / rw if rw else None
            qs  = pr * wr if wr is not None else None
            hd  = s["hp_deltas"]; sc = s["shop_count"]
            rf  = s["run_floors"]
            acts = {act: {"offered": av["o"], "picked": av["p"],
                          "pick_rate": round(av["p"]/av["o"],3) if av["o"] else 0}
                    for act, av in s["act"].items()}
            result[char].append({
                "card":          _clean_id(card, "CARD."),
                "offered":       off,
                "picked":        pk,
                "pick_rate":     round(pr, 3),
                "runs_with":     rw,
                "win_rate":      round(wr, 3) if wr is not None else None,
                "quality_score": round(qs, 4) if qs is not None else None,
                "avg_hp_delta":  round(sum(hd)/len(hd), 1) if hd else None,
                "avg_floor_with": round(sum(rf)/len(rf), 1) if rf else None,
                "shop_count":    sc,
                "shop_win_rate": round(s["shop_wins"]/sc, 3) if sc else None,
                "acts":          acts,
            })
        result[char].sort(key=lambda x: x["quality_score"] or 0, reverse=True)
    return result

def compute_relic_stats(runs):
    S = defaultdict(lambda: defaultdict(lambda: {
        "count": 0, "wins": 0, "losses": 0, "floors": [], "acts": defaultdict(int)
    }))
    totals = defaultdict(int)
    for r in runs:
        char  = _g(r, "character_chosen", "character", "char", default="Unknown")
        won   = bool(_g(r, "victory", "won", default=False))
        totals[char] += 1
        for rr in (_g(r, "relics_obtained", "relics", default=[]) or []):
            if isinstance(rr, dict):
                key = _g(rr, "key", "relic", "id", "name"); floor = _g(rr, "floor")
            elif isinstance(rr, str): key = rr; floor = None
            else: continue
            if not key: continue
            display_key = _clean_id(key)
            S[char][display_key]["count"] += 1
            S[char][display_key]["acts"][floor_to_act(floor)] += 1
            if floor is not None: S[char][display_key]["floors"].append(floor)
            if won: S[char][display_key]["wins"] += 1
            else:   S[char][display_key]["losses"] += 1

    result = {}
    for char, relics in S.items():
        result[char] = []
        total = totals[char]
        for relic, s in relics.items():
            rw  = s["wins"] + s["losses"]
            wr  = s["wins"] / rw if rw else None
            obr = s["count"] / total if total else 0
            fls = s["floors"]
            result[char].append({
                "relic":         relic,
                "count":         s["count"],
                "obtain_rate":   round(obr, 3),
                "runs_with":     rw,
                "win_rate":      round(wr, 3) if wr is not None else None,
                "quality_score": round(obr * wr, 4) if wr is not None else None,
                "avg_floor":     round(sum(fls)/len(fls), 1) if fls else None,
                "acts":          {k: v for k, v in s["acts"].items()},
            })
        result[char].sort(key=lambda x: x["quality_score"] or 0, reverse=True)
    return result

def compute_elo(runs, K=32, init=1000):
    ratings = defaultdict(lambda: defaultdict(lambda: init))
    for r in runs:
        char = _g(r, "character_chosen", "character", "char", default="Unknown")
        for c in (_g(r, "card_choices", "cardChoices", default=[]) or []):
            if not isinstance(c, dict): continue
            picked = _g(c, "picked", "chosen", "card_picked")
            skip   = _g(c, "not_picked", "skipped", "cards_not_picked", default=[])
            if isinstance(skip, str): skip = [skip] if skip else []
            if not picked or not isinstance(picked, str): continue
            for opp in (skip or []):
                if not isinstance(opp, str): continue
                ra = ratings[char][picked]; rb = ratings[char][opp]
                ea = 1 / (1 + 10**((rb - ra)/400))
                ratings[char][picked] += K * (1 - ea)
                ratings[char][opp]    += K * (0 - (1 - ea))
    return {char: sorted([{"card": _clean_id(c, "CARD."), "elo": round(r)} for c, r in cards.items()],
                         key=lambda x: x["elo"], reverse=True)
            for char, cards in ratings.items()}

def compute_synergies(runs, min_occ=2):
    pairs   = defaultdict(lambda: {"wins": 0, "total": 0})
    basewrs = defaultdict(lambda: {"wins": 0, "total": 0})
    for r in runs:
        char = _g(r, "character_chosen", "character", "char", default="Unknown")
        won  = bool(_g(r, "victory", "won", default=False))
        basewrs[char]["total"] += 1
        if won: basewrs[char]["wins"] += 1
        picked = {_g(c, "picked", "chosen", "card_picked")
                  for c in (_g(r, "card_choices", "cardChoices", default=[]) or [])
                  if isinstance(c, dict) and _g(c, "picked", "chosen", "card_picked")}
        rkeys = set()
        for rr in (_g(r, "relics_obtained", "relics", default=[]) or []):
            k = (_g(rr, "key", "relic", "id", "name") if isinstance(rr, dict)
                 else rr if isinstance(rr, str) else None)
            if k: rkeys.add(k)
        for card in picked:
            for relic in rkeys:
                pairs[(char, card, relic)]["total"] += 1
                if won: pairs[(char, card, relic)]["wins"] += 1

    out = []
    for (char, card, relic), s in pairs.items():
        if s["total"] < min_occ: continue
        wr  = s["wins"] / s["total"]
        bwr = basewrs[char]["wins"] / basewrs[char]["total"] if basewrs[char]["total"] else 0
        out.append({"character": char, "card": _clean_id(card, "CARD."), "relic": _clean_id(relic),
                    "occurrences": s["total"], "wins": s["wins"],
                    "win_rate": round(wr, 3), "baseline_wr": round(bwr, 3),
                    "lift": round(wr/bwr, 3) if bwr else None})
    return sorted(out, key=lambda x: x.get("lift") or 0, reverse=True)

def compute_kills(runs):
    """Tally what killed the player, broken down by character."""
    by_char  = defaultdict(lambda: defaultdict(int))
    overall  = defaultdict(int)
    total_deaths = defaultdict(int)
    total_overall = 0
    for r in runs:
        char = _g(r, "character_chosen", default="Unknown")
        won  = bool(_g(r, "victory", default=False))
        if won:
            continue
        kb = r.get("killed_by")
        if not kb:
            continue
        by_char[char][kb] += 1
        overall[kb] += 1
        total_deaths[char] += 1
        total_overall += 1
    out = []
    for killer, count in sorted(overall.items(), key=lambda x: -x[1]):
        by_c = {c: by_char[c].get(killer, 0) for c in by_char}
        out.append({
            "killer":  killer,
            "total":   count,
            "rate":    round(count / total_overall, 3) if total_overall else 0,
            "by_char": by_c,
        })
    return out

def compute_act_routes(runs):
    """Win rate and floor reached broken down by Act 1 choice."""
    routes = defaultdict(lambda: {"wins": 0, "total": 0, "floors": []})
    for r in runs:
        acts = r.get("acts") or []
        act1 = acts[0] if acts else "Unknown"
        won  = bool(_g(r, "victory", default=False))
        floor = _g(r, "floor_reached", "floor")
        routes[act1]["total"] += 1
        if won: routes[act1]["wins"] += 1
        if floor: routes[act1]["floors"].append(floor)
    out = []
    for route, s in sorted(routes.items()):
        floors = s["floors"]
        wr = s["wins"] / s["total"] if s["total"] else None
        out.append({
            "act1":      route,
            "total":     s["total"],
            "wins":      s["wins"],
            "win_rate":  round(wr, 3) if wr is not None else None,
            "avg_floor": round(sum(floors)/len(floors), 1) if floors else None,
        })
    return out

def compute_hp_gold(runs):
    by_char = defaultdict(lambda: defaultdict(lambda: {"hp": [], "max_hp": [], "gold": []}))
    for r in runs:
        char = _g(r, "character_chosen", "character", "char", default="Unknown")
        hp_c = _g(r, "current_hp_per_floor", default=[]) or []
        hp_m = _g(r, "max_hp_per_floor",     default=[]) or []
        gold = _g(r, "gold_per_floor",        default=[]) or []
        for i in range(max(len(hp_c), len(hp_m), len(gold))):
            f = i + 1
            if i < len(hp_c) and hp_c[i] is not None: by_char[char][f]["hp"].append(hp_c[i])
            if i < len(hp_m) and hp_m[i] is not None: by_char[char][f]["max_hp"].append(hp_m[i])
            if i < len(gold) and gold[i] is not None:  by_char[char][f]["gold"].append(gold[i])
    result = {}
    for char, floors in by_char.items():
        flist = sorted(floors.keys())
        hp_pct = []; avg_gold = []
        for f in flist:
            d = floors[f]
            ah = sum(d["hp"])/len(d["hp"]) if d["hp"] else None
            am = sum(d["max_hp"])/len(d["max_hp"]) if d["max_hp"] else None
            ag = sum(d["gold"])/len(d["gold"]) if d["gold"] else None
            hp_pct.append(round(ah/am*100, 1) if (ah and am and am > 0) else None)
            avg_gold.append(round(ag, 1) if ag else None)
        result[char] = {"floors": flist, "hp_pct": hp_pct, "avg_gold": avg_gold}
    return result

# ── HTML Template ──────────────────────────────────────────────────────────────

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spire Codex — STS2 Analytics</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Barlow:ital,wght@0,300;0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#080a12;--s1:#0e1120;--s2:#141729;--s3:#1b1f35;
  --border:#252840;--border2:#2e3350;
  --gold:#c9903c;--gold2:#e8b86d;--gold3:#f5d28a;
  --text:#ccc8c0;--muted:#6a6880;--dim:#4a4860;
  --win:#52b875;--loss:#e05c5c;--neutral:#5b8dd9;
  --r:8px
}
html{font-size:14px}
body{font-family:'Barlow',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5}
a{color:var(--gold);text-decoration:none}

/* ── Layout ── */
.app{display:flex;flex-direction:column;min-height:100vh}
.header{
  display:flex;align-items:center;justify-content:space-between;
  padding:1rem 2rem;background:var(--s1);
  border-bottom:1px solid var(--border);
  background-image:linear-gradient(to right,var(--s1),#0d1024)
}
.header-brand{display:flex;align-items:center;gap:.75rem}
.header-skull{font-size:1.5rem;filter:sepia(1) saturate(2) hue-rotate(5deg)}
.header-title{font-family:'Cinzel',serif;font-size:1.25rem;font-weight:700;
  background:linear-gradient(135deg,var(--gold3),var(--gold));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:.05em}
.header-sub{font-size:.75rem;color:var(--muted);margin-top:.15rem}
.header-meta{font-size:.75rem;color:var(--dim);font-family:'JetBrains Mono',monospace}

/* ── Tabs ── */
.tabs{display:flex;background:var(--s1);border-bottom:1px solid var(--border);padding:0 1.5rem;gap:.25rem;overflow-x:auto}
.tab{
  padding:.75rem 1.25rem;border:none;background:none;color:var(--muted);
  cursor:pointer;font-family:'Barlow',sans-serif;font-size:.875rem;font-weight:500;
  border-bottom:2px solid transparent;white-space:nowrap;transition:color .2s,border-color .2s
}
.tab:hover{color:var(--text)}
.tab.active{color:var(--gold2);border-bottom-color:var(--gold)}

/* ── Content ── */
.content{flex:1;padding:1.5rem 2rem;max-width:1600px;width:100%;margin:0 auto}
.panel{display:none}.panel.active{display:block}

/* ── KPI row ── */
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-bottom:1.5rem}
.kpi{
  background:var(--s1);border:1px solid var(--border);border-radius:var(--r);
  padding:1.25rem 1rem;text-align:center;position:relative;overflow:hidden;
  transition:border-color .2s
}
.kpi::before{
  content:'';position:absolute;inset:0;
  background:linear-gradient(135deg,rgba(201,144,60,.04),transparent);pointer-events:none
}
.kpi:hover{border-color:var(--border2)}
.kpi-val{font-family:'JetBrains Mono',monospace;font-size:2rem;font-weight:500;
  color:var(--gold2);line-height:1}
.kpi-label{font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-top:.5rem}

/* ── Chart cards ── */
.charts-row{display:grid;gap:1.25rem;margin-bottom:1.5rem}
.charts-row.col2{grid-template-columns:1fr 2fr}
.charts-row.col1{grid-template-columns:1fr}
.chart-card{background:var(--s1);border:1px solid var(--border);border-radius:var(--r);padding:1.25rem}
.chart-card h3{
  font-family:'Cinzel',serif;font-size:.7rem;letter-spacing:.12em;
  color:var(--muted);text-transform:uppercase;margin-bottom:1rem;
  display:flex;align-items:center;gap:.5rem
}
.chart-card h3 .badge{
  background:var(--s3);border:1px solid var(--border2);
  border-radius:4px;padding:.1rem .4rem;font-family:'JetBrains Mono';font-size:.65rem;color:var(--dim)
}
.chart-wrap{position:relative;width:100%}
.chart-wrap canvas{max-height:260px}
.chart-wrap.tall canvas{max-height:320px}

/* ── Table card ── */
.tcard{background:var(--s1);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:1.5rem}
.tcard-head{
  display:flex;align-items:center;gap:1rem;padding:.875rem 1.25rem;
  border-bottom:1px solid var(--border);flex-wrap:wrap
}
.tcard-title{font-family:'Cinzel',serif;font-size:.7rem;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;flex:1}
.tcard-wrap{overflow-x:auto;max-height:520px;overflow-y:auto}
table{width:100%;border-collapse:collapse}
th{
  position:sticky;top:0;z-index:1;background:var(--s2);
  padding:.6rem 1rem;text-align:left;font-size:.72rem;font-weight:600;
  text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
  cursor:pointer;user-select:none;white-space:nowrap;
  border-bottom:1px solid var(--border2);transition:color .15s
}
th:hover{color:var(--gold2)}
th.asc::after{content:' ▲';color:var(--gold)}
th.desc::after{content:' ▼';color:var(--gold)}
td{padding:.55rem 1rem;font-size:.825rem;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(201,144,60,.04)}
.num{font-family:'JetBrains Mono',monospace;font-size:.8rem}
.pct{font-family:'JetBrains Mono',monospace;font-size:.8rem}
.w{color:var(--win)}.l{color:var(--loss)}.n{color:var(--neutral)}
.badge-win{background:rgba(82,184,117,.15);color:var(--win);border-radius:4px;padding:.1rem .5rem;font-size:.72rem;font-weight:600}
.badge-loss{background:rgba(224,92,92,.15);color:var(--loss);border-radius:4px;padding:.1rem .5rem;font-size:.72rem;font-weight:600}
.spark{display:inline-block;height:4px;border-radius:2px;background:var(--gold);vertical-align:middle;margin-left:4px;opacity:.7}

/* ── Controls ── */
.controls{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
.ctrl-label{font-size:.75rem;color:var(--muted);white-space:nowrap}
select,.search-input{
  background:var(--s3);border:1px solid var(--border2);color:var(--text);
  padding:.35rem .75rem;border-radius:5px;font-family:'Barlow',sans-serif;font-size:.825rem;
  outline:none;transition:border-color .2s
}
select:focus,.search-input:focus{border-color:var(--gold)}
select option{background:var(--s3)}
.search-input{width:200px}
.empty{text-align:center;padding:3rem;color:var(--dim);font-style:italic}

/* ── Lift indicator ── */
.lift-high{color:var(--win);font-weight:600}
.lift-med{color:var(--gold2)}
.lift-low{color:var(--muted)}
.lift-neg{color:var(--loss)}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--s1)}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--dim)}

/* ── Section label ── */
.section-label{
  font-family:'Cinzel',serif;font-size:.65rem;letter-spacing:.18em;
  color:var(--dim);text-transform:uppercase;margin-bottom:.75rem;margin-top:1.5rem;
  display:flex;align-items:center;gap:.5rem
}
.section-label::before,.section-label::after{content:'';flex:1;height:1px;background:var(--border)}

/* ── Act dots ── */
.act1{color:#e8a23a}.act2{color:#5b8dd9}.act3{color:#9c6fcc}
</style>
</head>
<body>
<div class="app">
  <header class="header">
    <div class="header-brand">
      <span class="header-skull">☠</span>
      <div>
        <div class="header-title">Spire Codex</div>
        <div class="header-sub">Slay the Spire 2 — Run Analytics</div>
      </div>
    </div>
    <div class="header-meta" id="header-meta">Loading...</div>
  </header>

  <nav class="tabs">
    <button class="tab active" data-tab="overview">Overview</button>
    <button class="tab" data-tab="cards">Cards</button>
    <button class="tab" data-tab="relics">Relics</button>
    <button class="tab" data-tab="synergies">Synergies</button>
    <button class="tab" data-tab="kills">Deaths</button>
    <button class="tab" data-tab="hpgold">HP &amp; Gold</button>
    <button class="tab" data-tab="runs">Run Log</button>
  </nav>

  <main class="content">
    <div class="panel active" id="panel-overview"></div>
    <div class="panel" id="panel-cards"></div>
    <div class="panel" id="panel-relics"></div>
    <div class="panel" id="panel-synergies"></div>
    <div class="panel" id="panel-kills"></div>
    <div class="panel" id="panel-hpgold"></div>
    <div class="panel" id="panel-runs"></div>
  </main>
</div>

<script>
const DATA = __DATA__;

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt  = (v, d=1) => v == null ? '—' : (typeof v==='number' ? v.toFixed(d) : v);
const pct  = v => v == null ? '—' : (v*100).toFixed(1)+'%';
const num  = v => v == null ? '—' : v.toLocaleString();
const elo  = v => v == null ? '—' : Math.round(v).toString();
const delta = v => v == null ? '—' : (v >= 0 ? '<span class="w">+'+v.toFixed(1)+'</span>' : '<span class="l">'+v.toFixed(1)+'</span>');
const liftFmt = v => {
  if (v == null) return '<span class="lift-low">—</span>';
  const c = v >= 1.3 ? 'lift-high' : v >= 1.1 ? 'lift-med' : v >= 0.9 ? 'lift-low' : 'lift-neg';
  return '<span class="' + c + '">' + v.toFixed(2) + 'x</span>';
};
const spark = (v, max=1) => {
  if (v == null) return '';
  const w = Math.round(Math.min(v/max, 1)*48);
  return '<span class="spark" style="width:' + w + 'px"></span>';
};
const chars = () => [...new Set(DATA.summaries.map(s=>s.character))].sort();
const charColor = c => ({
  IRONCLAD:'#c05c5c', THE_SILENT:'#52b875', DEFECT:'#5b8dd9',
  WATCHER:'#c9903c', NECROBINDER:'#9c6fcc', REGENT:'#e8b86d',
})[c] || '#7a7890';

// ── Chart defaults ─────────────────────────────────────────────────────────────

Chart.defaults.color = '#6a6880';
Chart.defaults.borderColor = '#252840';
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.font.size = 11;

const chartDefaults = {
  responsive: true, maintainAspectRatio: true,
  plugins: {legend:{display:false}, tooltip:{
    backgroundColor:'#1b1f35', borderColor:'#2e3350', borderWidth:1,
    titleColor:'#e8b86d', bodyColor:'#ccc8c0', padding:10, cornerRadius:6
  }}
};

function hbarChart(id, labels, values, color='#c9903c', opts={}) {
  const existing = Chart.getChart(id);
  if (existing) existing.destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{data: values, backgroundColor: color + 'bb', borderColor: color,
                  borderWidth:1, borderRadius:3}]
    },
    options: {
      ...chartDefaults,
      indexAxis: 'y',
      plugins: {...chartDefaults.plugins, ...opts.plugins},
      scales: {
        x: {grid:{color:'#252840'}, ticks:{color:'#6a6880', ...opts.xTicks}},
        y: {grid:{display:false}, ticks:{color:'#ccc8c0', font:{size:11}}}
      }
    }
  });
}

function lineChart(id, datasets, labels, opts={}) {
  const existing = Chart.getChart(id);
  if (existing) existing.destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...chartDefaults,
      plugins: {...chartDefaults.plugins, legend:{display: datasets.length > 1,
        labels:{color:'#ccc8c0',boxWidth:12,font:{size:11}}}},
      scales: {
        x: {grid:{color:'#1b1f35'}, ticks:{color:'#6a6880', maxTicksLimit:12, ...opts.xTicks}},
        y: {grid:{color:'#252840'}, ticks:{color:'#6a6880', ...opts.yTicks}, ...opts.yAxis}
      }
    }
  });
}

// ── Sortable table builder ─────────────────────────────────────────────────────

function makeTable(containerId, cols, rows, opts={}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!rows || rows.length === 0) {
    container.innerHTML = '<div class="empty">No data yet. Play more runs!</div>'; return;
  }

  let sortCol = opts.defaultSort || 0;
  let sortAsc = false;
  let filterText = '';
  let currentRows = [...rows];

  function renderTable() {
    let filtered = currentRows.filter(r => {
      if (!filterText) return true;
      return cols.some(c => String(r[c.key] ?? '').toLowerCase().includes(filterText));
    });

    let sorted = [...filtered];
    sorted.sort((a, b) => {
      const av = a[cols[sortCol].key]; const bv = b[cols[sortCol].key];
      const an = parseFloat(av); const bn = parseFloat(bv);
      const cmp = isNaN(an) || isNaN(bn)
        ? String(av||'').localeCompare(String(bv||''))
        : an - bn;
      return sortAsc ? cmp : -cmp;
    });

    let html = '<table><thead><tr>';
    cols.forEach((c, i) => {
      const dir = sortCol === i ? (sortAsc ? ' asc' : ' desc') : '';
      html += '<th class="' + dir + '" data-col="' + i + '">' + c.label + '</th>';
    });
    html += '</tr></thead><tbody>';
    sorted.forEach(r => {
      html += '<tr>';
      cols.forEach(c => {
        const raw = r[c.key];
        const val = c.render ? c.render(raw, r) : (raw == null ? '<span style="color:var(--dim)">—</span>' : raw);
        html += '<td data-val="' + (raw ?? '') + '">' + val + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
    container.querySelectorAll('th').forEach(th => {
      th.addEventListener('click', () => {
        const i = parseInt(th.dataset.col);
        if (sortCol === i) sortAsc = !sortAsc; else { sortCol = i; sortAsc = false; }
        renderTable();
      });
    });
  }

  renderTable();

  return {
    setFilter: t => { filterText = t.toLowerCase(); renderTable(); },
    setRows:   r => { currentRows = [...r]; renderTable(); },
  };
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function charSelHTML(id, includeAll=true) {
  const opts = (includeAll ? ['All'] : []).concat(chars());
  return `<select id="${id}">${opts.map(c=>`<option value="${c}">${c==='All'?'All Characters':c.replace(/_/g,' ')}</option>`).join('')}</select>`;
}

// ── Tab init tracking ──────────────────────────────────────────────────────────

const inited = {};
function initTab(name) {
  if (inited[name]) return;
  inited[name] = true;
  ({overview:initOverview, cards:initCards, relics:initRelics,
    synergies:initSynergies, kills:initKills,
    hpgold:initHpGold, runs:initRuns})[name]?.();
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab,.panel').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('panel-' + btn.dataset.tab);
    if (panel) panel.classList.add('active');
    initTab(btn.dataset.tab);
  });
});

// ── Overview ───────────────────────────────────────────────────────────────────

const fmtTime = s => {
  if (s == null) return '—';
  const m = Math.floor(s/60), sec = s%60;
  return m + ':' + String(sec).padStart(2,'0');
};

function initOverview() {
  const s = DATA.summaries;
  const total = s.length;
  const wins  = s.filter(r => r.victory).length;
  const wr    = total ? wins/total : 0;
  const floors = s.map(r=>r.floor).filter(Boolean);
  const times  = s.map(r=>r.run_time).filter(Boolean);
  const avgFloor = floors.length ? (floors.reduce((a,b)=>a+b,0)/floors.length).toFixed(1) : '—';
  const avgTime  = times.length  ? Math.round(times.reduce((a,b)=>a+b,0)/times.length) : null;
  const charCounts = {};
  s.forEach(r=>{ charCounts[r.character] = (charCounts[r.character]||0)+1; });
  const topChar = Object.entries(charCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';
  const streak = (() => {
    let n=0; for (let i=s.length-1;i>=0;i--) { if (s[i].victory===s[s.length-1].victory) n++; else break; }
    return (s[s.length-1]?.victory ? 'W' : 'L') + n;
  })();

  const panel = document.getElementById('panel-overview');
  panel.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-val">${total}</div><div class="kpi-label">Total Runs</div></div>
      <div class="kpi"><div class="kpi-val ${wr>=.5?'w':'l'}">${(wr*100).toFixed(1)}%</div><div class="kpi-label">Win Rate</div></div>
      <div class="kpi"><div class="kpi-val">${avgFloor}</div><div class="kpi-label">Avg Floor</div></div>
      <div class="kpi"><div class="kpi-val">${fmtTime(avgTime)}</div><div class="kpi-label">Avg Run Time</div></div>
      <div class="kpi"><div class="kpi-val" style="font-size:1.2rem">${topChar.replace(/_/g,' ')}</div><div class="kpi-label">Top Character</div></div>
      <div class="kpi"><div class="kpi-val" style="color:${s[s.length-1]?.victory?'var(--win)':'var(--loss)'};">${streak}</div><div class="kpi-label">Current Streak</div></div>
    </div>
    <div class="charts-row col2">
      <div class="chart-card"><h3>Win Rate by Character</h3>
        <div class="chart-wrap"><canvas id="ch-wr-char"></canvas></div></div>
      <div class="chart-card"><h3>Floor Reached per Run</h3>
        <div class="chart-wrap"><canvas id="ch-floor-dist"></canvas></div></div>
    </div>
    <div class="charts-row col1">
      <div class="chart-card"><h3>Win Rate by Act 1</h3>
        <div class="chart-wrap"><canvas id="ch-wr-route"></canvas></div></div>
    </div>
    <div class="section-label">Recent Runs</div>
    <div class="tcard"><div class="tcard-wrap" id="tbl-recent"></div></div>
  `;

  // Win rate by character
  const ov = DATA.overview.win_by_char;
  hbarChart('ch-wr-char', ov.labels, ov.rates, '#c9903c',
    {xTicks:{callback:v=>v+'%'}, plugins:{tooltip:{callbacks:{label:ctx=>{
      const i=ctx.dataIndex;
      return `${ov.wins[i]}W / ${ov.losses[i]}L (${ov.rates[i]}%)`;
    }}}}});

  // Floor reached per run — stacked bar wins/losses by floor bucket
  const tl = DATA.overview.timeline;
  (() => {
    const bucketSize = 5;
    const maxFloor = Math.max(...tl.floor.filter(Boolean));
    const buckets = [];
    for (let lo = 1; lo <= maxFloor; lo += bucketSize) {
      buckets.push({ lo, hi: lo + bucketSize - 1, label: `${lo}–${lo+bucketSize-1}`, wins: 0, losses: 0 });
    }
    tl.floor.forEach((f, i) => {
      if (f == null) return;
      const b = buckets[Math.floor((f - 1) / bucketSize)];
      if (!b) return;
      if (tl.won[i]) b.wins++; else b.losses++;
    });
    const existing = Chart.getChart('ch-floor-dist'); if (existing) existing.destroy();
    new Chart(document.getElementById('ch-floor-dist'), {
      type: 'bar',
      data: {
        labels: buckets.map(b => b.label),
        datasets: [
          { label: 'Win',  data: buckets.map(b=>b.wins),   backgroundColor: '#52b87599', borderColor: '#52b875', borderWidth: 1, borderRadius: 3 },
          { label: 'Loss', data: buckets.map(b=>b.losses), backgroundColor: '#e05c5c99', borderColor: '#e05c5c', borderWidth: 1, borderRadius: 3 },
        ],
      },
      options: {
        ...chartDefaults,
        plugins: { ...chartDefaults.plugins, legend: { display: true, labels: { color: '#ccc8c0', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { stacked: true, grid: { color: '#1b1f35' }, ticks: { color: '#6a6880' } },
          y: { stacked: true, grid: { color: '#252840' }, ticks: { color: '#6a6880', stepSize: 1 } },
        },
      },
    });
  })();

  // Win rate by act 1
  const ar = DATA.act_routes;
  hbarChart('ch-wr-route',
    ar.map(r=>r.act1),
    ar.map(r=>r.win_rate != null ? r.win_rate*100 : 0),
    '#9c6fcc',
    {xTicks:{callback:v=>v.toFixed(0)+'%'}, plugins:{tooltip:{callbacks:{label:ctx=>{
      const r=ar[ctx.dataIndex];
      return `${r.wins}W / ${r.total-r.wins}L — avg floor ${r.avg_floor}`;
    }}}}});

  // Recent runs table
  const recent = [...s].reverse().slice(0, 20);
  makeTable('tbl-recent', [
    {key:'character', label:'Character', render:v=>'<span style="color:'+charColor(v)+'">'+v.replace(/_/g,' ')+'</span>'},
    {key:'victory',   label:'Result',    render:v=>v?'<span class="badge-win">WIN</span>':'<span class="badge-loss">LOSS</span>'},
    {key:'floor',     label:'Floor',     render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'acts',      label:'Route',     render:v=>(v||[]).join(' → ')},
    {key:'ascension', label:'Asc',       render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'gold',      label:'Gold',      render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'run_time',  label:'Time',      render:v=>'<span class="num">'+fmtTime(v)+'</span>'},
    {key:'killed_by', label:'Killed By', render:v=>v?'<span style="color:var(--loss);font-size:.78rem">'+v+'</span>':'<span style="color:var(--win);font-size:.78rem">Victory</span>'},
  ], recent, {defaultSort:2});
}

// ── Cards ──────────────────────────────────────────────────────────────────────

function initCards() {
  const panel = document.getElementById('panel-cards');
  const allChars = chars();
  const eloMap = {};
  allChars.forEach(c => { if (DATA.elo[c]) DATA.elo[c].forEach(e=>{ eloMap[c+':'+e.card]=e.elo; }); });

  panel.innerHTML = `
    <div class="tcard-head">
      <span class="tcard-title">Card Analytics</span>
      <div class="controls">
        <span class="ctrl-label">Character</span>
        ${charSelHTML('card-char-sel', false)}
        <span class="ctrl-label">Sort by</span>
        <select id="card-sort-sel">
          <option value="quality_score">Quality Score</option>
          <option value="elo">ELO</option>
          <option value="win_rate">Win Rate</option>
          <option value="pick_rate">Pick Rate</option>
          <option value="offered">Times Seen</option>
        </select>
        <input class="search-input" id="card-search" placeholder="Search card..." type="text">
      </div>
    </div>
    <div class="charts-row col2" style="margin-top:1.25rem">
      <div class="chart-card"><h3>Top 20 — Quality Score <span class="badge">pick rate × win rate</span></h3>
        <div class="chart-wrap tall"><canvas id="ch-card-qs"></canvas></div></div>
      <div class="chart-card"><h3>Top 20 — ELO Rating <span class="badge">head-to-head preference</span></h3>
        <div class="chart-wrap tall"><canvas id="ch-card-elo"></canvas></div></div>
    </div>
    <div class="tcard">
      <div class="tcard-wrap" id="tbl-cards"></div>
    </div>
  `;

  function getRows(char) {
    const cs = DATA.card_stats[char] || [];
    return cs.map(c => ({
      ...c,
      elo: eloMap[char+':'+c.card] ?? null,
      act1_pr: c.acts?.['Act 1']?.pick_rate ?? null,
      act2_pr: c.acts?.['Act 2']?.pick_rate ?? null,
      act3_pr: c.acts?.['Act 3+']?.pick_rate ?? null,
    }));
  }

  let char = allChars[0];
  let rows = getRows(char);

  const tbl = makeTable('tbl-cards', [
    {key:'card',         label:'Card',      render:v=>'<strong>'+v+'</strong>'},
    {key:'elo',          label:'ELO',       render:v=>'<span class="num">'+(v==null?'—':Math.round(v))+'</span>'},
    {key:'pick_rate',    label:'Pick Rate', render:v=>'<span class="pct">'+pct(v)+'</span>'+spark(v)},
    {key:'win_rate',     label:'Win Rate',  render:v=>'<span class="pct '+(v==null?'':v>=.5?'w':'l')+'">'+pct(v)+'</span>'},
    {key:'quality_score',label:'Quality',   render:v=>'<span class="num '+(v!=null&&v>=.3?'w':v!=null&&v<.15?'l':'')+'">'+fmt(v,3)+'</span>'},
    {key:'offered',      label:'Seen',      render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'runs_with',    label:'Runs With', render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'avg_hp_delta',   label:'HP Δ/3F',      render:v=>delta(v)},
    {key:'avg_floor_with', label:'Avg Floor',    render:v=>'<span class="num">'+(v!=null?v.toFixed(1):'—')+'</span>'},
    {key:'shop_win_rate',  label:'Shop WR',      render:v=>'<span class="pct">'+pct(v)+'</span>'},
    {key:'act1_pr',      label:'Act 1 PR',  render:v=>'<span class="act1 pct">'+pct(v)+'</span>'},
    {key:'act2_pr',      label:'Act 2 PR',  render:v=>'<span class="act2 pct">'+pct(v)+'</span>'},
    {key:'act3_pr',      label:'Act 3+ PR', render:v=>'<span class="act3 pct">'+pct(v)+'</span>'},
  ], rows, {defaultSort:4});

  function updateCharts(r) {
    const top = [...r].sort((a,b)=>(b.quality_score||0)-(a.quality_score||0)).slice(0,20);
    hbarChart('ch-card-qs', top.map(c=>c.card), top.map(c=>c.quality_score||0), '#c9903c',
      {plugins:{tooltip:{callbacks:{label:c=>`QS: ${c.raw?.toFixed(3)} (PR: ${pct(top[c.dataIndex].pick_rate)}, WR: ${pct(top[c.dataIndex].win_rate)})`}}}});
    const topElo = [...r].filter(c=>c.elo!=null).sort((a,b)=>b.elo-a.elo).slice(0,20);
    hbarChart('ch-card-elo', topElo.map(c=>c.card), topElo.map(c=>c.elo||0), '#5b8dd9');
  }

  updateCharts(rows);

  function refresh() { rows = getRows(char); tbl?.setRows(rows); updateCharts(rows); }
  document.getElementById('card-char-sel').addEventListener('change', e => { char=e.target.value; refresh(); });
  document.getElementById('card-search').addEventListener('input', e => tbl?.setFilter(e.target.value));
}

// ── Relics ─────────────────────────────────────────────────────────────────────

function initRelics() {
  const panel = document.getElementById('panel-relics');

  panel.innerHTML = `
    <div class="tcard-head">
      <span class="tcard-title">Relic Analytics</span>
      <div class="controls">
        <span class="ctrl-label">Character</span>
        ${charSelHTML('relic-char-sel', false)}
        <input class="search-input" id="relic-search" placeholder="Search relic..." type="text">
      </div>
    </div>
    <div class="charts-row col2" style="margin-top:1.25rem">
      <div class="chart-card"><h3>Top 20 — Quality Score</h3>
        <div class="chart-wrap tall"><canvas id="ch-relic-qs"></canvas></div></div>
      <div class="chart-card"><h3>Top 20 — Win Rate</h3>
        <div class="chart-wrap tall"><canvas id="ch-relic-wr"></canvas></div></div>
    </div>
    <div class="tcard"><div class="tcard-wrap" id="tbl-relics"></div></div>
  `;

  function getRows(char) {
    return (DATA.relic_stats[char] || []).map(r => ({
      ...r,
      act1_cnt: r.acts?.['Act 1'] ?? null,
      act2_cnt: r.acts?.['Act 2'] ?? null,
      act3_cnt: r.acts?.['Act 3+'] ?? null,
    }));
  }

  let char = chars()[0];
  let rows = getRows(char);

  const tbl = makeTable('tbl-relics', [
    {key:'relic',         label:'Relic',       render:v=>'<strong>'+v+'</strong>'},
    {key:'count',         label:'Count',       render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'obtain_rate',   label:'Obtain Rate', render:v=>'<span class="pct">'+pct(v)+'</span>'+spark(v,0.5)},
    {key:'win_rate',      label:'Win Rate',    render:v=>'<span class="pct '+(v==null?'':v>=.5?'w':'l')+'">'+pct(v)+'</span>'},
    {key:'quality_score', label:'Quality',     render:v=>'<span class="num '+(v!=null&&v>=.2?'w':'')+'">'+fmt(v,3)+'</span>'},
    {key:'avg_floor',     label:'Avg Floor',   render:v=>'<span class="num">'+fmt(v,0)+'</span>'},
    {key:'act1_cnt',      label:'Act 1',       render:v=>'<span class="act1 num">'+num(v)+'</span>'},
    {key:'act2_cnt',      label:'Act 2',       render:v=>'<span class="act2 num">'+num(v)+'</span>'},
    {key:'act3_cnt',      label:'Act 3+',      render:v=>'<span class="act3 num">'+num(v)+'</span>'},
  ], rows, {defaultSort:4});

  function updateCharts(r) {
    const top = [...r].sort((a,b)=>(b.quality_score||0)-(a.quality_score||0)).slice(0,20);
    hbarChart('ch-relic-qs', top.map(r=>r.relic), top.map(r=>r.quality_score||0), '#9c6fcc');
    const topWR = [...r].filter(r=>r.win_rate!=null&&r.runs_with>=2).sort((a,b)=>b.win_rate-a.win_rate).slice(0,20);
    hbarChart('ch-relic-wr', topWR.map(r=>r.relic), topWR.map(r=>r.win_rate||0), '#52b875',
      {xTicks:{callback:v=>(v*100).toFixed(0)+'%'}});
  }

  updateCharts(rows);

  function refresh() { rows = getRows(char); tbl?.setRows(rows); updateCharts(rows); }
  document.getElementById('relic-char-sel').addEventListener('change', e => { char=e.target.value; refresh(); });
  document.getElementById('relic-search').addEventListener('input', e => tbl?.setFilter(e.target.value));
}

// ── Synergies ──────────────────────────────────────────────────────────────────

function initSynergies() {
  const panel = document.getElementById('panel-synergies');

  panel.innerHTML = `
    <div class="tcard-head">
      <span class="tcard-title">Card + Relic Synergies</span>
      <div class="controls">
        <span class="ctrl-label">Character</span>
        ${charSelHTML('syn-char-sel')}
        <input class="search-input" id="syn-search" placeholder="Search..." type="text">
        <span class="ctrl-label" style="margin-left:.5rem;font-size:.7rem;color:var(--dim)">Lift = win rate ÷ baseline. Requires 2+ co-occurrences.</span>
      </div>
    </div>
    <div class="tcard" style="margin-top:1.25rem"><div class="tcard-wrap" id="tbl-syn"></div></div>
  `;

  let char = 'All';
  function getRows(c) {
    return c === 'All' ? DATA.synergies : DATA.synergies.filter(r=>r.character===c);
  }

  const tbl = makeTable('tbl-syn', [
    {key:'character',   label:'Character',   render:v=>'<span style="color:'+charColor(v)+'">'+v.replace(/_/g,' ')+'</span>'},
    {key:'card',        label:'Card',        render:v=>'<strong>'+v+'</strong>'},
    {key:'relic',       label:'Relic',       render:v=>'<em>'+v+'</em>'},
    {key:'occurrences', label:'Co-occurs',   render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'wins',        label:'Wins',        render:v=>'<span class="num w">'+num(v)+'</span>'},
    {key:'win_rate',    label:'Win Rate',    render:v=>'<span class="pct '+(v>=.5?'w':'l')+'">'+pct(v)+'</span>'},
    {key:'baseline_wr', label:'Baseline WR', render:v=>'<span class="pct">'+pct(v)+'</span>'},
    {key:'lift',        label:'Lift ▾',      render:v=>liftFmt(v)},
  ], getRows(char), {defaultSort:7});

  document.getElementById('syn-char-sel').addEventListener('change', e => { char=e.target.value; tbl?.setRows(getRows(char)); });
  document.getElementById('syn-search').addEventListener('input', e => tbl?.setFilter(e.target.value));
}

// ── Deaths ─────────────────────────────────────────────────────────────────────

function initKills() {
  const panel = document.getElementById('panel-kills');
  const allChars = chars();

  panel.innerHTML = `
    <div class="tcard-head">
      <span class="tcard-title">Death Analysis</span>
      <div class="controls">
        <span class="ctrl-label">Character</span>
        ${charSelHTML('kills-char-sel')}
        <input class="search-input" id="kills-search" placeholder="Search encounter..." type="text">
      </div>
    </div>
    <div class="charts-row col1" style="margin-top:1.25rem">
      <div class="chart-card"><h3>Top 20 Killers</h3>
        <div class="chart-wrap tall"><canvas id="ch-kills-bar"></canvas></div></div>
    </div>
    <div class="tcard" style="margin-top:1.25rem"><div class="tcard-wrap" id="tbl-kills"></div></div>
  `;

  let char = 'All';

  function getRows(c) {
    return DATA.kills.map(k => {
      const count = c === 'All' ? k.total : (k.by_char[c] || 0);
      const deaths = DATA.summaries.filter(s => !s.victory && (c==='All' || s.character===c)).length;
      return {...k, count, rate: deaths ? count/deaths : 0};
    }).filter(k => k.count > 0).sort((a,b)=>b.count-a.count);
  }

  const cols = [
    {key:'killer', label:'Killer',       render:v=>'<strong>'+v+'</strong>'},
    {key:'count',  label:'Deaths',       render:v=>'<span class="num l">'+v+'</span>'},
    {key:'rate',   label:'% of Deaths',  render:v=>'<span class="pct">'+pct(v)+'</span>'},
    ...allChars.map(c=>({key:'_'+c, label:c.replace(/_/g,' '),
      render:(_,r)=>'<span class="num">'+(r.by_char[c]||0)+'</span>'})),
  ];

  function flatRows(r) {
    return r.map(k => {
      const flat = {...k};
      allChars.forEach(c => { flat['_'+c] = k.by_char[c] || 0; });
      return flat;
    });
  }

  let rows = getRows(char);
  const tbl = makeTable('tbl-kills', cols, flatRows(rows), {defaultSort:1});

  function updateChart(r) {
    hbarChart('ch-kills-bar', r.slice(0,20).map(k=>k.killer), r.slice(0,20).map(k=>k.count), '#e05c5c');
  }
  updateChart(rows);

  function refresh() { rows=getRows(char); tbl?.setRows(flatRows(rows)); updateChart(rows); }
  document.getElementById('kills-char-sel').addEventListener('change', e => { char=e.target.value; refresh(); });
  document.getElementById('kills-search').addEventListener('input', e => tbl?.setFilter(e.target.value));
}

// ── HP & Gold ──────────────────────────────────────────────────────────────────

const HG_COLORS = ['#52b875','#e8b86d','#5b8dd9','#9c6fcc','#e05c5c'];

function initHpGold() {
  const panel = document.getElementById('panel-hpgold');
  const hgChars = chars().filter(c => DATA.hp_gold[c]);

  panel.innerHTML = `
    <div class="tcard-head" style="border:none;padding-bottom:0">
      <span class="tcard-title" style="font-size:.75rem">HP &amp; Gold Per Floor</span>
      <div class="controls">
        <span class="ctrl-label">Character</span>
        ${charSelHTML('hpg-char-sel')}
        <span style="font-size:.72rem;color:var(--dim)">Averaged across all runs for that character.</span>
      </div>
    </div>
    <div class="charts-row col1" style="margin-top:1.25rem">
      <div class="chart-card"><h3>Avg HP % Per Floor</h3>
        <div class="chart-wrap"><canvas id="ch-hp-floor"></canvas></div></div>
    </div>
    <div class="charts-row col1">
      <div class="chart-card"><h3>Avg Gold Per Floor</h3>
        <div class="chart-wrap"><canvas id="ch-gold-floor"></canvas></div></div>
    </div>
  `;

  function datasetsFor(charSel) {
    const targets = charSel === 'All' ? hgChars : [charSel];
    return targets.map((c, i) => ({c, d: DATA.hp_gold[c], color: HG_COLORS[i % HG_COLORS.length]}))
                  .filter(x => x.d);
  }

  function allFloors(targets) {
    const s = new Set();
    targets.forEach(({d}) => d.floors.forEach(f => s.add(f)));
    return [...s].sort((a,b)=>a-b);
  }

  function drawCharts(charSel) {
    const targets = datasetsFor(charSel);
    const floors  = allFloors(targets);
    const showLegend = targets.length > 1;

    const existing1 = Chart.getChart('ch-hp-floor');  if (existing1) existing1.destroy();
    const existing2 = Chart.getChart('ch-gold-floor'); if (existing2) existing2.destroy();

    function floorVal(d, f, key) {
      const idx = d.floors.indexOf(f);
      return idx >= 0 ? d[key][idx] : null;
    }

    const hpDatasets = targets.map(({c, d, color}) => ({
      label: c.replace(/_/g,' '),
      data: floors.map(f => floorVal(d, f, 'hp_pct')),
      borderColor: color, backgroundColor: color+'18',
      tension:.4, fill: targets.length === 1, pointRadius:0, pointHoverRadius:4,
    }));
    const goldDatasets = targets.map(({c, d, color}) => ({
      label: c.replace(/_/g,' '),
      data: floors.map(f => floorVal(d, f, 'avg_gold')),
      borderColor: color, backgroundColor: color+'18',
      tension:.4, fill: targets.length === 1, pointRadius:0, pointHoverRadius:4,
    }));

    const xTicks = {color:'#6a6880', callback:(_,i) => floors[i]%5===0 ? 'F'+floors[i] : ''};

    new Chart(document.getElementById('ch-hp-floor'), {
      type:'line',
      data:{labels:floors, datasets:hpDatasets},
      options:{...chartDefaults,
        plugins:{...chartDefaults.plugins, legend:{display:showLegend, labels:{color:'#ccc8c0',boxWidth:12,font:{size:11}}}},
        scales:{
          x:{ticks:xTicks, grid:{color:'#1b1f35'}},
          y:{ticks:{color:'#6a6880',callback:v=>v+'%'}, grid:{color:'#252840'}, min:0, max:100}
        }
      }
    });

    new Chart(document.getElementById('ch-gold-floor'), {
      type:'line',
      data:{labels:floors, datasets:goldDatasets},
      options:{...chartDefaults,
        plugins:{...chartDefaults.plugins, legend:{display:showLegend, labels:{color:'#ccc8c0',boxWidth:12,font:{size:11}}}},
        scales:{
          x:{ticks:xTicks, grid:{color:'#1b1f35'}},
          y:{ticks:{color:'#6a6880',callback:v=>v+'g'}, grid:{color:'#252840'}, min:0}
        }
      }
    });
  }

  drawCharts('All');
  document.getElementById('hpg-char-sel').addEventListener('change', e => drawCharts(e.target.value));
}

// ── Run Log ────────────────────────────────────────────────────────────────────

function initRuns() {
  const panel = document.getElementById('panel-runs');
  panel.innerHTML = `
    <div class="tcard-head">
      <span class="tcard-title">Run Log</span>
      <div class="controls">
        <span class="ctrl-label">Character</span>
        ${charSelHTML('runs-char-sel')}
        <span class="ctrl-label">Result</span>
        <select id="runs-result-sel"><option value="All">All</option><option value="win">Wins</option><option value="loss">Losses</option></select>
        <input class="search-input" id="runs-search" placeholder="Search..." type="text">
      </div>
    </div>
    <div class="tcard-wrap" id="tbl-runs"></div>
  `;

  let char = 'All', result = 'All', search = '';
  function getRows() {
    return DATA.summaries.filter(r => {
      if (char !== 'All' && r.character !== char) return false;
      if (result === 'win' && !r.victory) return false;
      if (result === 'loss' && r.victory) return false;
      if (search && !JSON.stringify(r).toLowerCase().includes(search)) return false;
      return true;
    }).reverse();
  }

  const tbl = makeTable('tbl-runs', [
    {key:'file',      label:'Run File',  render:v=>'<span class="num" style="font-size:.72rem;color:var(--dim)">'+v+'</span>'},
    {key:'character', label:'Character', render:v=>'<span style="color:'+charColor(v)+';font-weight:500">'+v.replace(/_/g,' ')+'</span>'},
    {key:'victory',   label:'Result',    render:v=>v?'<span class="badge-win">WIN</span>':'<span class="badge-loss">LOSS</span>'},
    {key:'floor',     label:'Floor',     render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'acts',      label:'Route',     render:v=>(v||[]).join(' → ')},
    {key:'ascension', label:'Asc',       render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'gold',      label:'Gold',      render:v=>'<span class="num">'+num(v)+'</span>'},
    {key:'run_time',  label:'Time',      render:v=>'<span class="num">'+fmtTime(v)+'</span>'},
    {key:'killed_by', label:'Killed By', render:v=>v?'<span style="color:var(--loss);font-size:.78rem">'+v+'</span>':'<span style="color:var(--win);font-size:.78rem">Victory</span>'},
  ], getRows(), {defaultSort:3});

  const update = () => tbl?.setRows(getRows());
  document.getElementById('runs-char-sel').addEventListener('change',   e=>{char=e.target.value; update();});
  document.getElementById('runs-result-sel').addEventListener('change', e=>{result=e.target.value; update();});
  document.getElementById('runs-search').addEventListener('input',      e=>{search=e.target.value.toLowerCase(); update();});
}

// ── Boot ───────────────────────────────────────────────────────────────────────

const meta = DATA.meta;
document.getElementById('header-meta').textContent =
  `${meta.total_runs} run${meta.total_runs===1?'':'s'} · Generated ${meta.generated.slice(0,16).replace('T',' ')}`;

initTab('overview');
</script>
</body>
</html>"""

# ── Generation & main ─────────────────────────────────────────────────────────

def generate_html(payload):
    js = json.dumps(payload, separators=(',', ':'), default=str)
    js = js.replace("</script>", r"<\/script>")
    return HTML_TEMPLATE.replace("__DATA__", js)

def main():
    ap = argparse.ArgumentParser(description="STS2 dashboard generator")
    ap.add_argument("--discover", action="store_true", help="Print .run file structure and exit")
    ap.add_argument("--path",    type=str,  help="Manual path to history folder")
    ap.add_argument("--output",  type=str,  default="sts2_dashboard.html")
    ap.add_argument("--profile", type=int,  default=1, help="Profile number (default: 1)")
    args = ap.parse_args()

    hist = Path(args.path).expanduser() if args.path else find_history_dir(args.profile)
    if not hist or not hist.exists():
        print("Could not find history folder. Use --path to specify it manually.")
        print("Tip: In Finder, Option+Go → Library → Application Support")
        sys.exit(1)

    print(f"History: {hist}")
    if args.discover:
        discover(hist); return

    runs = load_runs(hist)
    if not runs:
        print("No .run files found. Try --discover to inspect the folder."); sys.exit(1)
    print(f"Loaded {len(runs)} run(s). Computing analytics...")

    summaries = compute_summaries(runs)
    payload = {
        "meta":        {"generated": datetime.now().isoformat(), "total_runs": len(runs)},
        "summaries":   summaries,
        "overview":    compute_overview(summaries),
        "card_stats":  compute_card_stats(runs),
        "relic_stats": compute_relic_stats(runs),
        "elo":         compute_elo(runs),
        "synergies":   compute_synergies(runs),
        "hp_gold":     compute_hp_gold(runs),
        "kills":       compute_kills(runs),
        "act_routes":  compute_act_routes(runs),
    }

    out = Path(args.output)
    out.write_text(generate_html(payload))
    print(f"Dashboard written: {out.resolve()}")
    print("Open in any browser. Re-run the script to refresh.")

if __name__ == "__main__":
    main()
