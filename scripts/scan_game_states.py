#!/usr/bin/env python3
"""Scan captured game states for the shapes that break the front end.

Every probe here corresponds to a failure mode observed in production
(gop.error_log / gop.request_log), not a hypothetical one. Run it over
captured fixtures to find which games reproduce a class of bug, or over a
live sample to find the next one before a user does.

  python3 scripts/scan_game_states.py                       # all captured fixtures
  python3 scripts/scan_game_states.py --live 401752921 ...   # fetch + scan now
  python3 scripts/scan_game_states.py --sample 40            # scan a slate sample
  python3 scripts/scan_game_states.py --json report.json     # machine-readable

Exit code is 1 when any BREAKS-severity probe fires, so this can gate CI.
"""
import argparse, glob, gzip, json, os, sys, urllib.request
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "game-states")
ESPN_PBP = "https://cdn.espn.com/core/college-football/playbyplay?gameId={gid}&xhr=1&render=false&userab=18"
ESPN_SB = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=81&limit=400"
UA = "gop-state-scan/1.0 (+https://gameonpaper.com)"

# severity: BREAKS = crash/500/blank section, UGLY = visible undefined/NaN/wrong value
PROBES = []


def probe(pid, severity, why):
    def deco(fn):
        PROBES.append({"id": pid, "severity": severity, "why": why, "fn": fn})
        return fn
    return deco


def _comp(gp):
    return ((gp.get("header") or {}).get("competitions") or [{}])[0]


def _plays(gp):
    dr = gp.get("drives") or {}
    out = []
    for d in (dr.get("previous") or []):
        out.extend(d.get("plays") or [])
    cur = dr.get("current")
    if cur:
        out.extend(cur.get("plays") or [])
    return out


@probe("no_header_competitions", "BREAKS",
       "python raises 'has no header.competitions; cannot build play-by-play' -> 404 page")
def _p1(gp):
    return [] if ((gp.get("header") or {}).get("competitions")) else ["header.competitions absent"]


@probe("team_missing_color", "BREAKS",
       "team.color undefined -> .startsWith threw: /team/[id] 500 + DriveChart failed to hydrate")
def _p2(gp):
    bad = []
    for c in _comp(gp).get("competitors") or []:
        t = c.get("team") or {}
        if not t.get("color"):
            bad.append(f"{t.get('abbreviation') or t.get('id')} has no color")
    return bad


@probe("play_missing_clock_fields", "BREAKS",
       "python raises KeyError('clock.minutes') -> whole game 404s")
def _p3(gp):
    bad = []
    for p in _plays(gp):
        ck = p.get("clock")
        if ck is None or "displayValue" not in (ck or {}):
            bad.append(f"play {p.get('id')} clock={ck!r}")
    return bad[:5]


@probe("competitor_missing_score", "UGLY",
       "score renders as undefined in the page title and scoreboard")
def _p4(gp):
    st = ((_comp(gp).get("status") or {}).get("type") or {})
    if st.get("name") == "STATUS_SCHEDULED":
        return []  # pregame legitimately has no score
    bad = []
    for c in _comp(gp).get("competitors") or []:
        if c.get("score") in (None, ""):
            bad.append(f"{((c.get('team') or {}).get('abbreviation'))} score={c.get('score')!r}")
    return bad


@probe("team_missing_logo", "UGLY", "broken <img> in the header / dark-mode logo swap")
def _p5(gp):
    bad = []
    for c in _comp(gp).get("competitors") or []:
        t = c.get("team") or {}
        if not (t.get("logo") or t.get("logos")):
            bad.append(f"{t.get('abbreviation') or t.get('id')} has no logo")
    return bad


@probe("play_missing_start_state", "UGLY",
       "down/distance/yardline render blank or 'undefined & undefined' in PlaysTable")
def _p6(gp):
    bad = []
    for p in _plays(gp):
        s = p.get("start")
        if not s:
            bad.append(f"play {p.get('id')} has no start")
        elif s.get("yardsToEndzone") is None and s.get("yardLine") is None:
            bad.append(f"play {p.get('id')} no yardline")
    return bad[:5]


@probe("play_missing_type", "UGLY", "formatDown() reads playType -> 'undefined' in the down column")
def _p7(gp):
    bad = [f"play {p.get('id')}" for p in _plays(gp)
           if not ((p.get("type") or {}).get("text"))]
    return bad[:5]


@probe("drive_missing_team", "UGLY", "DriveChart paints '#undefined' for the drive's offense")
def _p8(gp):
    bad = []
    dr = gp.get("drives") or {}
    for d in (dr.get("previous") or []) + ([dr["current"]] if dr.get("current") else []):
        t = d.get("team") or {}
        if not t.get("abbreviation") and not t.get("id"):
            bad.append(f"drive {d.get('id')} has no team")
        elif not t.get("color"):
            bad.append(f"drive {d.get('id')} team {t.get('abbreviation')} has no color")
    return bad[:5]


