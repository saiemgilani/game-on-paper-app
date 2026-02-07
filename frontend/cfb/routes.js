const express = require('express');
const axios = require('axios');
const GamesModel = require("./resources/game")
const GlossaryModel = require('./resources/glossary');
const GamesRoute = require("./routes/game");
const YearsRoute = require("./routes/year");
const TeamsRoute = require("./routes/team");

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


router.get('/glossary', (req, res, next) => {
    return res.render('pages/cfb/glossary', {
        glossary: GlossaryModel.generateGlossaryItems()
    });
})


router.use("/game", GamesRoute)
router.use("/year/:year", YearsRoute)
router.use("/team", TeamsRoute)

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

router.get('/charts/team/epa', async (req, res, next) => {
    return res.redirect(`/cfb/year/2025/charts/team/epa`)
})

router.get('/charts/trends', async function(req, res, next) {
    try {
        let type = req.query.type ?? "offensive";
        // can't do differentials here
        if (type == "differential") {
            type = "offensive"
        }
        let metric = req.query.metric ?? `overall.epaPerPlay`

        let allPctls = []
        for (const p of [0.01, 0.25, 0.5, 0.75, 0.99]) {
            const percentiles = await retrievePercentiles(null, p);
            allPctls = allPctls.concat(percentiles);
        }

        const pctlKey = getPercentileKey(metric)
        const selectedPercentiles = allPctls.map(p => {
            var result = {
                season: p["season"],
                pctile: p["pctile"],
            }
            result["value"] = p[pctlKey];
            return result
        }).filter(p => (p["value"] !== undefined) && (p["value"] != null))

        if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
            return res.json(selectedPercentiles); 
        } else {
            return res.render('pages/cfb/trends', {
                seasons: selectedPercentiles.map(b => b.season).sort(),
                percentiles: selectedPercentiles,
                type,
                metric,
                last_updated: await retrieveLastUpdated()
            });
        }
    } catch(err) {
        console.error(err)
        return next(err)
    }
})

module.exports = router