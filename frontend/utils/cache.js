const redis = require('redis');
const logger = require("./logger");
const REDIS_CLIENT = redis.createClient({
    url: 'redis://cache:6380'
});

const cacheIgnore = process.env.CACHE_IGNORE || 'false'

REDIS_CLIENT.on('error', (err) => logger.error(`Error in Redis client: ${err}`));

REDIS_CLIENT.connect()
    .then(() => {
        logger.info('connected to redis page cache on port 6380');
    })
    .catch((e) => {
        logger.error(`Error while connecting to redis page cache: ${e}`)
    })

class CacheError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CacheError';
  }
}


/*
    This solves the problem of get/set contention in Redis but somewhat fails as a page cache. 
    If the lock can not be acquired, the system still hits Python to parse the game data. 
   
    - If the lock is not able to be acquired, then we should return the old data, no?
        - This could create a race condition where the lock is engaged but the underlying key expires, so there's no data to return to the caller...
            - To avoid this, we set the expiration of the key to be longer. If there's another request when the lock is still engaged, we identify the lock contention error and the old content is still returned
            - If the key still expires before the lock is disengaged, we hit Python to parse the game data.
*/

const setCachedValue = async (key, value, duration) => {
    if (typeof key !== "string") {
        key = `${key}`;
    }
    try {
        await REDIS_CLIENT.set(key, value, { EX: duration })
    } catch (e) {
        logger.error(`Error while writing ${key} (with value: ${value}) to redis: ${e} -- ${e.stack}`)
    }
}

const lockAndTransact = async (key, promiseFunc) => {
    logger.info(`locking for ${key}`)
    const lockResult = await REDIS_CLIENT.setNX(`${key}-lock`, "locked");
    if (!lockResult) {
        throw new CacheError(`Lock still on for ${key}`)
    }
    await REDIS_CLIENT.expire(`${key}-lock`, 60 * 60) // one hour expiration on the lock
    await REDIS_CLIENT.expire(key, 60 * 5) // extend to five minute expiration on the key just in case anything goes wrong with this update
    await promiseFunc()
    logger.info(`unlocking for ${key}`)
    await REDIS_CLIENT.del(`${key}-lock`)
}

// https://medium.com/the-node-js-collection/simple-server-side-cache-for-express-js-with-node-js-45ff296ca0f0
const cachePage = (duration) => {
    return (req, res, next) => {
        const key = `__express__-${req.originalUrl || req.url}`
        logger.info(`cache logic: ${key}`)
        // attempt to acquire lock before read.         
        lockAndTransact(key, async () => {
            // if not locked, lock --> update --> unlock
            const content = await REDIS_CLIENT.get(key)
            if (!content || cacheIgnore == 'true') {
                logger.info(`cache miss: ${key}`)
                res.sendResponse = res.send
                res.send = (body) => {
                    setCachedValue(key, body, duration)
                        .then(() => {
                            res.sendResponse(body)
                        })
                }
                next()
            } else {
                logger.info(`cache hit: ${key}`)
                res.send(content)
            }
        })
        .catch(async (e) => {
            // If locked, pass through IF we have content saved
            const content = await REDIS_CLIENT.get(key)
            if ((e instanceof CacheError) && content) {
                logger.error(`Lock still ON for ${key}, so returning old content: ${e}`)
                res.send(content)
            } else {
                logger.error(`Error while trying to lock and transact on redis ${key}: ${e}`)
                next()
            }
        })
    }
}

module.exports = {
    cachePage,
    setCachedValue,
    REDIS_CLIENT
}