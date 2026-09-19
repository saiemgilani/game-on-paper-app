from functools import wraps
import math

from flask import Flask, request, jsonify, Response, g
from datetime import datetime as dt, timezone as tz
from sportsdataverse.cfb import CFBPlayProcess
from sportsdataverse.nfl import NFLPlayProcess
from flask_compress import Compress
import orjson

import os
import logging
import base64

from telemetry import TEL, stage, init_flask
import gop_routes
import espn_proxy
import dq
import paper_index
import qa
from sportsdataverse.cfb import cfb_drive_summary as drive_summary
from sportsdataverse.cfb import cfb_situational_stats as situational_stats
import span_box

# Source switch (football-sources Stage 4). The allowed values ARE the
# contract's registry -- nothing here enumerates sources, so `shield` (and the
# rest) start working the moment this deploy's sportsdataverse-py pin carries
# their adapter. A pin older than sportsdataverse-py #525 has no contract at
# all; then only ESPN is offered and every other `source` is a 400.
try:
    from sportsdataverse.football.sources.dispatch import SOURCE_ORDER as _SOURCE_ORDER
    from sportsdataverse.football.sources.dispatch import AllSourcesFailed as _ALL_SOURCES_FAILED
    from sportsdataverse.football.sources.dispatch import _process_game as _dispatch_game
except ImportError:  # pragma: no cover - depends on the deployed sdv-py pin
    _SOURCE_ORDER, _dispatch_game, _ALL_SOURCES_FAILED = {}, None, None

# span key -> drive-summary period windows (drives book to their start quarter)
_SPAN_PERIODS = {
    "q1": {1}, "q2": {2}, "q3": {3}, "q4": {4},
    "h1": {1, 2}, "h2": {3, 4}, "ot": "ot",
}

HTTP_TOKEN = os.getenv("PYTHON_HTTP_TOKEN")
assert HTTP_TOKEN, "HTTP_TOKEN not provided, can not start server"

app = Flask(__name__)
app.config["LOG_TYPE"] = os.environ.get("LOG_TYPE", "stream")
app.config["LOG_LEVEL"] = os.environ.get("LOG_LEVEL", "INFO")

app.config["COMPRESS_BR_LEVEL"] = 4
app.config["COMPRESS_LEVEL"] = 5
app.config["COMPRESS_MIN_SIZE"] = 1024
Compress(app)


def _orjson_default(obj):
    """orjson fallback for types its native handling can't serialize.

    OPT_SERIALIZE_NUMPY covers the common numpy types (int*, uint*,
    float32/64, ndarray of those) but trips on object-dtype arrays,
    numpy strings, or numpy scalars in less-common dtypes — which
    pop up when sportsdataverse stores mixed-content lists. Duck-
    typing via tolist()/item() handles these without importing numpy
    (which we dropped above when removing the np.array().tolist()
    wraps in the top-level result dict).
    """
    if hasattr(obj, "tolist"):
        return obj.tolist()
    if hasattr(obj, "item"):
        return obj.item()
    raise TypeError(f"orjson: unsupported type {type(obj).__name__}")


@app.after_request
def after_request(response):
    logger = logging.getLogger("app.access")
    logger.info(
        "[python] %s [%s] %s %s %s",
        request.remote_addr,
        dt.now(tz=tz.utc).strftime("%d/%b/%Y:%H:%M:%S.%f")[:-3],
        request.method,
        request.path,
        response.status,
    )
    return response


init_flask(app, TEL)
TEL.start()
app.register_blueprint(gop_routes.bp)
app.register_blueprint(espn_proxy.bp)


def require_auth_token(func):
    @wraps(func)
    def check_token(*args, **kwargs):
        try:
            headers = request.headers
            bearer = headers.get("Authorization")
            assert bearer, "Bearer Auth not provided in this request"

            raw_token = bearer.split()[1]
            token = base64.b64decode(raw_token).decode("ascii")
            assert token == HTTP_TOKEN, (
                "provided token value did not match expected token"
            )

            # Otherwise just send them where they wanted to go
            return func(*args, **kwargs)
        except Exception as e:
            logging.getLogger("root").error(f"ERROR while checking token: {e}")
            return jsonify({"status": "bad", "message": "Access denied"}), 401

    return check_token


