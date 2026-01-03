const axios = require('axios');
const util = require('util');
const debuglog = util.debuglog('[frontend]');

async function populate(endpoint, season, teamId, type = null) {
    let seasonType = type != null ? `/types/${type}` : ""
    const res =  await axios.get(`https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}${seasonType}/teams/${teamId}/${endpoint}?lang=en&region=us`, {
        protocol: "https"
    })
    debuglog(res.request.res.responseUrl)
    let espnContent = res.data;
    if (espnContent == null) {
        throw Error(`Data not available for ESPN endpoint ${endpoint} with year ${season} and team ${teamId}.`)
    }

    let result = espnContent ?? {};
    return result;
}

exports.getTeamInformation = async function (season, teamId) {
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

    // debuglog(result);
    var schedulePromises = []
    let types = [2, 3];
    types.forEach(type => {
        schedulePromises.push(axios.get(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamId}/schedule?season=${season}&seasontype=${type}`, {
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
