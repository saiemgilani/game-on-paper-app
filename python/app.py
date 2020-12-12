from flask import Flask
import xgboost as xgb
import numpy as np
from flask import request
from flask import jsonify

app = Flask(__name__)

ep_model = xgb.Booster({'nthread': 4})  # init model
ep_model.load_model('/models/ep_model.model')

wp_model = xgb.Booster({'nthread': 4})  # init model
wp_model.load_model('/models/wp_spread.model')

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
    app.run(port=8080, debug=False, host='0.0.0.0')

