// schedule.js
const fs = require('fs');
const util = require('util');
const debuglog = util.debuglog('[frontend]');
const axios = require('axios')
const path = require("path");

let range = (start, end) => Array.from(Array(end + 1).keys()).slice(start); 

debuglog("Compiling schedule vars");
let schedule = {}
fs.readFile(path.resolve(__dirname, "schedule.json"), function (err, data) {
    if (err) {
        debuglog(err)
        throw err;
    }
    debuglog(`Loading schedules...`)
    schedule = JSON.parse(data);
    debuglog(`Loaded schedules for ${Object.keys(schedule)}`)
});

exports.scheduleList = schedule;

exports.getWeeksMap = function () {
    var results = {};
    Object.entries(schedule).forEach(([year, weeks]) => {
        results[year] = weeks.map(wk => {
            return {
                label: wk.label,
                value: wk.value,
                type: wk.label.includes("Bowls") ? "3" : "2"
            }
        })
    });
    return results;
}

exports.getGames = async function (year, week, type, group) {
    if (year == null || week == null) {
        const res =  await axios.get(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=${group || 80}&limit=1000&${new Date().getTime()}`, {
            protocol: "https"
        })
        debuglog(res.request.res.responseUrl)
        let espnContent = res.data;
        if (espnContent == null) {
            throw Error(`Data not available for ESPN's schedule endpoint.`)
        }

        let result = (espnContent != null) ? espnContent.events : [];
        return result;
    } else {
        // https://github.com/BlueSCar/cfb-data/blob/master/app/services/schedule.service.js
        const baseUrl = 'https://cdn.espn.com/core/college-football/schedule';

        const params = {
            year: year,
            week: week,
            group: group || 80,
            seasontype: type || 2,
            xhr: 1,
            render: 'false',
            userab: 18
        }

        const res = await axios.get(baseUrl, {
            params
        });
        debuglog(JSON.stringify(params))
        debuglog(res.request.res.responseUrl)
        let espnContent = res.data;
        if (espnContent == null) {
            throw Error(`Data not available for ESPN's schedule endpoint.`)
        }

        if (typeof espnContent == 'str' && espnContent.toLocaleLowerCase().includes("<html>")) {
            throw Error("Data returned from ESPN was HTML file, not valid JSON.")
        }

        var result = []
        // console.log(espnContent)
        Object.entries(espnContent.content.schedule).forEach(([date, schedule]) => {
            if (schedule != null && schedule.games != null) {
                result = result.concat(schedule.games)
            }
        })
        result.sort((a, b) => {
            var aVal = parseInt(a.status.type.id)
            var bVal = parseInt(b.status.type.id)
            if (aVal < bVal) {
                return -1
            } else if (aVal > bVal) {
                return 1
            } else {
                var aDate = Date.parse(a.date)
                var bDate = Date.parse(b.date)
                if (aDate > bDate) {
                    return -1
                } else if (aDate < bDate) {
                    return 1
                } else {
                    return 0
                }
            }
        })
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