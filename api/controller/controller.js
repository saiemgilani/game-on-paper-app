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

function checkValidPlay(p) {
    if (p.type == null) {
        return false;
    }

    if (p.text == null) {
        return false;
    }
    return !(p.type.text.toLocaleLowerCase().includes("end of") || p.text.toLocaleLowerCase().includes("end of") || p.type.text.toLocaleLowerCase().includes("coin toss") || p.text.toLocaleLowerCase().includes("coin toss"))
}

async function retrievePBP(req, res) {
    // get game all game data
    let pbp = await cfb.games.getPlayByPlay(req.params.gameId);
    let summary = await cfb.games.getSummary(req.params.gameId);
    // console.log(JSON.stringify(boxScore))
    
    // strip out the unnecessary crap
    delete pbp.news;
    delete pbp.article;
    delete pbp.standings;
    delete pbp.videos;
    delete pbp.header;
    pbp.homeTeamSpread = summary.pickcenter[0].spread * (summary.pickcenter[0].homeTeamOdds.favorite == true ? 1 : -1)
    delete pbp.pickcenter;
    delete pbp.teams;

    pbp.gameInfo = pbp.competitions[0];
    var homeTeamId = pbp.competitions[0].competitors[0].id;
    var awayTeamId = pbp.competitions[0].competitors[1].id;
    delete pbp.competitions;

    var drives = pbp.drives.previous;
    if ("current" in pbp.drives) {
        drives.concat(pbp.drives.current)
    }
    drives.sort((a,b) => parseInt(a.id) < parseInt(b.id))
    var firstHalfKickTeamId = drives[0].plays[0].start.team.id
    var plays = drives.map(d => d.plays.filter(p => checkValidPlay(p))).reduce((acc, val) => acc.concat(val));
    
    if ("winprobability" in pbp) {
        pbp.espnWP = pbp.winprobability
        delete pbp.winprobability
    }
    
    plays.sort((a, b) => parseInt(a.id) < parseInt(b.id));
    var timeouts = {};
    timeouts[homeTeamId] = {
        "1": [],
        "2": []
    };
    timeouts[awayTeamId] = {
        "1": [],
        "2": []
    };
    // console.log(timeouts)
    try {
        plays.forEach(p => p.playType = (p.type != null) ? p.type.text : "Unknown")
        plays.forEach(p => p.period = (p.period != null) ? parseInt(p.period.number) : 0)

        timeouts[homeTeamId]["1"] = plays.filter(p => p.type.text.includes("Timeout") && p.start.team.id == homeTeamId && p.period <= 2).map(p => parseInt(p.id))
        timeouts[awayTeamId]["1"] = plays.filter(p => p.type.text.includes("Timeout") && p.start.team.id == awayTeamId && p.period <= 2).map(p => parseInt(p.id))
        timeouts[homeTeamId]["2"] = plays.filter(p => p.type.text.includes("Timeout") && p.start.team.id == homeTeamId && p.period > 2).map(p => parseInt(p.id))
        timeouts[awayTeamId]["2"] = plays.filter(p => p.type.text.includes("Timeout") && p.start.team.id == awayTeamId && p.period > 2).map(p => parseInt(p.id))

        plays.forEach(p => {
            var intId = parseInt(p.id);
            var offenseId = p.start.team.id;
            var defenseId = (offenseId == homeTeamId) ? awayTeamId : homeTeamId

            var half = p.period <= 2 ? "1" : "2"

            p.start.posTeamTimeouts = Math.max(0, Math.min(3, 3 - timeouts[offenseId][half].filter(t => t < intId).length))
            p.start.defTeamTimeouts = Math.max(0, Math.min(3, 3 - timeouts[defenseId][half].filter(t => t < intId).length))

            p.end.posTeamTimeouts = Math.max(0, Math.min(3, 3 - timeouts[offenseId][half].filter(t => t <= intId).length))
            p.end.defTeamTimeouts = Math.max(0, Math.min(3, 3 - timeouts[defenseId][half].filter(t => t <= intId).length))
        });
        
        plays = await calculateEPA(plays, homeTeamId)
        plays = await calculateWPA(plays, pbp.homeTeamSpread, homeTeamId, firstHalfKickTeamId);
        pbp.scoringPlays = plays.filter(p => ("scoringPlay" in p) && (p.scoringPlay == true))
        pbp.plays = plays;
        pbp.drives = drives;

        if (pbp.gameInfo.status.type.completed == true) {
            let boxScore = await retrieveBoxScore(req.params.gameId)
            pbp.boxScore = boxScore
        }

        return res.json(pbp);
    } catch(err) {
        console.log(err);
        return res.json(err);
    }
}

