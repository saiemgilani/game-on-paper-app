const axios = require('axios');
const redis = require('redis');

const redisClient = redis.createClient({
    url: 'redis://redis:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

redisClient.connect().then(() => {
    console.log('connected to redis LRU cache on port 6379');
});


async function retrieveRemoteData(payload) {
    console.log(`loading from summary: ${JSON.stringify(payload)}`)
    const response = await axios({
        method: 'POST',
        url: `http://summary:3000/`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams(payload)
    });
    const content = response.data.results;
    return content;
}

async function retrieveRemoteLeagueData(year, type) {
    try {        
        // update redis cache
        const content = await retrieveRemoteData({
            year,
            type: type
        });
        const key = `${year}-${type}`;
        await redisClient.set(key, JSON.stringify(content))
        await redisClient.expire(key, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
        return content;
    } catch (err) {
        console.log(`could not find data for league in ${year}, checking ${year - 1}`)
        if (err) {
            console.log(`also err: ${err}`);
        }
        if ((year - 1) < 2014) {
            return [];
        } else {
            return await retrieveRemoteLeagueData(year - 1, type);
        }
    }
}

async function retrieveLeagueData(year, type) {
    const key = `${year}-${type}`;
    try {
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty league data from redis for key: ${key}, repulling`)
        }
        // console.log(`found content for key ${key}: ${content}`)
        return JSON.parse(content);
    } catch (err) {
        console.log(err)
        console.log(`receieved some error from redis for key: ${key}, repulling league data`)
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
        console.log(err)
        return await retrieveRemoteLastUpdated();
    }
}

async function retrieveRemotePercentiles(year) {
    try {
        const response = await axios({
            method: 'GET',
            url: `http://summary:3000/percentiles/${year}`
        });
        
        // update redis cache
        const content = response.data.results;
        const key = `${year}-percentiles`;
        await redisClient.set(key, JSON.stringify(content))
        await redisClient.expire(key, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
        return content;
    } catch (err) {
        console.log(`could not find percentiles for league in ${year}, checking ${year - 1}`)
        if (err) {
            console.log(`also err: ${err}`);
        }
        if ((year - 1) < 2014) {
            return [];
        } else {
            return await retrieveRemotePercentiles(year - 1);
        }
    }
}

async function retrievePercentiles(year) {
    const key = `${year}-percentiles`;
    try {
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty league data from redis for key: ${key}, repulling`)
        }
        // console.log(`found content for key ${key}: ${content}`)
        return JSON.parse(content);
    } catch (err) {
        console.log(err)
        console.log(`receieved some error from redis for key: ${key}, repulling league data`)
        return await retrieveRemotePercentiles(year);
    }
}

async function retrieveRemoteTeamData(year, team_id, type) {
    try {
        // update redis cache
        const content = await retrieveRemoteData({
            year,
            team: team_id,
            type: type
        });
        const key = `${year}-${team_id}-${type}`;
        await redisClient.set(key, JSON.stringify(content))
        await redisClient.expire(key, 60 * 60 * 24 * 3); // expire every three days so that we get fresh data
        return content;
    } catch (err) {
        console.log(`could not find data for ${team_id} in ${year}, checking ${year - 1}`)
        if (err) {
            console.log(`also err: ${err}`);
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
        const key = `${year}-${team_id}-${type}`;
        const content = await redisClient.get(key);
        if (!content) {
            throw new Error(`receieved invalid/empty data from redis for key: ${key}, repulling`)
        }
        return JSON.parse(content);
    } catch (err) {
        console.log(err)
        return await retrieveRemoteTeamData(year, team_id, type);
    }
}

module.exports = {
    retrieveLastUpdated,
    retrieveLeagueData,
    retrievePercentiles,
    retrieveTeamData
}