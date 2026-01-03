const express = require('express');
const axios = require('axios');

const GamesModel = require('./resources/game');
const ScheduleModel = require('./resources/schedule');
const GlossaryModel = require('./resources/glossary');
const GamesRoute = require("./routes/game");
const YearsRoute = require("./routes/year");

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
    try {
        const gameList = await GamesModel.retrieveGameList(req.originalUrl, { group: req.query.group });
        const weekList = ScheduleModel.getWeeksMap();
        const groupList = ScheduleModel.getGroups();
        return res.render('pages/cfb/index', {
            scoreboard: gameList,
            weekList: weekList,
            groups: groupList,
            year: req.params.year,
            week: req.params.week,
            seasontype: 2,
            group: req.query.group || 80
        });
    } catch(err) {
        return next(err)
    }
});


router.get('/glossary', (req, res, next) => {
    return res.render('pages/cfb/glossary', {
        glossary: GlossaryModel.generateGlossaryItems()
    });
})


router.use("/game", GamesRoute)
router.use("/year/:year", YearsRoute)

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

router.get('/charts/team/epa', async (req, res, next) => { // change after week 4
    return res.redirect(`/cfb/year/2025/charts/team/epa`)
})

module.exports = router