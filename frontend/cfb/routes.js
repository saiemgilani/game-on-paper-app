const express = require('express');
const Games = require('./games');
const Teams = require('./teams');
const Schedule = require('./schedule');
const router = express.Router();
const axios = require('axios');
const redis = require('redis');
const path = require("path");
const fs = require('fs');
const util = require('util');
const debuglog = util.debuglog('[frontend]');
const alphabet = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];
let glossary = {};
fs.readFile(path.resolve(__dirname, "glossary.json"), function (err, data) {
    if (err) {
        debuglog(err)
        throw err;
    }
    debuglog(`Loading glossary...`)
    const tmpGloss = JSON.parse(data);
    alphabet.forEach(letter => {
        let records = tmpGloss[letter];
        if (records) {
            let copyRec = [...records];
            copyRec.sort((a, b) => {
                return a.term.localeCompare(b.term)
            });
            glossary[letter] = copyRec;
        }
    });

    debuglog(`Loaded glossary for ${Object.keys(glossary)} letters`)
});

const redisClient = redis.createClient({
    url: 'redis://redis:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

redisClient.connect().then(() => {
    console.log('connected to redis LRU cache on port 6379');
});

router.get('/healthcheck', Games.getServiceHealth)

async function retrieveGameList(url, params) {
    var gameList = await Games.getGameList(params);
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

async function retrieveRemotePercentiles(year) {
    try {
        const response = await axios({
            method: 'GET',
            url: `http://summary:3000/percentiles/${year}`
        });
        
        // update redis cache
        const content = response.data.results;
        const key = `${year}-percentiles`;
        await redisClient.set(key, JSON.stringify(content))
        await redisClient.expire(key, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
        return content;
    } catch (err) {
        console.log(`could not find percentiles for league in ${year}, checking ${year - 1}`)
        if (err) {
            console.log(`also err: ${err}`);
        }
        if ((year - 1) < 2014) {
            return [];
        } else {
            return await retrieveRemotePercentiles(year - 1);
        }
    }
}

async function retrievePercentiles(year) {
    const key = `${year}-percentiles`;
    try {
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty league data from redis for key: ${key}, repulling`)
        }
        // console.log(`found content for key ${key}: ${content}`)
        return JSON.parse(content);
    } catch (err) {
        console.log(err)
        console.log(`receieved some error from redis for key: ${key}, repulling league data`)
        return await retrieveRemotePercentiles(year);
    }
}

async function retrieveRemoteData(payload) {
    let query = payload;
    for (let param in query) { /* You can get copy by spreading {...query} */
        if (query[param] === undefined /* In case of undefined assignment */
            || query[param] === null 
            || query[param] === ""
        ) {    
            delete query[param];
        }
    }
    console.log(`loading from summary: ${JSON.stringify(query)}`)
    const response = await axios({
        method: 'POST',
        url: `http://summary:3000/`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams(query)
    });
    const content = response.data.results;
    return content;
}

async function retrieveRemoteLeagueData(year, type) {
    try {        
        // update redis cache
        const content = await retrieveRemoteData({
            year,
            type: type
        });
        const key = `${year}-${type}`;
        await redisClient.set(key, JSON.stringify(content))
        await redisClient.expire(key, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
        return content;
    } catch (err) {
        console.log(`could not find data for league in ${year}, checking ${year - 1}`)
        if (err) {
            console.log(`also err: ${err}`);
        }
        if ((year - 1) < 2014) {
            return [];
        } else {
            return await retrieveRemoteLeagueData(year - 1, type);
        }
    }
}

async function retrieveLeagueData(year, type) {
    const key = `${year}-${type}`;
    try {
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty league data from redis for key: ${key}, repulling`)
        }
        // console.log(`found content for key ${key}: ${content}`)
        return JSON.parse(content);
    } catch (err) {
        console.log(err)
        console.log(`receieved some error from redis for key: ${key}, repulling league data`)
        return await retrieveRemoteLeagueData(year, type);
    }
}

async function retrieveRemoteTeamData(year, team_id, type) {
    try {
        // update redis cache
        const content = await retrieveRemoteData({
            year,
            team: team_id,
            type: type
        });
        const key = `${year}-${team_id}-${type}`;
        await redisClient.set(key, JSON.stringify(content))
        await redisClient.expire(key, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
        return content;
    } catch (err) {
        console.log(`could not find data for ${team_id} in ${year}, checking ${year - 1}`)
        if (err) {
            console.log(`also err: ${err}`);
        }
        if ((year - 1) < 2014) {
            return [{
                pos_team: team_id
            }];
        } else {
            return await retrieveRemoteTeamData(year - 1, team_id, type);
        }
    }
}

async function retrieveTeamData(year, team_id, type) {
    try {
        let keyParts = []
        if (year) {
            keyParts.push(year)
        }
        if (team_id) {
            keyParts.push(team_id)
        }
        if (keyParts.length == 0) {
            throw new Error("invalid team data request, must include year AND/OR team")
        }
        if (type) {
            keyParts.push(type)
        }
        const key = keyParts.join("-");
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty data from redis for key: ${key}, repulling`)
        }
        return JSON.parse(content);
    } catch (err) {
        console.log(err)
        if (err.message == "invalid team data request, must include year AND/OR team") {
            return [];
        }
        return await retrieveRemoteTeamData(year, team_id, type);
    }
}

async function retrieveRemoteLastUpdated() {
    const response = await axios({
        method: 'GET',
        url: `http://summary:3000/updated`
    });
    const content = response.data;
    await redisClient.set(`summary-last-updated`, JSON.stringify(content))
    await redisClient.expire(`summary-last-updated`, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
    return content.last_updated;
}

async function retrieveLastUpdated() {
    try {
        const key = `summary-last-updated`;
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty data from redis for key: ${key}, repulling`)
        }
        return JSON.parse(content).last_updated;
    } catch (err) {
        console.log(err)
        return await retrieveRemoteLastUpdated();
    }
}

router.get('/', async function(req, res, next) {
    try {
        let gameList = await retrieveGameList(req.originalUrl, { group: req.query.group });
        let weekList = await Schedule.getWeeksMap();
        let groupList = await Schedule.getGroups();

        return res.render('pages/cfb/index', {
            scoreboard: gameList,
            weekList: weekList,
            groups: groupList,
            year: req.params.year,
            week: req.params.week,
            seasontype: 2,
            group: req.query.group || 80,
            title: null
        });
    } catch(err) {
        return next(err)
    }
});

router.route('/year/:year/type/:type/week/:week')
    .get(async function(req, res, next) {
        try {
            let gameList = await retrieveGameList(req.originalUrl, { year: req.params.year, week:req.params.week, type: req.params.type, group: req.query.group });
            let weekList = await Schedule.getWeeksMap();
            let groupList = await Schedule.getGroups();

            const weekTitle = weekList[req.params.year]?.find(w => parseInt(w.type) == parseInt(req.params.type) && parseInt(w.value) == parseInt(req.params.week))?.title;

            return res.render('pages/cfb/index', {
                scoreboard: gameList,
                weekList: weekList,
                groups: groupList,
                year: req.params.year,
                week: req.params.week,
                seasontype: req.params.type,
                group: req.query.group || 80,
                title: weekTitle
            });
        } catch(err) {
            return next(err)
        }
    })
    .post(async function(req, res, next) {
        try {
            let data = await retrieveGameList(req.originalUrl, { year: req.params.year, week:req.params.week, type: req.params.type, group: req.query.group })
            return res.json(data);
        } catch(err) {
            return next(err)
        }
    });

router.route('/year/:year')
    .get(async function(req, res, next) {
        try {
            let gameList = await retrieveGameList(req.originalUrl, { year: req.params.year, week: 1, type: 2, group: req.query.group });
            let weekList = await Schedule.getWeeksMap();
            let groupList = await Schedule.getGroups();
            const weekTitle = weekList[req.params.year]?.find(w => parseInt(w.type) == 2 && parseInt(w.value) == 1)?.title;

            return res.render('pages/cfb/index', {
                scoreboard: gameList,
                weekList: weekList,
                groups: groupList,
                year: req.params.year,
                week: 1,
                seasontype: 2,
                group: req.query.group || 80,
                title: weekTitle
            });
        } catch(err) {
            return next(err)
        }
    });

function cleanAbbreviation(abbrev) {
    // add summary abbreviation overrides here
    return abbrev;
}

const QUARANTINE_LIST = [
    '401411157',
    '401403861',
    // 2024 WK 1 - ESPN not providing statYardage on completed passes for these games
    // '401634299',
    // '401628455',
    '401628329',
    '401634301',
    '401634212',
    // '401628456',
    // '401628454',
    '401628398'
]

router.route('/game/:gameId')
    .get(async function(req, res, next) {
        try {
            const cacheBuster = ((new Date()).getTime() * 1000);
            // check if the game is active or in the future
            pbp_url = `http://cdn.espn.com/core/college-football/playbyplay?gameId=${req.params.gameId}&xhr=1&render=false&userab=18&${cacheBuster}`;
            const response = await axios.get(pbp_url);
            const game = response.data["gamepackageJSON"]["header"]["competitions"][0];
            const season = response.data["gamepackageJSON"]["header"]["season"]["year"];
            const week = response.data["gamepackageJSON"]["header"]["week"];
            const homeComp = game.competitors[0];
            const awayComp = game.competitors[1];
            const homeTeam = homeComp.team;
            const awayTeam = awayComp.team;
            const homeKey = cleanAbbreviation(homeTeam.abbreviation);
            const awayKey = cleanAbbreviation(awayTeam.abbreviation);

            // if it's in the future, send to pregame template
            if (game["status"]["type"]["name"] === 'STATUS_SCHEDULED' || (req.query.preview_mode && (req.query.preview_mode == "old" || req.query.preview_mode == "new"))) {
                const homeBreakdown = await retrieveTeamData(season, homeTeam.id, 'overall');
                const awayBreakdown = await retrieveTeamData(season, awayTeam.id, 'overall');
                return res.render('pages/cfb/pregame', {
                    season,
                    week,
                    view_full: (req.query.preview_mode == "old"),
                    gameData: {
                        gameInfo: game,
                        header: response.data["gamepackageJSON"]["header"],
                        matchup: {
                            team: [
                                ...awayBreakdown, ...homeBreakdown
                            ]
                        }
                    }
                });
            }

            try {
                if (QUARANTINE_LIST.includes(req.params.gameId)) {
                    throw new Error(`Game ${req.params.gameId} has been quarantined`);
                }
                // if it's past/live, send to normal template
                const data = await Games.getPBP(req.params.gameId);
                if (data == null || data.gameInfo == null) {
                    throw Error(`Data not available for game ${req.params.gameId}. An internal service may be down.`)
                }
        
                if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
                    return res.json(data);
                } else {
                    let percentiles = [];
                    try {
                        const inputSeason = data["header"]["season"]["year"];
                        const season = Math.min(Math.max(inputSeason, 2014), 2025); // always clamped a season behind until week 4
                        console.log(`retreiving percentiles for season ${season}, input was ${inputSeason} clamped to 2014 to 2025`)
                        percentiles = await retrievePercentiles(season);
                    } catch (e) {
                        console.log(`error while retrieving league percentiles: ${e}`)
                    }

                    return res.render('pages/cfb/game', {
                        gameData: data,
                        percentiles,
                        season
                    });
                }
            } catch (e) {
                console.error(`Error while loading PBP data: ${e}`);
                return res.render('pages/cfb/game_error', {
                    gameData: {
                        gameInfo: game
                    },
                    errorType: (e.message.includes('quarantine')) ? 'quarantine' : 'pbp'
                }); 
            }
        } catch(err) {
            return next(err)
        }
    })
    .post(async function(req, res, next) {
        try {
            let data = await Games.getPBP(req, res);
            if (data == null || data.gameInfo == null) {
                throw Error(`Data not available for game ${req.params.gameId}. An internal service may be down.`)
            }
    
            return res.json(data);
        } catch(err) {
            return next(err)
        }
    });


router.route('/year/:year/team/:teamId')
    .get(async function(req, res, next) {
        try {
            let data = await Teams.getTeamSeasonInformation(req.params.year, req.params.teamId)
            if (data == null) {
                throw Error(`Data not available for team ${req.params.teamId} and season ${req.params.year}. An internal service may be down.`)
            }
    
            if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
                return res.json(data);
            } else {
                const brkd = await retrieveTeamData(req.params.year, req.params.teamId, 'overall')
                // console.log(brkd[0])
                return res.render('pages/cfb/team_season', {
                    teamData: data,
                    breakdown: brkd,
                    players: {
                        passing: await retrieveTeamData(req.params.year, req.params.teamId, 'passing'),
                        rushing: await retrieveTeamData(req.params.year, req.params.teamId, 'rushing'),
                        receiving: await retrieveTeamData(req.params.year, req.params.teamId, 'receiving')
                    },
                    season: req.params.year
                });
            }
        } catch(err) {
            return next(err)
        }
    })

