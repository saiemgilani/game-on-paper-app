import express from "express";
import { renderGameList } from './resources/game.js';
import { generateGlossaryItems } from './resources/glossary.js';
import GamesRoute from './routes/game.js';
import YearsRoute from './routes/year.js';
// import TeamsRoute from './routes/team';
import ChartsRoute from './routes/chart.js';
import { ping, range, CURRENT_YEAR, renderFile } from '../utils/misc.js';
import { retrieveLastUpdated, retrieveAllTeams } from './resources/summary.js';
import logger from '../utils/logger.js';
import { sendCachedResponse } from '../utils/cache.js';
const router = express.Router();

router.get('/healthcheck', async (req, res) => {
    const RDATA_BASE_URL = process.env.RDATA_BASE_URL;
    const rdataCheck = await ping(RDATA_BASE_URL + '/healthcheck');
    const cfbdCheck = await ping('https://collegefootballdata.com');
    const espnCheck = await ping('https://cdn.espn.com/college-sports/scoreboard')
    const selfCheck = {
        "status" : "ok"
    }
    
    return res.json({
        "python" : rdataCheck.data,
        "node" : selfCheck,
        "cfbData" : cfbdCheck,
        "espn": espnCheck,
    })
})


// cache this every minute
router.get('/', async function(req, res, next) {
    try {  
        if (!req.query.group) {
            return await sendCachedResponse(req, res, next, "scoreboard", 60, async () => renderGameList({ group: 80 }))
        }

        const htmlValue = await renderGameList({ group: req.query.group }, req.originalUrl)
        return res.type("html").send(htmlValue)
    } catch (e) {
        logger.error(`Error while loading PBP data: ${e}`);
        return next(e)
    }
});


router.get('/glossary', async (req, res, next) => {
    return await sendCachedResponse(req, res, next, "glossary", 60 * 60 * 24, async () => renderFile("pages/cfb/glossary", { glossary: generateGlossaryItems() }))
})

router.get('/teams', async (req, res, next) => {
    return await sendCachedResponse(req, res, next, "teams", 60 * 60 * 24, async () => {
        return renderFile("pages/cfb/team_index", {
            teams: await retrieveAllTeams(),
            seasons: range(2014, CURRENT_YEAR),
            last_updated: await retrieveLastUpdated()
        })
    })
})

router.use("/game", GamesRoute)
router.use("/year/:year", YearsRoute)
// router.use("/team", TeamsRoute)
router.use("/charts", ChartsRoute)

// short hand
router.get('/teams/:type', async (req, res, next) => {
    return res.redirect(`/cfb/year/${CURRENT_YEAR}/teams/${req.params.type}`);
})

router.get('/players', async (req, res, next) => {
    return res.redirect(`/cfb/year/${CURRENT_YEAR}/players/passing`);
})

router.get('/players/:type', async (req, res, next) => {
    return res.redirect(`/cfb/year/${CURRENT_YEAR}/players/${req.params.type}`);
})

export default router;