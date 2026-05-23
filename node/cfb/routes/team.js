const express = require('express');
const TeamsModel = require('../resources/team');
const logger = require("../../utils/logger");

const router = express.Router();
logger.info("activating teams route page cache")
const { REDIS_CLIENT } = require("../../utils/cache")
// router.use(cachePage(60)) // 1 minute TTL for stuff that does change

router.get('/:teamId', async function(req, res, next) {
    try {            
        let teamHtml = await REDIS_CLIENT.get(`team-${req.params.teamId}`) // TODO: santitize URL inputs
        if (!teamHtml) {
            // if not found in redis, redirect to archived file
            logger.warn(`Cache miss: ${req.params.teamId}`)
            // return res.redirect(`/cfb/team/${req.params.teamId}/archive`)
            teamHtml = await TeamsModel.generateTeamHtml(req.params.teamId);
        } else {
            logger.info(`Cache hit: ${req.params.teamId}`)
        }
        // if found in redis, return response
        return res.type("html").send(teamHtml);
    } catch (e) {
        logger.error(`Error while loading team data: ${e}`);
        return next(e)
    }
})

router.get('/:teamId/year/:year', async function(req, res, next) {
    return res.redirect(`/cfb/year/${req.params.year}/team/${req.params.teamId}`) // TODO: santitize URL inputs
})

module.exports = router