router.route('/team/:teamId')
    .get(async function(req, res, next) {
        try {
            let data = await Teams.getTeamInformation(req.params.teamId)
            if (data == null) {
                throw Error(`Data not available for team ${req.params.teamId}. An internal service may be down.`)
            }

            if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
                return res.json(data);
            } else {
                const brkd = await retrieveTeamData(null, req.params.teamId, null)
                const type = req.query.type ?? "differential";
                let chartKey = req.query.sort ?? `overall.adjEpaPerPlay`
                // can't do passing/rushing/havoc differentials
                if (type == "differential" && (!chartKey.includes("overall") || chartKey.includes("havocRate"))) {
                    chartKey = `overall.adjEpaPerPlay`
                }
                // console.log(brkd[0])
                return res.render('pages/cfb/team', {
                    teamData: data,
                    breakdowns: brkd,
                    seasons: brkd.map(b => b.season).sort(),
                    type: type,
                    chartMetric: chartKey,
                    last_updated: await retrieveLastUpdated()
                });
            }
        } catch(err) {
            console.error(err)
            return next(err)
        }
    })

router.route('/teams')
    .get(async function(req, res, next) {
        return res.redirect(`/cfb/year/2025/teams/differential`);
    })

router.route('/teams/:type')
    .get(async function(req, res, next) {
        return res.redirect(`/cfb/year/2025/teams/${req.params.type}`);
    })

