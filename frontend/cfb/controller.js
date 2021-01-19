const axios = require('axios');
const util = require('util');
const debuglog = util.debuglog('[frontend]');
const Schedule = require('./schedule');

const RDATA_BASE_URL = process.env.RDATA_BASE_URL;
debuglog("RDATA BASE URL: " + RDATA_BASE_URL)

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
// Filters out end of half and period plays, as well as any coin-toss plays
function checkValidPlay(p) {
    if (p.type == null) {
        return false;
    }

    if (p.text == null) {
        return false;
    }
    return !(p.type.text.toLocaleLowerCase().includes("end of") || p.text.toLocaleLowerCase().includes("end of") || p.type.text.toLocaleLowerCase().includes("coin toss") || p.text.toLocaleLowerCase().includes("coin toss"))
}

// From https://github.com/BlueSCar/cfb-data/blob/master/app/services/game.service.js
async function getPlayByPlay(id) {
    const baseUrl = 'http://cdn.espn.com/core/college-football/playbyplay';
    const params = {
        gameId: id,
        xhr: 1,
        render: 'false',
        userab: 18
    };

    const res = await axios.get(baseUrl, {
        params
    });

    return {
        scoringPlays: res.data.gamepackageJSON.scoringPlays,
        videos: res.data.gamepackageJSON.videos,
        drives: res.data.gamepackageJSON.drives,
        teams: res.data.gamepackageJSON.header.competitions[0].competitors,
        id: res.data.gamepackageJSON.header.id,
        competitions: res.data.gamepackageJSON.header.competitions,
        season: res.data.gamepackageJSON.header.season,
        week: res.data.gamepackageJSON.header.week,
        boxScore: res.data.gamepackageJSON.boxscore
    };
};

async function getSummary(id) {
    const baseUrl = 'http://site.api.espn.com/apis/site/v2/sports/football/college-football/summary';
    const params = {
        event: id
    };

    const res = await axios.get(baseUrl, {
        params
    });

    return res.data;
};

async function getSchedule(input) {
    if (input == null) {
        input = {
            year: null,
            week: null,
            group: 80
        }
    }
    const games = await Schedule.getGames(input.year, input.week, input.type, input.group);
    return games || [];
}

