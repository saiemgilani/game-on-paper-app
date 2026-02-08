const express = require('express');
const cachePage = require('../../utils/cache');
const SummaryModel = require("../resources/summary")
const logger = require("../../utils/logger");
const getPercentileKey = require("../../utils/misc").getPercentileKey;

const router = express.Router();
logger.info("activating charts route page cache")
router.use(cachePage(60)) // 1 minute TTL for stuff that does change

router.get('/team/epa', async (req, res, next) => {
    return res.redirect(`/cfb/year/2025/charts/team/epa`)
})

router.get('/trends', async function(req, res, next) {
    try {
        let type = req.query.type ?? "offensive";
        // can't do differentials here
        if (type == "differential") {
            type = "offensive"
        }
        let metric = req.query.metric ?? `overall.epaPerPlay`

        let allPctls = []
        for (const p of [0.01, 0.25, 0.5, 0.75, 0.99]) {
            const percentiles = await SummaryModel.retrievePercentiles(null, p);
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
                last_updated: await SummaryModel.retrieveLastUpdated()
            });
        }
    } catch(err) {
        console.error(err)
        return next(err)
    }
})

module.exports = router;