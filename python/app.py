from flask import Flask, request, jsonify
import numpy as np
from datetime import datetime as dt
from flask_logs import LogSetup
from sportsdataverse.cfb.cfb_pbp import CFBPlayProcess
import os
import logging
import pandas as pd
import json

app = Flask(__name__)
app.config["LOG_TYPE"] = os.environ.get("LOG_TYPE", "stream")
app.config["LOG_LEVEL"] = os.environ.get("LOG_LEVEL", "INFO")

logs = LogSetup()
logs.init_app(app)

@app.after_request
def after_request(response):
    logger = logging.getLogger("app.access")
    logger.info(
        "[python] %s [%s] %s %s %s",
        request.remote_addr,
        dt.utcnow().strftime("%d/%b/%Y:%H:%M:%S.%f")[:-3],
        request.method,
        request.path,
        response.status
    )
    return response

@app.route('/cfb/process', methods=['POST'])
def process():
    try:
        gameId = request.get_json(force=True)['gameId']
        processed_data = CFBPlayProcess(gameId = gameId)
        pbp = processed_data.espn_cfb_pbp()
        processed_data.run_processing_pipeline()
        tmp_json = processed_data.plays_json.to_json(orient="records")
        jsonified_df = json.loads(tmp_json)

        box = processed_data.create_box_score()
        bad_cols = [
            'start.distance', 'start.yardLine', 'start.team.id', 'start.down', 'start.yardsToEndzone', 'start.posTeamTimeouts', 'start.defTeamTimeouts',
            'start.shortDownDistanceText', 'start.possessionText', 'start.downDistanceText', 'start.pos_team_timeouts', 'start.def_pos_team_timeouts',
            'clock.displayValue',
            'type.id', 'type.text', 'type.abbreviation',
            'end.distance', 'end.yardLine', 'end.team.id','end.down', 'end.yardsToEndzone', 'end.posTeamTimeouts','end.defTeamTimeouts',
            'end.shortDownDistanceText', 'end.possessionText', 'end.downDistanceText', 'end.pos_team_timeouts', 'end.def_pos_team_timeouts',
            'expectedPoints.before', 'expectedPoints.after', 'expectedPoints.added',
            'winProbability.before', 'winProbability.after', 'winProbability.added',
            'scoringType.displayName', 'scoringType.name', 'scoringType.abbreviation'
        ]
        # clean records back into ESPN format
        for record in jsonified_df:
            record["clock"] = {
                "displayValue" : record["clock.displayValue"],
                "minutes" : record["clock.minutes"],
                "seconds" : record["clock.seconds"]
            }

            record["type"] = {
                "id" : record["type.id"],
                "text" : record["type.text"],
                "abbreviation" : record["type.abbreviation"],
            }
            record["modelInputs"] = {
                "start" : {
                    "down" : record["start.down"],
                    "distance" : record["start.distance"],
                    "yardsToEndzone" : record["start.yardsToEndzone"],
                    "TimeSecsRem": record["start.TimeSecsRem"],
                    "adj_TimeSecsRem" : record["start.adj_TimeSecsRem"],
                    "pos_score_diff" : record["pos_score_diff_start"],
                    "posTeamTimeouts" : record["start.posTeamTimeouts"],
                    "defTeamTimeouts" : record["start.defPosTeamTimeouts"],
                    "ExpScoreDiff" : record["start.ExpScoreDiff"],
                    "ExpScoreDiff_Time_Ratio" : record["start.ExpScoreDiff_Time_Ratio"],
                    "spread_time" : record['start.spread_time'],
                    "pos_team_receives_2H_kickoff": record["start.pos_team_receives_2H_kickoff"],
                    "is_home": record["start.is_home"],
                    "period": record["period"]
                },
                "end" : {
                    "down" : record["end.down"],
                    "distance" : record["end.distance"],
                    "yardsToEndzone" : record["end.yardsToEndzone"],
                    "TimeSecsRem": record["end.TimeSecsRem"],
                    "adj_TimeSecsRem" : record["end.adj_TimeSecsRem"],
                    "posTeamTimeouts" : record["end.posTeamTimeouts"],
                    "defTeamTimeouts" : record["end.defPosTeamTimeouts"],
                    "pos_score_diff" : record["pos_score_diff_end"],
                    "ExpScoreDiff" : record["end.ExpScoreDiff"],
                    "ExpScoreDiff_Time_Ratio" : record["end.ExpScoreDiff_Time_Ratio"],
                    "spread_time" : record['end.spread_time'],
                    "pos_team_receives_2H_kickoff": record["end.pos_team_receives_2H_kickoff"],
                    "is_home": record["end.is_home"],
                    "period": record["period"]
                }
            }

            record["expectedPoints"] = {
                "before" : record["EP_start"],
                "after" : record["EP_end"],
                "added" : record["EPA"]
            }

            record["winProbability"] = {
                "before" : record["wp_before"],
                "after" : record["wp_after"],
                "added" : record["wpa"]
            }

            record["start"] = {
                "team" : {
                    "id" : record["start.team.id"],
                },
                "pos_team": {
                    "id" : record["start.pos_team.id"],
                    "name" : record["start.pos_team.name"]
                },
                "def_pos_team": {
                    "id" : record["start.def_pos_team.id"],
                    "name" : record["start.def_pos_team.name"],
                },
                "distance" : record["start.distance"],
                "yardLine" : record["start.yardLine"],
                "down" : record["start.down"],
                "yardsToEndzone" : record["start.yardsToEndzone"],
                "homeScore" : record["start.homeScore"],
                "awayScore" : record["start.awayScore"],
                "pos_team_score" : record["start.pos_team_score"],
                "def_pos_team_score" : record["start.def_pos_team_score"],
                "pos_score_diff" : record["pos_score_diff_start"],
                "posTeamTimeouts" : record["start.posTeamTimeouts"],
                "defTeamTimeouts" : record["start.defPosTeamTimeouts"],
                "ExpScoreDiff" : record["start.ExpScoreDiff"],
                "ExpScoreDiff_Time_Ratio" : record["start.ExpScoreDiff_Time_Ratio"],
                "shortDownDistanceText" : record["start.shortDownDistanceText"],
                "possessionText" : record["start.possessionText"],
                "downDistanceText" : record["start.downDistanceText"],
                "posTeamSpread" : record["start.pos_team_spread"]
            }

            record["end"] = {
                "team" : {
                    "id" : record["end.team.id"],
                },
                "pos_team": {
                    "id" : record["end.pos_team.id"],
                    "name" : record["end.pos_team.name"],
                },
                "def_pos_team": {
                    "id" : record["end.def_pos_team.id"],
                    "name" : record["end.def_pos_team.name"],
                },
                "distance" : record["end.distance"],
                "yardLine" : record["end.yardLine"],
                "down" : record["end.down"],
                "yardsToEndzone" : record["end.yardsToEndzone"],
                "homeScore" : record["end.homeScore"],
                "awayScore" : record["end.awayScore"],
                "pos_team_score" : record["end.pos_team_score"],
                "def_pos_team_score" : record["end.def_pos_team_score"],
                "pos_score_diff" : record["pos_score_diff_end"],
                "posTeamTimeouts" : record["end.posTeamTimeouts"],
                "defPosTeamTimeouts" : record["end.defPosTeamTimeouts"],
                "ExpScoreDiff" : record["end.ExpScoreDiff"],
                "ExpScoreDiff_Time_Ratio" : record["end.ExpScoreDiff_Time_Ratio"],
                "shortDownDistanceText" : record.get("end.shortDownDistanceText"),
                "possessionText" : record.get("end.possessionText"),
                "downDistanceText" : record.get("end.downDistanceText")
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
            for col in bad_cols:
                record.pop(col, None)

        result = {
            "id": gameId,
            "count" : len(jsonified_df),
            "plays" : jsonified_df,
            "box_score" : box,
            "homeTeamId": pbp['header']['competitions'][0]['competitors'][0]['team']['id'],
            "awayTeamId": pbp['header']['competitions'][0]['competitors'][1]['team']['id'],
            "drives" : pbp['drives'],
            "scoringPlays" : np.array(pbp['scoringPlays']).tolist(),
            "winprobability" : np.array(pbp['winprobability']).tolist(),
            "boxScore" : pbp['boxscore'],
            "homeTeamSpread" : np.array(pbp['homeTeamSpread']).tolist(),
            "overUnder" : np.array(pbp['overUnder']).tolist(),
            "header" : pbp['header'],
            "broadcasts" : np.array(pbp['broadcasts']).tolist(),
            "videos" : np.array(pbp['videos']).tolist(),
            "standings" : pbp['standings'],
            "pickcenter" : np.array(pbp['pickcenter']).tolist(),
            "espnWinProbability" : np.array(pbp['espnWP']).tolist(),
            "gameInfo" : np.array(pbp['gameInfo']).tolist(),
            "season" : np.array(pbp['season']).tolist()
        }
        # logging.getLogger("root").info(result)
        return jsonify(result), 200
    except KeyError as e:
        logging.getLogger("root").error("Error while processing PBP on Python side, threw 404: %r (%s)" % (e, e))
        return jsonify({
            "status" : "bad",
            "message" : "ESPN payload is malformed. Data not available."
        }), 404
    except Exception as e:
        logging.getLogger("root").error("Error while processing PBP on Python side, threw 500: %r (%s)" % (e, e))
        import traceback
        traceback.print_tb(e.__traceback__)
        return jsonify({
            "status" : "bad",
            "message" : "Unknown error occurred, check logs."
        }), 500


@app.route('/healthcheck', methods=['GET'])
def healthcheck():
    return jsonify({
        "status": "ok"
    })

if __name__ == '__main__':
    app.run(port=7000, debug=False, host='0.0.0.0')

