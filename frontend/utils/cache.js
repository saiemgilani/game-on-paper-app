const redis = require('redis');
const util = require('util');
const debuglog = util.debuglog('[frontend]');
const redisClient = redis.createClient({
    url: 'redis://cache:6380'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

redisClient.connect().then(() => {
    console.log('connected to redis game cache on port 6380');
});

const setCache = async (key, value, duration) => {
    try {
        await redisClient.set(key, value)
        await redisClient.expire(key, duration)
    } catch (e) {
        debuglog(`Error while writing ${key} to redis: ${e}`)
    }
}

const lockAndTransact = async (key, promiseFunc) => {
    await redisClient.setNX(`${key}-lock`, "locked")
    await redisClient.expire(key, 60 * 60 * 24)
    await promiseFunc()
    await redisClient.del(`${key}-lock`)
}

// https://medium.com/the-node-js-collection/simple-server-side-cache-for-express-js-with-node-js-45ff296ca0f0
const cachePage = (duration) => {
    return (req, res, next) => {
        const key = `__express__-${req.originalUrl || req.url}`
        // attempt to acquire lock before read.         
        lockAndTransact(key, async () => {
            // if not locked, lock --> update --> unlock
            const content = await redisClient.get(key)
            if (!content) {
                debuglog(`cache miss: ${key}`)
                res.sendResponse = res.send
                res.send = (body) => {
                    setCache(key, body, duration)
                        .then(() => {
                            res.sendResponse(body)
                        })
                }
                next()
            } else {
                debuglog(`cache hit: ${key}`)
                res.send(content)
            }
        })
        .catch((e) => {
            // If locked, pass through
            debuglog(`Error while trying to lock and transact on redis ${key}: ${e}`)
            next()
        })
    }
}

module.exports = cachePage