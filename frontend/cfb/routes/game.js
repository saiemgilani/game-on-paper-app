const express = require('express');
const GamesModel = require('../resources/game');
const logger = require("../../utils/logger");

const router = express.Router();
logger.info("activating games route page cache")
const { REDIS_CLIENT } = require("../../utils/cache")
// router.use(cachePage(60)) // 1 minute TTL for stuff that does change

router.route('/:gameId')
    .get(async function(req, res, next) {
        try {            
            let pbpHtml = await REDIS_CLIENT.get(req.params.gameId)
            if (!pbpHtml) {
                // if not found in redis, 404? or pull stored file?
                logger.warn(`Cache miss: ${req.params.gameId}`)
                pbpHtml = await GamesModel.generateGameHtml(req.params.gameId)
                if (!pbpHtml) {
                    throw Error(`Data not available for game ${req.params.gameId}. An internal service may be down.`)
                }
            } else {
                logger.info(`Cache hit: ${req.params.gameId}`)
            }
            // if found in redis, return response
            // logger.debug(pbpHtml.substring(0, 100))
            return res.type("html").send(pbpHtml);
        } catch (e) {
            logger.error(`Error while loading PBP data: ${e}`);
            return next(e)
        }
    })

module.exports = router