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

exports.getGames = async function (year, week, type, group) {
    var urls = []
    var cleanGroup = group || 80; // FBS only
    if (year == null || week == null) {
        urls.push({
            url: `http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=${cleanGroup}`
        })
    } else {
        let season = schedule[year];
        if (type == null || parseInt(type) != 3) {
            urls = season.filter(w => (parseInt(w.value) == week) && !w.label.includes("Bowls"))
        } else if (parseInt(type) == 3) {
            urls = season.filter(w => w.label.includes("Bowls"))
        } else {
            urls = []
        }
    }
    urls = urls.map(w => w.url);
    if (urls.length == 0) {
        throw Error("No data URLs on file for specified week and year.")
    }
    return await axios.get(`${urls[0]}&groups=${cleanGroup}`, {
        protocol: "https"
    })
}

exports.getWeeks = async function (year) {
    let season = (year == null) ? schedule[schedule.length - 1] : schedule[year];
    return season.map(wk => {
        return {
            label: wk.label,
            value: wk.value,
            type: wk.label.includes("Bowls") ? "3" : "2"
        }
    });
}