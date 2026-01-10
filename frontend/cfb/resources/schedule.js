// schedule.js
const fs = require('fs');
const logger = require("../../utils/logger");
const axios = require('axios')
const path = require("path");

logger.info("Compiling schedule vars");
let schedule = {}
fs.readFile(path.resolve(__dirname, "..", "..", "static", "schedule.json"), function (err, data) {
    if (err) {
        logger.error(err)
        throw err;
    }
    logger.info(`Loading schedules...`)
    schedule = JSON.parse(data);
    logger.info(`Loaded schedules for ${Object.keys(schedule)}`)
});

let groupMap = [];
fs.readFile(path.resolve(__dirname, "..", "..", "static", "groups.json"), function (err, data) {
    if (err) {
        logger.error(err)
        throw err;
    }
    logger.info(`Loading groups...`)
    groupMap = JSON.parse(data);
    logger.info(`Loaded groups: ${groupMap.map(p => p.id)}`)
});

exports.scheduleList = schedule;

exports.getWeeksMap = function () {
    var results = {};
    Object.entries(schedule).forEach(([year, weeks]) => {
        results[year] = weeks.map(wk => {
            return {
                title: wk.label,
                label: `${wk.label} (${wk.detail})`,
                value: wk.value,
                type: wk.type
            }
        })
    });
    return results;
}

exports.getGroups = function() {
    return groupMap;
}

exports.getGames = async function (year, week, type, group) {
    return await _getRemoteGames(year, week, type, group); 
}

async function _getRemoteGames (year, week, type, group) {
    var espnGroup = group; 
    if (espnGroup && espnGroup < 0) {
        espnGroup = 80; // All FBS which we will filter
    }

    if (year == null || week == null) {
        const res =  await axios.get(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=${espnGroup || 80}&size=100000&${new Date().getTime()}`, {
            protocol: "https"
        })
        logger.info(res.request.res.responseUrl)
        let espnContent = res.data;
        if (espnContent == null) {
            throw Error(`Data not available for ESPN's schedule endpoint.`)
        }

        let result = (espnContent != null) ? espnContent.events : [];

        if (group == -1) { // top 25
            result = result.filter(g => {
                const home = g.competitions[0].competitors[0];
                const away = g.competitions[0].competitors[1];

                return ((home.curatedRank?.current ?? 99) < 26) || ((away.curatedRank?.current ?? 99) < 26)
            })
        }

        return result;
    } else {
        // https://github.com/BlueSCar/cfb-data/blob/master/app/services/schedule.service.js
        const baseUrl = 'https://cdn.espn.com/core/college-football/schedule?';

        const query = {
            year: year,
            week: week,
            group: espnGroup || 80,
            type: type || 2,
            xhr: 1,
            render: 'false',
            userab: 18,
        }

        for (let param in query) { /* You can get copy by spreading {...query} */
            if (query[param] === undefined /* In case of undefined assignment */
                || query[param] === null 
                || query[param] === ""
            ) {    
                delete query[param];
            }
        }

        const url = baseUrl + (new URLSearchParams(query)).toString() + `&${new Date().getTime()}`;
        logger.info(url)
        const res = await axios.get(url);

        let espnContent = res.data;
        if (espnContent == null) {
            throw Error(`Data not available for ESPN's schedule endpoint.`)
        }

        if (typeof espnContent == 'str' && espnContent.toLocaleLowerCase().includes("<html>")) {
            throw Error("Data returned from ESPN was HTML file, not valid JSON.")
        }

        var result = []
        const actualContent = espnContent.content?.schedule;
        if (!actualContent) {
            throw Error(`Data not available for ESPN's schedule endpoint.`)
        }
        Object.entries(actualContent).forEach(([date, schedule]) => {
            if (schedule != null && schedule.games != null) {
                result = result.concat(schedule.games)
            }
        })

        if (group == -1) { // top 25
            result = result.filter(g => {
                const home = g.competitions[0].competitors[0];
                const away = g.competitions[0].competitors[1];

                return ((home.curatedRank?.current ?? 99) < 26) || ((away.curatedRank?.current ?? 99) < 26)
            })
        }

        return result;
    }
}

exports.getWeeks = async function (year) {
    let years = Object.keys(schedule);
    let season = (year == null) ? schedule[years[years.length - 1]] : schedule[year];
    return season.map(wk => {
        return {
            label: wk.label,
            value: wk.value,
            type: wk.label.includes("Bowls") ? "3" : "2"
        }
    });
}