async function retrievePBP(gameId) {
    // get game all game data
    let pbp = await getPlayByPlay(gameId);
    let summary = await getSummary(gameId);
    // debuglog("retreived data for game " + req.params.gameId)

    if (pbp == null) {
        throw "No play-by-play available, game could have been postponed or cancelled OR is invalid."
    }

    if (summary == null) {
        throw "No summary available, game could be invalid"
    }

    // strip out the unnecessary crap
    delete pbp.news;
    delete pbp.article;
    delete pbp.standings;
    delete pbp.videos;    
    delete pbp.header;
    var gameSpread = 2.5;
    if (summary.pickcenter != null && summary.pickcenter.length > 0) {
        let spreads = summary.pickcenter.filter(odds => (odds.spread != null))
        let baseSpread = Math.abs(parseFloat(spreads[0].spread))
        gameSpread = (spreads[0].homeTeamOdds.favorite == true) ? baseSpread : (-1 * baseSpread)
    }
    pbp.homeTeamSpread = (gameSpread || 2.5);
    
    delete pbp.pickcenter;
    delete pbp.teams;

    pbp.gameInfo = pbp.competitions[0];
    var homeTeamId = pbp.competitions[0].competitors[0].id;
    var homeTeamName = pbp.competitions[0].competitors[0].team.location;
    var awayTeamId = pbp.competitions[0].competitors[1].id;
    var awayTeamName = pbp.competitions[0].competitors[1].team.location;
    delete pbp.competitions;

    if ("winprobability" in pbp) {
        pbp.espnWP = pbp.winprobability
        delete pbp.winprobability
    }

    var drives = [];
    if ("drives" in pbp && pbp.drives != null) {
        if ("previous" in pbp.drives) {
            drives = drives.concat(pbp.drives.previous);
        }
        if ("current" in pbp.drives) {
            drives = drives.concat(pbp.drives.current);
        }
    }
    drives.sort((a,b) => {
        var diff = parseInt(a.id) - parseInt(b.id)
        if (diff < 0) {
            return -1
        } else if (diff == 0) {
            return 0
        } else {
            return 1
        }
    })
    drives = drives.filter((thing, index, self) =>
        index === self.findIndex((t) => (
            parseInt(thing.id) == parseInt(t.id)
        ))
    )
    var firstHalfKickTeamId = (drives.length > 0) ? drives[0].plays[0].start.team.id : null
    var plays = [];
    if (drives.length > 0) {
        drives.forEach(d => {
            d.plays.forEach((p, idx) => {
                p.driveId = d.id;
                p.drive_play_index = parseFloat(idx + 1)
                p.gameId = parseFloat(pbp.id);
            })
        })
        plays = drives.map(d => d.plays.filter(p => checkValidPlay(p))).reduce((acc, val) => acc.concat(val));
    }

    var timeouts = {};
    timeouts[homeTeamId] = {
        "1": [],
        "2": []
    };
    timeouts[awayTeamId] = {
        "1": [],
        "2": []
    };

    plays.forEach(p => {
        var yard = (p.start.team != null && p.start.team.id == homeTeamId) ? 100 - p.start.yardLine : p.start.yardLine
        p.start.yardsToEndzone = (p.start.yardLine != null) ? yard : p.start.yardsToEndzone
    })
    plays.forEach(p => {
        var yard = (p.end.team != null && p.end.team.id == homeTeamId) ? 100 - p.end.yardLine : p.end.yardLine
        p.end.yardsToEndzone = (p.end.yardLine != null) ? yard : p.end.yardsToEndzone
    })
    plays.forEach(p => p.playType = (p.type != null) ? p.type.text : "Unknown")
    plays.forEach(p => p.period = (p.period != null) ? parseInt(p.period.number) : 0)
    plays.forEach(p => p.gameId = pbp.gameInfo.id)

    for (var i = 0; i < plays.length; i += 1) {
        var nextPlay = null
        if ((i + 1) >= plays.length) {
            nextPlay = null
        } else {
            nextPlay = plays[i + 1]
        }

        plays[i].start.TimeSecsRem = calculateHalfSecondsRemaining(plays[i].period, plays[i].clock.displayValue)
        plays[i].start.adj_TimeSecsRem = calculateGameSecondsRemaining(plays[i].period, plays[i].start.TimeSecsRem)
        
        var endPeriod = (nextPlay != null) ? nextPlay.period : 5
        var endClock = (nextPlay != null) ? nextPlay.clock.displayValue : "0:00"
        plays[i].end.TimeSecsRem = calculateHalfSecondsRemaining(endPeriod, endClock)
        plays[i].end.adj_TimeSecsRem = calculateGameSecondsRemaining(endPeriod, plays[i].end.TimeSecsRem)
    }

    timeouts[homeTeamId]["1"] = plays.filter(p => p.type.text.includes("Timeout") && p.start.team.id == homeTeamId && p.period <= 2).map(p => parseInt(p.id))
    timeouts[awayTeamId]["1"] = plays.filter(p => p.type.text.includes("Timeout") && p.start.team.id == awayTeamId && p.period <= 2).map(p => parseInt(p.id))
    timeouts[homeTeamId]["2"] = plays.filter(p => p.type.text.includes("Timeout") && p.start.team.id == homeTeamId && p.period > 2).map(p => parseInt(p.id))
    timeouts[awayTeamId]["2"] = plays.filter(p => p.type.text.includes("Timeout") && p.start.team.id == awayTeamId && p.period > 2).map(p => parseInt(p.id))

    plays.forEach(p => {
        var intId = parseInt(p.id);
        var offenseId = p.start.team.id;
        var defenseId = (offenseId == homeTeamId) ? awayTeamId : homeTeamId
        var endOffenseId = p.end.team.id;
        var endDefenseId = (endOffenseId == homeTeamId) ? awayTeamId : homeTeamId
        var half = p.period <= 2 ? "1" : "2"

        p.start.posTeamTimeouts = Math.max(0, Math.min(3, 3 - timeouts[offenseId][half].filter(t => t < intId).length))
        p.start.defTeamTimeouts = Math.max(0, Math.min(3, 3 - timeouts[defenseId][half].filter(t => t < intId).length))

        p.end.posTeamTimeouts = Math.max(0, Math.min(3, 3 - timeouts[endOffenseId][half].filter(t => t <= intId).length))
        p.end.defTeamTimeouts = Math.max(0, Math.min(3, 3 - timeouts[endDefenseId][half].filter(t => t <= intId).length))
    });
    
    let driveMetadata = drives.map(d => {
        return {
            id: d.id,
            driveResult: d.displayResult,
            description: d.description,
            start: d.start
        }
    })
    boxScore = pbp.boxScore;
    season = pbp.season;

    const processedGame = await processPlays(plays, driveMetadata, boxScore, season, pbp.homeTeamSpread, homeTeamId, homeTeamName, awayTeamId, awayTeamName, firstHalfKickTeamId);
    
    // debuglog(processedGame)
    // debuglog(typeof processedGame)

    plays = processedGame["records"];
    // debuglog(plays)
    pbp.advBoxScore = processedGame["box_score"];
    pbp.boxScore = processedGame["boxScore"];
    // debuglog(typeof pbp.boxScore)
    // debuglog(pbp.boxScore)
    
    pbp.scoringPlays = plays.filter(p => ("scoringPlay" in p) && (p.scoringPlay == true))
    pbp.plays = plays;
    pbp.drives = drives;
    pbp.boxScore = boxScore;

    if (pbp != null && pbp.gameInfo != null && pbp.gameInfo.status.type.completed == true) {
        if (pbp.plays[pbp.plays.length - 1].pos_team == homeTeamId && (pbp.plays[pbp.plays.length - 1].homeScore > pbp.plays[pbp.plays.length - 1].awayScore)) {
            pbp.plays[pbp.plays.length - 1].winProbability.after = 1.0
        } else if (pbp.plays[pbp.plays.length - 1].pos_team == awayTeamId && (pbp.plays[pbp.plays.length - 1].homeScore < pbp.plays[pbp.plays.length - 1].awayScore)) {
            pbp.plays[pbp.plays.length - 1].winProbability.after = 1.0
        } else {
            pbp.plays[pbp.plays.length - 1].winProbability.after = 0.0
        }

        pbp.gameInfo.gei = calculateGEI(pbp.plays, homeTeamId)
    }

    return pbp;
}

