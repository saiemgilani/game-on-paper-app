import express from 'express';
import * as Leaderboards from '../resources/leaderboard.js';
import logger from '../../utils/logger.js';
import { CURRENT_YEAR, getPercentileKey } from '../../utils/misc.js';
import { sendCachedResponse } from '../../utils/cache.js';

const router = express.Router();
logger.info("activating charts route page cache")
router.get('/team/epa', async (req, res, next) => {
    return res.redirect(`/cfb/year/${CURRENT_YEAR}/charts/team/epa`)
})

router.get('/team/epa/year/:year', async (req, res, next) => {
    return res.redirect(`/cfb/year/${req.params.year}/charts/team/epa`)
})

router.get('/trends', async function(req, res, next) {
    try {
        let type = req.query.type ?? "offensive";
        // can't do differentials here
        if (type == "differential") {
            type = "offensive"
        }
        let metric = req.query.metric ?? `overall.epaPerPlay`
        const htmlValue = await sendCachedResponse("team-trends", 60 * 60 * 24, Leaderboards.getTrends(type, metric));
        return res.type("html").send(htmlValue);
    } catch(err) {
        logger.error(`ERROR while loading chart info: ${err}`)
        return next(err)
    }
})

export default router;