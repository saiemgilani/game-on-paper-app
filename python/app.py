from flask import Flask, request, jsonify
import xgboost as xgb
import numpy as np
from datetime import datetime as dt
from flask_logs import LogSetup
from play_handler import PlayProcess
import os
import logging
import pandas as pd

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

@app.route('/box', methods=['POST'])
def box():
    # base_data = request.get_json(force=True)['gameId']
    return jsonify({})

@app.route('/ep/predict', methods=['POST'])
def ep_predict():
    base_data = request.get_json(force=True)['data']
    # print(base_data)
    np_mom = np.array(base_data)
    dtest_moment = xgb.DMatrix(np_mom)
    predictions = ep_model.predict(dtest_moment)
    result = []
    # "Touchdown", "Opp_Touchdown", "Field_Goal", "Opp_Field_Goal",
    # "Safety", "Opp_Safety", "No_Score"
    for p in predictions:
        result.append({
            "td" : float(p[0]),
            "opp_td" : float(p[1]),
            "fg" : float(p[2]),
            "opp_fg" : float(p[3]),
            "safety" : float(p[4]),
            "opp_safety" : float(p[5]),
            "no_score" : float(p[6])
        })
    return jsonify({
        "count" : len(result),
        "predictions" : result
    })

@app.route('/wp/predict', methods=['POST'])
def wp_predict():
    base_data = request.get_json(force=True)['data']
    # print(base_data)
    np_mom = np.array(base_data)
    dtest_moment = xgb.DMatrix(np_mom)
    predictions = wp_model.predict(dtest_moment)
    result = []
    for p in predictions:
        result.append({
            "wp" : float(p)
        })
    return jsonify({
        "count" : len(result),
        "predictions" : result
    })

@app.route('/cfb/process', methods=['POST'])
def process():
    base_data = request.get_json(force=True)['data']
    processed_data = PlayProcess(json_data=base_data)
    processed_data.run_processing_pipeline()
    jsonified_df = processed_data.plays_json.to_json(orient="records")
    
    bad_cols = [
        'start.distance', 'start.yardLine', 'start.team.id', 'start.down', 'start.yardsToEndzone', 'start.posTeamTimeouts', 'start.defTeamTimeouts', 
        'start.shortDownDistanceText', 'start.possessionText', 'start.downDistanceText',
        'clock.displayValue', 
        'type.id', 'type.text', 'type.abbreviation'
        'end.shortDownDistanceText', 'end.possessionText', 'end.downDistanceText', 'end.distance', 'end.yardLine', 'end.team.id','end.down', 'end.yardsToEndzone', 'end.posTeamTimeouts','end.defTeamTimeouts', 
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
            "added" : record["EPA"],
        }

        record["winProbability"] = {
            "before" : record["WP_start"],
            "after" : record["WP_end"],
            "added" : record["WPA"],
        }

        record["start"] = {
            "team" : {
                "id" : record["start.team.id"],
            },
            "distance" : record["start.distance"],
            "yardLine" : record["start.yardLine"],
            "down" : record["start.down"],
            "yardsToEndzone" : record["start.yardsToEndzone"],
            "posTeamTimeouts" : record["start.posTeamTimeouts"],
            "defTeamTimeouts" : record["start.defTeamTimeouts"],
            "shortDownDistanceText" : record["start.shortDownDistanceText"],
            "possessionText" : record["start.possessionText"],
            "downDistanceText" : record["start.downDistanceText"],
        }

        record["end"] = {
            "team" : {
                "id" : record["end.team.id"],
            },
            "distance" : record["end.distance"],
            "yardLine" : record["end.yardLine"],
            "down" : record["end.down"],
            "yardsToEndzone" : record["end.yardsToEndzone"],
            "posTeamTimeouts" : record["end.posTeamTimeouts"],
            "defTeamTimeouts" : record["end.defTeamTimeouts"],
            "shortDownDistanceText" : record["end.shortDownDistanceText"],
            "possessionText" : record["end.possessionText"],
            "downDistanceText" : record["end.downDistanceText"],
        }

        # remove added columns
        for col in bad_cols:
            record.pop(col, None)

    return jsonify({
        "count" : len(jsonified_df),
        "records" : jsonified_df
    })

@app.route('/healthcheck', methods=['GET'])
def healthcheck():
    return jsonify({
        "status": "ok"
    })

if __name__ == '__main__':
    app.run(port=7000, debug=False, host='0.0.0.0')

