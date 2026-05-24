import redis from 'redis';
import logger from './logger.js';
const REDIS_CLIENT = redis.createClient({
    url: 'redis://cache:6380'
});

// const cacheIgnore = process.env.CACHE_IGNORE || 'false'

REDIS_CLIENT.on('error', (err) => logger.error(`Error in Redis client: ${err}`));

REDIS_CLIENT.connect()
    .then(() => {
        logger.info('connected to redis page cache on port 6380');
    })
    .catch((e) => {
        logger.error(`Error while connecting to redis page cache: ${e}`)
    })



const setCachedValue = async (key, value, duration) => {
    if (typeof key !== "string") {
        key = `${key}`;
    }
    if (typeof value !== "string") {
        value = `${value}`;
    }
    let params = {}
    if (duration) {
        params["EX"] = duration
    }

    try {
        await REDIS_CLIENT.set(key, value, params)
    } catch (e) {
        logger.error(`Error while writing ${key} (with value: ${value}) to redis: ${e} -- ${e.stack}`)
    }
}

const getCachedValue = async (key) => {
    if (typeof key !== "string") {
        key = `${key}`;
    }

    try {
        return await REDIS_CLIENT.get(key)
    } catch (e) {
        logger.error(`Error while reading ${key} (with value: ${value}) to redis: ${e} -- ${e.stack}`)
        return null;
    }
}

async function cacheResponse(key, duration, valuePromise) {
    let htmlValue = await getCachedValue(key) // TODO: santitize URL inputs
    if (!htmlValue) {
        // if not found in redis, generate file
        logger.warn(`Cache miss: ${key}`)
        if (typeof valuePromise == 'function') {
            htmlValue = await valuePromise();
        } else {
            htmlValue = await valuePromise;
        }
        await setCachedValue(key, htmlValue, duration)
    } else {
        logger.info(`Cache hit: ${key}`)
    }
    // if found in redis, return response
    return htmlValue;
}

async function sendCachedResponse(req, res, next, key, duration, valuePromise) {
    try {
        const htmlValue = await cacheResponse(key, duration, valuePromise);
        return res.type("html").send(htmlValue);
    } catch (e) {
        logger.error(`Error while sending cached response for key ${key}: ${e}`);
        return next(e)
    }
}

export {
    setCachedValue,
    getCachedValue,
    cacheResponse,
    sendCachedResponse
}