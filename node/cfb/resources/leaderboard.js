import * as SummaryModel from './summary.js';
import {retrieveValue, renderFile} from '../../utils/misc.js';

async function getPlayerLeaderboard(type, sortKey) {
    const asc = false;//(type == "defensive" && sortKey != "overall.havocRate") || (type == "offensive" && sortKey == "overall.havocRate") // adjust for defensive stats where it makes sense
    let content = await SummaryModel.retrieveLeagueData(req.params.year, type) 

    content = content.filter(p => {
        const nonNullValue = retrieveValue(p, sortKey) != null && retrieveValue(p, sortKey) != "NA"
        const nonNullRank = retrieveValue(p, `${sortKey}Rank`) != null && retrieveValue(p, `${sortKey}Rank`) != "NA"
        return nonNullRank && nonNullValue
    }).sort((a, b) => {
        const compVal = parseFloat(retrieveValue(a, sortKey)) - parseFloat(retrieveValue(b, sortKey))
        return asc ? compVal : (-1 * compVal)
    })
    // return res.json(content);
    return renderFile("pages/cfb/player_leaderboard", {
        players: content,
        type,
        season: req.params.year,
        sort: sortKey,
        last_updated: await SummaryModel.retrieveLastUpdated()
    })
}


async function getTeamLeaderboard(type, sortKey) {
    // can't do passing/rushing/havoc differentials
    const asc = (type == "defensive" && sortKey != "overall.havocRate") || (type == "offensive" && sortKey == "overall.havocRate") // adjust for defensive stats where it makes sense
    const baseData = await SummaryModel.retrieveLeagueData(req.params.year, "overall") 

    let content = baseData.map(t => {
        let target = t[type]
        return {
            teamId: t.teamId,
            team: t.team,
            ...target
        }
    })
    // logger.info(content[0])
    content = content.filter(p => {
        const nonNullValue = retrieveValue(p, sortKey) != null && retrieveValue(p, sortKey) != "NA"
        const nonNullRank = retrieveValue(p, `${sortKey}Rank`) != null && retrieveValue(p, `${sortKey}Rank`) != "NA"
        if (sortKey.includes("adjEpaPerPlay")) {
            return true
        }
        return nonNullRank && nonNullValue
    }).sort((a, b) => {
        const aVal = retrieveValue(a, sortKey)
        const bVal = retrieveValue(b, sortKey)
        
        if (aVal == null & bVal != null) {
            return 1
        } else if (aVal != null & bVal == null) {
            return -1
        } else if (aVal == null & bVal == null) {
            return 0
        } else {
            const compVal = parseFloat(aVal) - parseFloat(bVal)
            return asc ? compVal : (-1 * compVal)
        }
    })
    // logger.info(content[0])
    // return res.json(content);
    return renderFile("pages/cfb/leaderboard", {
        teams: content,
        type,
        season: req.params.year,
        sort: sortKey,
        last_updated: await SummaryModel.retrieveLastUpdated()
    })
}

async function getTrends(type, metric) {
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

    return renderFile('pages/cfb/trends', {
        seasons: availableSeasons,
        percentiles: selectedPercentiles,
        type,
        metric,
        last_updated: await SummaryModel.retrieveLastUpdated()
    });
}

async function getEpaChart() {
    const baseData = await SummaryModel.retrieveLeagueData(req.params.year, "overall") 

    let content = baseData.map(t => {
        // let target = t[type]
        return {
            teamId: t.teamId,
            team: t.team,
            fbsClass: t.fbsClass,
            adjOffEpa: t.offensive?.overall?.adjEpaPerPlay,
            adjDefEpa: t.defensive?.overall?.adjEpaPerPlay
        }
    })

    return renderFile("pages/cfb/epa_chart", {
        teams: content,
        season: req.params.year,
        last_updated: await SummaryModel.retrieveLastUpdated()
    })
}

export {
    getTeamLeaderboard,
    getPlayerLeaderboard,
    getTrends,
    getEpaChart
}