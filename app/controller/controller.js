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
    let pbp = await cfb.games.getPlayByPlay(req.query.gameId);
    let summary = await cfb.games.getSummary(req.query.gameId);
    // console.log(JSON.stringify(boxScore))
    
    // strip out the unnecessary crap
    delete pbp.news;
    delete pbp.article;
    delete pbp.standings;
    delete pbp.videos;
    delete pbp.header;
    summary.homeTeamSpread = summary.pickcenter[0].spread * (summary.pickcenter[0].homeTeamOdds.favorite == true ? 1 : -1)
    delete pbp.pickcenter;
    delete pbp.teams;

    pbp.gameInfo = pbp.competitions[0];
    var homeTeamId = pbp.competitions[0].competitors[0].id;
    delete pbp.competitions;

    var drives = pbp.drives.previous;
    if ("current" in pbp.drives) {
        drives.concat(pbp.drives.current)
    }
    drives.sort((a,b) => parseInt(a.id) < parseInt(b.id))
    var firstHalfKickTeamId = drives[0].plays[0].start.team.id

    var plays = drives.map(d => d.plays).reduce((acc, val) => acc.concat(val));
    
    if ("winprobability" in pbp) {
        pbp.espnWP = pbp.winprobability
        delete pbp.winprobability
    }
    
    plays.sort((a, b) => parseInt(a.id) < parseInt(b.id));
    try {
        plays.forEach(p => p.playType = (p.type != null) ? p.type.text : "Unknown")
        plays.forEach(p => p.period = (p.period != null) ? p.period.number : 0)
        plays = await calculateEPA(plays)
        plays = await calculateWPA(plays, pbp.homeTeamSpread, homeTeamId, firstHalfKickTeamId);
        pbp.scoringPlays = plays.filter(p => ("scoringPlay" in p) && (p.scoringPlay == true))
        pbp.plays = plays;
        pbp.drives = drives;
        return res.json(pbp);
    } catch(err) {
        console.log(err);
        return res.json(err);
    }
}