# Flat columns sdv-py adds that the site rebuilds as nested objects below;
# dropped from every record after the fold so the payload carries each once.
_BAD_COLS = [
    "start.distance",
    "start.yardLine",
    "start.team.id",
    "start.down",
    "start.yardsToEndzone",
    "start.posTeamTimeouts",
    "start.defTeamTimeouts",
    "start.defPosTeamTimeouts",
    "start.shortDownDistanceText",
    "start.possessionText",
    "start.downDistanceText",
    "start.pos_team_timeouts",
    "start.def_pos_team_timeouts",
    "clock.displayValue",
    "type.id",
    "type.text",
    "type.abbreviation",
    "end.distance",
    "end.yardLine",
    "end.team.id",
    "end.down",
    "end.yardsToEndzone",
    "end.posTeamTimeouts",
    "end.defTeamTimeouts",
    "end.defPosTeamTimeouts",
    "end.shortDownDistanceText",
    "end.possessionText",
    "end.downDistanceText",
    "end.pos_team_timeouts",
    "end.def_pos_team_timeouts",
    "expectedPoints.before",
    "expectedPoints.after",
    "expectedPoints.added",
    "winProbability.before",
    "winProbability.after",
    "winProbability.added",
    "scoringType.displayName",
    "scoringType.name",
    "scoringType.abbreviation",
]


def _game_drives(processed_game):
    """ESPN's drives grouping in game order, each drive exactly once.

    A live ESPN summary lists the drive in ``drives.current`` inside
    ``drives.previous`` as well (DEN @ KC 401872931, 2026-09-14), so appending
    ``current`` to ``previous`` counted that drive twice: an extra drive for
    the team, a 23rd chart row where 22 drives were played, and every average
    (scoring %, yards, plays, time of possession) skewed. The frontend's drives
    table already dedupes by id; the drive summary never did. First occurrence
    wins, which keeps game order.
    """
    grouping = processed_game.get("drives") or {}
    drives = list(grouping.get("previous") or [])
    if grouping.get("current"):
        drives.append(grouping["current"])
    seen, unique = set(), []
    for drive in drives:
        key = drive.get("id") if isinstance(drive, dict) else None
        if key is not None:
            if key in seen:
                continue
            seen.add(key)
        unique.append(drive)
    return unique


def _frameless_features(game):
    """The frame-dependent features a request loses when ``plays_frame`` is absent.

    Span boxes are listed only when span_box's own lookup also comes up empty:
    it falls back to ``plays_json`` when that is still a polars frame, so the
    log must not report a feature skipped that in fact rendered.
    """
    if getattr(game, "plays_frame", None) is not None:
        return []
    skipped = ["drive summary", "situational stats"]
    if span_box._plays_frame(game) is None:
        skipped.append("span boxes")
    skipped.append("paper index")
    return skipped


