#!/usr/bin/env python3
"""Capture a game's full lifecycle from ESPN, state by state, for edge-case tests.

Polls the same ESPN endpoint the Astro app fetches and (optionally) our own
rendered game page, writing a gzipped snapshot every time the payload actually
changes. The result is a replayable timeline of every state a game passes
through -- pregame, each drive, halftime, overtime, final -- which is what you
need to reproduce the null/undefined rendering bugs that only appear in
transient states and are gone by the time anyone looks at the finished game.

Storage is change-driven, not poll-driven: identical consecutive payloads are
not rewritten, so a 4-hour game costs ~200 snapshots rather than ~480.

  # follow every game on today's slate until they all go final
  python3 scripts/capture_game_states.py --auto --interval 30

  # follow specific games
  python3 scripts/capture_game_states.py --games 401856766 401864494

  # backfill the end-state of finished games (fixtures for replay tests)
  python3 scripts/capture_game_states.py --games 401856766 --once

Layout: fixtures/game-states/<game_id>/
          manifest.jsonl                one line per captured state
          <seq>__<utc>__<status>.json.gz    ESPN payload
          <seq>__<utc>__<status>.html.gz    rendered page (when --html)
"""
import argparse, gzip, hashlib, json, os, signal, sys, time
import urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "game-states")
ESPN_PBP = "https://cdn.espn.com/core/college-football/playbyplay?gameId={gid}&xhr=1&render=false&userab=18"
ESPN_SB = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups={grp}&limit=400"
SITE_GAME = "https://gameonpaper.com/game/{gid}"
UA = "gop-state-capture/1.0 (+https://gameonpaper.com; edge-case fixture collection)"
STOP = False


def _now():
    return datetime.now(timezone.utc)


def fetch(url, timeout=45, accept_html=False):
    """GET a URL.

    NB: site.api.espn.com returns 403 for *any* explicit User-Agent header --
    a browser-spoofed one included -- but serves fine under urllib's default.
    So only our own origin gets an identifying UA; ESPN gets the default.
    """
    headers = {"Accept": "text/html" if accept_html else "application/json"}
    if "gameonpaper.com" in url:
        headers["User-Agent"] = UA
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def game_state(payload):
    """Pull the identifying state out of an ESPN pbp payload."""
    gp = (payload or {}).get("gamepackageJSON") or {}
    comp = ((gp.get("header") or {}).get("competitions") or [{}])[0]
    st = comp.get("status") or {}
    t = st.get("type") or {}
    plays = gp.get("drives") or {}
    n_plays = 0
    for d in (plays.get("previous") or []):
        n_plays += len(d.get("plays") or [])
    cur = plays.get("current")
    if cur:
        n_plays += len(cur.get("plays") or [])
    comps = comp.get("competitors") or []
    score = "-".join(str(c.get("score", "?")) for c in comps) if comps else "?"
    return {
        "status": t.get("name", "UNKNOWN"),
        "detail": t.get("detail"),
        "period": st.get("period"),
        "clock": st.get("displayClock"),
        "completed": bool(t.get("completed")),
        "score": score,
        "n_plays": n_plays,
        "n_drives": len(plays.get("previous") or []) + (1 if cur else 0),
    }


def slug(s):
    return "".join(c if c.isalnum() else "-" for c in str(s or "na"))[:40]


class GameCapture:
    def __init__(self, gid, want_html=False):
        self.gid = str(gid)
        self.dir = os.path.join(ROOT, self.gid)
        os.makedirs(self.dir, exist_ok=True)
        self.manifest = os.path.join(self.dir, "manifest.jsonl")
        self.want_html = want_html
        self.last_hash = None
        self.seq = 0
        self.done = False
        self.html_every = 5      # capture rendered HTML on every Nth change
        self._resume()

    def _resume(self):
        if not os.path.exists(self.manifest):
            return
        with open(self.manifest) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                self.seq = max(self.seq, rec.get("seq", 0))
                self.last_hash = rec.get("hash", self.last_hash)
                if rec.get("state", {}).get("completed"):
                    self.done = True
        if self.seq:
            print(f"[{self.gid}] resuming at seq {self.seq}"
                  f"{' (already final)' if self.done else ''}", flush=True)

    def poll(self):
        """Fetch once; write a snapshot only if the payload changed. Returns state."""
        try:
            status, raw = fetch(ESPN_PBP.format(gid=self.gid))
        except Exception as e:
            print(f"[{self.gid}] fetch error: {e}", flush=True)
            return None
        if status != 200:
            print(f"[{self.gid}] http {status}", flush=True)
            return None
        digest = hashlib.sha256(raw).hexdigest()
        try:
            payload = json.loads(raw)
        except ValueError:
            print(f"[{self.gid}] non-JSON response ({len(raw)}b) -- ESPN served HTML?", flush=True)
            payload = None
        st = game_state(payload) if payload else {"status": "PARSE_ERROR", "completed": False}

        if digest == self.last_hash:
            return st  # nothing changed; don't rewrite

        self.seq += 1
        ts = _now()
        stamp = ts.strftime("%Y%m%dT%H%M%SZ")
        base = f"{self.seq:04d}__{stamp}__{slug(st.get('status'))}"
        with gzip.open(os.path.join(self.dir, base + ".json.gz"), "wb") as f:
            f.write(raw)

        html_file = None
        if self.want_html and (self.seq == 1 or self.seq % self.html_every == 0 or st.get("completed")):
            try:
                hs, hraw = fetch(SITE_GAME.format(gid=self.gid), timeout=90, accept_html=True)
                if hs == 200:
                    html_file = base + ".html.gz"
                    with gzip.open(os.path.join(self.dir, html_file), "wb") as f:
                        f.write(hraw)
            except Exception as e:
                print(f"[{self.gid}] html capture failed: {e}", flush=True)

        rec = {"seq": self.seq, "ts": ts.isoformat(), "hash": digest,
               "bytes": len(raw), "state": st,
               "json": base + ".json.gz", "html": html_file}
        with open(self.manifest, "a") as f:
            f.write(json.dumps(rec) + "\n")
        self.last_hash = digest
        print(f"[{self.gid}] #{self.seq} {st.get('status')} "
              f"q{st.get('period')} {st.get('clock')} {st.get('score')} "
              f"plays={st.get('n_plays')} ({len(raw)//1024}kb)", flush=True)
        if st.get("completed"):
            self.done = True
            print(f"[{self.gid}] FINAL reached; {self.seq} states captured", flush=True)
        return st


