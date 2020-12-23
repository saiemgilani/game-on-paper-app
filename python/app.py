from flask import Flask, request, jsonify
import xgboost as xgb
import numpy as np
from datetime import datetime as dt
from flask_logs import LogSetup
import os
import logging

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
    for p in predictions:
        result.append({
            "td" : float(p[0]),
            "opp_td" : float(p[1]),
            "fg" : float(p[2]),
            "opp_fg" : float(p[3]),
            "no_score" : float(p[4]),
            "safety" : float(p[5]),
            "opp_safety" : float(p[6])
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
@app.route('/healthcheck', methods=['GET'])
def healthcheck():
    return jsonify({
        "status": "ok"
    })

if __name__ == '__main__':
    app.run(port=7000, debug=False, host='0.0.0.0')

