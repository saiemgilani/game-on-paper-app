import axios from 'axios';
import logger from './logger.js';
const ALPHABET = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];
import crypto from 'node:crypto';
import path from 'node:path';
import ejs from 'ejs';

function retrieveValue(dictionary, key) {
    const subKeys = key.split('.')
    let sub = dictionary;
    for (const k of subKeys) {
        sub = sub[k];
    }
    return sub;
}

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

function generateChecksum(game) {
    return crypto.createHash('sha256').update(JSON.stringify(game)).digest('hex');
}

function renderFile(templatePath, data) {
    if (!templatePath.endsWith(".ejs")) {
        templatePath += ".ejs"
    }
    return ejs.renderFile(path.join(import.meta.dirname, "../", "views", templatePath), data);
}

function range(start, end) {
    return Array.from(Array(end + 1).keys()).slice(start);
}

const CURRENT_YEAR = 2025;

export {
    generateKey,
    getPercentileKey,
    cleanUpParams,
    ping,
    ALPHABET,
    sleep,
    generateChecksum,
    range,
    CURRENT_YEAR,
    retrieveValue,
    renderFile
}