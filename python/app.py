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
    git_cache_pbp = processed_data.git_pbp()
    if (git_cache_pbp != None):
        pbp = json.loads(git_cache_pbp)
        box = pbp["advBoxScore"] if ("advBoxScore" in pbp.keys()) else pbp["box_score"]
        for k in box.keys():
            box_list = box[k]
            for item in box_list:
                item["pos_team"] = item["posteam"]
            
        jsonified_df = pbp["plays"]
    else:
        pbp = processed_data.cfb_pbp()
        processed_data.run_processing_pipeline()
        tmp_json = processed_data.plays_json.to_json(orient="records")
        jsonified_df = json.loads(tmp_json)
        box = processed_data.create_box_score()

    result = processed_data.process_cfb_raw_for_gop(gameId, pbp, jsonified_df, box)
    
    # logging.getLogger("root").info(result)
    return jsonify(result)

@app.route('/healthcheck', methods=['GET'])
def healthcheck():
    return jsonify({
        "status": "ok"
    })

if __name__ == '__main__':
    app.run(port=7000, debug=False, host='0.0.0.0')

