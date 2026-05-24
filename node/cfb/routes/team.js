import express from 'express';
import * as TeamsModel from '../resources/team.js';
import logger from '../../utils/logger.js';
import { sendCachedResponse } from '../../utils/cache.js';

const router = express.Router();
logger.info("activating teams route page cache")
// router.use(cachePage(60 * 60 * 24)) // 1 day TTL for stuff that doesn't change

router.get('/:teamId', async function(req, res, next) {
    return await sendCachedResponse(req, res, next, `team-${req.params.teamId}`, 60 * 60 * 24, TeamsModel.generateTeamHtml(req.params.teamId))
})

router.get('/:teamId/year/:year', async function(req, res, next) {
    return res.redirect(`/cfb/year/${req.params.year}/team/${req.params.teamId}`) // TODO: santitize URL inputs
})

export default router;