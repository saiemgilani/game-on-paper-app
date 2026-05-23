const express = require('express');
const SummaryModel = require("../resources/summary")
const GamesModel = require("../resources/game")
const Teams = require("../resources/team")
const Leaderboards = require("../resources/leaderboard")
const logger = require("../../utils/logger");
const { setCachedValue, getCachedValue } = require("../../utils/cache")
const router = express.Router({ mergeParams: true });
logger.info("activating years page cache")
// router.use(cachePage(60 * 60 * 24)) // 1 day TTL for stuff that doesn't change

router.get('/', async (req, res, next) => {
    return GamesModel.routeGameList(
        req, 
        res,
        next,
        {
            year: req.params.year, 
            week: 1, 
            type: 2, 
            group: req.query.group || 80
        }
    )
});

router.get('/type/:type', async (req, res, next) => {
    return GamesModel.routeGameList(
        req, 
        res,
        next,
        {
            year: req.params.year, 
            week: 1, 
            type: req.params.type, 
            group: req.query.group || 80
        }
    )
})

router.get('/type/:type/week/:week', async (req, res, next) => {
    return GamesModel.routeGameList(
        req, 
        res,
        next,
        {
            year: req.params.year, 
            week: req.params.week, 
            type: req.params.type, 
            group: req.query.group || 80
        }
    )
})

router.get('/team/:teamId', async function(req, res, next) {
    try {            
        let teamHtml = await getCachedValue(`team-${req.params.teamId}-${req.params.year}`) // TODO: santitize URL inputs
        if (!teamHtml) {
            // if not found in redis, redirect to archived file
            logger.warn(`Cache miss: team-${req.params.teamId}-${req.params.year}`)
            // return res.redirect(`/cfb/team/${req.params.teamId}/archive`)
            teamHtml = await Teams.generateTeamSeasonHtml(req.params.year, req.params.teamId);
            await setCachedValue(`team-${req.params.teamId}-${req.params.year}`, teamHtml, 60 * 60 * 24)
        } else {
            logger.info(`Cache hit: team-${req.params.teamId}-${req.params.year}`)
        }
        // if found in redis, return response
        return res.type("html").send(teamHtml);
    } catch (e) {
        logger.error(`Error while loading team season data: ${e}`);
        return next(e)
    }
})

router.get('/charts/team/epa', async (req, res, next) => {
    try {
        const baseData = await SummaryModel.retrieveLeagueData(req.params.year, "overall") 

        let content = baseData.map(t => {
            // let target = t[type]
            return {
                teamId: t.teamId,
                team: t.team,
                fbsClass: t.fbsClass,
                adjOffEpa: t.offensive?.overall?.adjEpaPerPlay,
                adjDefEpa: t.defensive?.overall?.adjEpaPerPlay
            }
        })

        return res.render("pages/cfb/epa_chart", {
            teams: content,
            season: req.params.year,
            last_updated: await SummaryModel.retrieveLastUpdated()
        })
    } catch(err) {
        return next(err)
    }
})

router.get('/teams/:type', async (req, res, next) => {
    try {
        const type = req.params.type ?? "differential";
        let sortKey = req.query.sort ?? `overall.adjEpaPerPlay`
        if (type == "differential" && (!sortKey.includes("overall") || sortKey.includes("havocRate"))) {
            sortKey = `overall.adjEpaPerPlay`
        }
        return Leaderboards.getTeamLeaderboard(type, sortKey)
    } catch(err) {
        return next(err)
    }
})

router.get('/players/:type', async (req, res, next) => {
    try {
        const type = req.params.type ?? "passing";
        let sortKey = req.query.sort ?? `advanced.epaPerPlay`
        return Leaderboards.getPlayerLeaderboard(type, sortKey)
    } catch(err) {
        return next(err)
    }
})

router.get('/players', async (req, res, next) => {
    return res.redirect(`/cfb/year/${req.params.year}/players/passing`);
})

router.get('/teams', async (req, res, next) => {
    return res.redirect(`/cfb/year/${req.params.year}/teams/differential`);
})

module.exports = router;