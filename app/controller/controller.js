const cfb = require('cfb-data');
const xgb = require('ml-xgboost');
// const epModel = xgb.load('../models/ep-model.json');
const reducer = (accumulator, currentValue) => accumulator.concat(currentValue);
async function retrievePBP(req, res) {
    // get game all game data
    let summary = await cfb.games.getPlayByPlay(req.query.gameId);
    
    // strip out the unnecessary crap
    delete summary.news;
    delete summary.article;
    delete summary.standings;
    delete summary.videos;
    delete summary.header;
    delete summary.pickcenter; // could probably reuse the spread from here to give an initial prediction
    delete summary.teams;

    summary.gameInfo = summary.competitions[0];
    delete summary.competitions;

    var drives = summary.drives.previous;
    if ("current" in summary.drives) {
        drives.concat(summary.drives.current)
    }
    drives.sort((a,b) => parseInt(a.id) < parseInt(b.id))

    var plays = drives.map(d => d.plays).reduce(reducer);
    
    if ("winprobability" in summary) {
        summary.espnWP = summary.winprobability
        delete summary.winprobability
    }
    
    plays.sort((a, b) => parseInt(a.id) < parseInt(b.id));
    plays.forEach(p => p.expectedPoints = calculateEPA(p));
    plays.forEach(p => p.winProbability = calculateEPA(p));
    summary.scoringPlays = plays.filter(p => ("scoringPlay" in p) && (p.scoringPlay == true))
    summary.plays = plays;
    summary.drives = drives;

    return res.json(summary)
}

function calculateEPA(play) {
    // INPUTS: ['Intercept', 'down2', 'down3', 'down4',
    //    'goal_to_go', 'under_two', 'time_remaining',
    //    'adjusted_yardline', 'adjusted_yardline_down_2',
    //    'adjusted_yardline_down_3', 'adjusted_yardline_down_4',
    //    'log_distance', 'log_distance_down_2',
    //    'log_distance_down_3', 'log_distance_down_4',
    //    'goal_to_go_log_distance']


    return {
        "before" : 0.0,
        "after" : 0.0,
        "added" : 0.0
    }
}

function calculateWPA(play) {
    // INPUTS: ["pos_team_receives_2H_kickoff","spread_time","TimeSecsRem","adj_TimeSecsRem","ExpScoreDiff_Time_Ratio",
    // "pos_score_diff_start","down","distance","yards_to_goal","is_home","pos_team_timeouts_rem_before","def_pos_team_timeouts_rem_before",
    // "period"]

    // how do we figure out when timeouts are taken?
    return {
        "before" : 0.0,
        "after" : 0.0,
        "added" : 0.0
    }
}

exports.getPBP = retrievePBP
exports.calculateEPA = calculateEPA
exports.calculateWPA = calculateWPA