router.route('/year/:year/teams')
    .get(async function(req, res, next) {
        return res.redirect(`/cfb/year/${req.params.year}/teams/differential`);
    })

function retrieveValue(dictionary, key) {
    const subKeys = key.split('.')
    let sub = dictionary;
    for (const k of subKeys) {
        sub = sub[k];
    }
    return sub;
}

router.route('/charts/team/epa')
    .get(async function(req, res, next) { // change after week 4
        return res.redirect(`/cfb/year/2025/charts/team/epa`)
    })

router.route('/year/:year/charts/team/epa')
    .get(async function(req, res, next) {
        try {
            const baseData = await retrieveLeagueData(req.params.year, "overall") 

            let content = baseData.map(t => {
                // let target = t[type]
                return {
                    teamId: t.teamId,
                    team: t.team,
                    fbsClass: t.fbsClass,
                    adjOffEpa: t["offensive"]["overall"]["adjEpaPerPlay"],
                    adjDefEpa: t["defensive"]["overall"]["adjEpaPerPlay"],
                }
            })

            return res.render("pages/cfb/epa_chart", {
                teams: content,
                season: req.params.year,
                last_updated: await retrieveLastUpdated()
            })
        } catch(err) {
            return next(err)
        }
    })

router.route('/year/:year/teams/:type')
    .get(async function(req, res, next) {
        try {
            const type = req.params.type ?? "differential";
            let sortKey = req.query.sort ?? `overall.adjEpaPerPlay`
            // can't do passing/rushing/havoc differentials
            if (type == "differential" && (!sortKey.includes("overall") || sortKey.includes("havocRate"))) {
                sortKey = `overall.adjEpaPerPlay`
            }
            const asc = (type == "defensive" && sortKey != "overall.havocRate") || (type == "offensive" && sortKey == "overall.havocRate") // adjust for defensive stats where it makes sense
            const baseData = await retrieveLeagueData(req.params.year, "overall") 

            let content = baseData.map(t => {
                let target = t[type]
                return {
                    teamId: t.teamId,
                    team: t.team,
                    ...target
                }
            })
            // console.log(content[0])
            content = content.filter(p => {
                const nonNullValue = retrieveValue(p, sortKey) != null && retrieveValue(p, sortKey) != "NA"
                const nonNullRank = retrieveValue(p, `${sortKey}Rank`) != null && retrieveValue(p, `${sortKey}Rank`) != "NA"
                if (sortKey.includes("adjEpaPerPlay")) {
                    return true
                }
                return nonNullRank && nonNullValue
            }).sort((a, b) => {
                const aVal = retrieveValue(a, sortKey)
                const bVal = retrieveValue(b, sortKey)
                
                if (aVal == null & bVal != null) {
                    return 1
                } else if (aVal != null & bVal == null) {
                    return -1
                } else if (aVal == null & bVal == null) {
                    return 0
                } else {
                    const compVal = parseFloat(aVal) - parseFloat(bVal)
                    return asc ? compVal : (-1 * compVal)
                }
            })
            // console.log(content[0])
            // return res.json(content);
            return res.render("pages/cfb/leaderboard", {
                teams: content,
                type,
                season: req.params.year,
                sort: sortKey,
                last_updated: await retrieveLastUpdated()
            })
        } catch(err) {
            return next(err)
        }
    })

