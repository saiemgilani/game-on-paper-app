const express = require('express');
const TeamsModel = require('../resources/team');
const logger = require("../../utils/logger");

const router = express.Router();
logger.info("activating teams route page cache")
const { getCachedValue, setCachedValue } = require("../../utils/cache")
// router.use(cachePage(60 * 60 * 24)) // 1 day TTL for stuff that doesn't change

router.get('/:teamId', async function(req, res, next) {
    try {            
        let teamHtml = await getCachedValue(`team-${req.params.teamId}`) // TODO: santitize URL inputs
        if (!teamHtml) {
            // if not found in redis, redirect to archived file
            logger.warn(`Cache miss: ${req.params.teamId}`)
            // return res.redirect(`/cfb/team/${req.params.teamId}/archive`)
            teamHtml = await TeamsModel.generateTeamHtml(req.params.teamId);
            await setCachedValue(`team-${req.params.teamId}`, teamHtml, 60 * 60 * 24)
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