const redis = require('redis');
const logger = require("./logger");
const redisClient = redis.createClient({
    url: 'redis://cache:6380'
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));

redisClient.connect().then(() => {
    logger.info('connected to redis game cache on port 6380');
});

const setCache = async (key, value, duration) => {
    try {
        await redisClient.set(key, value)
        await redisClient.expire(key, duration)
    } catch (e) {
        logger.error(`Error while writing ${key} to redis: ${e}`)
    }
}

const lockAndTransact = async (key, promiseFunc) => {
    logger.info(`locking for ${key}`)
    await redisClient.setNX(`${key}-lock`, "locked")
    await redisClient.expire(key, 60 * 60) // one hour lock
    await promiseFunc()
    logger.info(`unlocking for ${key}`)
    await redisClient.del(`${key}-lock`)
}

// https://medium.com/the-node-js-collection/simple-server-side-cache-for-express-js-with-node-js-45ff296ca0f0
const cachePage = (duration) => {
    return (req, res, next) => {
        const key = `__express__-${req.originalUrl || req.url}`
        logger.info(`cache logic: ${key}`)
        // attempt to acquire lock before read.         
        lockAndTransact(key, async () => {
            // if not locked, lock --> update --> unlock
            const content = await redisClient.get(key)
            if (!content) {
                logger.info(`cache miss: ${key}`)
                res.sendResponse = res.send
                res.send = (body) => {
                    setCache(key, body, duration)
                        .then(() => {
                            res.sendResponse(body)
                        })
                }
                next()
            } else {
                logger.error(`cache hit: ${key}`)
                res.send(content)
            }
        })
        .catch((e) => {
            // If locked, pass through
            logger.error(`Error while trying to lock and transact on redis ${key}: ${e}`)
            next()
        })
    }
}

module.exports = cachePage