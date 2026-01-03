const express = require('express');
const cachePage = require('../../utils/cache');
const Games = require('../resources/game');
const SummaryModel = require("../resources/summary")
const axios = require('axios');
const logger = require("../../utils/logger");

const router = express.Router();
logger.info("activating games route page cache")
router.use(cachePage(60)) // 1 minute TTL for stuff that does change

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


router.route('/:gameId')
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

            // if it's in the future, send to pregame template
            if (game["status"]["type"]["name"] === 'STATUS_SCHEDULED' || (req.query.preview_mode && (req.query.preview_mode == "old" || req.query.preview_mode == "new"))) {
                const homeBreakdown = await SummaryModel.retrieveTeamData(season, homeTeam.id, 'overall');
                const awayBreakdown = await SummaryModel.retrieveTeamData(season, awayTeam.id, 'overall');
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
                const data = await Games.retrievePBP(req.params.gameId);
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
                        logger.info(`retreiving percentiles for season ${season}, input was ${inputSeason} clamped to 2014 to 2025`)
                        percentiles = await SummaryModel.retrievePercentiles(season);
                    } catch (e) {
                        logger.error(`error while retrieving league percentiles: ${e}`)
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
            let data = await Games.retrievePBP(req, res);
            if (data == null || data.gameInfo == null) {
                throw Error(`Data not available for game ${req.params.gameId}. An internal service may be down.`)
            }
    
            return res.json(data);
        } catch(err) {
            return next(err)
        }
    });

module.exports = router;