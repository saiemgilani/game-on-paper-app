const express = require('express');
const {cachePage} = require('../../utils/cache');
const SummaryModel = require("../resources/summary")
const TeamModel = require("../resources/team")
const logger = require("../../utils/logger");
const getPercentileKey = require("../../utils/misc").getPercentileKey;

const router = express.Router();
logger.info("activating teams route page cache")
router.use(cachePage(60)) // 1 minute TTL for stuff that does change

router.get('/:teamId', async function(req, res, next) {
    try {
        let data = await TeamModel.getTeamInformation(req.params.teamId)
        if (data == null) {
            throw Error(`Data not available for team ${req.params.teamId}. An internal service may be down.`)
        }

        const brkd = await SummaryModel.retrieveTeamData(null, req.params.teamId, null)
        const type = req.query.type ?? "differential";
        let metric = req.query.metric ?? `overall.adjEpaPerPlay`
        // can't do passing/rushing/havoc differentials
        if (type == "differential" && (!metric.includes("overall") || metric.includes("havocRate"))) {
            metric = `overall.adjEpaPerPlay`
        }

        let selectedPercentiles = []
        if (type != "differential") {
            let allPctls = []
            for (const p of [0.01, 0.25, 0.5, 0.75, 0.99]) {
                const percentiles = await SummaryModel.retrievePercentiles(null, p);
                allPctls = allPctls.concat(percentiles);
            }

            const pctlKey = getPercentileKey(metric)
            selectedPercentiles = allPctls.map(p => {
                var result = {
                    season: p["season"],
                    pctile: p["pctile"],
                }
                result["value"] = p[pctlKey];
                return result
            }).filter(p => (p["value"] !== undefined) && (p["value"] != null))
        }

        // console.log(pctlKey)
        // console.log(selectedPercentiles)
        // console.log(brkd[0])
        return res.render('pages/cfb/team', {
            teamData: data,
            breakdowns: brkd,
            seasons: brkd.map(b => b.season).sort(),
            percentiles: selectedPercentiles,
            type,
            metric,
            last_updated: await SummaryModel.retrieveLastUpdated()
        });
    } catch(err) {
        logger.error(err)
        return next(err)
    }
})

module.exports = router
