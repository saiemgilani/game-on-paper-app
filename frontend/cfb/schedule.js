// schedule.js
const fs = require('fs')
const debuglog = util.debuglog('[frontend]');
const axios = require('axios')

let range = (start, end) => Array.from(Array(end + 1).keys()).slice(start); 

debuglog("Compiling schedule vars");
let schedule = {}
let yrRange = range(2002, 2020);
yrRange.forEach(yr => {
    fs.readFile(`schedules/${yr}.json`, 'utf8', function (err, data) {
        if (err) {
            debuglog(err)
            throw err;
        }
        debuglog(`Loaded schedule for ${yr}`)
        schedule[yr] = JSON.parse(data);
    }); 
})

exports.getGames = async function (year, week, type) {
    var urls = []
    if (year == null || week == null) {
        urls.push({
            url: "http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"
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
    return await axios.get(urls[0], {
        protocol: "https"
    })
}

exports.getWeeks = async function (year) {
    if (year == null) {
        return [];
    }
    let season = schedule[year];
    return season.map(wk => {
        return {
            label: wk.label,
            value: wk.value,
            type: wk.label.includes("Bowls") ? "3" : "2"
        }
    });
}