const logger = require("./utils/logger");
const { DateTime } = require("luxon");
const ScheduleModel = require("./cfb/resources/schedule")
const {sleep, generateChecksum} = require("./utils/misc");
const { setCachedValue, REDIS_CLIENT } = require("./utils/cache")
const BEANSTALK_CLIENT_POOL = require("./utils/beanstalk").BEANSTALK_CLIENT_POOL;
let IS_ACTIVE_BEANSTALK_EMITTER = (process.env.IS_ACTIVE_BEANSTALK_EMITTER == "true") ?? false;
const BEANSTALK_JOB_TTR = process.env.BEANSTALK_JOB_TTR ?? 60;
const EMITTER_UPDATE_DELAY = process.env.EMITTER_UPDATE_DELAY ?? 120;

function setupSignalHandlers() {
    logger.info(`Setting up process signal handlers...`)
    let sigHandle = (signal) => {
        if (IS_ACTIVE_BEANSTALK_EMITTER) {
            logger.info(`Emitter received ${signal}, queue processing will stop after this current job.`)
            IS_ACTIVE_BEANSTALK_EMITTER = false;
        } else {
            logger.info(`Emitter received ${signal} and is no longer an active emitter.`)
        }
    }
    process.on('SIGBREAK', sigHandle);
    process.on('SIGINT', sigHandle);
    process.on('SIGTERM', sigHandle);
}

async function startEmitter() {
    try {
        logger.info(`Emitter: Starting up queue emitter...`)
        setupSignalHandlers();

        logger.info(`Emitter: Creating beanstalkd pool and connecting client...`)
        let client = await BEANSTALK_CLIENT_POOL.connect();

        logger.info(`Emitter: Starting queue emitter loop...`)
        // poll every two minutes for new game status
        while (IS_ACTIVE_BEANSTALK_EMITTER) {
            const today = DateTime.now().setZone("America/Los_Angeles").toISODate();
            
            // also store scoreboard HTML in cache for live page
            const currentScoreboard = await ScheduleModel.getGames();
            await setCachedValue("scoreboard", JSON.stringify(currentScoreboard), 0);

            logger.info(`Emitter: found scoreboard games: ${currentScoreboard.length}`);
            for (const i in currentScoreboard) {
                const g = currentScoreboard[i];
                const gameDate = DateTime.fromISO(g["date"]).setZone("America/Los_Angeles").toISODate();
                const existingContent = await REDIS_CLIENT.get(`game-${g.id}`);
                if (gameDate != today) {
                    logger.info(`Emitter: skipping game ${g.id} because game date (PT) of ${gameDate} does not match current PT date of ${today}`)
                    continue
                }

                logger.info(`Emitter: pushing game ${g.id} to beanstalkd with TTR: ${BEANSTALK_JOB_TTR}, condition: not in cache`)
                await client.put(
                    g, 
                    parseInt(BEANSTALK_JOB_TTR)
                );
                continue
            }

            // trigger team/chart/etc CDN updates from admin panel?

            if (!IS_ACTIVE_BEANSTALK_EMITTER) {
                logger.info(`Emitter: Queue emitter stopping gracefully...`)
                break;
            }

            logger.info(`Emitter: Queue emitter sleeping until next update (in ${EMITTER_UPDATE_DELAY} sec)...`)
            await sleep(parseInt(EMITTER_UPDATE_DELAY))
        }
        logger.info(`Emitter: Releasing client to beanstalkd pool...`)
        client.releaseClient();
    } catch (err) {
        logger.error(`Emitter: Uncaught error in queue emitter: ${err}`)
        if (!IS_ACTIVE_BEANSTALK_EMITTER) {
            logger.info(`Emitter: Queue emitter stopping gracefully...`)
            logger.info(`Emitter: Releasing client to beanstalkd pool...`)
            client.releaseClient();
        }
    } finally {
        logger.info(`Emitter: Disconnecting from beanstalkd...`)
        BEANSTALK_CLIENT_POOL.disconnect();
    }

    logger.info(`Emitter: Queue emitter exiting.`)
}

startEmitter();