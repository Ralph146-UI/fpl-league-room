#!/usr/bin/env python3
"""Fetch your FPL mini-league into one file for the FPL League Room page.

The page can't reach the FPL website itself (browsers block it), so this
script does the fetching on your own computer and writes fpl_bundle.json.
Drop that file onto the page. Everything else happens there.

    python3 fpl_fetch.py                 # league id from settings.json
    python3 fpl_fetch.py 123456          # or give it here
    python3 fpl_fetch.py 123456 --gw 8   # a particular gameweek

The league id is the number in the league's address:
fantasy.premierleague.com/leagues/<THIS NUMBER>/standings/c
It changes every season.

Standard library only. Python 3.9 or newer.
"""

import argparse
import datetime as dt
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".fpl_cache"
BASE = "https://fantasy.premierleague.com/api"
MAX_MANAGERS = 150


def fail(msg):
    sys.exit(f"\nStopped: {msg}\n")


def get(path, ttl=600):
    """GET a JSON endpoint, cached on disk for 10 minutes."""
    CACHE.mkdir(exist_ok=True)
    key = CACHE / (re.sub(r"[^A-Za-z0-9]+", "_", path).strip("_") + ".json")
    if key.exists() and time.time() - key.stat().st_mtime < ttl:
        return json.loads(key.read_text())
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "fpl-league-room/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode())
            key.write_text(json.dumps(data))
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 503:
                fail("the FPL site is updating (it does this between gameweeks). Try again in an hour.")
            if attempt == 2:
                fail(f"the FPL site answered {e.code} for {path}.")
        except urllib.error.URLError as e:
            if attempt == 2:
                fail(f"could not reach fantasy.premierleague.com ({e.reason}).")
        time.sleep(1.5 * (attempt + 1))


def pmap(fn, items):
    with ThreadPoolExecutor(8) as ex:
        return list(ex.map(fn, items))


def picks_rows(p):
    """Compact picks: [element, position, multiplier, is_captain, is_vice]."""
    if not p:
        return None
    eh = p.get("entry_history") or {}
    return {
        "chip": p.get("active_chip"),
        "bank": eh.get("bank", 0),
        "picks": [[x["element"], x["position"], x["multiplier"], int(x["is_captain"]), int(x["is_vice_captain"])]
                  for x in p.get("picks", [])],
    }


def main():
    ap = argparse.ArgumentParser(description="Fetch an FPL mini-league for FPL League Room")
    ap.add_argument("league_id", type=int, nargs="?")
    ap.add_argument("--gw", type=int, help="gameweek to report on (default: latest final one)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    settings = HERE / "settings.json"
    if args.league_id is None and settings.exists():
        args.league_id = json.loads(settings.read_text()).get("league_id")
    if not args.league_id:
        fail("no league id. Put it in settings.json (\"league_id\": 123456) or pass it: python3 fpl_fetch.py 123456")
    if args.out is None:
        args.out = "data/fpl_bundle.json" if (HERE / "data").is_dir() else "fpl_bundle.json"

    bs = get("/bootstrap-static/")
    events = bs["events"]
    checked = [e["id"] for e in events if e.get("finished") and e.get("data_checked")]
    finished = [e["id"] for e in events if e.get("finished")]
    gw = args.gw or (max(checked) if checked else (max(finished) if finished else None))
    if not gw:
        fail("no gameweek has been played yet this season.")
    current = next((e["id"] for e in events if e.get("is_current")), gw)
    squad_gw = max(gw, current)

    rows, page = [], 1
    while True:
        s = get(f"/leagues-classic/{args.league_id}/standings/?page_standings={page}")
        if s is None:
            fail(f"league {args.league_id} was not found. Check the id (it changes every season; "
                 "head-to-head leagues aren't supported).")
        meta = s["league"]
        rows += s["standings"]["results"]
        if not s["standings"]["has_next"] or len(rows) >= MAX_MANAGERS:
            break
        page += 1
    total_managers = len(rows) if not s["standings"]["has_next"] else None
    if len(rows) > MAX_MANAGERS:
        print(f"Note: the league has more than {MAX_MANAGERS} managers. Keeping the top {MAX_MANAGERS}.")
        rows = rows[:MAX_MANAGERS]

    def one(r):
        e = r["entry"]
        h = get(f"/entry/{e}/history/") or {}
        picks = get(f"/entry/{e}/event/{gw}/picks/")
        prev = get(f"/entry/{e}/event/{gw - 1}/picks/") if gw > 1 else None
        squad = picks if squad_gw == gw else get(f"/entry/{e}/event/{squad_gw}/picks/")
        tx = get(f"/entry/{e}/transfers/") or []
        return {
            "entry": e,
            "name": r["player_name"],
            "team": r["entry_name"],
            # [event, points, total_points, overall_rank, bank, value, transfers, transfer_cost, bench]
            "history": [[x["event"], x["points"], x["total_points"], x.get("overall_rank") or 0, x["bank"],
                         x["value"], x["event_transfers"], x["event_transfers_cost"], x["points_on_bench"]]
                        for x in h.get("current", [])],
            "chips": [[c["name"], c["event"]] for c in h.get("chips", [])],
            "picks": picks_rows(picks),
            "prev": picks_rows(prev),
            "squad": picks_rows(squad),
            "transfers": [[t["element_in"], t["element_out"], t["event"]] for t in tx if t["event"] == gw],
        }

    print(f"Fetching {len(rows)} managers from {meta['name']}...")
    managers = pmap(one, rows)

    live = get(f"/event/{gw}/live/") or {"elements": []}
    fixtures = get("/fixtures/?future=1") or []

    bundle = {
        "v": 1,
        "fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "league": {"id": meta["id"], "name": meta["name"], "complete": total_managers is not None and total_managers <= MAX_MANAGERS},
        "gw": gw,
        "squad_gw": squad_gw,
        "events": [{"id": e["id"], "avg": e.get("average_entry_score"), "high": e.get("highest_score"),
                    "finished": bool(e.get("finished")), "checked": bool(e.get("data_checked")),
                    "current": bool(e.get("is_current")), "next": bool(e.get("is_next")),
                    "deadline": e.get("deadline_time")} for e in events],
        "teams": [[t["id"], t["short_name"], t["name"]] for t in bs["teams"]],
        # [id, web_name, team, position(1-4), now_cost, form, ppg, minutes, status, chance_next, news, selected_by, total_points]
        "elements": [[e["id"], e["web_name"], e["team"], e["element_type"], e["now_cost"], float(e["form"] or 0),
                      float(e["points_per_game"] or 0), e["minutes"], e["status"], e.get("chance_of_playing_next_round"),
                      e.get("news") or "", float(e["selected_by_percent"] or 0), e["total_points"]]
                     for e in bs["elements"]],
        "fixtures": [[f["event"], f["team_h"], f["team_a"], f["team_h_difficulty"], f["team_a_difficulty"]]
                     for f in fixtures if f.get("event")],
        "live": {str(x["id"]): [x["stats"].get("total_points", 0), x["stats"].get("minutes", 0)]
                 for x in live.get("elements", []) if x["stats"].get("minutes", 0) or x["stats"].get("total_points", 0)},
        "managers": managers,
    }
    out = HERE / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")))
    final = gw in checked
    print(f"\nWrote {args.out} ({out.stat().st_size // 1024} KB): {meta['name']}, gameweek {gw}"
          + ("" if final else " (NOT final yet: bonus points may still change)") + ".")
    print("Drop it onto the FPL League Room page.\n")


if __name__ == "__main__":
    main()
