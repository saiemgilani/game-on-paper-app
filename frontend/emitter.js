const logger = require("./utils/logger");
const { DateTime } = require("luxon");
const ScheduleModel = require("./cfb/resources/schedule")
const {sleep} = require("./utils/misc");
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
        logger.info(`Starting up queue emitter...`)
        setupSignalHandlers();

        logger.info(`Creating beanstalkd pool and connecting client...`)
        let client = await BEANSTALK_CLIENT_POOL.connect();

        logger.info(`Starting queue emitter loop...`)
        // poll every two minutes for new game status
        while (IS_ACTIVE_BEANSTALK_EMITTER) {
            const today = DateTime.now().setZone("America/Los_Angeles").toISODate();
            
            const currentScoreboard = await ScheduleModel.getGames();
            logger.info(`Emitter: found scoreboard games: ${currentScoreboard.length}`);
            for (const i in currentScoreboard) {
                // if (i >= 1) {
                //     // for testing
                //     continue;
                // }

                const g = currentScoreboard[i];
                const gameDate = DateTime.fromISO(g["date"]).setZone("America/Los_Angeles").toISODate();
                if (gameDate != today) {
                    logger.info(`Emitter: skipping game ${g.id} because game date (PT) of ${gameDate} does not match current PT date of ${today}`)
                    continue
                }

                logger.info(`Emitter: pushing game ${g.id} to beanstalkd with TTR: ${BEANSTALK_JOB_TTR}`)
                await client.put(
                    { gameId: g.id }, 
                    parseInt(BEANSTALK_JOB_TTR)
                );
            }

            if (!IS_ACTIVE_BEANSTALK_EMITTER) {
                logger.info(`Queue emitter stopping gracefully...`)
                break;
            }

            logger.info(`Queue emitter sleeping until next update...`)
            await sleep(parseInt(EMITTER_UPDATE_DELAY))
        }
        logger.info(`Releasing client to beanstalkd pool...`)
        client.releaseClient();
    } catch (err) {
        logger.error(`Uncaught error in queue emitter: ${err}`)
    } finally {
        logger.info(`Disconnecting from beanstalkd...`)
        BEANSTALK_CLIENT_POOL.disconnect();
    }

    logger.info(`Queue emitter exiting.`)
}

startEmitter();