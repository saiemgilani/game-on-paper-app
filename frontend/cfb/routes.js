const express = require('express');
const axios = require('axios');
const GamesModel = require("./resources/game")
const GlossaryModel = require('./resources/glossary');
const GamesRoute = require("./routes/game");
const YearsRoute = require("./routes/year");
const TeamsRoute = require("./routes/team");
const ChartsRoute = require("./routes/chart");
const logger = require("../utils/logger");

const router = express.Router();

router.get('/healthcheck', async (req, res) => {
    const RDATA_BASE_URL = process.env.RDATA_BASE_URL;
    const rdataCheck = await axios.get(RDATA_BASE_URL + '/healthcheck');
    const cfbDataCheck = await axios.get('https://collegefootballdata.com');

    var cfbdCheck = {
        status: (cfbDataCheck.status == 200) ? "ok" : "bad"
    }

    const selfCheck = {
        "status" : "ok"
    }
    
    return res.json({
        "python" : rdataCheck.data,
        "node" : selfCheck,
        "cfbData" : cfbdCheck
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
    const glossary = await GlossaryModel.generateGlossaryItems()
    logger.info(glossary)
    return res.render('pages/cfb/glossary', {
        glossary 
    });
})


router.use("/game", GamesRoute)
router.use("/year/:year", YearsRoute)
router.use("/team", TeamsRoute)
router.use("/charts", ChartsRoute)

// short hand
router.get('/teams', async (req, res, next) => {
    return res.redirect(`/cfb/year/2025/teams/differential`);
})

router.get('/teams/:type', async (req, res, next) => {
    return res.redirect(`/cfb/year/2025/teams/${req.params.type}`);
})

router.get('/players', async (req, res, next) => {
    return res.redirect(`/cfb/year/2025/players/passing`);
})

router.get('/players/:type', async (req, res, next) => {
    return res.redirect(`/cfb/year/2025/players/${req.params.type}`);
})

module.exports = router