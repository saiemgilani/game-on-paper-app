import axios from 'axios';
import logger from '../../utils/logger.js';
import { URLSearchParams } from 'node:url';
import * as SummaryModel from './summary.js';
import {getPercentileKey, renderFile} from '../../utils/misc.js';

async function populate(endpoint, season, teamId, type = null) {
    let seasonType = type != null ? `/types/${type}` : ""
    let seasonStr = season != null ? `/seasons/${season}` : ""
    const res =  await axios.get(`https://sports.core.api.espn.com/v2/sports/football/leagues/college-football${seasonStr}${seasonType}/teams/${teamId}/${endpoint}?lang=en&region=us`, {
        protocol: "https"
    })
    logger.info(res.request.res.responseUrl)
    let espnContent = res.data;
    if (espnContent == null) {
        throw Error(`Data not available for ESPN endpoint ${endpoint} with year ${season} and team ${teamId}.`)
    }

    let result = espnContent ?? {};
    return result;
}

async function getTeamInformation(teamId) {
    return await populate("", null, teamId)
}

async function getTeamSeasonInformation(season, teamId) {
    var result =  await populate("", season, teamId);

    let populatableKeys = ["record", "athletes", "ranks", "leaders"]
    let typeKeys = ["record", "leaders"]
    var valPromises = []
    populatableKeys.forEach(item => {
        valPromises.push(populate(item, season, teamId, typeKeys.includes(item) ? "2" : null));
    });

    let populatingValues = await Promise.all(valPromises);
    populatableKeys.forEach((item, idx) => {
        result[item] = populatingValues[idx].items;
    });

    // logger.info(result);
    var schedulePromises = []
    let types = [2, 3];
    types.forEach(type => {
        let params = new URLSearchParams({ seasontype: type })
        if (season) {
            params.append("season", season)
        }
        schedulePromises.push(axios.get(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamId}/schedule?` + params.toString(), {
            protocol: "https"
        }))
    })
    let responses = await Promise.all(schedulePromises);
    result.events = [];

    responses.forEach(response => {
        Object.entries(response.data.events).forEach(([date, game]) => {
            if (game != null && game.competitions != null) {
                game.status = game.competitions[0].status;
                result.events = result.events.concat(game)
            }
        })
    })

    return result;
}

async function generateTeamHtml(teamId) {
    let data = await getTeamInformation(teamId)
    if (data == null) {
        throw Error(`Data not available for team ${teamId}. An internal service may be down.`)
    }

    const brkd = await SummaryModel.retrieveTeamData(null, teamId, null)
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


    return renderFile('pages/cfb/team', {
        teamData: data,
        breakdowns: brkd,
        seasons: brkd.map(b => b.season).sort(),
        percentiles: selectedPercentiles,
        type,
        metric,
        last_updated: await SummaryModel.retrieveLastUpdated()
    });
}

async function generateTeamSeasonHtml(year, teamId) {
    let data = await getTeamSeasonInformation(year, teamId)
    if (data == null) {
        throw Error(`Data not available for team ${teamId} and season ${year}. An internal service may be down.`)
    }

    const brkd = await SummaryModel.retrieveTeamData(year, teamId, 'overall')
    // logger.info(brkd[0])
    return renderFile('pages/cfb/team_season', {
        teamData: data,
        breakdown: brkd,
        players: {
            passing: await SummaryModel.retrieveTeamData(year, teamId, 'passing'),
            rushing: await SummaryModel.retrieveTeamData(year, teamId, 'rushing'),
            receiving: await SummaryModel.retrieveTeamData(year, teamId, 'receiving')
        },
        season: year
    });
}

export {
    generateTeamHtml,
    generateTeamSeasonHtml,
    getTeamSeasonInformation,
    getTeamInformation
}