def _reshape_records(plays):
    """Fold sdv-py's flat dotted columns back into ESPN's nested shape.

    League-agnostic: CFBPlayProcess and NFLPlayProcess emit the same dotted
    columns for everything read here. Mutates ``plays`` in place; non-finite
    floats become None so orjson emits null rather than raising.
    """
    for record in plays:
        record["clock"] = {
            "displayValue": record["clock.displayValue"],
            "minutes": record["clock.minutes"],
            "seconds": record["clock.seconds"],
        }

        record["type"] = {
            "id": record["type.id"],
            "text": record["type.text"],
            "abbreviation": record["type.abbreviation"],
        }
        record["modelInputs"] = {
            "start": {
                "down": record["start.down"],
                "distance": record["start.distance"],
                "yardsToEndzone": record["start.yardsToEndzone"],
                "TimeSecsRem": record["start.TimeSecsRem"],
                "adj_TimeSecsRem": record["start.adj_TimeSecsRem"],
                "pos_score_diff": record["pos_score_diff_start"],
                "posTeamTimeouts": record["start.posTeamTimeouts"],
                "defTeamTimeouts": record["start.defPosTeamTimeouts"],
                "ExpScoreDiff": record["start.ExpScoreDiff"],
                "ExpScoreDiff_Time_Ratio": record["start.ExpScoreDiff_Time_Ratio"],
                "spread_time": record["start.spread_time"],
                "pos_team_receives_2H_kickoff": record[
                    "start.pos_team_receives_2H_kickoff"
                ],
                "is_home": record["start.is_home"],
                "period": record["period"],
            },
            "end": {
                "down": record["end.down"],
                "distance": record["end.distance"],
                "yardsToEndzone": record["end.yardsToEndzone"],
                "TimeSecsRem": record["end.TimeSecsRem"],
                "adj_TimeSecsRem": record["end.adj_TimeSecsRem"],
                "posTeamTimeouts": record["end.posTeamTimeouts"],
                "defTeamTimeouts": record["end.defPosTeamTimeouts"],
                "pos_score_diff": record["pos_score_diff_end"],
                "ExpScoreDiff": record["end.ExpScoreDiff"],
                "ExpScoreDiff_Time_Ratio": record["end.ExpScoreDiff_Time_Ratio"],
                "spread_time": record["end.spread_time"],
                "pos_team_receives_2H_kickoff": record[
                    "end.pos_team_receives_2H_kickoff"
                ],
                "is_home": record["end.is_home"],
                "period": record["period"],
            },
        }

        record["expectedPoints"] = {
            "before": record["EP_start"],
            "after": record["EP_end"],
            "added": record["EPA"],
        }

        record["winProbability"] = {
            "before": record["wp_before"],
            "after": record["wp_after"],
            "added": record["wpa"],
        }

        record["start"] = {
            "team": {
                "id": record["start.team.id"],
            },
            "pos_team": {
                "id": record["start.pos_team.id"],
                "name": record["start.pos_team.name"],
            },
            "def_pos_team": {
                "id": record["start.def_pos_team.id"],
                "name": record["start.def_pos_team.name"],
            },
            "distance": record["start.distance"],
            "yardLine": record["start.yardLine"],
            "down": record["start.down"],
            "yardsToEndzone": record["start.yardsToEndzone"],
            "homeScore": record["start.homeScore"],
            "awayScore": record["start.awayScore"],
            "pos_team_score": record["start.pos_team_score"],
            "def_pos_team_score": record["start.def_pos_team_score"],
            "pos_score_diff": record["pos_score_diff_start"],
            "posTeamTimeouts": record["start.posTeamTimeouts"],
            "defTeamTimeouts": record["start.defPosTeamTimeouts"],
            "ExpScoreDiff": record["start.ExpScoreDiff"],
            "ExpScoreDiff_Time_Ratio": record["start.ExpScoreDiff_Time_Ratio"],
            # ESPN omits these on kickoff-only payloads (first ~40s of a live game),
            # so sdv-py's frame has no such column at all -- not even a null.
            "shortDownDistanceText": record.get("start.shortDownDistanceText"),
            "possessionText": record.get("start.possessionText"),
            "downDistanceText": record.get("start.downDistanceText"),
            "posTeamSpread": record["start.pos_team_spread"],
        }

        record["end"] = {
            "team": {
                "id": record["end.team.id"],
            },
            "pos_team": {
                "id": record["end.pos_team.id"],
                "name": record["end.pos_team.name"],
            },
            "def_pos_team": {
                "id": record["end.def_pos_team.id"],
                "name": record["end.def_pos_team.name"],
            },
            "distance": record["end.distance"],
            "yardLine": record["end.yardLine"],
            "down": record["end.down"],
            "yardsToEndzone": record["end.yardsToEndzone"],
            "homeScore": record["end.homeScore"],
            "awayScore": record["end.awayScore"],
            "pos_team_score": record["end.pos_team_score"],
            "def_pos_team_score": record["end.def_pos_team_score"],
            "pos_score_diff": record["pos_score_diff_end"],
            "posTeamTimeouts": record["end.posTeamTimeouts"],
            "defPosTeamTimeouts": record["end.defPosTeamTimeouts"],
            "ExpScoreDiff": record["end.ExpScoreDiff"],
            "ExpScoreDiff_Time_Ratio": record["end.ExpScoreDiff_Time_Ratio"],
            "shortDownDistanceText": record.get("end.shortDownDistanceText"),
            "possessionText": record.get("end.possessionText"),
            "downDistanceText": record.get("end.downDistanceText"),
        }

        # remove added columns
        for k in list(record.keys()):
            if k in _BAD_COLS:
                del record[k]
                continue
            v = record[k]
            if isinstance(v, float) and not math.isfinite(v):
                record[k] = None


