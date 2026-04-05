const axios = require("axios");
const logger = require("../utils/logger");
const ALPHABET = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

function generateKey(parts, sep = "-") {
    const valid = parts.filter(p => (p))
    if (valid.length == 0) {
        throw new Error("invalid key")
    }
    return valid.join(sep)
}


function getPercentileKey(metric) {
    switch (metric) {
        case "overall.epaPerPlay": 
            return "epaPerPlay";
        case "overall.yardsPerPlay": 
            return "yardsPerPlay";
        case "overall.successRate": 
            return "successRate";
        case "passing.epaPerPlay": 
            return "epaPerDropback";
        case "passing.yardsPerPlay": 
            return "yardsPerDropback";
        case "passing.successRate": 
            return "passingSuccessRate";
        case "rushing.epaPerPlay": 
            return "epaPerRush";
        case "rushing.yardsPerPlay": 
            return "yardsPerRush";
        case "rushing.successRate": 
            return "rushingSuccessRate";
        case "overall.havocRate": 
            return "havocRate";
        case "passing.explosiveRate":
            return "passingExplosivePlayRate";
        case "rushing.explosiveRate":
            return "rushingExplosivePlayRate";
        case "rushing.opportunityRate":
            return "rushOpportunityRate";
        case "rushing.lineYards":
            return "lineYards";
        case "rushing.stuffedPlayRate":
            return "playStuffedRate";
        case "overall.explosiveRate":
            return "explosivePlayRate";
        case "overall.nonExplosiveEpaPerPlay":
            return "nonExplosiveEpaPerPlay";
        case "overall.earlyDownEPAPerPlay":
            return "earlyDownEpaPerPlay";
        case "overall.lateDownSuccessRate":
            return "lateDownSuccessRate";
        case "overall.thirdDownDistance":
            return "thirdDownDistance";
        default:
            return metric;
    }
}

function cleanUpParams(payload) {
    let query = {...payload};
    for (let param in query) { 
        if (query[param] === undefined /* In case of undefined assignment */
            || query[param] === null 
            || query[param] === ""
        ) {    
            delete query[param];
        }
    }
    return query;
}

async function ping(url) {
    let check = { "status": 404 };
    try {
        check = await axios.get(url)
        return { "status": check.status } 
    } catch (err) {
        logger.error(`Error while checking status of ${url}: ${err}`)
        return { "status": 500 };
    }
}

async function sleep(sec) {
  return new Promise((resolve) => {
    setTimeout(resolve, sec * 1000);
  });
}

module.exports = {
    generateKey,
    getPercentileKey,
    cleanUpParams,
    ping,
    ALPHABET,
    sleep,
    range: (start, end) => Array.from(Array(end + 1).keys()).slice(start),
    CURRENT_YEAR: 2025
}