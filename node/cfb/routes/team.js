import express from 'express';
import * as TeamsModel from '../resources/team.js';
import logger from '../../utils/logger.js';
import { getCachedValue, setCachedValue } from '../../utils/cache.js';

const router = express.Router();
logger.info("activating teams route page cache")
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

export default router;