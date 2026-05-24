import express from 'express';
import * as SummaryModel from '../resources/summary.js';
import * as GamesModel from '../resources/game.js';
import * as TeamsModel from '../resources/team.js';
import * as Leaderboards from '../resources/leaderboard.js';
import logger from '../../utils/logger.js';
import { sendCachedResponse, cacheResponse } from '../../utils/cache.js';
const router = express.Router({ mergeParams: true });
logger.info("activating years page cache")
// router.use(cachePage(60 * 60 * 24)) // 1 day TTL for stuff that doesn't change

router.get('/', async (req, res, next) => {
    try {
        const htmlValue = await GamesModel.renderGameList(
            {
                year: req.params.year, 
                week: 1, 
                type: 2, 
                group: req.query.group || 80
            },
        )
        return res.type("html").send(htmlValue)
    } catch (e) {
        logger.error(`ERROR while loading path: ${req.originalUrl}: ${e}`)
        return next(e)
    }
});

router.get('/type/:type', async (req, res, next) => {
    try {
        const htmlValue = await GamesModel.renderGameList(
            {
                year: req.params.year, 
                week: 1, 
                type: req.params.type, 
                group: req.query.group || 80
            },
        )
        return res.type("html").send(htmlValue)
    } catch (e) {
        logger.error(`ERROR while loading path: ${req.originalUrl}: ${e}`)
        return next(e)
    }
})

router.get('/type/:type/week/:week', async (req, res, next) => {
    try {
        const htmlValue = await GamesModel.renderGameList(
            {
                year: req.params.year, 
                week: req.params.week, 
                type: req.params.type, 
                group: req.query.group || 80
            },
        )
        return res.type("html").send(htmlValue)
    } catch (e) {
        logger.error(`ERROR while loading path: ${req.originalUrl}: ${e}`)
        return next(e)
    }
})

router.get('/team/:teamId', async (req, res, next) => {
    return await sendCachedResponse(req, res, next, `team-${req.params.teamId}-${req.params.year}`, 60 * 60 * 24, TeamsModel.generateTeamSeasonHtml(req.params.year, req.params.teamId));
})


router.get('/charts/team/epa', async (req, res, next) => {
    return await sendCachedResponse(req, res, next, `epa-${req.params.year}`, 60 * 60 * 24, Leaderboards.getEpaChart())
})

router.get('/teams/:type', async (req, res, next) => {
    try {
        const type = req.params.type ?? "differential";
        let sortKey = req.query.sort ?? `overall.adjEpaPerPlay`
        if (type == "differential" && (!sortKey.includes("overall") || sortKey.includes("havocRate"))) {
            sortKey = `overall.adjEpaPerPlay`
        }
        const htmlValue = cacheResponse(`team-sort-${type}-${sortKey}`, 60 * 60 * 24, Leaderboards.getTeamLeaderboard(type, sortKey))
        return res.type("html").send(htmlValue);
    } catch(err) {
        return next(err)
    }
})

router.get('/players/:type', async (req, res, next) => {
    try {
        const type = req.params.type ?? "passing";
        let sortKey = req.query.sort ?? `advanced.epaPerPlay`
        const htmlValue = cacheResponse(`player-sort-${type}-${sortKey}`, 60 * 60 * 24, Leaderboards.getPlayerLeaderboard(type, sortKey))
        return res.type("html").send(htmlValue); 
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

export default router;