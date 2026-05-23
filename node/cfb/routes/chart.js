const express = require('express');
const SummaryModel = require("../resources/summary")
const logger = require("../../utils/logger");
const { CURRENT_YEAR, getPercentileKey } = require('../../utils/misc');

const router = express.Router();
logger.info("activating charts route page cache")
// router.use(cachePage(60)) // 1 minute TTL for stuff that does change
// router.use(cachePage(60 * 60 * 24)) // 1 day TTL for stuff that doesn't change

router.get('/team/epa', async (req, res, next) => {
    return res.redirect(`/cfb/year/${CURRENT_YEAR}/charts/team/epa`)
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

        let availableSeasons = selectedPercentiles.map(b => b.season)
        availableSeasons = [...new Set(availableSeasons)].sort();

        return res.render('pages/cfb/trends', {
            seasons: availableSeasons,
            percentiles: selectedPercentiles,
            type,
            metric,
            last_updated: await SummaryModel.retrieveLastUpdated()
        });
    } catch(err) {
        logger.error(`ERROR while loading chart info: ${err}`)
        return next(err)
    }
})

module.exports = router;