from functools import wraps
import math

from flask import Flask, request, jsonify, Response, g
import numpy as np
from datetime import datetime as dt, timezone as tz
import polars as pl
from sportsdataverse.cfb import CFBPlayProcess
from flask_compress import Compress
import orjson

import os
import logging
import json
import base64

from telemetry import TEL, stage, init_flask
import gop_routes

HTTP_TOKEN = os.getenv("PYTHON_HTTP_TOKEN")
assert HTTP_TOKEN, f"HTTP_TOKEN not provided, can not start server"

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


@app.route("/cfb/<int:game_id>/process", methods=["GET"])
@require_auth_token
def process(game_id: int):
    timings = {}
    try:
        g.gop_meta = {"game_id": str(game_id)}
        game = CFBPlayProcess(gameId=game_id)
        game.join_participants = True
        game.resolve_missing = False  ## this doesn't work as expected or there needs to be a way to set this as expected.
        espn_logged = False
        with stage(timings, "espn_fetch"):
            game.espn_cfb_pbp()
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

        bad_cols = [
            "start.distance",
            "start.yardLine",
            "start.team.id",
            "start.down",
            "start.yardsToEndzone",
            "start.posTeamTimeouts",
            "start.defTeamTimeouts",
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
        # clean records back into ESPN format
        for record in processed_game["plays"]:
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
                "downDistanceText": record["start.downDistanceText"],
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

            # record["players"] = {
            #     'passer_player_name' : record["passer_player_name"],
            #     'rusher_player_name' : record["rusher_player_name"],
            #     'receiver_player_name' : record["receiver_player_name"],
            #     'sack_player_name' : record["sack_player_name"],
            #     'sack_player_name2' : record["sack_player_name2"],
            #     'pass_breakup_player_name' : record["pass_breakup_player_name"],
            #     'interception_player_name' : record["interception_player_name"],
            #     'fg_kicker_player_name' : record["fg_kicker_player_name"],
            #     'fg_block_player_name' : record["fg_block_player_name"],
            #     'fg_return_player_name' : record["fg_return_player_name"],
            #     'kickoff_player_name' : record["kickoff_player_name"],
            #     'kickoff_return_player_name' : record["kickoff_return_player_name"],
            #     'punter_player_name' : record["punter_player_name"],
            #     'punt_block_player_name' : record["punt_block_player_name"],
            #     'punt_return_player_name' : record["punt_return_player_name"],
            #     'punt_block_return_player_name' : record["punt_block_return_player_name"],
            #     'fumble_player_name' : record["fumble_player_name"],
            #     'fumble_forced_player_name' : record["fumble_forced_player_name"],
            #     'fumble_recovered_player_name' : record["fumble_recovered_player_name"],
            # }
            # remove added columns
            for k in list(record.keys()):
                if k in bad_cols:
                    del record[k]
                    continue
                v = record[k]
                if isinstance(v, float) and not math.isfinite(v):
                    record[k] = None

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
        return jsonify(processed_game), 200
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


@app.route("/healthcheck", methods=["GET"])
def healthcheck():
    # Report exactly which sportsdataverse-py is running. The image resolves
    # main at build time (see python/Dockerfile), so the version string alone
    # cannot distinguish two builds; the SHA the builder recorded can.
    sha = None
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sdv_py_sha.txt")) as fh:
            sha = fh.read().strip() or None
    except OSError:
        pass
    try:
        from importlib.metadata import version

        sdv_version = version("sportsdataverse")
    except Exception:
        sdv_version = None
    return jsonify({"status": "ok", "sportsdataverse": {"version": sdv_version, "sha": sha}})


if __name__ == "__main__":
    app.run(port=7000, debug=False, host="0.0.0.0")
