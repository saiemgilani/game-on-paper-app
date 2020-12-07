const cfb = require('cfb-data');
const axios = require('axios');

PAT_miss_type = [ 'PAT MISSED','PAT failed', 'PAT blocked', 'PAT BLOCKED']

turnover_plays = [
    "Blocked Field Goal",
    "Blocked Field Goal Touchdown",    
    "Blocked Punt",
    "Blocked Punt Touchdown",
    "Field Goal Missed",
    "Missed Field Goal Return",
    "Missed Field Goal Return Touchdown",    
    "Fumble Recovery (Opponent)",
    "Fumble Recovery (Opponent) Touchdown",
    "Fumble Return Touchdown",
    "Fumble Return Touchdown Touchdown",
    "Defensive 2pt Conversion",
    "Pass Interception",
    "Interception",
    "Interception Return Touchdown",
    "Pass Interception Return",
    "Pass Interception Return Touchdown",
    "Punt",
    "Punt Return Touchdown",
    "Sack Touchdown",
    "Uncategorized Touchdown"
]

defense_score_vec = [
    "Blocked Punt Touchdown",
    "Blocked Field Goal Touchdown",
    "Missed Field Goal Return Touchdown",
    "Punt Return Touchdown",
    "Fumble Recovery (Opponent) Touchdown",    
    "Fumble Return Touchdown",
    "Fumble Return Touchdown Touchdown",
    "Defensive 2pt Conversion",
    "Safety",
    "Sack Touchdown",    
    "Interception Return Touchdown",
    "Pass Interception Return Touchdown",
    "Uncategorized Touchdown"
]

normal_play = [
    "Rush",
    "Pass",
    "Pass Completion",
    "Pass Reception",
    "Pass Incompletion",
    "Sack",
    "Fumble Recovery (Own)"
]

score = [
    "Passing Touchdown", 
    "Rushing Touchdown", 
    "Field Goal Good",
    "Pass Reception Touchdown",
    "Fumble Recovery (Own) Touchdown",
    "Punt Touchdown",
    "Rushing Touchdown Touchdown"         
]