function calculateGEI(plays, homeTeamId) {
    var wpDiffs = []
    for (var i = 0; i < plays.length; i++) {
        let play = plays[i]

        var nextPlay = null;
        if ((i + 1) >= plays.length) {
            nextPlay = null
        } else {
            nextPlay = plays[i + 1]
        }
        
        function calculateHomeWP(play) {
            let offWP = play != null ? play.winProbability.before : 0.0
            let defWP = 1.0 - offWP
            
            let homeWP = (play.pos_team == homeTeamId) ? offWP : defWP
            return homeWP
        }
        
        var finalWP = 0
        if (play.homeScore > play.awayScore) {
            if (play.pos_team == homeTeamId) {
                finalWP = 1.0
            } else {
                finalWP = 0.0
            }
        } else {
            if (play.pos_team == homeTeamId) {
                finalWP = 0.0
            } else {
                finalWP = 1.0
            }
        }
        let nextPlayWP = (nextPlay != null) ? calculateHomeWP(nextPlay) : finalWP
        
        wpDiffs.push((nextPlayWP - calculateHomeWP(play)))
    }

    let normalizeFactor = (plays.length == 0) ? 0 : (179.01777401608126 / plays.length)
    let gei = wpDiffs.map(p => Math.abs(p)).reduce((acc, val) => acc + val)
    return normalizeFactor * gei
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

async function processPlays(plays, drives, boxScore, season, homeTeamSpread, homeTeamId, homeTeamName, awayTeamId, awayTeamName, firstHalfKickTeamId) {
    var response = await axios.post(`${RDATA_BASE_URL}/cfb/process`, {
        data: plays,
        drivesData: drives,
        boxScore: boxScore,
        season: season,
        homeTeamId: homeTeamId,
        homeTeamName: homeTeamName,
        awayTeamId: awayTeamId,
        awayTeamName: awayTeamName,
        homeTeamSpread: homeTeamSpread,
        firstHalfKickoffTeamId: firstHalfKickTeamId
    })
    return response.data;
}

async function getServiceHealth(req, res) {
    const rdataCheck = await axios.get(RDATA_BASE_URL + '/healthcheck');
    const cfbDataCheck = await axios.get('https://collegefootballdata.com');

    var cfbdCheck = {
        status: (cfbDataCheck.status == 200) ? "ok" : "bad"
    }

    const selfCheck = {
        "status" : "ok"
    }
    
    return res.json({
        "python" : rdataCheck.data,
        "node" : selfCheck,
        "cfbData" : cfbdCheck
    })
}

exports.getGameList = getSchedule
exports.getPBP = retrievePBP
exports.getServiceHealth = getServiceHealth