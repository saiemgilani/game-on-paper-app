# NFL Plan A — Python route, league abstraction, ESPN-only `/nfl` pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/nfl` (scoreboard), `/nfl/game/[id]`, `/nfl/game/matchup` and `/nfl/year/[y]/type/[t]/week/[w]` on gameonpaper.com, powered by ESPN through `NFLPlayProcess`, with zero change to any CFB URL or test.

**Architecture:** One Astro app. Middleware strips a `/nfl` prefix into `Astro.locals.league = 'nfl'` and rewrites to the existing page files (the `/preview/*` rewrite pattern). The three resource modules (`espn.ts`, `python.ts`, `sdv.ts`) take a `league` argument defaulting to `'cfb'`. Flask gains `/nfl/<id>/process` by extracting the CFB route's record-reshaping into a league-agnostic helper.

**Tech Stack:** Astro 5 SSR (Cloudflare adapter; vitest + Container API for tests), Svelte 5, Flask + `sportsdataverse.nfl.NFLPlayProcess`, uv.

**Spec:** `docs/superpowers/specs/2026-09-09-nfl-branch-design.md` (§1.1, §1.2, §3.1, §3.2, phases 1–2).

## Global Constraints

- Conventional Commits; **never** add an AI co-author trailer or "Generated with" footer (repo rule + commit-msg hook).
- Stage explicit paths; no `git add -A`. One logical change per commit.
- Work only in the worktree `/mnt/sdv_repos/gop-nfl-wt` on branch `feat/nfl`.
- Local gates: `cd astro && npx vitest run` (baseline 208 passed / 1 skipped) and `cd python && ./.venv/bin/python -m pytest -q` (baseline 29 passed). `astro check` / `astro dev` do NOT run here (node v20 < 22.12) — CI covers templates; render tests are the local proof.
- **No existing test file may change in this plan.** Only additions.
- CFB behavior byte-identical: every new parameter defaults to `'cfb'`; the CFB KV cache key `"scoreboard"` and Python URL `/cfb/<id>/process` are unchanged.
- Polars 1.x API only in Python; no new dependencies.
- Never `curl`/`wget` in Bash (redirected); use the venv python `requests` for captures.

---

### Task 1: Extract the record reshaper from the CFB route

**Files:**
- Modify: `python/app.py:94-283` (the `process` view) — pull the per-record reshaping loop into a module-level function.
- Test: `python/tests/test_reshape.py` (new)