# league -> (processor class, name of its ESPN fetch method). The pipeline,
# box-score builder and record shape are shared by both sdv-py processors;
# only construction and the fetch differ.
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
            record["success"] = bool(
                isinstance(epa, (int, float)) and math.isfinite(epa) and epa > 0
            )


def _process_game(league: str, game_id: int, source: str | None = None):
    """Process one game. `source` is None for every request the public makes.

    Only Game on Paper's 'source-switch' preview path sends `?source=`, so
    `source is None` keeps the ESPN path -- request, response and cache key --
    exactly as it was. A named source goes through the sportsdataverse-py
    contract's dispatch, which validates the adapted summary and falls through
    the league's order with ESPN as the terminal fallback.
    """
    timings = {}
    order = _SOURCE_ORDER.get(league) or ("espn",)
    if source is not None and source not in order:
        return jsonify(
            {
                "status": "bad",
                "message": f"unknown source {source!r} for {league}; known: {list(order)}",
            }
        ), 400
    try:
        cls, fetch_name = _PROCESSORS[league]
        g.gop_meta = {"game_id": str(game_id), "league": league}
        espn_logged = False
        if source is None or source == "espn":
            # The unchanged path. Deliberately NOT dispatch's espn adapter: that
            # one runs the processor with join_participants=False, which would
            # cost the default response its participant-derived columns.
            game = cls(gameId=game_id)
            game.join_participants = True
            game.resolve_missing = False  ## this doesn't work as expected or there needs to be a way to set this as expected.
            with stage(timings, "espn_fetch"):
                getattr(game, fetch_name)()
            served, fallback_used, processed_game = "espn", False, None
            dispatch_prov = None
        else:
            # dispatch fetches, validates against the contract and runs the
            # processor in one call; ESPN stays the terminal fallback inside it.
            with stage(timings, "espn_fetch"):
                dispatched = _dispatch_game(league, game_id, source=source)
            game, processed_game = dispatched.processor, dispatched.game
            dispatch_prov = dispatched.provenance
            served = dispatch_prov["served"]
            fallback_used = dispatch_prov["fallback"]
        TEL.push(
            "upstream_log",
            {
                "service": "python",
                "target": "espn_pbp" if served == "espn" else f"{served}_pbp",
                "status": 200,
                "duration_ms": timings["espn_fetch_ms"],
                "ok": True,
                "game_id": str(game_id),
                "error": None,
            },
        )
        espn_logged = True
        if processed_game is None:
            with stage(timings, "pipeline"):
                processed_game = game.run_processing_pipeline()

        _fill_success(processed_game["plays"])
        _reshape_records(processed_game["plays"])

        # Additive, and only on the flagged path: a response with no `?source=`
        # stays byte-for-byte what it is today, so the classic game page and
        # every other consumer are untouched.
        if source is not None:
            processed_game["provenance"] = {
                "source": served,
                "requested": source,
                "fallback_used": fallback_used,
                "contract_version": _SDV_VERSION,
                "contract_sha": _SDV_SHA,
            }

        # Every block below reads the processor's enriched polars frame and is
        # fail-open, so a processor that never exposes one (NFLPlayProcess
        # before sportsdataverse-py's plays_frame landed) silently drops them.
        # Say so once per request instead of letting features vanish unlogged.
        skipped = _frameless_features(game)
        if skipped:
            logging.getLogger("root").warning(
                f"{league} processor exposed no plays_frame for {game_id}: {', '.join(skipped)} skipped"
            )

        # Both of these must precede serialization: the span swap mutates
        # processed_game, and everything after `return` is dead code -- which is
        # exactly where the DQ emit sat unnoticed until CodeRabbit flagged the
        # ordering (gop.dq_boxscore had zero rows since #192 merged).
        # StatBroadcast-style drive summary/chart. Cheap (one pass over ~25
        # drives + a few frame aggregations), so it ships on every response;
        # fail-open like everything else on this route.
        try:
            frame = getattr(game, "plays_frame", None)
            drv = _game_drives(processed_game)
            if frame is not None and drv:
                summary = drive_summary.create_drive_summary(
                    drv, frame,
                    frame["homeTeamId"][0], frame["awayTeamId"][0],
                )
                if summary:
                    processed_game["driveSummary"] = summary
        except Exception as e:  # a summary must never cost the page
            logging.getLogger("root").warning(
                f"drive summary failed for {game_id}: {e}"
            )

        # Situational team stats (metrics-note inventory), same contract.
        try:
            frame = getattr(game, "plays_frame", None)
            if frame is not None:
                sit = situational_stats.create_situational_stats(
                    frame, frame["homeTeamId"][0], frame["awayTeamId"][0]
                )
                if sit:
                    processed_game["situationalStats"] = sit
        except Exception as e:  # observability must never cost a render
            logging.getLogger("root").warning(
                f"situational stats failed for {game_id}: {e}"
            )

        # Every standard window's box, drive summary, and situational slice
        # ships on every response, so the frontend switches spans in place
        # without a reload. Window-inherent sections (two-minute, middle-8,
        # pace, non-garbage, 4th-down report) stay on the full-game objects
        # only.
        try:
            boxes = span_box.all_span_boxes(game)
            if boxes:
                processed_game["advBoxScoreSpans"] = boxes
        except Exception as e:  # a bad window must never cost the page
            logging.getLogger("root").warning(
                f"all-span boxes failed for {game_id}: {e}"
            )

        # Paper Index: one who-won-on-paper share from six fitted margins
        # (python/paper_index.py; trained by tools/fit_paper_index.py).
        # Always the FULL game -- a span page still describes the whole game's
        # paper story -- and fail-open like everything else here.
        try:
            frame = getattr(game, "plays_frame", None)
            if frame is not None:
                pidx = paper_index.compute(
                    frame, frame["homeTeamId"][0], frame["awayTeamId"][0], league=league
                )
                if pidx:
                    processed_game["paperIndex"] = pidx
        except Exception as e:  # the index must never cost the page
            logging.getLogger("root").warning(
                f"paper index failed for {game_id}: {e}"
            )

        try:
            frame = getattr(game, "plays_frame", None)
            drv_all = _game_drives(processed_game)
            if frame is not None:
                hid, aid = frame["homeTeamId"][0], frame["awayTeamId"][0]
                ds_spans, sit_spans = {}, {}
                for key, per in _SPAN_PERIODS.items():
                    parsed = span_box.parse_span(key)
                    if parsed is None:
                        continue
                    _, expr = parsed
                    try:  # one bad window must not cost the others
                        if drv_all:
                            w = drive_summary.create_drive_summary(
                                drv_all, frame, hid, aid, periods=per
                            )
                            if w:
                                ds_spans[key] = w
                        w = situational_stats.create_situational_stats(
                            frame, hid, aid, window_expr=expr
                        )
                        if w:
                            sit_spans[key] = w
                    except Exception as e:
                        logging.getLogger("root").warning(
                            f"span summaries window {key} failed: {e}"
                        )
                if ds_spans:
                    processed_game["driveSummarySpans"] = ds_spans
                if sit_spans:
                    processed_game["situationalStatsSpans"] = sit_spans
        except Exception as e:  # a bad window must never cost the page
            logging.getLogger("root").warning(
                f"all-span summaries failed for {game_id}: {e}"
            )

        # Data-quality signal on every response (python/qa.py): the packaged
        # per-game gate when the pin carries it, plus the live-poll rules while
        # the game is running. Additive and fail-open -- a null `qa` is a
        # documented state (docs/qa-payload.md), an exception here is not
        # allowed to cost the page, and the classic twin never reads it.
        try:
            processed_game["qa"] = qa.build(
                game, processed_game, league, game_id,
                provenance=dispatch_prov, sdv_version=_SDV_VERSION, sdv_sha=_SDV_SHA,
            )
            # ...and onto this request's telemetry row, so the route timing and
            # the quality of what it served are one sample rather than two
            # datasets. Inside the same guard: flattening the verdict is still
            # observability, so it must not be the one qa step that can 500.
            g.gop_meta = {**getattr(g, "gop_meta", {}), **qa.telemetry_fields(processed_game["qa"])}
        except Exception as e:  # observability must never cost a render
            logging.getLogger("root").warning(f"qa summary failed for {game_id}: {e}")
            processed_game.setdefault("qa", None)

        try:
            _emit_dq(game_id, game, processed_game)
        except Exception as e:  # observability must never cost a render
            logging.getLogger("root").warning(f"dq emit failed for {game_id}: {e}")

        body_bytes = orjson.dumps(
            processed_game,
            default=_orjson_default,
            option=orjson.OPT_SERIALIZE_NUMPY | orjson.OPT_NON_STR_KEYS,
        )
        response = Response(body_bytes, mimetype="application/json")
        # timings["total"] = time.perf_counter() - request_start
        # response.headers["Server-Timing"] = _server_timing_header(timings)
        response.headers["X-Result-Cache"] = "MISS"
        # _emit_metrics(timings, gameId, 200)
        return response, 200
    except KeyError as e:
        logging.getLogger("root").error(
            "Error while processing PBP on Python side, threw 404: %r (%s)" % (e, e)
        )
        if not locals().get("espn_logged"):  # fetch itself failed; don't double-count
            TEL.push(
                "upstream_log",
                {
                    "service": "python",
                    "target": "espn_pbp",
                    "status": None,
                    "duration_ms": timings.get("espn_fetch_ms"),
                    "ok": False,
                    "game_id": str(game_id),
                    "error": ("KeyError: %r" % (e,))[:500],
                },
            )
        TEL.log_error(
            "ESPN payload malformed (KeyError: %r)" % (e,),
            path=request.path,
            game_id=str(game_id),
        )
        g.gop_meta = {**getattr(g, "gop_meta", {}), "render_outcome": "failed"}
        return jsonify(
            {
                "status": "bad",
                "message": "ESPN payload is malformed. Data not available.",
            }
        ), 404
    except Exception as e:
        # Every source in the order failed, ESPN included. That is the same
        # condition the ESPN path reports as a clean 404 (the KeyError branch
        # above) -- a game id nothing has data for, or an upstream outage. It
        # is not a bug in this service, so it must not write a stack trace to
        # the error log or answer 500.
        if _ALL_SOURCES_FAILED is not None and isinstance(e, _ALL_SOURCES_FAILED):
            g.gop_meta = {**getattr(g, "gop_meta", {}), "render_outcome": "failed"}
            return jsonify(
                {"status": "bad", "message": "No source could produce this game."}
            ), 404
        logging.getLogger("root").error(
            "Error while processing PBP on Python side, threw 500: %r (%s)" % (e, e)
        )
        import traceback

        traceback.print_tb(e.__traceback__)
        TEL.log_error(
            str(e),
            stack="".join(traceback.format_tb(e.__traceback__))[:4000],
            path=request.path,
            game_id=str(game_id),
        )
        g.gop_meta = {**getattr(g, "gop_meta", {}), "render_outcome": "failed"}
        return jsonify(
            {"status": "bad", "message": "Unknown error occurred, check logs."}
        ), 500


