const express = require('express');
const { routeGameList } = require("./resources/game")
const { generateGlossaryItems } = require('./resources/glossary');
const GamesRoute = require("./routes/game");
const YearsRoute = require("./routes/year");
// const TeamsRoute = require("./routes/team");
const ChartsRoute = require("./routes/chart");
const { ping, range, CURRENT_YEAR } = require("../utils/misc");
const { retrieveLastUpdated, retrieveAllTeams } = require('./resources/summary');
const logger = require("../utils/logger");
const { getCachedValue, setCachedValue } = require("../utils/cache")
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
        let pbpHtml = null;  
        if (!req.query.group) {
            // if scoreboard found in redis, return response
            pbpHtml = await getCachedValue(`scoreboard`)
        }
        
        if (!pbpHtml) {
            pbpHtml = await routeGameList(
                {
                    group: req.query.group || 80
                }, 
                req.originalUrl
            )
            if (!req.query.group) {
                await setCachedValue("scoreboard", pbpHtml, 60)
            }
        }
        
        return res.type("html").send(pbpHtml);
    } catch (e) {
        logger.error(`Error while loading PBP data: ${e}`);
        return next(e)
    }
});


router.get('/glossary', async (req, res, next) => {
    try {
        const glossary = await generateGlossaryItems()
        return res.render('pages/cfb/glossary', {
            glossary 
        });
    } catch (err) {
        return next(err)
    }
})

router.get('/teams', async (req, res, next) => {
    try {
        return res.render("pages/cfb/team_index", {
            teams: await retrieveAllTeams(),
            seasons: range(2014, CURRENT_YEAR),
            last_updated: await retrieveLastUpdated()
        })
    } catch (err) {
        return next(err)
    }
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

module.exports = router