router.route('/year/:year/players/:type')
    .get(async function(req, res, next) {
        try {
            const type = req.params.type ?? "passing";
            let sortKey = req.query.sort ?? `advanced.epaPerPlay`
            // // can't do passing/rushing/havoc differentials
            // if (type == "differential" && (!sortKey.includes("overall") || sortKey.includes("havocRate"))) {
            //     sortKey = `overall.epaPerPlay`
            // }
            const asc = false;//(type == "defensive" && sortKey != "overall.havocRate") || (type == "offensive" && sortKey == "overall.havocRate") // adjust for defensive stats where it makes sense
            let content = await retrieveLeagueData(req.params.year, type) 

            content = content.filter(p => {
                const nonNullValue = retrieveValue(p, sortKey) != null && retrieveValue(p, sortKey) != "NA"
                const nonNullRank = retrieveValue(p, `${sortKey}Rank`) != null && retrieveValue(p, `${sortKey}Rank`) != "NA"
                return nonNullRank && nonNullValue
            }).sort((a, b) => {
                const compVal = parseFloat(retrieveValue(a, sortKey)) - parseFloat(retrieveValue(b, sortKey))
                return asc ? compVal : (-1 * compVal)
            })
            // return res.json(content);
            return res.render("pages/cfb/player_leaderboard", {
                players: content,
                type,
                season: req.params.year,
                sort: sortKey,
                last_updated: await retrieveLastUpdated()
            })
        } catch(err) {
            return next(err)
        }
    })

router.route('/players')
    .get(async function(req, res, next) {
        return res.redirect(`/cfb/year/2025/players/passing`);
    })

router.route('/players/:type')
.get(async function(req, res, next) {
    return res.redirect(`/cfb/year/2025/players/${req.params.type}`);
})

router.route('/year/:year/players')
.get(async function(req, res, next) {
    return res.redirect(`/cfb/year/${req.params.year}/players/passing`);
})

router.route('/glossary')
.get(function(req, res, next) {
    return res.render('pages/cfb/glossary', {
        glossary
    });
})

module.exports = router