def discover(groups=("80", "81"), live_only=False):
    """Non-final games across ESPN group ids (80=FBS, 81=FCS).

    Groups must be queried one at a time: the combined `groups=80,81` form
    returns events with no `competitions` key at all.
    """
    seen, out = set(), []
    for grp in groups:
        try:
            _, raw = fetch(ESPN_SB.format(grp=grp))
            data = json.loads(raw)
        except Exception as e:
            print(f"discover: group {grp} failed: {e}", flush=True)
            continue
        for e in data.get("events", []):
            comps = e.get("competitions") or []
            if not comps:
                continue  # malformed event shape; nothing to follow
            st = (comps[0].get("status") or {}).get("type") or {}
            name = st.get("name", "")
            if st.get("completed") or e["id"] in seen:
                continue
            if live_only and name == "STATUS_SCHEDULED":
                continue
            seen.add(e["id"])
            out.append((e["id"], e.get("shortName", ""), name, e.get("date", ""), grp))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--games", nargs="*", default=[], help="explicit ESPN game ids")
    ap.add_argument("--auto", action="store_true", help="discover today's non-final games and follow them")
    ap.add_argument("--groups", default="80,81", help="ESPN group ids to discover (80=FBS, 81=FCS)")
    ap.add_argument("--live-only", action="store_true", help="only follow games already under way")
    ap.add_argument("--interval", type=int, default=30, help="seconds between polls per game (default 30)")
    ap.add_argument("--once", action="store_true", help="single pass, then exit (backfill mode)")
    ap.add_argument("--html", action="store_true", help="also capture the rendered gameonpaper page")
    ap.add_argument("--max-hours", type=float, default=8.0, help="safety stop (default 8h)")
    args = ap.parse_args()

    def _sig(*_):
        global STOP
        STOP = True
        print("\nstopping after current cycle...", flush=True)
    signal.signal(signal.SIGINT, _sig)
    signal.signal(signal.SIGTERM, _sig)

    gids = list(dict.fromkeys(args.games))
    if args.auto:
        found = discover(tuple(g.strip() for g in args.groups.split(",") if g.strip()),
                         live_only=args.live_only)
        print(f"discovered {len(found)} game(s) to follow", flush=True)
        for gid, short, name, date, grp in found:
            print(f"  {gid}  {short:<18} {name:<22} grp{grp}  {date}", flush=True)
            gids.append(gid)
        gids = list(dict.fromkeys(gids))
    if not gids:
        print("no games to capture (use --games or --auto)", flush=True)
        return 1

    os.makedirs(ROOT, exist_ok=True)
    caps = [GameCapture(g, want_html=args.html) for g in gids]
    print(f"capturing {len(caps)} game(s) -> {ROOT}", flush=True)
    started = time.time()
    cycle = 0
    while not STOP:
        cycle += 1
        live = [c for c in caps if not c.done]
        if not live:
            print("all games final; done", flush=True)
            break
        for c in live:
            if STOP:
                break
            c.poll()
            time.sleep(1.0)  # be polite to ESPN between games
        if args.once:
            break
        if time.time() - started > args.max_hours * 3600:
            print("max-hours reached; stopping", flush=True)
            break
        sleep_for = max(5, args.interval - len(live))
        for _ in range(sleep_for):
            if STOP:
                break
            time.sleep(1)

    total = sum(c.seq for c in caps)
    print(f"\ncaptured {total} states across {len(caps)} game(s) in {(time.time()-started)/60:.1f} min", flush=True)
    for c in caps:
        print(f"  {c.gid}: {c.seq} states {'(final)' if c.done else '(incomplete)'}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
