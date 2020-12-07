const cfb = require('cfb-data');
const axios = require('axios')

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
    try {
        plays = await calculateEPA(plays)
        calculateWPA(plays);
        summary.scoringPlays = plays.filter(p => ("scoringPlay" in p) && (p.scoringPlay == true))
        summary.plays = plays;
        summary.drives = drives;
        return res.json(summary);
    } catch(err) {
        console.log(err);
        return res.json(err);
    }
}

function calculateHalfSecondsRemaining(period, minutes, seconds) {
    if (period > 4) {
        return 0
    } else {
        var adjMin = (period == 1 || period == 3) ? (15.0 + minutes) : minutes
        return Math.max(0, Math.min(1800, (adjMin * 60.0) + seconds))
    }
}
function calculateGameSecondsRemaining(period, halfSeconds) {
    if (period <= 2) {
        return Math.max(0, Math.min(3600, 1800.0 + halfSeconds))
    } else {
        return halfSeconds
    }
}

function prepareEPInputs(play, clock) {
    var splitTime = clock.split(":")
    var minutes = splitTime.length > 0 ? parseInt(splitTime[0]) : 0
    var seconds = splitTime.length > 1 ? parseInt(splitTime[1]) : 0
    var time_remaining = calculateHalfSecondsRemaining(play.period, minutes, seconds);
    return {
        Intercept: 1,
        down2: (play.down == 2) ? 1.0 : 0.0,
        down3: (play.down == 3) ? 1.0 : 0.0,
        down4: (play.down == 4) ? 1.0 : 0.0,
        goal_to_go: (play.yardsToEndzone <= play.distance) ? 1.0 : 0.0,
        under_two: (time_remaining <= 120) ? 1.0 : 0.0,
        time_remaining: time_remaining,
        adjusted_yardline: play.yardsToEndzone,
        adjusted_yardline_down_2: (play.down == 2) ? play.yardsToEndzone : 0.0,
        adjusted_yardline_down_3: (play.down == 3) ? play.yardsToEndzone : 0.0,
        adjusted_yardline_down_4: (play.down == 4) ? play.yardsToEndzone : 0.0,
        log_distance: Math.log(play.distance),
        log_distance_down_2: (play.down == 2) ? Math.log(play.distance) : 0.0,
        log_distance_down_3: (play.down == 3) ? Math.log(play.distance) : 0.0,
        log_distance_down_4: (play.down == 4) ? Math.log(play.distance) : 0.0,
        goal_to_go_log_distance: (play.yardsToEndzone <= play.distance) ? Math.log(play.distance) : 0.0
    }
}

async function calculateEPA(plays) {
    // INPUTS: ['Intercept', 'down2', 'down3', 'down4',
    //    'goal_to_go', 'under_two', 'time_remaining',
    //    'adjusted_yardline', 'adjusted_yardline_down_2',
    //    'adjusted_yardline_down_3', 'adjusted_yardline_down_4',
    //    'log_distance', 'log_distance_down_2',
    //    'log_distance_down_3', 'log_distance_down_4',
    //    'goal_to_go_log_distance']
    var inputs = []
    plays.forEach(play => {
        let epInputs = prepareEPInputs(play.start, play.clock.displayValue)
        let start = [
            epInputs['Intercept'], 
            epInputs['down2'], 
            epInputs['down3'], 
            epInputs['down4'],
            epInputs['goal_to_go'], 
            epInputs['under_two'], 
            epInputs['time_remaining'],
            epInputs['adjusted_yardline'], 
            epInputs['adjusted_yardline_down_2'],
            epInputs['adjusted_yardline_down_3'], 
            epInputs['adjusted_yardline_down_4'],
            epInputs['log_distance'], 
            epInputs['log_distance_down_2'],
            epInputs['log_distance_down_3'], 
            epInputs['log_distance_down_4'],
            epInputs['goal_to_go_log_distance']
        ]
        inputs.push(start)
        play.expectedPoints = {
            "before" : 0.0,
            "after" : 0.0,
            "added" : 0.0
        }
    })

    const res = await axios.post('http://localhost:8000/ep/predict', {
        data: inputs
    });
    var epBefore = res.data.predictions; 
    for (var i = 0; i < epBefore.length; i += 1) {
        plays[i].expectedPoints.before = calculateExpectedValue(epBefore[i])
    }
    return plays;
}

name_to_mapping = {
    "td": 7,
    "opp_td": -7,
    "fg": 3,
    "opp_fg": -3,
    "no_score": 0,
    "safety": 2,
    "opp_safety": -2
}

function calculateExpectedValue(preds) {
    var result = 0.0
    for (let key in preds) {
        result += preds[key] * name_to_mapping[key]
    }
    return result
}

function calculateWPA(plays) {
    // INPUTS: ["pos_team_receives_2H_kickoff","spread_time","TimeSecsRem","adj_TimeSecsRem","ExpScoreDiff_Time_Ratio",
    // "pos_score_diff_start","down","distance","yards_to_goal","is_home","pos_team_timeouts_rem_before","def_pos_team_timeouts_rem_before",
    // "period"]

    // how do we figure out when timeouts are taken?
    // how do we figure out who's kicking off in the second half?
    plays.forEach(p => p.winProbability = {
        "before" : 0.0,
        "after" : 0.0,
        "added" : 0.0
    })
}

exports.getPBP = retrievePBP
exports.calculateEPA = calculateEPA
exports.calculateWPA = calculateWPA