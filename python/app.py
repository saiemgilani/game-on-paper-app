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
<<<<<<< HEAD
import paper_index
=======
from sportsdataverse.cfb import cfb_drive_summary as drive_summary
from sportsdataverse.cfb import cfb_situational_stats as situational_stats
>>>>>>> origin/main
import span_box

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


def _process_game(league: str, game_id: int):
    timings = {}
    try:
        cls, fetch_name = _PROCESSORS[league]
        g.gop_meta = {"game_id": str(game_id), "league": league}
        game = cls(gameId=game_id)
        game.join_participants = True
        game.resolve_missing = False  ## this doesn't work as expected or there needs to be a way to set this as expected.
        espn_logged = False
        with stage(timings, "espn_fetch"):
            getattr(game, fetch_name)()
        TEL.push(
            "upstream_log",
            {
                "service": "python",
                "target": "espn_pbp",
                "status": 200,
                "duration_ms": timings["espn_fetch_ms"],
                "ok": True,
                "game_id": str(game_id),
                "error": None,
            },
        )
        espn_logged = True
        with stage(timings, "pipeline"):
            processed_game = game.run_processing_pipeline()

        _fill_success(processed_game["plays"])
        _reshape_records(processed_game["plays"])

        # Both of these must precede serialization: the span swap mutates
        # processed_game, and everything after `return` is dead code -- which is
        # exactly where the DQ emit sat unnoticed until CodeRabbit flagged the
        # ordering (gop.dq_boxscore had zero rows since #192 merged).
<<<<<<< HEAD
        # Every standard window's box ships on every response
        # (advBoxScoreSpans), so the frontend switches spans in place without
        # a reload. The singular ?span= swap below stays for deep links.
=======
        # StatBroadcast-style drive summary/chart. Cheap (one pass over ~25
        # drives + a few frame aggregations), so it ships on every response;
        # fail-open like everything else on this route.
        try:
            frame = getattr(game, "plays_frame", None)
            drv = (processed_game.get("drives") or {}).get("previous") or []
            cur = (processed_game.get("drives") or {}).get("current")
            if cur:
                drv = drv + [cur]
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
        # only. The singular ?span= swap below stays for deep links.
>>>>>>> origin/main
        try:
            boxes = span_box.all_span_boxes(game)
            if boxes:
                processed_game["advBoxScoreSpans"] = boxes
        except Exception as e:  # a bad window must never cost the page
            logging.getLogger("root").warning(
                f"all-span boxes failed for {game_id}: {e}"
            )
<<<<<<< HEAD

        # Paper Index: one who-won-on-paper share from six fitted margins
        # (python/paper_index.py; trained by tools/fit_paper_index.py).
        # Always the FULL game -- a span page still describes the whole game's
        # paper story -- and fail-open like everything else here.
        try:
            frame = getattr(game, "plays_frame", None)
            if frame is not None:
                pidx = paper_index.compute(
                    frame, frame["homeTeamId"][0], frame["awayTeamId"][0]
                )
                if pidx:
                    processed_game["paperIndex"] = pidx
        except Exception as e:  # the index must never cost the page
            logging.getLogger("root").warning(
                f"paper index failed for {game_id}: {e}"
=======
        try:
            frame = getattr(game, "plays_frame", None)
            drv_all = (processed_game.get("drives") or {}).get("previous") or []
            cur = (processed_game.get("drives") or {}).get("current")
            if cur:
                drv_all = drv_all + [cur]
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
>>>>>>> origin/main
            )

        raw_span = request.args.get("span")
        if raw_span:
            try:
                box, span_key = span_box.spanned_box(game, raw_span)
                if box is not None:
                    processed_game["advBoxScore"] = box
                    processed_game["advBoxScoreSpan"] = span_key
            except Exception as e:  # a bad window must never cost the page
                logging.getLogger("root").warning(
                    f"span box failed for {game_id} span={raw_span}: {e}"
                )
            # the summaries window with the box, keeping the response coherent
            try:
                parsed = span_box.parse_span(raw_span)
                frame = getattr(game, "plays_frame", None)
                if parsed is not None and frame is not None:
                    key, expr = parsed
                    hid, aid = frame["homeTeamId"][0], frame["awayTeamId"][0]
                    w = situational_stats.create_situational_stats(frame, hid, aid, window_expr=expr)
                    if w:
                        processed_game["situationalStats"] = w
                    else:  # never a full-game object on a windowed response
                        processed_game.pop("situationalStats", None)
                    per = _SPAN_PERIODS.get(key)
                    drv_all = (processed_game.get("drives") or {}).get("previous") or []
                    cur = (processed_game.get("drives") or {}).get("current")
                    if cur:
                        drv_all = drv_all + [cur]
                    w = (
                        drive_summary.create_drive_summary(drv_all, frame, hid, aid, periods=per)
                        if per is not None and drv_all
                        else None  # clock spans don't map to drive windows
                    )
                    if w:
                        processed_game["driveSummary"] = w
                    else:
                        processed_game.pop("driveSummary", None)
            except Exception as e:
                logging.getLogger("root").warning(
                    f"span summaries failed for {game_id} span={raw_span}: {e}"
                )

        if not raw_span:  # a windowed request is not the game's canonical box
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
    return _process_game("cfb", game_id)


@app.route("/nfl/<int:game_id>/process", methods=["GET"])
@require_auth_token
def process_nfl(game_id: int):
    return _process_game("nfl", game_id)


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
        for row in dq.build_dq_rows(processed_game, game_id, _SDV_VERSION, _SDV_SHA):
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
