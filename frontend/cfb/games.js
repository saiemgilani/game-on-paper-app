const axios = require('axios');
const util = require('util');
const Schedule = require('./schedule');
const redis = require('redis');
const RDATA_BASE_URL = process.env.RDATA_BASE_URL;
const redisClient = redis.createClient({
    url: 'redis://cache:6380'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

redisClient.connect().then(() => {
    console.log('connected to redis game cache on port 6380');
});

console.log("RDATA BASE URL: " + RDATA_BASE_URL)

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
    
    // console.log(processedGame)
    // console.log(typeof processedGame)
    pbp = processedGame;
    pbp.plays = processedGame["plays"];
    // console.log(plays)
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

    try {
        await redisClient.set(`cfb-${gameId}`, JSON.stringify(pbp));
        await redisClient.expire(`cfb-${gameId}`, 60 * 2); // 2 min TTL
    } catch (e) {
        console.log(`failed to write game data for key cfb-${gameId} to redis game cache, error: ${e}`);
    }

    return pbp;
}

async function retrievePBP(gameId) {
    try {
        console.log(`Looking for ${gameId} for sport 'cfb' in game cache`)
        const rawPBP = await redisClient.get(`cfb-${gameId}`);
        if (!rawPBP) {
            throw new Error(`Failed to find gameID ${gameId} for sport 'cfb' in game cache, forcing retrieval from remote`)
        }
        console.log(`Found content for ${gameId} for sport 'cfb' in game cache, returning to caller`)
        // console.log(`content: ${rawPBP}`)
        return JSON.parse(rawPBP);
    } catch (e) {
        console.log(`ERROR on redis game cache retrieval: ${e}`)
        return await _remoteRetrievePBP(gameId);
    }
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