@app.route("/cfb/<int:game_id>/process", methods=["GET"])
@require_auth_token
def process(game_id: int):
    return _process_game("cfb", game_id, request.args.get("source"))


@app.route("/nfl/<int:game_id>/process", methods=["GET"])
@require_auth_token
def process_nfl(game_id: int):
    return _process_game("nfl", game_id, request.args.get("source"))


def _sources(league: str, game_id: int):
    """The sources this deploy can process `league` from, in failover order.

    The list IS the contract's registry -- nothing here enumerates sources, so
    a pin that carries a new adapter starts offering it with no change to this
    file or to Game on Paper. A pin older than the contract has no registry at
    all and this answers ESPN alone, which is exactly what `?source=` accepts.

    Deliberately does NOT probe availability: asking every source whether it
    holds this game would be one upstream fetch per source per page render.
    The game id is in the path for the id-map resolution the contract does not
    expose yet (a follow-up), and so the route reads like /process beside it.

    `game_id` is echoed for the same reason, and echoing it is what makes the
    caller's cache key per game rather than per league -- one entry per game
    per deploy instead of one per league. That is the right key for the body as
    it stands, and the right key once the id map lands and the body genuinely
    varies per game. Drop the echo (and go back to a per-league key) only if
    that follow-up is abandoned.
    """
    return jsonify(
        {
            "league": league,
            "game_id": game_id,
            "sources": list(_SOURCE_ORDER.get(league) or ("espn",)),
            "contract_version": _SDV_VERSION,
            "contract_sha": _SDV_SHA,
        }
    )


