const axios = require('axios');
const redis = require('redis');
const logger = require("../../utils/logger");
const generateKey = require("../../utils/misc").generateKey;
const cleanUpParams = require("../../utils/misc").cleanUpParams;

const redisClient = redis.createClient({
    url: 'redis://redis:6379'
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));

redisClient.connect().then(() => {
    logger.info('connected to redis LRU cache on port 6379');
});

async function retrieveRemoteData(payload) {
    const query = cleanUpParams(payload);
    logger.info(`loading from summary: ${JSON.stringify(query)}`)
    const response = await axios({
        method: 'POST',
        url: `http://summary:3000/`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams(query)
    });
    const content = response.data.results;
    return content;
}

async function retrieveRemoteLeagueData(year, type) {
    if (!year && !type) {
        logger.error(`failed to retreive remote league data, must provide 'year' AND/OR 'type'`)
        return [];
    }
    try {        
        // update redis cache
        const content = await retrieveRemoteData({
            year,
            type: type
        });
        const key = generateKey(["league", year, type]);
        await redisClient.set(key, JSON.stringify(content))
        await redisClient.expire(key, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
        return content;
    } catch (err) {
        logger.error(`could not find data for league in ${year}, checking ${year - 1}`)
        if (err) {
            logger.error(`also err: ${err}`);
        }
        if ((year - 1) < 2014) {
            return [];
        } else {
            return await retrieveRemoteLeagueData(year - 1, type);
        }
    }
}

async function retrieveLeagueData(year, type) {
    if (!year && !type) {
        logger.error(`failed to retreive league data, must provide 'year' AND/OR 'type'`)
        return [];
    }
    const key = generateKey(["league", year, type]);
    try {
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty league data from redis for key: ${key}, repulling`)
        }
        // logger.info(`found content for key ${key}: ${content}`)
        return JSON.parse(content);
    } catch (err) {
        logger.error(err)
        logger.error(`receieved some error from redis for key: ${key}, repulling league data`)
        return await retrieveRemoteLeagueData(year, type);
    }
}


async function retrieveRemoteLastUpdated() {
    const response = await axios({
        method: 'GET',
        url: `http://summary:3000/updated`
    });
    const content = response.data;
    await redisClient.set(`summary-last-updated`, JSON.stringify(content))
    await redisClient.expire(`summary-last-updated`, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
    return content.last_updated;
}

async function retrieveLastUpdated() {
    try {
        const key = `summary-last-updated`;
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty data from redis for key: ${key}, repulling`)
        }
        return JSON.parse(content).last_updated;
    } catch (err) {
        logger.error(err)
        return await retrieveRemoteLastUpdated();
    }
}

async function retrieveRemotePercentiles(year = null, pctile = null) {
    if (!year && !pctile) {
        logger.error(`failed to retreive percentiles, must provide 'year' AND/OR 'pctile'`)
        return [];
    }
    try {
        const query = cleanUpParams({ year, pctile });
        const response = await axios({
            method: 'GET',
            url: `http://summary:3000/percentiles?` + (new URLSearchParams(query)).toString(),
        });
        
        // update redis cache
        const content = response.data.results;
        const key = generateKey(["percentiles", year, pctile]);
        await redisClient.set(key, JSON.stringify(content))
        await redisClient.expire(key, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
        return content;
    } catch (err) {
        logger.error(`could not find percentiles (${pctile}) for league in ${year}, checking ${year - 1}`)
        if (err) {
            logger.error(`also err: ${err}`);
        }
        if ((year - 1) < 2014) {
            return [];
        } else {
            return await retrieveRemotePercentiles(year - 1, pctile);
        }
    }
}

async function retrievePercentiles(year = null, pctile = null) {
    if (!year && !pctile) {
        console.error(`failed to retreive percentiles, must provide 'year' AND/OR 'pctile'`)
        return [];
    }
    const key = generateKey(["percentiles", year, pctile])
    try {
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty league data from redis for key: ${key}, repulling`)
        }
        // logger.error(`found content for key ${key}: ${content}`)
        return JSON.parse(content);
    } catch (err) {
        logger.error(err)
        logger.error(`receieved some error from redis for key: ${key}, repulling league data`)
        return await retrieveRemotePercentiles(year, pctile);
    }
}

async function retrieveRemoteTeamData(year, team_id, type) {
    if (!year && !team_id) {
        logger.error(`failed to retreive remote team data, must provide 'year' AND/OR 'team_id'`)
        return [];
    }
    try {
        // update redis cache
        const content = await retrieveRemoteData({
            year,
            team: team_id,
            type: type
        });
        const key = generateKey([year, team_id, type]);
        await redisClient.set(key, JSON.stringify(content))
        await redisClient.expire(key, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
        return content;
    } catch (err) {
        logger.error(`could not find data for ${team_id} in ${year}, checking ${year - 1}`)
        if (err) {
            logger.error(`also err: ${err}`);
        }
        if ((year - 1) < 2014) {
            return [{
                pos_team: team_id
            }];
        } else {
            return await retrieveRemoteTeamData(year - 1, team_id, type);
        }
    }
}

async function retrieveTeamData(year, team_id, type) {
    try {
        let keyParts = []
        if (year) {
            keyParts.push(year)
        }
        if (team_id) {
            keyParts.push(team_id)
        }
        if (keyParts.length == 0) {
            throw new Error("invalid team data request, must include year AND/OR team")
        }
        if (type) {
            keyParts.push(type)
        }
        const key = generateKey(keyParts);
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty data from redis for key: ${key}, repulling`)
        }
        return JSON.parse(content)
    } catch (err) {
        logger.error(err)
        return await retrieveRemoteTeamData(year, team_id, type);
    }
}

module.exports = {
    retrieveLastUpdated,
    retrieveLeagueData,
    retrievePercentiles,
    retrieveTeamData
}