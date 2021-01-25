from flask import Flask, request, jsonify
import xgboost as xgb
import numpy as np
from datetime import datetime as dt
from flask_logs import LogSetup
from play_handler import PlayProcess
import os
import logging
import urllib
import pandas as pd
import json

app = Flask(__name__)
app.config["LOG_TYPE"] = os.environ.get("LOG_TYPE", "stream")
app.config["LOG_LEVEL"] = os.environ.get("LOG_LEVEL", "INFO")

logs = LogSetup()
logs.init_app(app)

ep_model = xgb.Booster({'nthread': 4})  # init model
ep_model.load_model('models/ep_model.model')

wp_model = xgb.Booster({'nthread': 4})  # init model
wp_model.load_model('models/wp_spread.model')

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
    gameId = request.get_json(force=True)['gameId']
    
    processed_data = PlayProcess(logger = logging.getLogger("root"), gameId = gameId)
    pbp = processed_data.cfb_pbp()
    
    
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
            "displayValue" : record["clock.displayValue"]
        }

        record["type"] = {
            "id" : record["type.id"],
            "text" : record["type.text"],
            "abbreviation" : record["type.abbreviation"],
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
            }, 
            "def_pos_team": {
                "id" : record["start.def_pos_team.id"],
            }, 
            "distance" : record["start.distance"],
            "yardLine" : record["start.yardLine"],
            "down" : record["start.down"],
            "yardsToEndzone" : record["start.yardsToEndzone"],
            "homeScore" : record["start.homeScore"],
            "awayScore" : record["start.awayScore"],
            "pos_team_score" : record["start.pos_team_score"],
            "def_pos_team_score" : record["start.def_pos_team_score"],
            "pos_score_diff" : record["start.pos_score_diff"],
            "posTeamTimeouts" : record["start.posTeamTimeouts"],
            "defTeamTimeouts" : record["start.defPosTeamTimeouts"],
            "ExpScoreDiff" : record["start.ExpScoreDiff"],
            "ExpScoreDiff_Time_Ratio" : record["start.ExpScoreDiff_Time_Ratio"],
            "shortDownDistanceText" : record["start.shortDownDistanceText"],
            "possessionText" : record["start.possessionText"],
            "downDistanceText" : record["start.downDistanceText"]
        }

        record["end"] = {
            "team" : {
                "id" : record["end.team.id"],
            },
            "pos_team": {
                "id" : record["end.pos_team.id"],
            }, 
            "def_pos_team": {
                "id" : record["end.def_pos_team.id"],
            }, 
            "distance" : record["end.distance"],
            "yardLine" : record["end.yardLine"],
            "down" : record["end.down"],
            "yardsToEndzone" : record["end.yardsToEndzone"],
            "homeScore" : record["end.homeScore"],
            "awayScore" : record["end.awayScore"],
            "pos_team_score" : record["end.pos_team_score"],
            "def_pos_team_score" : record["end.def_pos_team_score"],
            "pos_score_diff" : record["end.pos_score_diff"],
            "posTeamTimeouts" : record["end.posTeamTimeouts"],
            "defPosTeamTimeouts" : record["end.defPosTeamTimeouts"],
            "ExpScoreDiff" : record["end.ExpScoreDiff"],
            "ExpScoreDiff_Time_Ratio" : record["end.ExpScoreDiff_Time_Ratio"],
            "shortDownDistanceText" : record["end.shortDownDistanceText"],
            "possessionText" : record["end.possessionText"],
            "downDistanceText" : record["end.downDistanceText"]
        }

        # remove added columns
        for col in bad_cols:
            record.pop(col, None)

    result = {
        "count" : len(jsonified_df),
        "plays" : jsonified_df,
        "box_score" : box,
        "homeTeamId": pbp['header']['competitions'][0]['competitors'][0]['team']['id'],
        "awayTeamId": pbp['header']['competitions'][0]['competitors'][1]['team']['id'],
        "drives" : pbp['drives'],
        "scoringPlays" : np.array(pbp['scoringPlays']).tolist(),
        "winprobability" : np.array(pbp['winprobability']).tolist(),
        "boxScore" : pbp['boxscore'],
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
    return jsonify(result)

@app.route('/healthcheck', methods=['GET'])
def healthcheck():
    return jsonify({
        "status": "ok"
    })

if __name__ == '__main__':
    app.run(port=7000, debug=False, host='0.0.0.0')