@app.route("/cfb/<int:game_id>/sources", methods=["GET"])
@require_auth_token
def sources(game_id: int):
    return _sources("cfb", game_id)


@app.route("/nfl/<int:game_id>/sources", methods=["GET"])
@require_auth_token
def sources_nfl(game_id: int):
    return _sources("nfl", game_id)


def _sdv_identity():
    try:
        with open(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "sdv_py_sha.txt")
        ) as f:
            sha = f.read().strip() or None
    except Exception:
        sha = None
    try:
        from importlib.metadata import version

        ver = version("sportsdataverse")
    except Exception:
        ver = None
    return ver, sha


_SDV_VERSION, _SDV_SHA = _sdv_identity()


def _emit_dq(game_id, game, processed_game):
    header = (
        (getattr(game, "json", None) or {}).get("header")
        or processed_game.get("header")
        or {}
    )
    TEL.push("game_meta", dq.build_game_meta_row(header, game_id))
    status = ((header.get("competitions") or [{}])[0].get("status") or {}).get(
        "type"
    ) or {}
    if status.get("completed") is True:
        league = (getattr(g, "gop_meta", None) or {}).get("league", "cfb")
        for row in dq.build_dq_rows(processed_game, game_id, _SDV_VERSION, _SDV_SHA, league=league):
            TEL.push("dq_boxscore", row)


@app.route("/healthcheck", methods=["GET"])
def healthcheck():
    # Report exactly which sportsdataverse-py is running. The image resolves
    # main at build time (see python/Dockerfile), so the version string alone
    # cannot distinguish two builds; the SHA the builder recorded can.
    sha = None
    try:
        with open(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "sdv_py_sha.txt")
        ) as fh:
            sha = fh.read().strip() or None
    except OSError:
        pass
    try:
        from importlib.metadata import version

        sdv_version = version("sportsdataverse")
    except Exception:
        sdv_version = None
    return jsonify(
        {"status": "ok", "sportsdataverse": {"version": sdv_version, "sha": sha}}
    )


if __name__ == "__main__":
    app.run(port=7000, debug=False, host="0.0.0.0")