async function retrieveBoxScore(gameId) {
    const res = await axios.post('http://rdata:7000/box', {
        gameId: gameId
    });
    // console.log(res.data)
    return res.data
}

function calculateHalfSecondsRemaining(period, time) {
    if (period == null) {
        return 0
    }

    if (time == null) {
        return 0
    }

    if (parseInt(period) > 4) {
        return 0
    }

    var splitTime = time.split(":")

    var minutes = (splitTime.length > 0) ? parseInt(splitTime[0]) : 0
    var seconds = (splitTime.length > 1) ? parseInt(splitTime[1]) : 0

    var adjMin = (parseInt(period) == 1 || parseInt(period) == 3) ? (15.0 + minutes) : minutes

    return Math.max(0, Math.min(1800, (adjMin * 60.0) + seconds))
}


function calculateGameSecondsRemaining(period, halfSeconds) {
    if (period <= 2) {
        return Math.max(0, Math.min(3600, 1800.0 + halfSeconds))
    } else {
        return halfSeconds
    }
}

function prepareEPInputs(play, period, clock, homeTeamId, homeScore, awayScore) {
    var time_remaining = calculateHalfSecondsRemaining(period, clock);
    // console.log("period: " + period)
    // console.log("time sec: " + time_remaining)
    var adj_TimeSecsRem = calculateGameSecondsRemaining(period, time_remaining)
    var logDistance = (play.distance == 0) ? Math.log(0.5) : Math.log(play.distance)
    let isHome = (play.team != null && homeTeamId == play.team.id) ? 1.0 : 0.0
    let posScoreMargin = (isHome == 1.0) ? (homeScore - awayScore) : (awayScore - homeScore)
    return {
        "TimeSecsRem" : time_remaining,
        "down" : parseInt(play.down) < 0 ? 1 : parseInt(play.down),
        "distance" : parseInt(play.distance),
        "yards_to_goal" : parseInt(play.yardsToEndzone),
        "log_ydstogo" : logDistance,
        "Goal_To_Go" : (play.yardsToEndzone <= play.distance) ? 1.0 : 0.0,
        "Under_two" : time_remaining <= 120 ? 1.0 : 0.0,
        "pos_score_diff_start": posScoreMargin,
        "adj_TimeSecsRem": adj_TimeSecsRem,
    }
}