kickoff = [
    "Kickoff",
    "Kickoff Return (Offense)",
    "Kickoff Return Touchdown",
    "Kickoff Touchdown"
]

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

    var plays = drives.map(d => d.plays).reduce((acc, val) => acc.concat(val));
    
    if ("winprobability" in summary) {
        summary.espnWP = summary.winprobability
        delete summary.winprobability
    }
    
    plays.sort((a, b) => parseInt(a.id) < parseInt(b.id));
    try {
        plays.forEach(p => p.playType = (p.type != null) ? p.type.text : "Unknown")
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

function calculateHalfSecondsRemaining(period, time) {
    var splitTime = time.split(":")
    var minutes = splitTime.length > 0 ? parseInt(splitTime[0]) : 0
    var seconds = splitTime.length > 1 ? parseInt(splitTime[1]) : 0
    return calculateHalfSecondsRemaining(period, minutes, seconds);
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
    var logDistance = (play.distance == 0) ? Math.log(0.5) : Math.log(play.distance)
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
        log_distance: logDistance,
        log_distance_down_2: (play.down == 2) ? logDistance : 0.0,
        log_distance_down_3: (play.down == 3) ? logDistance : 0.0,
        log_distance_down_4: (play.down == 4) ? logDistance : 0.0,
        goal_to_go_log_distance: (play.yardsToEndzone <= play.distance) ? logDistance : 0.0
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
    var beforeInputs = []
    var endInputs = []
    for (var i = 0; i <= plays.length - 1; i+= 1) {
        var play = plays[i]
        var nextPlay = null
        if ((i + 1) >= plays.length) {
            nextPlay = null
        } else {
            nextPlay = plays[i + 1]
        }
        let epBeforeInputs = prepareEPInputs(play.start, play.clock.displayValue)
        let start = [
            epBeforeInputs['Intercept'], 
            epBeforeInputs['down2'], 
            epBeforeInputs['down3'], 
            epBeforeInputs['down4'],
            epBeforeInputs['goal_to_go'], 
            epBeforeInputs['under_two'], 
            epBeforeInputs['time_remaining'],
            epBeforeInputs['adjusted_yardline'], 
            epBeforeInputs['adjusted_yardline_down_2'],
            epBeforeInputs['adjusted_yardline_down_3'], 
            epBeforeInputs['adjusted_yardline_down_4'],
            epBeforeInputs['log_distance'], 
            epBeforeInputs['log_distance_down_2'],
            epBeforeInputs['log_distance_down_3'], 
            epBeforeInputs['log_distance_down_4'],
            epBeforeInputs['goal_to_go_log_distance']
        ]
        beforeInputs.push(start)

        var epAfterInputs = prepareEPInputs(play.end, (nextPlay != null) ? nextPlay.clock.displayValue : "0:00")

        if (epAfterInputs["time_remaining"] == 0) {
            epAfterInputs['Intercept'], 
            epAfterInputs['down2'] = 0
            epAfterInputs['down3'] = 0
            epAfterInputs['down4'] = 1
            epAfterInputs['goal_to_go'] = 0
            epAfterInputs["under_two"] = 1
            epAfterInputs['time_remaining'] = 0
            epAfterInputs["adjusted_yardline"] = 99
            epAfterInputs['adjusted_yardline_down_2'] = 0
            epAfterInputs['adjusted_yardline_down_3'] = 0
            epAfterInputs['adjusted_yardline_down_4'] = 99
            epAfterInputs["log_distance"] = Math.log(99)
            epAfterInputs['log_distance_down_2'] = 0
            epAfterInputs['log_distance_down_3'] = 0
            epAfterInputs["log_distance_down_4"] = Math.log(99)
            epAfterInputs['goal_to_go_log_distance'] = 0
        }
        
        if (epAfterInputs["adjusted_yardline"] >= 100) {
            epAfterInputs["adjusted_yardline"] = 99
            epAfterInputs['adjusted_yardline_down_2'] = (play.end.down == 2) ? 99 : 0.0
            epAfterInputs['adjusted_yardline_down_3'] = (play.end.down == 3) ? 99 : 0.0
            epAfterInputs['adjusted_yardline_down_4'] = (play.end.down == 4) ? 99 : 0.0
        }
        
        if (play.end.distance < 0) {
            var logDistance = Math.log(99)
            epAfterInputs["log_distance"] = logDistance

            epAfterInputs['log_distance_down_2'] = (play.end.down == 2) ? logDistance : 0.0
            epAfterInputs['log_distance_down_3'] = (play.end.down == 3) ? logDistance : 0.0
            epAfterInputs["log_distance_down_4"] = (play.end.down == 4) ? logDistance : 0.0

            epAfterInputs["new_distance"] = 99 // dat.new_distance.shift(-1)
            epAfterInputs['goal_to_go_log_distance'] = (epAfterInputs['goal_to_go'] == 1) ? logDistance : 0
        }

        if (epAfterInputs["adjusted_yardline"] <= 0) {
            epAfterInputs["adjusted_yardline"] = 99
            epAfterInputs['adjusted_yardline_down_2'] = (play.end.down == 2) ? 99 : 0.0
            epAfterInputs['adjusted_yardline_down_3'] = (play.end.down == 3) ? 99 : 0.0
            epAfterInputs['adjusted_yardline_down_4'] = (play.end.down == 4) ? 99 : 0.0
        }

        let end = [
            epAfterInputs['Intercept'], 
            epAfterInputs['down2'], 
            epAfterInputs['down3'], 
            epAfterInputs['down4'],
            epAfterInputs['goal_to_go'], 
            epAfterInputs['under_two'], 
            epAfterInputs['time_remaining'],
            epAfterInputs['adjusted_yardline'], 
            epAfterInputs['adjusted_yardline_down_2'],
            epAfterInputs['adjusted_yardline_down_3'], 
            epAfterInputs['adjusted_yardline_down_4'],
            epAfterInputs['log_distance'], 
            epAfterInputs['log_distance_down_2'],
            epAfterInputs['log_distance_down_3'], 
            epAfterInputs['log_distance_down_4'],
            epAfterInputs['goal_to_go_log_distance']
        ]
        endInputs.push(end)

        play.expectedPoints = {
            "before" : 0.0,
            "after" : 0.0,
            "added" : 0.0
        }
    }

    const resBefore = await axios.post('http://localhost:8000/ep/predict', {
        data: beforeInputs
    });
    var epBefore = resBefore.data.predictions; 
    for (var i = 0; i < epBefore.length; i += 1) {
        plays[i].expectedPoints.before = calculateExpectedValue(epBefore[i])
    }

    const resAfter = await axios.post('http://localhost:8000/ep/predict', {
        data: endInputs
    });
    var epAfter = resAfter.data.predictions; 
    for (var i = 0; i < epAfter.length; i += 1) {
        plays[i].expectedPoints.after = calculateExpectedValue(epAfter[i])

        if (turnover_plays.includes(plays[i].playType)) {
            plays[i].expectedPoints.after *= -1
        }
        
        if (calculateHalfSecondsRemaining(plays[i].period, plays[i].clock.displayValue) == 0 || plays[i].playType.toLocaleLowerCase().includes("end of game") || plays[i].playType.toLocaleLowerCase().includes("end of half")) {
            plays[i].expectedPoints.after = 0
        }

        if (score.includes(plays[i].playType)) {
            plays[i].expectedPoints.after = 7
        }
        
        if (defense_score_vec.includes(plays[i].playType)) {
            plays[i].expectedPoints.after = -7
        }
        
        if (plays[i].playType.includes("Safety")) {
            plays[i].expectedPoints.after = -2
        }

        if (PAT_miss_type.includes(plays[i].playType)) {
            plays[i].expectedPoints.after = 6
        }

        if (plays[i].playType.includes("Field Goal Good")) {
            plays[i].expectedPoints.after = 3
        }

        plays[i].expectedPoints.added = plays[i].expectedPoints.after - plays[i].expectedPoints.before
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