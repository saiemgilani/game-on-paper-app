const axios = require('axios');
const Schedule = require('./schedule');
const logger = require("../../utils/logger");
const RDATA_BASE_URL = process.env.RDATA_BASE_URL;

logger.info("RDATA BASE URL: " + RDATA_BASE_URL)

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

async function _remoteRetrievePBP(gameId) {
    const processedGame = await processPlays(gameId);
    
    pbp = processedGame;
    pbp.plays = processedGame["plays"];
    pbp.advBoxScore = processedGame["box_score"];
    pbp.boxScore = processedGame['boxScore'];
    pbp.gameInfo = pbp.header.competitions[0];
    

    pbp.scoringPlays = pbp.plays.filter(p => ("scoringPlay" in p) && (p.scoringPlay == true))
    delete pbp.records;
    delete pbp.box_score;
    var homeTeamId = pbp.homeTeamId;
    var awayTeamId = pbp.awayTeamId;
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

async function retrievePBP(gameId) {
        return await _remoteRetrievePBP(gameId);
    // }
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


async function processPlays(gameId) {
    var response = await axios.post(`${RDATA_BASE_URL}/cfb/process`, {
        gameId: gameId
    })
    return response.data;
}


async function retrieveGameList(url, params) {
    var gameList = await getSchedule(params);
    if (gameList == null) {
        throw Error(`Data not available for ${url} because of a service error.`)
    }
    gameList = gameList.filter(g => {
        const gameComp = g.competitions[0];
        const homeComp = gameComp.competitors[0];
        const awayComp = gameComp.competitors[1];

        return (parseFloat(homeComp.id) >= 0 && parseFloat(awayComp.id) >= 0);
    })
    gameList.sort((a, b) => {
        if (a.status.type.name.includes("IN_PROGRESS") && !b.status.type.name.includes("IN_PROGRESS")) {
            return -1;
        } else if (b.status.type.name.includes("IN_PROGRESS") && !a.status.type.name.includes("IN_PROGRESS")) {
            return 1;
        } else if ((a.status.type.name.includes("END_OF") || a.status.type.name.includes("END_PERIOD")) && !(b.status.type.name.includes("END_OF") || b.status.type.name.includes("END_PERIOD"))) {
            return -1;
        } else if ((b.status.type.name.includes("END_PERIOD") || b.status.type.name.includes("END_OF")) && !(a.status.type.name.includes("END_OF") || a.status.type.name.includes("END_PERIOD"))) {
            return 1;
        } else if (a.status.type.name.includes("STATUS_HALFTIME") && !b.status.type.name.includes("STATUS_HALFTIME")) {
            return -1;
        } else if (b.status.type.name.includes("STATUS_HALFTIME") && !a.status.type.name.includes("STATUS_HALFTIME")) {
            return 1;
        } else {
            var aDate = Date.parse(a.date)
            var bDate = Date.parse(b.date)
            if (aDate < bDate) {
                return -1
            } else if (bDate < aDate) {
                return 1
            } else {
                var aVal = parseInt(a.status.type.id)
                var bVal = parseInt(b.status.type.id)
                if (aVal < bVal) {
                    return -1
                } else if (bVal < aVal) {
                    return 1
                } else {
                    return 0
                }
            }
        }
    })
    return gameList;
}

module.exports = {
    retrieveGameList,
    retrievePBP
}