**Interfaces:**
- Produces: `app._reshape_records(plays: list[dict]) -> None` (mutates in place; same semantics as today's loop: nests `clock`, `type`, `modelInputs`, `expectedPoints`, `winProbability`, `start`, `end`; deletes every key in `_BAD_COLS`; non-finite floats → `None`). `_BAD_COLS: list[str]` becomes a module constant (the current inline `bad_cols` list, verbatim).

- [ ] **Step 1: Write the failing test**

```python
# python/tests/test_reshape.py
import math

import app


def _record(**over):
    base = {
        "clock.displayValue": "12:34", "clock.minutes": 12, "clock.seconds": 34,
        "type.id": "5", "type.text": "Rush", "type.abbreviation": "RUSH",
        "start.down": 1, "start.distance": 10, "start.yardsToEndzone": 75,
        "start.TimeSecsRem": 1800, "start.adj_TimeSecsRem": 3600, "pos_score_diff_start": 0,
        "start.posTeamTimeouts": 3, "start.defPosTeamTimeouts": 3, "start.ExpScoreDiff": 0.1,
        "start.ExpScoreDiff_Time_Ratio": 0.0, "start.spread_time": -2.0,
        "start.pos_team_receives_2H_kickoff": 1, "start.is_home": 1, "period": 1,
        "end.down": 2, "end.distance": 7, "end.yardsToEndzone": 72, "end.TimeSecsRem": 1770,
        "end.adj_TimeSecsRem": 3570, "end.posTeamTimeouts": 3, "end.defPosTeamTimeouts": 3,
        "end.ExpScoreDiff": 0.2, "end.ExpScoreDiff_Time_Ratio": 0.0, "end.spread_time": -2.0,
        "end.pos_team_receives_2H_kickoff": 1, "pos_score_diff_end": 0,
        "EP_start": 1.0, "EP_end": 1.3, "EPA": 0.3, "wp_before": 0.5, "wp_after": 0.51, "wpa": 0.01,
        "start.team.id": "1", "start.pos_team.id": "1", "start.pos_team.name": "A",
        "start.def_pos_team.id": "2", "start.def_pos_team.name": "B",
        "start.pos_team_score": 0, "start.def_pos_team_score": 0, "start.homeScore": 0, "start.awayScore": 0,
        "start.yardLine": 25, "start.pos_team_spread": -2.0,
        "end.team.id": "1", "end.pos_team.id": "1", "end.pos_team.name": "A",
        "end.def_pos_team.id": "2", "end.def_pos_team.name": "B",
        "end.pos_team_score": 0, "end.def_pos_team_score": 0, "end.homeScore": 0, "end.awayScore": 0,
        "end.yardLine": 28, "end.is_home": 1,
        "start.shortDownDistanceText": "1st & 10", "start.possessionText": "A 25", "start.downDistanceText": "1st & 10 at A 25",
        "end.shortDownDistanceText": "2nd & 7", "end.possessionText": "A 28", "end.downDistanceText": "2nd & 7 at A 28",
        "expectedPoints.before": 1.0, "winProbability.before": 0.5, "scoringType.name": None,
        "text": "rush for 3 yards", "some_nan": float("nan"),
    }
    base.update(over)
    return base


def test_reshape_nests_and_strips():
    recs = [_record()]
    app._reshape_records(recs)
    r = recs[0]
    assert r["clock"] == {"displayValue": "12:34", "minutes": 12, "seconds": 34}
    assert r["type"]["abbreviation"] == "RUSH"
    assert r["modelInputs"]["start"]["down"] == 1 and r["modelInputs"]["end"]["distance"] == 7
    assert r["start"]["pos_team"]["id"] == "1" and r["end"]["def_pos_team"]["name"] == "B"
    assert r["start"]["shortDownDistanceText"] == "1st & 10"
    for gone in ("clock.displayValue", "type.id", "start.down", "expectedPoints.before", "winProbability.before", "scoringType.name"):
        assert gone not in r
    assert r["some_nan"] is None
    assert r["text"] == "rush for 3 yards"  # untouched passthrough


def test_reshape_tolerates_missing_optional_text_fields():
    rec = _record()
    for k in ("start.shortDownDistanceText", "start.possessionText", "end.shortDownDistanceText", "end.possessionText", "end.downDistanceText"):
        del rec[k]
    app._reshape_records([rec])
    assert rec["start"]["shortDownDistanceText"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/python && PYTHON_HTTP_TOKEN=test ./.venv/bin/python -m pytest tests/test_reshape.py -q`
Expected: FAIL — `AttributeError: module 'app' has no attribute '_reshape_records'`. (Existing tests import `app` with the env var set; keep that pattern — `app.py` asserts `PYTHON_HTTP_TOKEN` at import.)

- [ ] **Step 3: Extract the helper**

In `python/app.py`: move the inline `bad_cols = [...]` list (lines ~121–160) to module scope as `_BAD_COLS` directly above `def process`. Then move the whole `for record in processed_game["plays"]:` loop body (from `record["clock"] = {...}` through the `for k in list(record.keys()):` cleanup) into:

```python
def _reshape_records(plays):
    """Fold sdv-py's flat dotted columns back into ESPN's nested shape.

    League-agnostic: CFBPlayProcess and NFLPlayProcess emit the same dotted
    columns for everything this reads. Mutates ``plays`` in place.
    """
    for record in plays:
        # ... (the existing loop body, verbatim, indented one level less) ...
        for k in list(record.keys()):
            if k in _BAD_COLS:
                del record[k]
                continue
            v = record[k]
            if isinstance(v, float) and not math.isfinite(v):
                record[k] = None
```

and replace the loop in `process` with one line: `_reshape_records(processed_game["plays"])`. Do not change any string in the body — the point is a pure move. Delete the commented-out `record["players"]` block while moving (dead code).

- [ ] **Step 4: Run tests**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/python && PYTHON_HTTP_TOKEN=test ./.venv/bin/python -m pytest -q`
Expected: 31 passed (29 baseline + 2).

- [ ] **Step 5: Commit**

```bash
git add python/app.py python/tests/test_reshape.py
git commit -m "refactor(python): extract the play-record reshaper from the cfb route"
```

---

### Task 2: League-agnostic processing core + `/nfl/<id>/process`

**Files:**
- Modify: `python/app.py` — `process` becomes a thin wrapper over `_process_game(league, game_id, processor_factory)`.
- Test: `python/tests/test_nfl_route.py` (new)

**Interfaces:**
- Produces: `GET /nfl/<int:game_id>/process` (same auth decorator, same response shape as `/cfb/...`). `_PROCESSORS: dict[str, tuple[type, str]] = {"cfb": (CFBPlayProcess, "espn_cfb_pbp"), "nfl": (NFLPlayProcess, "espn_nfl_pbp")}`. Telemetry `upstream_log.target` stays `"espn_pbp"`; `g.gop_meta` gains `"league"`.
- NFL gap shim: after `run_processing_pipeline()`, if `"success"` is absent from the first play record, set `record["success"] = (record.get("EPA") or 0) > 0` for every play (nflfastR definition; CFBPlayProcess already emits it).

- [ ] **Step 1: Write the failing test**

```python
# python/tests/test_nfl_route.py
import base64
import math

import pytest


class _FakeNFL:
    """Stands in for NFLPlayProcess: no network, three plays, one nan."""
    instances = []

    def __init__(self, gameId=0, **_):
        self.gameId = gameId
        self.json = {"header": {"competitions": [{"status": {"type": {"completed": False}}}]}}
        self.plays_json = None
        _FakeNFL.instances.append(self)

    def espn_nfl_pbp(self):
        self.fetched = True

    def run_processing_pipeline(self):
        def play(i):
            return {
                "id": str(i), "text": f"play {i}", "EPA": [0.4, -0.2, float("nan")][i],
                "clock.displayValue": "1:00", "clock.minutes": 1, "clock.seconds": 0,
                "type.id": "5", "type.text": "Rush", "type.abbreviation": "RUSH",
                "start.down": 1, "start.distance": 10, "start.yardsToEndzone": 75, "start.TimeSecsRem": 60,
                "start.adj_TimeSecsRem": 60, "pos_score_diff_start": 0, "start.posTeamTimeouts": 3,
                "start.defPosTeamTimeouts": 3, "start.ExpScoreDiff": 0.0, "start.ExpScoreDiff_Time_Ratio": 0.0,
                "start.spread_time": 0.0, "start.pos_team_receives_2H_kickoff": 0, "start.is_home": 1, "period": 1,
                "end.down": 2, "end.distance": 7, "end.yardsToEndzone": 72, "end.TimeSecsRem": 30, "end.adj_TimeSecsRem": 30,
                "end.posTeamTimeouts": 3, "end.defPosTeamTimeouts": 3, "end.ExpScoreDiff": 0.0,
                "end.ExpScoreDiff_Time_Ratio": 0.0, "end.spread_time": 0.0, "end.pos_team_receives_2H_kickoff": 0,
                "pos_score_diff_end": 0, "EP_start": 1.0, "EP_end": 1.0, "wp_before": 0.5, "wp_after": 0.5, "wpa": 0.0,
                "start.team.id": "1", "start.pos_team.id": "1", "start.pos_team.name": "A", "start.def_pos_team.id": "2",
                "start.def_pos_team.name": "B", "start.pos_team_score": 0, "start.def_pos_team_score": 0,
                "start.homeScore": 0, "start.awayScore": 0, "start.yardLine": 25, "start.pos_team_spread": 0.0,
                "end.team.id": "1", "end.pos_team.id": "1", "end.pos_team.name": "A", "end.def_pos_team.id": "2",
                "end.def_pos_team.name": "B", "end.pos_team_score": 0, "end.def_pos_team_score": 0, "end.homeScore": 0,
                "end.awayScore": 0, "end.yardLine": 28, "end.is_home": 1,
            }
        return {"gameId": self.gameId, "plays": [play(i) for i in range(3)],
                "advBoxScore": {"pass": [], "rush": [], "receiver": [], "team": [], "situational": [],
                                "defensive": [], "turnover": [], "drives": []},
                "header": self.json["header"], "teamInfo": {}, "drives": {}, "season": {"year": 2025}, "week": 10}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import importlib
    import app as app_mod
    importlib.reload(app_mod)
    monkeypatch.setitem(app_mod._PROCESSORS, "nfl", (_FakeNFL, "espn_nfl_pbp"))
    monkeypatch.setattr(app_mod.TEL, "push", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    return app_mod.app.test_client()


def auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


def test_nfl_route_requires_token(client):
    assert client.get("/nfl/401772944/process").status_code == 401


def test_nfl_route_processes_and_reshapes(client):
    r = client.get("/nfl/401772944/process", headers=auth())
    assert r.status_code == 200
    body = r.get_json()
    assert body["gameId"] == 401772944
    assert len(body["plays"]) == 3
    p = body["plays"][0]
    assert p["clock"]["displayValue"] == "1:00" and "clock.displayValue" not in p
    assert p["modelInputs"]["start"]["down"] == 1
    # the NFL processor has no `success`; the route derives it from EPA
    assert [q["success"] for q in body["plays"]] == [True, False, False]
    assert body["plays"][2]["EPA"] is None  # nan -> null
    assert set(body["advBoxScore"]) == {"pass", "rush", "receiver", "team", "situational", "defensive", "turnover", "drives"}


def test_cfb_route_still_registered(client):
    # the extraction must not have unregistered the original route
    assert client.get("/cfb/1/process").status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/python && PYTHON_HTTP_TOKEN=test ./.venv/bin/python -m pytest tests/test_nfl_route.py -q`
Expected: FAIL — `AttributeError: module 'app' has no attribute '_PROCESSORS'` (and 404s on `/nfl/...`).

- [ ] **Step 3: Implement**

In `python/app.py`:

```python
from sportsdataverse.cfb import CFBPlayProcess
from sportsdataverse.nfl import NFLPlayProcess

# league -> (processor class, name of its ESPN fetch method). The pipeline,
# box-score builder and record shape are shared by both sdv-py processors;
# only construction and fetch differ.
_PROCESSORS = {
    "cfb": (CFBPlayProcess, "espn_cfb_pbp"),
    "nfl": (NFLPlayProcess, "espn_nfl_pbp"),
}


def _fill_success(plays):
    """CFBPlayProcess emits `success`; NFLPlayProcess does not. Same definition
    as nflfastR (EPA > 0) so the two leagues' play filters agree."""
    if plays and "success" not in plays[0]:
        for record in plays:
            epa = record.get("EPA")
            record["success"] = bool(epa is not None and isinstance(epa, (int, float)) and math.isfinite(epa) and epa > 0)
```

Rename the existing `process(game_id)` body into `def _process_game(league: str, game_id: int):` with these substitutions inside it:

```python
    cls, fetch_name = _PROCESSORS[league]
    g.gop_meta = {"game_id": str(game_id), "league": league}
    game = cls(gameId=game_id)
    game.join_participants = True
    game.resolve_missing = False
    ...
    with stage(timings, "espn_fetch"):
        getattr(game, fetch_name)()
    ...
    with stage(timings, "pipeline"):
        processed_game = game.run_processing_pipeline()
    _fill_success(processed_game["plays"])
    _reshape_records(processed_game["plays"])
```

Everything else (telemetry pushes, span handling, DQ emit, orjson response, the two `except` branches) stays as is inside `_process_game`. Then the two routes:

```python
@app.route("/cfb/<int:game_id>/process", methods=["GET"])
@require_auth_token
def process(game_id: int):
    return _process_game("cfb", game_id)


@app.route("/nfl/<int:game_id>/process", methods=["GET"])
@require_auth_token
def process_nfl(game_id: int):
    return _process_game("nfl", game_id)
```

Keep the CFB function named `process` (nothing else references it, but the diff stays minimal).

- [ ] **Step 4: Run all python tests**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/python && PYTHON_HTTP_TOKEN=test ./.venv/bin/python -m pytest -q`
Expected: 34 passed.

- [ ] **Step 5: Live smoke (droplet can reach ESPN)**

Run:
```bash
cd /mnt/sdv_repos/gop-nfl-wt/python && PYTHON_HTTP_TOKEN=test ./.venv/bin/python - <<'PY'
import base64, app
c = app.app.test_client()
r = c.get("/nfl/401772944/process", headers={"Authorization": "Bearer " + base64.b64encode(b"test").decode()})
b = r.get_json(); print(r.status_code, len(b["plays"]), sorted(b["advBoxScore"]), b["plays"][0]["success"])
PY
```
Expected: `200 175 ['defensive', 'drives', 'pass', 'receiver', 'rush', 'situational', 'team', 'turnover'] True|False`.

- [ ] **Step 6: Commit**

```bash
git add python/app.py python/tests/test_nfl_route.py
git commit -m "feat(python): serve /nfl/<id>/process through NFLPlayProcess"
```

---

### Task 3: Capture the NFL render fixture

**Files:**
- Create: `astro/test/fixtures/game-401772944-nfl.json.gz`
- Modify: `astro/test/fixtures/README.md` (add a provenance entry)

**Interfaces:**
- Produces: a gzipped `ProcessedGame` JSON exactly as `/nfl/401772944/process` returns it (LV @ DEN, 2025 REG week 10, completed), consumed by Task 8's render test through the same `wrappedFetch` mock the CFB render test uses.

- [ ] **Step 1: Capture from the Flask test client (no server needed)**

Run:
```bash
cd /mnt/sdv_repos/gop-nfl-wt/python && PYTHON_HTTP_TOKEN=test ./.venv/bin/python - <<'PY'
import base64, gzip, app
c = app.app.test_client()
r = c.get("/nfl/401772944/process", headers={"Authorization": "Bearer " + base64.b64encode(b"test").decode()})
assert r.status_code == 200, r.status_code
raw = r.get_data()
with gzip.open("../astro/test/fixtures/game-401772944-nfl.json.gz", "wb") as fh: fh.write(raw)
print(len(raw), "bytes json")
PY
ls -la astro/test/fixtures/
```
Expected: a file well under 1 MB (the CFB fixture is the size reference).

- [ ] **Step 2: Document provenance**

Append to `astro/test/fixtures/README.md`:

```markdown
## game-401772944-nfl.json.gz

`GET /nfl/401772944/process` from the Flask app (this repo, `python/app.py`) on
2026-09-09 against ESPN's live summary for Las Vegas Raiders @ Denver Broncos,
2025 REG week 10 (final). Captured through `app.test_client()` so it is exactly
the bytes the Astro side receives. Used by `test/nflGamePage.render.test.ts`.
```

- [ ] **Step 3: Commit**

```bash
git add astro/test/fixtures/game-401772944-nfl.json.gz astro/test/fixtures/README.md
git commit -m "test(nfl): capture a processed NFL game fixture for render tests"
```

---

### Task 4: `utils/league.ts`

**Files:**
- Create: `astro/src/utils/league.ts`
- Test: `astro/test/league.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export type League = 'cfb' | 'nfl';
  export const DEFAULT_LEAGUE: League = 'cfb';
  export interface LeagueConfig {
      slug: League; name: string; shortName: string;
      urlPrefix: '' | '/nfl';
      espnPath: 'college-football' | 'nfl';       // cdn.espn.com/core/<espnPath>/…, espn.com/<espnPath>/…
      espnCoreLeague: 'college-football' | 'nfl'; // sports.core.api.espn.com/v2/sports/football/leagues/<…>
      scoreboardQuery: string;                    // extra query for cdn scoreboard; cfb: 'group=80&limit=1000&', nfl: ''
      defaultGroup: number | null;                // cfb 80; nfl null (no conference grouping)
      scoreboardCacheKey: string;                 // KV key; cfb keeps 'scoreboard'
      sdvApiBase: string;                         // 'https://data.sportsdataverse.org/v1/<slug>'
      sdvEnabled: boolean;                        // nfl false until Plan B publishes the tables
      seasons: number[];                          // AVAILABLE_SEASONS for cfb; range(2002, CURRENT_YEAR) for nfl
      regularSeasonWeeks: number; postseasonWeeks: number; // cfb 15/1, nfl 18/5
  }
  export const LEAGUES: Record<League, LeagueConfig>;
  export function splitLeague(pathname: string): { league: League; rest: string };  // '/nfl/game/1' -> {nfl,'/game/1'}; '/nfl' -> {nfl,'/'}; '/nflx' -> {cfb,'/nflx'}
  export function leaguePath(league: League | undefined, path: string): string;     // ('nfl','/game/1') -> '/nfl/game/1'; ('cfb', p) -> p; ('nfl','/') -> '/nfl'
  export function leagueFromLocation(): League;                                      // client-side (Svelte): splitLeague(window.location.pathname).league; 'cfb' when window is undefined
  ```

- [ ] **Step 1: Write the failing test**

```ts
// astro/test/league.test.ts
import { describe, expect, test } from 'vitest';
import { LEAGUES, leaguePath, splitLeague } from '../src/utils/league';

describe('splitLeague', () => {
    test('strips the nfl prefix and keeps everything else', () => {
        expect(splitLeague('/nfl/game/401772944')).toEqual({ league: 'nfl', rest: '/game/401772944' });
        expect(splitLeague('/nfl')).toEqual({ league: 'nfl', rest: '/' });
        expect(splitLeague('/nfl/')).toEqual({ league: 'nfl', rest: '/' });
        expect(splitLeague('/game/1')).toEqual({ league: 'cfb', rest: '/game/1' });
        expect(splitLeague('/nflx/anything')).toEqual({ league: 'cfb', rest: '/nflx/anything' });
        expect(splitLeague('/')).toEqual({ league: 'cfb', rest: '/' });
    });
});

describe('leaguePath', () => {
    test('is the identity for cfb and undefined', () => {
        expect(leaguePath('cfb', '/game/1')).toBe('/game/1');
        expect(leaguePath(undefined, '/teams/')).toBe('/teams/');
    });
    test('prefixes nfl and collapses the root', () => {
        expect(leaguePath('nfl', '/game/1?span=q1')).toBe('/nfl/game/1?span=q1');
        expect(leaguePath('nfl', '/')).toBe('/nfl');
        expect(leaguePath('nfl', '/nfl/game/1')).toBe('/nfl/game/1'); // never double-prefixes
    });
});

describe('LEAGUES', () => {
    test('cfb keeps every value the site uses today', () => {
        expect(LEAGUES.cfb).toMatchObject({ urlPrefix: '', espnPath: 'college-football', defaultGroup: 80, scoreboardCacheKey: 'scoreboard', sdvEnabled: true, sdvApiBase: 'https://data.sportsdataverse.org/v1/cfb' });
        expect(LEAGUES.cfb.scoreboardQuery).toBe('group=80&limit=1000&');
    });
    test('nfl differs only where ESPN and the data differ', () => {
        expect(LEAGUES.nfl).toMatchObject({ urlPrefix: '/nfl', espnPath: 'nfl', espnCoreLeague: 'nfl', defaultGroup: null, scoreboardQuery: '', scoreboardCacheKey: 'scoreboard:nfl', sdvEnabled: false, regularSeasonWeeks: 18, postseasonWeeks: 5 });
        expect(LEAGUES.nfl.seasons[0]).toBe(2002);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run test/league.test.ts`
Expected: FAIL — cannot resolve `../src/utils/league`.

- [ ] **Step 3: Implement**

```ts
// astro/src/utils/league.ts
import { AVAILABLE_SEASONS, CURRENT_YEAR } from './constants';

export type League = 'cfb' | 'nfl';
export const DEFAULT_LEAGUE: League = 'cfb';

export interface LeagueConfig {
    slug: League;
    name: string;
    shortName: string;
    urlPrefix: '' | '/nfl';
    espnPath: 'college-football' | 'nfl';
    espnCoreLeague: 'college-football' | 'nfl';
    scoreboardQuery: string;
    defaultGroup: number | null;
    scoreboardCacheKey: string;
    sdvApiBase: string;
    sdvEnabled: boolean;
    seasons: number[];
    regularSeasonWeeks: number;
    postseasonWeeks: number;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const LEAGUES: Record<League, LeagueConfig> = {
    cfb: {
        slug: 'cfb', name: 'College Football', shortName: 'CFB', urlPrefix: '',
        espnPath: 'college-football', espnCoreLeague: 'college-football',
        scoreboardQuery: 'group=80&limit=1000&', defaultGroup: 80, scoreboardCacheKey: 'scoreboard',
        sdvApiBase: 'https://data.sportsdataverse.org/v1/cfb', sdvEnabled: true,
        seasons: AVAILABLE_SEASONS, regularSeasonWeeks: 15, postseasonWeeks: 1,
    },
    nfl: {
        slug: 'nfl', name: 'NFL', shortName: 'NFL', urlPrefix: '/nfl',
        espnPath: 'nfl', espnCoreLeague: 'nfl',
        scoreboardQuery: '', defaultGroup: null, scoreboardCacheKey: 'scoreboard:nfl',
        sdvApiBase: 'https://data.sportsdataverse.org/v1/nfl', sdvEnabled: false,
        // ESPN play-by-play for the NFL is reliable from the 2002 realignment on
        seasons: range(2002, CURRENT_YEAR), regularSeasonWeeks: 18, postseasonWeeks: 5,
    },
};

/** '/nfl/game/1' -> { nfl, '/game/1' }; anything else is cfb, untouched. */
export function splitLeague(pathname: string): { league: League; rest: string } {
    const p = LEAGUES.nfl.urlPrefix;
    if (pathname === p || pathname === p + '/') return { league: 'nfl', rest: '/' };
    if (pathname.startsWith(p + '/')) return { league: 'nfl', rest: pathname.slice(p.length) };
    return { league: 'cfb', rest: pathname };
}

/** Prefix a site path for a league. cfb is the identity so existing links never change. */
export function leaguePath(league: League | undefined, path: string): string {
    const prefix = LEAGUES[league ?? DEFAULT_LEAGUE].urlPrefix;
    if (!prefix || path.startsWith(prefix + '/') || path === prefix) return path;
    if (path === '/') return prefix;
    return prefix + path;
}

/** Client-side (Svelte) league detection; SSR has Astro.locals.league instead. */
export function leagueFromLocation(): League {
    if (typeof window === 'undefined') return DEFAULT_LEAGUE;
    return splitLeague(window.location.pathname).league;
}
```

Check `constants.ts` exports `AVAILABLE_SEASONS` and `CURRENT_YEAR` (it does, lines 3–5).

- [ ] **Step 4: Run tests**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run test/league.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add astro/src/utils/league.ts astro/test/league.test.ts
git commit -m "feat(league): league config, path split and prefix helpers"
```

---

### Task 5: Middleware rewrite `/nfl/*` → routes with `locals.league`

> **Superseded 2026-09-09** (review on #229): no middleware rewrite. The NFL is
> explicit pages under `pages/nfl/**` (one thin page per cfb page) that set
> `Astro.locals.league` and render shared route components in
> `components/routes/`, with page-side decisions (redirect/404/cache) in
> `src/routes/*.ts`. Pinned by `test/explicitRoutes.test.ts`.

**Files:**
- Modify: `astro/src/middleware.ts` (the block starting `let previewRewrite` ~line 55–80, and the final `next()` call)
- Modify: `astro/src/env.d.ts:14-19` (`Locals` gains `league?: League`)
- Test: `astro/test/leagueMiddleware.test.ts` (new). Read `astro/test/previewFlow.test.ts` first for how `onRequest` is invoked with a fake context in this repo, and reuse that helper shape.

**Interfaces:**
- Produces: for any request whose pathname is `/nfl` or starts with `/nfl/`, `context.locals.league === 'nfl'` and the response is `context.rewrite(rest + url.search)`; every other request has `context.locals.league === 'cfb'`. The preview surface composes: `/preview/nfl/game/1` → preview + nfl + rewrite to `/game/1`.

- [ ] **Step 1: Write the failing test**

Open `astro/test/previewFlow.test.ts`, copy its context-building helper (the function that builds `{ request, url, locals, cookies, redirect, rewrite, ... }` and calls `onRequest(ctx, next)`), and write:

```ts
// astro/test/leagueMiddleware.test.ts
import { describe, expect, test } from 'vitest';
// import { makeCtx, runMiddleware } from the same helpers previewFlow.test.ts uses (copy them here; do not edit that file)

describe('league prefix rewrite', () => {
    test('/nfl/game/1 sets locals.league=nfl and rewrites to /game/1', async () => {
        const { ctx, rewrites } = await runMiddleware('https://gameonpaper.com/nfl/game/1?span=q1');
        expect(ctx.locals.league).toBe('nfl');
        expect(rewrites).toEqual(['/game/1?span=q1']);
    });
    test('/nfl alone is the nfl scoreboard', async () => {
        const { ctx, rewrites } = await runMiddleware('https://gameonpaper.com/nfl');
        expect(ctx.locals.league).toBe('nfl');
        expect(rewrites).toEqual(['/']);
    });
    test('cfb paths are untouched', async () => {
        const { ctx, rewrites } = await runMiddleware('https://gameonpaper.com/game/1');
        expect(ctx.locals.league).toBe('cfb');
        expect(rewrites).toEqual([]);
    });
    test('/nflx is not the nfl', async () => {
        const { ctx } = await runMiddleware('https://gameonpaper.com/nflx');
        expect(ctx.locals.league).toBe('cfb');
    });
});
```

`runMiddleware` must record every `ctx.rewrite(target)` call into `rewrites` and return `{ ctx, rewrites }`. If `previewFlow.test.ts` has no reusable helper, write a minimal one: `ctx = { request: new Request(url), url: new URL(url), locals: {}, cookies: { get: () => undefined }, redirect: (l, s) => new Response(null, { status: s, headers: { Location: l } }), rewrite: (t) => { rewrites.push(String(t)); return new Response('rw'); } }` and `next = async () => new Response('ok')`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run test/leagueMiddleware.test.ts`
Expected: FAIL — `locals.league` is `undefined`, `rewrites` is `[]`.

- [ ] **Step 3: Implement**

`astro/src/env.d.ts`:
```ts
    interface Locals {
        preview?: boolean;
        adminAuthed?: boolean;
        adminActor?: string;
        /** which league's pages this request renders; set by middleware, 'cfb' when unprefixed */
        league?: import('./utils/league').League;
    }
```

`astro/src/middleware.ts` — import `splitLeague` from `./utils/league`. Immediately after the preview-link block (before `let previewRewrite`), add:

```ts
  // League prefix: /nfl/* renders the SAME page files as the cfb routes with
  // locals.league = 'nfl' (resources and links read it). A rewrite, not a
  // redirect, so the public URL keeps its prefix and Workers Caching keys on
  // it. Runs before the preview surface so /preview/nfl/... composes.
  const split = splitLeague(url.pathname);
  context.locals.league = split.league;
  let leagueRewrite: string | undefined;
  if (split.league !== 'cfb') {
    leagueRewrite = split.rest + url.search;
  }
```

In the preview block, after `const rest = url.pathname.slice(PREVIEW_PATH_PREFIX.length) || '/';` add:
```ts
    const restSplit = splitLeague(rest);
    context.locals.league = restSplit.league;
```
and compute `target` from `restSplit.rest` instead of `rest`.

Where the middleware finally dispatches (find the existing `previewRewrite ? context.rewrite(previewRewrite) : next()` shape near the bottom), make it:
```ts
  const rewriteTo = previewRewrite ?? leagueRewrite;
  const response = rewriteTo ? await context.rewrite(rewriteTo) : await next();
```
keeping every header/telemetry step that follows unchanged. Note: when both apply, `previewRewrite` already had its league prefix stripped above, so it wins.

- [ ] **Step 4: Run the whole suite**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run`
Expected: 208 + 7 + 4 passed, 1 skipped; `previewFlow.test.ts` and `preview.test.ts` unchanged and green.

- [ ] **Step 5: Commit**

```bash
git add astro/src/middleware.ts astro/src/env.d.ts astro/test/leagueMiddleware.test.ts
git commit -m "feat(league): rewrite /nfl/* onto the shared routes with locals.league"
```

---

### Task 6: League-aware resources (`espn.ts`, `python.ts`, `sdv.ts`)

**Files:**
- Modify: `astro/src/resources/espn.ts` — `getRemoteGames` (~392), `getCurrentScoreboard` (~464), `retrieveGamePage` (~510), `retrieveGamePageGuarded` (~541), `retrieveTeamEndpoint` (~607)
- Modify: `astro/src/resources/python.ts` — `retrieveProcessedGame` (843), `processPlays` (~930)
- Modify: `astro/src/resources/sdv.ts` — `SDV_HTTP_URL` (553) and `requestSDV` (566)
- Test: `astro/test/leagueResources.test.ts` (new)

**Interfaces:**
- Produces (all new params trailing, defaulting to `'cfb'`):
  - `getRemoteGames(year, seasontype?, week?, group?, league: League = 'cfb')` — URL `https://cdn.espn.com/core/${LEAGUES[league].espnPath}/schedule?…`; the `group` param is appended only when `LEAGUES[league].defaultGroup !== null`.
  - `getCurrentScoreboard(cacheReadEnabled = true, cacheWriteEnabled = false, league: League = 'cfb')` — KV key `LEAGUES[league].scoreboardCacheKey`; URL `https://cdn.espn.com/core/${espnPath}/scoreboard?${scoreboardQuery}xhr=1&${Date.now()}`.
  - `retrieveGamePage(gameId, league = 'cfb')`, `retrieveGamePageGuarded(gameId, league = 'cfb')` — cdn playbyplay URL uses `espnPath`.
  - `retrieveTeamInformation(teamId, league = 'cfb')`, `retrieveTeamSeasonRecord(season, teamId, league = 'cfb')` — core URL `.../leagues/${espnCoreLeague}...`.
  - `retrieveProcessedGame(gameId, cacheTTL, span?, league: League = 'cfb')` → `processPlays(gameId, cacheTTL, span, league)` → `${PYTHON_HTTP_URL}/${league}/${gameId}/process…` and the same `cacheKey` string with `/${league}/`.
  - `sdv.ts`: `requestSDV(endpoint, query?, body?, cacheTTL, cacheEnabled, league: League = 'cfb')` builds on `LEAGUES[league].sdvApiBase`; every exported `retrieve*` gets a trailing `league` param it forwards. When `!LEAGUES[league].sdvEnabled` the exported functions return their empty value (`[]` / `null`) **without a request** — the NFL tables do not exist yet, and a 404 must not cost a game-page render.

- [ ] **Step 1: Write the failing test**

```ts
// astro/test/leagueResources.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const seen: string[] = [];
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ gamepackageJSON: { header: { competitions: [{ status: { type: { name: 'STATUS_FINAL', completed: true } }, date: '2025-11-06T01:15Z' }] }, drives: {}, plays: [] }, plays: [{ id: '1', scoringPlay: false }], advBoxScore: {}, teamInfo: { home: { id: '7' }, away: { id: '13' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

beforeEach(() => { seen.length = 0; });

describe('python.ts routes by league', () => {
    test('cfb is unchanged, nfl hits /nfl/<id>/process', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        await retrieveProcessedGame(1, 30).catch(() => {});
        await retrieveProcessedGame(2, 30, null, 'nfl').catch(() => {});
        expect(seen.some(u => u.endsWith('/cfb/1/process'))).toBe(true);
        expect(seen.some(u => u.endsWith('/nfl/2/process'))).toBe(true);
    });
});

describe('espn.ts routes by league', () => {
    test('game page and schedule URLs use the league slug', async () => {
        const espn = await import('../src/resources/espn');
        await espn.retrieveGamePage(3).catch(() => {});
        await espn.retrieveGamePage(4, 'nfl').catch(() => {});
        await espn.getRemoteGames(2025, 2, 10, undefined, 'nfl').catch(() => {});
        await espn.getRemoteGames(2025, 2, 10).catch(() => {});
        expect(seen.find(u => u.includes('gameId=3'))).toContain('/core/college-football/playbyplay');
        expect(seen.find(u => u.includes('gameId=4'))).toContain('/core/nfl/playbyplay');
        const nflSched = seen.find(u => u.includes('/core/nfl/schedule'))!;
        expect(nflSched).toBeTruthy();
        expect(nflSched).not.toContain('group=');
        expect(seen.find(u => u.includes('/core/college-football/schedule'))).toContain('group=80');
    });
});

describe('sdv.ts is inert for a league without tables', () => {
    test('nfl returns empties without a request', async () => {
        const sdv = await import('../src/resources/sdv');
        expect(await sdv.retrievePercentiles(undefined, 50, 2025, 'nfl')).toEqual([]);
        expect(await sdv.retrieveTeamSummaries({ season: 2025, league: 'nfl' })).toEqual([]);
        expect(seen.filter(u => u.includes('sportsdataverse.org'))).toEqual([]);
    });
});
```

`requestESPN` in `espn.ts` must route through `wrappedFetch` for the mock to see it — confirm by reading `requestESPN`; if it calls `fetch` directly, mock `globalThis.fetch` in the same way instead and keep the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run test/leagueResources.test.ts`
Expected: FAIL — `/nfl/2/process` never requested; nfl playbyplay URL still `college-football`; TS errors on the extra args.

- [ ] **Step 3: Implement**

`python.ts`:
```ts
import { LEAGUES, type League } from '../utils/league';
export async function retrieveProcessedGame(gameId: string | number, cacheTTL: number, span?: string | null, league: League = 'cfb'): Promise<ProcessedGame> {
    const processed: ProcessedGame = await processPlays(gameId, cacheTTL, span, league);
    ...
async function processPlays(gameId: string | number, cacheTTL: number, span?: string | null, league: League = 'cfb'): Promise<ProcessedGame> {
    ...
    const req = await wrappedFetch(`${PYTHON_HTTP_URL}/${league}/${gameId}/process${spanQ}`, {
        ...
            cacheKey: `${PYTHON_HTTP_URL}/${league}/${gameId}/process?v=${APP_VERSION}${span ? `&span=${span}` : ''}`,
```

`espn.ts` — add `import { LEAGUES, type League } from '../utils/league';` then:
```ts
export async function getRemoteGames(year: number, seasontype?: number, week?: number, group?: number, league: League = 'cfb'): Promise<ESPNScheduleEvent[]> {
    const cfg = LEAGUES[league];
    ...
    if (cfg.defaultGroup !== null) {           // replaces the unconditional group append
        query.append("group", `${espnGroup || cfg.defaultGroup}`);
    }
    ...
    const reqURL = `https://cdn.espn.com/core/${cfg.espnPath}/schedule?` + query.toString()

export async function getCurrentScoreboard(cacheReadEnabled = true, cacheWriteEnabled = false, league: League = 'cfb'): Promise<ESPNScheduleEvent[]> {
    const cfg = LEAGUES[league];
    // KV reads/writes use cfg.scoreboardCacheKey instead of the literal "scoreboard"
    const resp = await requestESPN(`https://cdn.espn.com/core/${cfg.espnPath}/scoreboard?${cfg.scoreboardQuery}xhr=1&${(new Date()).getTime()}`)

export async function retrieveGamePage(gameId: string | number, league: League = 'cfb'): Promise<ESPNPlayByPlayResponse> {
    const req = await requestESPN(`https://cdn.espn.com/core/${LEAGUES[league].espnPath}/playbyplay?gameId=${gameId}&xhr=1&render=false&userab=18`);

export async function retrieveGamePageGuarded(gameId: string | number, league: League = 'cfb'): Promise<GuardedGamePage> {
    // forward league to retrieveGamePage; the KV "last good payload" key used by
    // the guard must include the league for nfl: `${league === 'cfb' ? '' : league + ':'}${existingKey}`

async function retrieveTeamEndpoint(payload: ESPNTeamRequestPayload): Promise<any> {   // payload gains optional league
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/${LEAGUES[payload.league ?? 'cfb'].espnCoreLeague}${seasonStr}${seasonType}/teams/${payload.teamId}/${endpoint}?lang=en&region=us`
export async function retrieveTeamInformation(teamId: string | number, league: League = 'cfb')
export async function retrieveTeamSeasonRecord(season: string | number, teamId: string | number, league: League = 'cfb')
```
Read `retrieveGamePageGuarded` before editing: it stores the last-good payload in KV keyed by game id; the key must be league-qualified for nfl so an NFL game id can never collide with a CFB one (ESPN ids are globally unique in practice, but the guard's contract should not depend on that).

`sdv.ts`:
```ts
import { LEAGUES, type League } from '../utils/league';
// delete the SDV_HTTP_URL constant; requestSDV builds from the league
async function requestSDV(endpoint: string, query?: URLSearchParams, body?: URLSearchParams, cacheTTL = 60, cacheEnabled = true, league: League = 'cfb'): Promise<any> {
    const base = LEAGUES[league].sdvApiBase;
    let endpointURL = `${base}/${endpoint}` ... // wherever SDV_HTTP_URL was concatenated
```
Add `league: League = 'cfb'` as the trailing parameter of `retrievePercentiles`, `retrievePlayerSummaries`, `retrieveTeam`, `retrieveTeamGames`, `retrieveMatchupHistory`, `retrieveTeamSchedule`, `retrieveTeamSeasonInformation`, and an optional `league?: League` field on `SDVTeamSummaryRequest` (used by `retrieveTeamSummaries`) and `SDVTeamScheduleRequest`. At the top of each exported function:
```ts
    if (!LEAGUES[league].sdvEnabled) return [];   // or null for the single-object returns
```
and pass `league` to `requestSDV`. `SDV_MAX_LOOKBACK_YEAR` and every other constant stay.

- [ ] **Step 4: Run the whole suite**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run`
Expected: all previous tests green + 4 new. `gamePage.render.test.ts` still mocks `wrappedFetch` on `/cfb/401729745/process` — it must still pass, proving the CFB path is unchanged.

- [ ] **Step 5: Commit**

```bash
git add astro/src/resources/espn.ts astro/src/resources/python.ts astro/src/resources/sdv.ts astro/test/leagueResources.test.ts
git commit -m "feat(league): thread the league through the ESPN, Python and SDV resources"
```

---

### Task 7: Pages and components read `Astro.locals.league`

**Files:**
- Modify: `astro/src/pages/index.astro`, `astro/src/pages/game/[id].astro`, `astro/src/pages/game/matchup.astro`, `astro/src/pages/year/[year]/type/[type]/week/[week].astro`
- Modify: `astro/src/components/game/GamePage.astro` (Gamecast link, 2× og/twitter image, Matchup Preview link, `retrieveProcessedGame`/`retrievePercentiles` calls if any inside), `astro/src/components/game/PreGamePage.astro` (2× stitcher image + any `/game/` links), `astro/src/components/game/classic/GamePage.astro` (3 sites), `astro/src/components/schedule/SchedulePage.astro` (title + canonical), `astro/src/components/schedule/GameThumb.astro`, `astro/src/components/schedule/GameCompactRow.astro`, `astro/src/components/schedule/ScheduleDropdown.svelte`, `astro/src/components/game/plays/PlayRow.astro`, `astro/src/components/game/classic/PlayRow.astro`, `astro/src/components/game/metrics/{BinionBoxScore,Linescore,PenaltyBreakdown,SituationalSplits,TeamMetricsTable,TraditionalTeamStats}.astro` (each has 1 `/glossary…` or `/team/…` link), `astro/src/components/game/MatchupHistoryTable.astro`, `astro/src/components/game/MatchupBuilder.svelte`, `astro/src/components/Header.astro`, `astro/src/components/Footer.astro`, `astro/src/components/team/TeamCard.astro` (1 link; TeamCard is rendered inside GamePage/PreGamePage panels)
- Test: covered by Task 8's render tests.

**Interfaces:**
- Consumes: `Astro.locals.league` (Task 5), `leaguePath`/`LEAGUES`/`leagueFromLocation` (Task 4), league params on resources (Task 6).
- Produces: every internal `href` in the files above is `leaguePath(league, '/…')`; every ESPN external URL uses `LEAGUES[league].espnPath`; `Header` shows a CFB | NFL switcher.

- [ ] **Step 1: Pages**

`pages/index.astro`:
```astro
import { LEAGUES } from "../utils/league";
const league = Astro.locals.league ?? 'cfb';
const cfg = LEAGUES[league];
...
    games = await getCurrentScoreboard(true, true, league);
    Astro.cache.set({ ..., tags: ["favorites-enabled", "scoreboard", `league:${league}`] });
...
<SchedulePage title={`${cfg.name} | Game on Paper`} season={CURRENT_YEAR} week={games[0]?.week?.number} seasontype={games[0]?.season?.type} isScoreboard={true} games={games} />
```
(`title` was the literal `"College Football | Game on Paper"`.)

`pages/game/[id].astro`:
```astro
const league = Astro.locals.league ?? 'cfb';
...
    return Astro.redirect(leaguePath(league, "/"));
...
    const guarded = await retrieveGamePageGuarded(id, league);
...
                stack: null, path: leaguePath(league, `/game/${id}`), game_id: String(id), context: null } });
...
        game = await retrieveProcessedGame(id, config.maxAge || 30, spanKey, league);
```
and the three ErrorPage `message` strings that say `https://www.espn.com/college-football/game/_/gameId/${id}` become `https://www.espn.com/${LEAGUES[league].espnPath}/game/_/gameId/${id}`. Pass `league={league}` to `<GamePage>`, `<GamePageClassic>` and `<PreGamePage>` (add `league?: League` to each `Props` interface; default `'cfb'` inside).

`pages/year/[year]/type/[type]/week/[week].astro`:
```astro
const league = Astro.locals.league ?? 'cfb';
const cfg = LEAGUES[league];
let groupRaw = Astro.url.searchParams.get("group") || String(cfg.defaultGroup ?? "");
const group = cfg.defaultGroup === null ? undefined : parseInt(groupRaw || `${cfg.defaultGroup}`);
...
    games = await getRemoteGames(season, seasontype, weekCleaned, group, league);
```
`pages/game/matchup.astro`: `const league = Astro.locals.league ?? 'cfb';` and forward `league` to every `retrieveTeamSeasonInformation`/`retrieveTeamSummaries`/`retrieveTeamGames` call (they return empties for nfl in this plan — the page renders its empty state; Plan C fills it). Change the `/team/` and `/game/` hrefs in `MatchupBuilder.svelte` to `leaguePath(leagueFromLocation(), …)` and `window.location = leaguePath(leagueFromLocation(), \`/game/matchup?…\`)`.

- [ ] **Step 2: Game-page components**

In `GamePage.astro`, `PreGamePage.astro`, `classic/GamePage.astro`: add to `Props` `league?: League`, `const league = Astro.props.league ?? Astro.locals.league ?? 'cfb'; const cfg = LEAGUES[league];`, and replace:
- `https://www.espn.com/college-football/game/_/gameId/${id}` → `https://www.espn.com/${cfg.espnPath}/game/_/gameId/${id}`
- `https://s.espncdn.com/stitcher/sports/football/college-football/events/${id}.png…` → `https://s.espncdn.com/stitcher/sports/football/${cfg.espnPath}/events/${id}.png…` (both og and twitter, in all three files)
- `/game/matchup?${…}` → `leaguePath(league, \`/game/matchup?${…}\`)`
- `canonicalUrl` builders that use `Astro.url.pathname`: use `Astro.originPathname` (the pre-rewrite path, so `/nfl/game/1` stays canonical). Same in `SchedulePage.astro` line 37.

Every other listed component: `const league = Astro.locals.league ?? 'cfb';` at the top of the frontmatter and wrap the one internal href: `href={leaguePath(league, \`/game/${espnGame.id}\`)}` (GameThumb 155, GameCompactRow), `href={leaguePath(league, \`/glossary#…\`)}` (the metrics files), `/team/${…}` (TeamCard, MatchupHistoryTable, PlayRow if it links a team). Read each site before editing; the grep on `href=(\{`|")/(game|team|teams|year|charts|glossary|changelog)` lists them.

`ScheduleDropdown.svelte`: it navigates with `window.location = \`/year/…\``; wrap with `leaguePath(leagueFromLocation(), …)`. Read its props: if it renders the CFB conference/group selector, hide that block when `leagueFromLocation() === 'nfl'` and cap the week list at `LEAGUES.nfl.regularSeasonWeeks` / `postseasonWeeks` (pass `league` as a prop from `SchedulePage.astro` rather than sniffing, since SchedulePage has `Astro.locals`).

- [ ] **Step 3: Header + Footer**

`Header.astro`:
```astro
---
import { AVAILABLE_SEASONS, LAST_YEAR } from "../utils/constants";
import { LEAGUES, leaguePath, type League } from "../utils/league";
const league: League = Astro.locals.league ?? 'cfb';
const cfg = LEAGUES[league];
const METRIC_YEAR = LAST_YEAR;
const lp = (p: string) => leaguePath(league, p);
const other: League = league === 'cfb' ? 'nfl' : 'cfb';
---
```
- Brand link → `href={lp("/")}`; add right after the brand a small toggle: `<a class="badge rounded-pill text-bg-secondary text-decoration-none ms-2" href={leaguePath(other, "/")} title={`Switch to ${LEAGUES[other].name}`}>{cfg.shortName} ▸ {LEAGUES[other].shortName}</a>`.
- Every `href="/…"` / `href={`/…`}` in the nav → `lp(...)`.
- The Leaderboards, Charts, Seasons-by-year, Teams and Matchup Builder items are wrapped in `{cfg.sdvEnabled && (...)}` — they 404/empty for the NFL until Plan C, and the nav must not link to pages that don't work. Scoreboard, Glossary, Changelog stay for both. Add an NFL-only "Weeks" dropdown: `{!cfg.sdvEnabled && (<li class="nav-item dropdown">… {Array.from({length: cfg.regularSeasonWeeks}, (_, i) => i + 1).map(w => <li><a class="dropdown-item" href={lp(\`/year/${LAST_YEAR}/type/2/week/${w}\`)}>Week {w}</a></li>)} …</li>)}`.
- The game-id search box (line 59) submits to the game page; find its handler in `Scripts.astro` or inline and prefix with `leaguePath(leagueFromLocation(), …)`.

`Footer.astro`: the one `college-football` reference — read the line; if it is an ESPN attribution URL, use `LEAGUES[Astro.locals.league ?? 'cfb'].espnPath`; if it is prose ("college football"), make it `{cfg.name}`.

- [ ] **Step 4: Run the suite**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run`
Expected: everything green (the CFB render tests exercise these components with `locals.league` undefined → cfb → identical HTML).

- [ ] **Step 5: Commit**

```bash
git add astro/src/pages astro/src/components astro/src/layouts
git commit -m "feat(nfl): league-aware links, ESPN paths and header switcher on the shared pages"
```
(Stage only the files you edited — list them explicitly if `git status` shows anything else.)

---

### Task 8: NFL render tests

**Files:**
- Create: `astro/test/nflGamePage.render.test.ts`
- Create: `astro/test/nflScoreboard.render.test.ts`

**Interfaces:**
- Consumes: Task 3 fixture; Task 6 `retrieveProcessedGame(id, ttl, span, 'nfl')`; Task 7 components.

- [ ] **Step 1: Write the game-page render test**

```ts
// astro/test/nflGamePage.render.test.ts
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// Mirror of gamePage.render.test.ts for the NFL: a REAL ProcessedGame from
// /nfl/401772944/process (LV @ DEN, 2025 wk 10) through the shared component
// tree with locals.league = 'nfl'. Proves (a) the NFL record shape renders the
// CFB components, (b) every internal link carries the /nfl prefix, (c) no
// college-football ESPN URL leaks into an NFL page.
const GAME_ID = 401772944;
const apiPayload = gunzipSync(readFileSync(new URL('./fixtures/game-401772944-nfl.json.gz', import.meta.url))).toString();
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (!String(url).includes(`/nfl/${GAME_ID}/process`)) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(apiPayload, { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

describe('GamePage renders a finished NFL game', () => {
    let html = '';
    beforeAll(async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game = await retrieveProcessedGame(GAME_ID, 30, null, 'nfl');
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        html = await container.renderToString(GamePage, {
            props: { id: GAME_ID, game, league: 'nfl' },
            request: new Request(`https://gameonpaper.com/nfl/game/${GAME_ID}`),
            locals: { league: 'nfl' },
        });
    }, 60_000);

    test('the whole document arrives', () => {
        expect(html.length).toBeGreaterThan(100_000);
        expect(html).toContain('</html>');
    });
    test('teams and box score sections are present', () => {
        expect(html).toContain('Raiders');
        expect(html).toContain('Broncos');
        for (const anchor of ['#drives', '#all-plays']) expect(html).toContain(`href="${anchor}"`);
    });
    test('links are league-prefixed and ESPN URLs are the NFL ones', () => {
        expect(html).toContain('/nfl/game/matchup?');
        expect(html).toContain('https://www.espn.com/nfl/game/_/gameId/401772944');
        expect(html).toContain('sports/football/nfl/events/401772944.png');
        expect(html).not.toContain('college-football');
        expect(html).not.toMatch(/href="\/game\/\d+"/);
    });
});
```

- [ ] **Step 2: Write the scoreboard render test**

Read `astro/test/scoreboard.render.test.ts` first and copy its structure (how it feeds `SchedulePage` a fixture list of ESPN events). Then:

```ts
// astro/test/nflScoreboard.render.test.ts  (same imports/container setup as above)
describe('SchedulePage renders the NFL scoreboard', () => {
    test('title and game links are NFL', async () => {
        const { default: SchedulePage } = await import('../src/components/schedule/SchedulePage.astro');
        const games = [/* copy ONE event object from scoreboard.render.test.ts's fixture, id 401772944, team names Raiders/Broncos */];
        const html = await container.renderToString(SchedulePage, {
            props: { title: 'NFL | Game on Paper', season: 2025, week: 10, seasontype: 2, isScoreboard: true, games },
            request: new Request('https://gameonpaper.com/nfl'),
            locals: { league: 'nfl' },
        });
        expect(html).toContain('<title>NFL | Game on Paper</title>');
        expect(html).toContain('href="/nfl/game/401772944"');
        expect(html).not.toContain('href="/game/401772944"');
        expect(html).toContain('href="/nfl"');       // brand / scoreboard link
        expect(html).not.toContain('/year/2025/teams/differential'); // leaderboards hidden until the NFL tables exist
    });
});
```

- [ ] **Step 3: Run the two tests**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run test/nflGamePage.render.test.ts test/nflScoreboard.render.test.ts`
Expected: PASS. Any failure here is a real gap in Task 7 — fix the component, not the assertion. Use `DUMP_HTML=/tmp/nfl.html` (copy the same env hook the CFB test has) to inspect.

- [ ] **Step 4: Full suite**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run`
Expected: 208 baseline + 7 (league) + 4 (middleware) + 4 (resources) + 4 (nfl render) + 1 (scoreboard) passed, 1 skipped.

- [ ] **Step 5: Commit**

```bash
git add astro/test/nflGamePage.render.test.ts astro/test/nflScoreboard.render.test.ts
git commit -m "test(nfl): render the NFL game page and scoreboard end to end"
```

---

### Task 9: Ops touch-points that already fan out by URL

**Files:**
- Modify: `astro/src/pages/admin/api/purge-game.ts` — it purges `/game/<id>` cache tags/URLs; read it and make it accept `league` (query or body field, default `cfb`) and purge `leaguePath(league, \`/game/${id}\`)` as well as the Python cache key with `/${league}/`.
- Modify: `astro/src/pages/sitemap.xml.ts` — add `{ loc: '/nfl', lastmod: today, changefreq: 'hourly', priority: '0.8' }` only. (NFL season/team URLs come with Plan C.)
- Modify: `CHANGELOG` page: `astro/src/pages/changelog/2026-09-09.md` (new, same front-matter shape as `2026-08-12.md`): "NFL: scoreboard, week schedules and game pages at /nfl, powered by ESPN through sportsdataverse-py's NFLPlayProcess. Season leaderboards and team pages follow."
- Test: `astro/test/sitemap.test.ts` exists and MUST NOT change — read it first; if it asserts an exact URL count, add the NFL entry in a way its assertions allow (e.g. it counts `/year/` entries only) or defer the sitemap line to Plan C and say so in the commit body.

- [ ] **Step 1: Read the three files, apply the edits above**
- [ ] **Step 2: Run the suite**

Run: `cd /mnt/sdv_repos/gop-nfl-wt/astro && npx vitest run`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add astro/src/pages/admin/api/purge-game.ts astro/src/pages/sitemap.xml.ts astro/src/pages/changelog/2026-09-09.md
git commit -m "feat(nfl): purge, sitemap and changelog entries for the /nfl surface"
```

---

### Task 10: Push, PR, CI

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/nfl
```

- [ ] **Step 2: Open the PR** (body in plain prose; no generated-with footer)

```bash
gh pr create --title "feat(nfl): NFL scoreboard, weeks and game pages at /nfl (ESPN via NFLPlayProcess)" --body-file - <<'MD'
## What
An NFL surface at `/nfl`: scoreboard, week schedules and full game pages (advanced box scores, drives, plays, WP/EP charts), served by the existing components. Design: `docs/superpowers/specs/2026-09-09-nfl-branch-design.md`; this is phases 1–2 of it.

## How
- Middleware rewrites `/nfl/*` onto the shared page files with `locals.league = 'nfl'` (same mechanism as `/preview/*`). Public URLs keep the prefix; Workers Caching keys on it.
- `espn.ts` / `python.ts` / `sdv.ts` take a trailing `league` argument defaulting to `'cfb'` — every CFB URL, KV key and cache key is byte-identical (no existing test changed).
- Flask: the record reshaper is extracted from the CFB route and `/nfl/<id>/process` runs `sportsdataverse.nfl.NFLPlayProcess` through it. `success` is derived (EPA > 0) because the NFL processor doesn't emit it.
- The header shows a CFB | NFL switcher; NFL leaderboards / team / chart links are hidden until the season tables exist (plan B/C), so nothing in the nav 404s.

## Verified
- vitest: baseline 208 + 20 new, all green (NFL game page and scoreboard rendered end to end from a captured `/nfl/401772944/process` payload).
- pytest: 29 + 5.
- Live smoke from the droplet: `/nfl/401772944/process` → 200, 175 plays, 8 box-score sections, 3.2 s.
- Not verified locally: `astro check`/`build` (node 20 here) — CI.

## Out of scope (next plans)
NFL season leaderboards, team pages, chart builder, percentiles (needs the `nfl-data` producer + sdv-db endpoints), rbsdm categories, backfill.
MD
```

- [ ] **Step 3: Watch CI**

Run: `gh pr checks --watch` (or `gh run list -b feat/nfl -L 3`). Expected: `test` green. If `astro check` fails on a template, fix in the worktree and push — that is the one class of error the droplet cannot see.

---

## Self-review (done at plan-writing time)

**Spec coverage (phases 1–2):** §3.1 Python route + reshape extraction → Tasks 1–2; §3.2 `league.ts` → Task 4; middleware → Task 5; resources → Task 6; pages/components/header → Task 7; render tests → Task 8; purge/sitemap → Task 9; §3.5 deploy needs nothing. `static/nfl_teams.json`, `constants` categories, team/leaderboard pages, glossary extras are Plan C (they need the season tables) — intentionally excluded here and the nav hides them.
**Placeholders:** none; Task 7's "read each site before editing" steps are bounded by the grep list and the Task 8 assertions that fail if a link is missed.
**Type consistency:** `League`, `LEAGUES`, `leaguePath`, `splitLeague`, `leagueFromLocation` (Task 4) are the only names used by Tasks 5–8; resource signatures in Task 6 match the calls in Tasks 7–8 (`retrieveProcessedGame(id, ttl, span, league)`, `getCurrentScoreboard(read, write, league)`, `getRemoteGames(year, type, week, group, league)`, `retrieveGamePageGuarded(id, league)`).