function calculateHalfSecondsRemaining(period, time) {
    if (period == null) {
        return 0
    }

    if (time == null) {
        return 0
    }

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
        adj_time_remaining: calculateGameSecondsRemaining(play.period, time_remaining),
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

function prepareWPInputs(play, homeTeamSpread, homeTeamId, firstHalfKickTeamId, nextPlay) {

    let offenseReceives2HKickoff = (firstHalfKickTeamId == play.start.team.id) ? 1.0 : 0.0

    let epStartInput = prepareEPInputs(play.start, play.clock.displayValue)
    let adj_TimeSecsRem = epStartInput['adj_time_remaining']

    let isHome = (homeTeamId == play.start.team.id) ? 1.0 : 0.0
    let posScoreMargin = (isHome == 1.0) ? (play.homeScore - play.awayScore) : (play.awayScore - play.homeScore)

    let expScoreDiff = posScoreMargin + play.expectedPoints.before
    let expScoreDiffTimeRatio = expScoreDiff / (adj_TimeSecsRem + 1)

    let posTeamSpread = (isHome == 1.0) ? homeTeamSpread : (-1 * homeTeamSpread)
    let elapsedShare = Math.max(0, (3600 - adj_TimeSecsRem) / 3600)
    let spreadTime = posTeamSpread * Math.exp(-4 * elapsedShare)

    let epAfterInput = prepareEPInputs(play.end, (nextPlay != null) ? nextPlay.clock.displayValue : "0:00")
    let adj_TimeSecsRem_end = epAfterInput['adj_time_remaining']

    let expScoreDiff_end = posScoreMargin + play.expectedPoints.after
    let expScoreDiffTimeRatio_end = expScoreDiff_end / (adj_TimeSecsRem_end + 1)

    let elapsedShare_End = Math.max(0, (3600 - adj_TimeSecsRem_end) / 3600)
    let spreadTime_end = posTeamSpread * Math.exp(-4 * elapsedShare_End)

    return {
        "pos_team_receives_2H_kickoff" : offenseReceives2HKickoff,
        "spread_time" : spreadTime,
        "TimeSecsRem" : epStartInput["time_remaining"],
        "adj_TimeSecsRem" : adj_TimeSecsRem,
        "ExpScoreDiff_Time_Ratio" : expScoreDiffTimeRatio,
        "pos_score_diff_start" : posScoreMargin,
        "down" : play.start.down,
        "distance" : play.start.distance,
        "yards_to_goal" : play.start.yardsToEndzone,
        "is_home" : isHome,
        "pos_team_timeouts_rem_before" : 3,
        "def_pos_team_timeouts_rem_before" : 3,
        "period" : play.period,

        "pos_team_receives_2H_kickoff_end" : offenseReceives2HKickoff,
        "spread_time_end" : spreadTime_end,
        "TimeSecsRem_end" : epAfterInput["time_remaining"],
        "adj_TimeSecsRem_end" : adj_TimeSecsRem_end,
        "ExpScoreDiff_Time_Ratio_end" : expScoreDiffTimeRatio_end,
        "pos_score_diff_start_end" : posScoreMargin,
        "down_end" : play.end.down,
        "distance_end" : play.end.distance,
        "yards_to_goal_end" : play.end.yardsToEndzone,
        "is_home_end" : isHome,
        "pos_team_timeouts_rem_before_end" : 3,
        "def_pos_team_timeouts_rem_before_end" : 3,
        "period_end" : play.period
    }
}

async function calculateWPA(plays, homeTeamSpread, homeTeamId, firstHalfKickTeamId) {
    // INPUTS: ["pos_team_receives_2H_kickoff","spread_time","TimeSecsRem","adj_TimeSecsRem","ExpScoreDiff_Time_Ratio",
    // "pos_score_diff_start","down","distance","yards_to_goal","is_home","pos_team_timeouts_rem_before","def_pos_team_timeouts_rem_before",
    // "period"]

    var beforeInputs = []
    var endInputs = []
    // how do we figure out when timeouts are taken?
    for (var i = 0; i <= plays.length - 1; i+= 1) {
        var play = plays[i]
        var nextPlay = null
        if ((i + 1) >= plays.length) {
            nextPlay = null
        } else {
            nextPlay = plays[i + 1]
        }

        let wpInputs = prepareWPInputs(play, homeTeamSpread, homeTeamId, firstHalfKickTeamId, nextPlay)
        let start = [
            wpInputs["pos_team_receives_2H_kickoff"],
            wpInputs["spread_time"],
            wpInputs["TimeSecsRem"],
            wpInputs["adj_TimeSecsRem"],
            wpInputs["ExpScoreDiff_Time_Ratio"],
            wpInputs["pos_score_diff_start"],
            wpInputs["down"],
            wpInputs["distance"],
            wpInputs["yards_to_goal"],
            wpInputs["is_home"],
            wpInputs["pos_team_timeouts_rem_before"],
            wpInputs["def_pos_team_timeouts_rem_before"],
            wpInputs["period"]
        ]
        beforeInputs.push(start)

        let end = [
            wpInputs["pos_team_receives_2H_kickoff_end"],
            wpInputs["spread_time_end"],
            wpInputs["TimeSecsRem_end"],
            wpInputs["adj_TimeSecsRem_end"],
            wpInputs["ExpScoreDiff_Time_Ratio_end"],
            wpInputs["pos_score_diff_start_end"],
            wpInputs["down_end"],
            wpInputs["distance_end"],
            wpInputs["yards_to_goal_end"],
            wpInputs["is_home_end"],
            wpInputs["pos_team_timeouts_rem_before_end"],
            wpInputs["def_pos_team_timeouts_rem_before_end"],
            wpInputs["period_end"]
        ]
        endInputs.push(end)

        play.winProbability = {
            "before" : 0.0,
            "after" : 0.0,
            "added" : 0.0
        }
    }

    const resBefore = await axios.post('http://localhost:8000/wp/predict', {
        data: beforeInputs
    });
    var wpBefore = resBefore.data.predictions; 
    for (var i = 0; i < wpBefore.length; i += 1) {
        plays[i].winProbability.before = wpBefore[i].wp
    }

    const resAfter = await axios.post('http://localhost:8000/wp/predict', {
        data: endInputs
    });
    var wpAfter = resAfter.data.predictions; 
    for (var i = 0; i < wpAfter.length; i += 1) {
        var wpEnd = wpAfter[i].wp

        var nextPlay = null
        if ((i + 1) >= plays.length) {
            nextPlay = null
        } else {
            nextPlay = plays[i + 1]
        }

        if (nextPlay == null || calculateGameSecondsRemaining(nextPlay, calculateHalfSecondsRemaining(nextPlay.period, nextPlay.clock.displayValue)) <= 0) {
            if (play.start.team.id == homeTeamId && play.homeScore > play.awayScore) {
                wpEnd = 1.0
            } else if (!(play.start.team.id == homeTeamId) && play.homeScore < play.awayScore) {
                wpEnd = 1.0
            } else {
                wpEnd = 0.0
            }
        }
        plays[i].winProbability.after = wpEnd
        plays[i].winProbability.added = plays[i].winProbability.after - plays[i].winProbability.before
    }
    return plays;
}

exports.getPBP = retrievePBP
exports.calculateEPA = calculateEPA
exports.calculateWPA = calculateWPA