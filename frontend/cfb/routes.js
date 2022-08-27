const express = require('express');
const Games = require('./games');
const Teams = require('./teams');
const Schedule = require('./schedule');
const router = express.Router();
const axios = require('axios');
const redis = require('redis');

const redisClient = redis.createClient({
    url: 'redis://redis:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

redisClient.connect().then(() => {
    console.log('connected to redis on port 6379');
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
        } else {
            var aDate = Date.parse(a.date)
            var bDate = Date.parse(b.date)
            if (aDate < bDate) {
                return -1
            } else if (aDate > bDate) {
                return 1
            } else {
                var aVal = parseInt(a.status.type.id)
                var bVal = parseInt(b.status.type.id)
                if (aVal > bVal) {
                    return -1
                } else if (aVal < bVal) {
                    return 1
                } else {
                    return 0
                }
            }
        }
    })
    return gameList;
}

async function retrieveRemoteTeamData(year, abbreviation, type) {
    try {
        const response = await axios({
            method: 'POST',
            url: `http://summary:3000/`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: new URLSearchParams({
                year,
                team: abbreviation,
                type: type
            })
        });
        
        // update redis cache
        const content = response.data.results;
        await redisClient.set(`${year}-${abbreviation}-${type}`, JSON.stringify(content))
        return content;
    } catch (err) {
        console.log(`could not find data for ${abbreviation} in ${year}, checking ${year - 1}`)
        if (err) {
            console.log(`also err: ${err}`);
        }
        if ((year - 1) < 2014) {
            return [{
                pos_team: abbreviation
            }];
        } else {
            return await retrieveRemoteTeamData(year - 1, abbreviation, type);
        }
    }
}

async function retrieveTeamData(year, abbreviation, type) {
    try {
        const key = `${year}-${abbreviation}-${type}`;
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty data from redis for key: ${key}, repulling`)
        }
        return JSON.parse(content);
    } catch (err) {
        console.log(err)
        return await retrieveRemoteTeamData(year, abbreviation, type);
    }
}

router.get('/', async function(req, res, next) {
    try {
        let gameList = await retrieveGameList(req.originalUrl, null);
        let weekList = await Schedule.getWeeksMap();
        return res.render('pages/cfb/index', {
            scoreboard: gameList,
            weekList: weekList,
            year: req.params.year,
            week: req.params.week,
            seasontype: 2
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
            return res.render('pages/cfb/index', {
                scoreboard: gameList,
                weekList: weekList,
                year: req.params.year,
                week: req.params.week,
                seasontype: req.params.type
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
            let gameList = await retrieveGameList(req.originalUrl, { year: req.params.year, week: 1, type: 2, group: 80 });
            let weekList = await Schedule.getWeeksMap();
            return res.render('pages/cfb/index', {
                scoreboard: gameList,
                weekList: weekList,
                year: req.params.year,
                week: 1,
                seasontype: 2
            });
        } catch(err) {
            return next(err)
        }
    });

function cleanAbbreviation(abbrev) {
    if (abbrev == 'NU') {
        return 'NW'
    }
    if (abbrev == 'CLT') {
        return 'CHAR'
    }
    if (abbrev == 'IU') {
        return 'IND'
    }
    return abbrev;
}

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
            if (game["status"]["type"]["name"] === 'STATUS_SCHEDULED') {
                const homeBreakdown = await retrieveTeamData(season, homeKey, 'overall');
                const awayBreakdown = await retrieveTeamData(season, awayKey, 'overall');
                return res.render('pages/cfb/pregame', {
                    season,
                    week,
                    gameData: {
                        gameInfo: game,
                        matchup: {
                            team: [
                                ...awayBreakdown, ...homeBreakdown
                            ]
                        }
                    }
                });
            }

            // if it's past/live, send to normal template
            const data = await Games.getPBP(req.params.gameId);
            if (data == null || data.gameInfo == null) {
                throw Error(`Data not available for game ${req.params.gameId}. An internal service may be down.`)
            }
    
            if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
                return res.json(data);
            } else {
                return res.render('pages/cfb/game', {
                    gameData: data
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
            let data = await Teams.getTeamInformation(req.params.year, req.params.teamId)
            if (data == null) {
                throw Error(`Data not available for team ${req.params.teamId} and season ${req.params.year}. An internal service may be down.`)
            }
    
            if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
                return res.json(data);
            } else {
                return res.render('pages/cfb/team', {
                    teamData: data,
                    breakdown: await retrieveTeamData(req.params.year, cleanAbbreviation(data.abbreviation), 'overall'),
                    players: {
                        passing: await retrieveTeamData(req.params.year, cleanAbbreviation(data.abbreviation), 'passing'),
                        rushing: await retrieveTeamData(req.params.year, cleanAbbreviation(data.abbreviation), 'rushing'),
                        receiving: await retrieveTeamData(req.params.year, cleanAbbreviation(data.abbreviation), 'receiving')
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
    return res.redirect(`/cfb/year/2021/team/${req.params.teamId}`);
})

module.exports = router