async function calculateEPA(plays, homeTeamId) {
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

        // if (play.down == 0 || play.start.team == null || play.end.team == null) {
        //     console.log(play)
        // }

        let epBeforeInputs = prepareEPInputs(play.start, play.period, play.clock.displayValue, homeTeamId, play.homeScore, play.awayScore)
        
        if (kickoff.includes(play.playType)) {
            epBeforeInputs["down"] = 1
            epBeforeInputs["distance"] = 10
            epBeforeInputs["yards_to_goal"] = 75
            epBeforeInputs["log_ydstogo"] = Math.log(10)
        }

        let start = [
            epBeforeInputs['TimeSecsRem'],
            epBeforeInputs['down'],
            epBeforeInputs['distance'],
            epBeforeInputs['yards_to_goal'],
            epBeforeInputs['log_ydstogo'],
            epBeforeInputs['Goal_To_Go'],
            epBeforeInputs['Under_two'],
            epBeforeInputs['pos_score_diff_start']
        ]
        beforeInputs.push(start)

        var epAfterInputs = prepareEPInputs(play.end, play.period, (nextPlay != null) ? nextPlay.clock.displayValue : "0:00", homeTeamId, play.homeScore, play.awayScore)

        if (epAfterInputs['down'] == 0 || play.end.team == null) { // this is some invalid state, usually (penalties, timeouts)
            epAfterInputs = epBeforeInputs
        }

        if (epAfterInputs["time_remaining"] == 0) {
            epAfterInputs['down'] = 1
            epAfterInputs['Goal_To_Go'] = 0
            epAfterInputs["Under_two"] = 1
            epAfterInputs['TimeSecsRem'] = 0
            epAfterInputs["yards_to_goal"] = 99
            epAfterInputs["log_ydstogo"] = Math.log(99)
        }
        
        if (epAfterInputs["yards_to_goal"] >= 100) {
            epAfterInputs["yards_to_goal"] = 99
        }
        
        if (play.end.distance < 0) {
            var logDistance = Math.log(99)
            epAfterInputs["log_ydstogo"] = logDistance
            epAfterInputs["distance"] = 99 // dat.new_distance.shift(-1)
        }

        if (epAfterInputs["yards_to_goal"] <= 0) {
            epAfterInputs["yards_to_goal"] = 99
        }

        let end = [
            epAfterInputs['TimeSecsRem'],
            epAfterInputs['down'],
            epAfterInputs['distance'],
            epAfterInputs['yards_to_goal'],
            epAfterInputs['log_ydstogo'],
            epAfterInputs['Goal_To_Go'],
            epAfterInputs['Under_two'],
            epAfterInputs['pos_score_diff_start']
        ]
        endInputs.push(end)

        // if (play.end.down == -1) {
        //     console.log(play)
        // }

        play.expectedPoints = {
            "before" : 0.0,
            "after" : 0.0,
            "added" : 0.0
        }
    }

    const resBefore = await axios.post('http://rdata:7000/ep/predict', {
        data: beforeInputs
    });
    
    var epBefore = resBefore.data.predictions; 
    for (var i = 0; i < epBefore.length; i += 1) {
        plays[i].expectedPoints.before = calculateExpectedValue(epBefore[i])
    }

    const resAfter = await axios.post('http://rdata:7000/ep/predict', {
        data: endInputs
    });
    var epAfter = resAfter.data.predictions; 
    for (var i = 0; i < epAfter.length; i += 1) {
        plays[i].expectedPoints.after = calculateExpectedValue(epAfter[i])

        if (turnover_plays.includes(plays[i].playType)) {
            plays[i].expectedPoints.after *= -1
        }
        
        var endHalfGame = (plays[i].type.text.toLocaleLowerCase().includes("end of game") || plays[i].text.toLocaleLowerCase().includes("end of game") || plays[i].type.text.toLocaleLowerCase().includes("end of half") || plays[i].text.toLocaleLowerCase().includes("end of half"))
        if (calculateHalfSecondsRemaining(plays[i].period, plays[i].clock.displayValue) == 0 || endHalfGame) {
            plays[i].expectedPoints.after = 0
        }

        if (score.includes(plays[i].playType) || (normal_play.includes(plays[i].playType) && plays[i].text.includes("TD"))) {
            plays[i].expectedPoints.after = plays[i].text.toLocaleLowerCase().includes("for two-point conversion") ? 8 : 7
        }
        
        if (defense_score_vec.includes(plays[i].playType)) {
            plays[i].expectedPoints.after = plays[i].text.toLocaleLowerCase().includes("for two-point conversion") ? -8 : -7
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
    "X1": 0,
    "X2": 3,
    "X3": -3,
    "X4": -2,
    "X5": -7,
    "X6": 2,
    "X7": 7
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

    let epStartInput = prepareEPInputs(play.start, play.period, play.clock.displayValue, homeTeamId, play.homeScore, play.awayScore)
    let adj_TimeSecsRem = epStartInput['adj_TimeSecsRem']

    let isHome = (play.start.team != null && homeTeamId == play.start.team.id) ? 1.0 : 0.0
    let posScoreMargin = (isHome == 1.0) ? (play.homeScore - play.awayScore) : (play.awayScore - play.homeScore)

    let expScoreDiff = posScoreMargin + play.expectedPoints.before
    let expScoreDiffTimeRatio = expScoreDiff / (adj_TimeSecsRem + 1)

    let posTeamSpread = (isHome == 1.0) ? homeTeamSpread : (-1 * homeTeamSpread)
    let elapsedShare = Math.max(0, (3600 - adj_TimeSecsRem) / 3600)
    let spreadTime = posTeamSpread * Math.exp(-4 * elapsedShare)

    let epAfterInput = prepareEPInputs(play.end, play.period, (nextPlay != null) ? nextPlay.clock.displayValue : "0:00", homeTeamId, play.homeScore, play.awayScore)
    let adj_TimeSecsRem_end = epAfterInput['adj_TimeSecsRem']

    let expScoreDiff_end = posScoreMargin + play.expectedPoints.after
    let expScoreDiffTimeRatio_end = expScoreDiff_end / (adj_TimeSecsRem_end + 1)

    let elapsedShare_End = Math.max(0, (3600 - adj_TimeSecsRem_end) / 3600)
    let spreadTime_end = posTeamSpread * Math.exp(-4 * elapsedShare_End)

    return {
        "pos_team_receives_2H_kickoff" : offenseReceives2HKickoff,
        "spread_time" : spreadTime,
        "TimeSecsRem" : epStartInput["TimeSecsRem"],
        "adj_TimeSecsRem" : adj_TimeSecsRem,
        "ExpScoreDiff": expScoreDiff,
        "ExpScoreDiff_Time_Ratio" : expScoreDiffTimeRatio,
        "pos_score_diff_start" : posScoreMargin,
        "down" : play.start.down,
        "distance" : play.start.distance,
        "yards_to_goal" : play.start.yardsToEndzone,
        "is_home" : isHome,
        "pos_team_timeouts_rem_before" : play.start.posTeamTimeouts,
        "def_pos_team_timeouts_rem_before" : play.end.posTeamTimeouts,
        "period" : play.period,
        "half" : (play.period <= 2) ? 1 : 2,
        "Under_two" : (epStartInput["TimeSecsRem"] <= 120) ? 1.0 : 0.0,

        "pos_team_receives_2H_kickoff_end" : offenseReceives2HKickoff,
        "spread_time_end" : spreadTime_end,
        "TimeSecsRem_end" : epAfterInput["TimeSecsRem"],
        "adj_TimeSecsRem_end" : adj_TimeSecsRem_end,
        "ExpScoreDiff_end": expScoreDiff_end,
        "ExpScoreDiff_Time_Ratio_end" : expScoreDiffTimeRatio_end,
        "pos_score_diff_start_end" : posScoreMargin,
        "down_end" : play.end.down,
        "distance_end" : play.end.distance,
        "yards_to_goal_end" : play.end.yardsToEndzone,
        "is_home_end" : isHome,
        "pos_team_timeouts_rem_before_end" : play.end.posTeamTimeouts,
        "def_pos_team_timeouts_rem_before_end" : play.end.defTeamTimeouts,
        "period_end" : play.period,
        "half_end" : (play.period <= 2) ? 1 : 2,
        "Under_two_end" : (epAfterInput["TimeSecsRem"] <= 120) ? 1.0 : 0.0,
    }
}

async function calculateWPA(plays, homeTeamSpread, homeTeamId, firstHalfKickTeamId) {
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

    const resBefore = await axios.post('http://rdata:7000/wp/predict', {
        data: beforeInputs
    });
    // console.log(resBefore.data)
    var wpBefore = resBefore.data.predictions; 
    for (var i = 0; i < wpBefore.length; i += 1) {
        plays[i].winProbability.before = wpBefore[i]
    }

    const resAfter = await axios.post('http://rdata:7000/wp/predict', {
        data: endInputs
    });
    var wpAfter = resAfter.data.predictions; 
    for (var i = 0; i < wpAfter.length; i += 1) {
        var wpEnd = wpAfter[i]

        var nextPlay = null
        if ((i + 1) >= plays.length) {
            nextPlay = null
        } else {
            nextPlay = plays[i + 1]
        }

        if (calculateGameSecondsRemaining(plays[i].period, calculateHalfSecondsRemaining(plays[i].period, plays[i].clock.displayValue)) <= 30 && (nextPlay == null || calculateGameSecondsRemaining(nextPlay, calculateHalfSecondsRemaining(nextPlay.period, nextPlay.clock.displayValue)) <= 0)) {
            if (plays[i].start.team.id == homeTeamId && plays[i].homeScore > plays[i].awayScore) {
                wpEnd = 1.0
            } else if (!(plays[i].start.team.id == homeTeamId) && plays[i].homeScore < plays[i].awayScore) {
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

async function getServiceHealth(req, res) {
    const rdataCheck = await axios.get('http://rdata:7000/healthcheck');
    const cfbDataCheck = await axios.get('https://collegefootballdata.com');

    var cfbdCheck = {
        status: (cfbDataCheck.status == 200) ? "ok" : "bad"
    }

    const selfCheck = {
        "status" : "ok"
    }
    
    return res.json({
        "r" : rdataCheck.data,
        "node" : selfCheck,
        "cfbData" : cfbdCheck
    })
}

exports.getPBP = retrievePBP
exports.calculateEPA = calculateEPA
exports.calculateWPA = calculateWPA
exports.getServiceHealth = getServiceHealth