@probe("no_winprobability", "UGLY", "WP chart renders empty for an in-progress/final game")
def _p9(gp):
    st = ((_comp(gp).get("status") or {}).get("type") or {})
    if st.get("name") == "STATUS_SCHEDULED":
        return []
    return [] if gp.get("winprobability") else ["winprobability absent"]


@probe("duplicate_drive_ids", "UGLY",
       "same drive rendered twice in the drives table (fixed in b753c32 by dedupe)")
def _p10(gp):
    dr = gp.get("drives") or {}
    ids = [d.get("id") for d in (dr.get("previous") or [])]
    if dr.get("current"):
        ids.append(dr["current"].get("id"))
    dupes = {i for i in ids if i and ids.count(i) > 1}
    return [f"drive id {i} appears {ids.count(i)}x" for i in dupes]


@probe("overtime_period", "INFO", "period > 4: exercises OT clock/period formatting paths")
def _p11(gp):
    per = (_comp(gp).get("status") or {}).get("period")
    return [f"period={per}"] if isinstance(per, int) and per > 4 else []


def scan_payload(payload):
    gp = (payload or {}).get("gamepackageJSON") or {}
    hits = []
    for p in PROBES:
        try:
            found = p["fn"](gp)
        except Exception as e:
            found = [f"probe crashed: {type(e).__name__}: {e}"]
        if found:
            hits.append({"id": p["id"], "severity": p["severity"], "why": p["why"], "detail": found})
    return hits


def fetch_game(gid):
    # no User-Agent: ESPN 403s any explicit UA on these endpoints
    req = urllib.request.Request(ESPN_PBP.format(gid=gid))
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read())


def iter_fixtures():
    for mf in sorted(glob.glob(os.path.join(ROOT, "*", "manifest.jsonl"))):
        gid = os.path.basename(os.path.dirname(mf))
        with open(mf) as f:
            for line in f:
                if not line.strip():
                    continue
                rec = json.loads(line)
                path = os.path.join(os.path.dirname(mf), rec["json"])
                if not os.path.exists(path):
                    continue
                with gzip.open(path, "rb") as g:
                    try:
                        yield gid, rec, json.loads(g.read())
                    except ValueError:
                        continue


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", nargs="*", help="fetch these game ids and scan now")
    ap.add_argument("--sample", type=int, help="scan N games off the current slate")
    ap.add_argument("--json", help="write full report here")
    args = ap.parse_args()

    findings = defaultdict(list)   # probe id -> [(gid, label, detail)]
    scanned = 0

    sources = []
    if args.live:
        sources = [(g, "live") for g in args.live]
    elif args.sample:
        req = urllib.request.Request(ESPN_SB)
        with urllib.request.urlopen(req, timeout=45) as r:
            data = json.loads(r.read())
        sources = [(e["id"], "slate") for e in data.get("events", [])][:args.sample]

    if sources:
        for gid, label in sources:
            try:
                payload = fetch_game(gid)
            except Exception as e:
                print(f"  {gid}: fetch failed {e}", file=sys.stderr)
                continue
            scanned += 1
            for h in scan_payload(payload):
                findings[h["id"]].append((gid, label, h["detail"]))
    else:
        for gid, rec, payload in iter_fixtures():
            scanned += 1
            label = f"#{rec['seq']} {rec['state'].get('status')}"
            for h in scan_payload(payload):
                findings[h["id"]].append((gid, label, h["detail"]))

    by_id = {p["id"]: p for p in PROBES}
    order = {"BREAKS": 0, "UGLY": 1, "INFO": 2}
    print(f"scanned {scanned} game state(s); {len(findings)} probe(s) fired\n")
    breaks = 0
    for pid in sorted(findings, key=lambda p: (order[by_id[p]["severity"]], -len(findings[p]))):
        pr = by_id[pid]
        rows = findings[pid]
        games = {g for g, _, _ in rows}
        if pr["severity"] == "BREAKS":
            breaks += 1
        print(f"[{pr['severity']}] {pid} — {len(rows)} state(s), {len(games)} game(s)")
        print(f"    impact: {pr['why']}")
        for g, label, detail in rows[:3]:
            print(f"    e.g. game {g} ({label}): {detail[0] if detail else ''}")
        print()

    if args.json:
        with open(args.json, "w") as f:
            json.dump({"scanned": scanned,
                       "findings": {k: [{"game": g, "label": l, "detail": d} for g, l, d in v]
                                    for k, v in findings.items()}}, f, indent=2)
        print(f"full report -> {args.json}")
    return 1 if breaks else 0


if __name__ == "__main__":
    sys.exit(main())
