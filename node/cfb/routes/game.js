import express from 'express';
import * as GamesModel from '../resources/game.js';
import logger from '../../utils/logger.js';
import { sendCachedResponse } from '../../utils/cache.js';

const router = express.Router();
logger.info("activating games route page cache")
// router.use(cachePage(60)) // 1 minute TTL for stuff that does change
// router.use(cachePage(60 * 60 * 24)) // 1 day TTL for stuff that doesn't change

router.get('/:gameId', async function(req, res, next) {
    return await sendCachedResponse(req, res, next, `game-${req.params.gameId}`, 60, GamesModel.generateGameHtml(req.params.gameId))
})

export default router;