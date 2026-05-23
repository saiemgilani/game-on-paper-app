const express = require('express');
const GamesModel = require('../resources/game');
const logger = require("../../utils/logger");

const router = express.Router();
logger.info("activating games route page cache")
const { setCachedValue, getCachedValue } = require("../../utils/cache")
// router.use(cachePage(60 * 60 * 24)) // 1 day TTL for stuff that doesn't change

router.get('/:gameId', async function(req, res, next) {
    try {            
        let pbpHtml = await getCachedValue(`game-${req.params.gameId}`)
        if (!pbpHtml) {
            // if not found in redis, redirect to archived file
            logger.warn(`Cache miss: ${req.params.gameId}`)
            pbpHtml = await GamesModel.generateGameHtml(req.params.gameId);
            await setCachedValue(`game-${req.params.gameId}`, pbpHtml, 60)
            // return res.redirect(`/cfb/game/${req.params.gameId}/archive`)
        } else {
            logger.info(`Cache hit: ${req.params.gameId}`)
        }
        // if found in redis, return response
        return res.type("html").send(pbpHtml);
    } catch (e) {
        logger.error(`Error while loading PBP data: ${e}`);
        return next(e)
    }
})

module.exports = router