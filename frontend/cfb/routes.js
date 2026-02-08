const express = require('express');
const GamesModel = require("./resources/game")
const GlossaryModel = require('./resources/glossary');
const GamesRoute = require("./routes/game");
const YearsRoute = require("./routes/year");
const TeamsRoute = require("./routes/team");
const ChartsRoute = require("./routes/chart");
const logger = require("../utils/logger");
const ping = require("../utils/misc").ping;
const CURRENT_YEAR = require("../utils/misc").CURRENT_YEAR;

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
    return GamesModel.routeGameList(
        req, 
        res,
        next,
        {
            group: req.query.group || 80
        }
    )
});


router.get('/glossary', async (req, res, next) => {
    try {
        const glossary = await GlossaryModel.generateGlossaryItems()
        return res.render('pages/cfb/glossary', {
            glossary 
        });
    } catch (err) {
        return next(err)
    }
})


router.use("/game", GamesRoute)
router.use("/year/:year", YearsRoute)
router.use("/team", TeamsRoute)
router.use("/charts", ChartsRoute)

// short hand
 // update at week 4
router.get('/teams', async (req, res, next) => {
    return res.redirect(`/cfb/year/${CURRENT_YEAR}/teams/differential`);
})

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