const logger = require("../utils/logger");
const { DateTime } = require("luxon");
const ScheduleModel = require("../cfb/resources/schedule")
const SummaryModel = require("../cfb/resources/summary")
const {sleep, generateChecksum} = require("../utils/misc");
const BEANSTALK_CLIENT_POOL = require("../utils/beanstalk").BEANSTALK_CLIENT_POOL;
const EMITTER_SELECTED_SEASONS = (process.env.EMITTER_SELECTED_SEASONS) ? JSON.parse(process.env.EMITTER_SELECTED_SEASONS) : [2025]

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

        logger.info(`Emitter: Creating beanstalkd pool and connecting clients...`)
        let teamClient = await BEANSTALK_CLIENT_POOL.connect();
        teamClient.use("team");

        let teamSeasonClient = await BEANSTALK_CLIENT_POOL.connect();
        teamSeasonClient.use("team-season");

        logger.info(`Emitter: Starting queue emitter loop...`)
        const allTeams = await SummaryModel.retrieveAllTeams()

        while (IS_ACTIVE_BEANSTALK_EMITTER) {
            for (const t of allTeams) {
                logger.info(`Emitter: pushing team ${t.team_id} to beanstalkd with TTR: ${BEANSTALK_JOB_TTR}, condition: updating`)
                await teamClient.put(
                    { id: t.team_id }, 
                    parseInt(BEANSTALK_JOB_TTR)
                );

                for (const s of t.seasons) {
                    if (EMITTER_SELECTED_SEASONS.includes(s)) {
                        logger.info(`Emitter: pushing team season ${t.team_id} to beanstalkd with TTR: ${BEANSTALK_JOB_TTR}, condition: updating`)
                        await teamSeasonClient.put(
                            { id: t.team_id, year: s }, 
                            parseInt(BEANSTALK_JOB_TTR)
                        );
                    }
                }

                if (!IS_ACTIVE_BEANSTALK_EMITTER) {
                    logger.info(`Emitter: Queue emitter stopping gracefully...`)
                    break;
                }
            }

            // processing is over, end the job
            IS_ACTIVE_BEANSTALK_EMITTER = false;
        }
        logger.info(`Emitter: Releasing client to beanstalkd pool...`)
        teamClient.releaseClient();
        teamSeasonClient.releaseClient();
    } catch (err) {
        logger.error(`Emitter: Uncaught error in queue emitter: ${err}`)
        if (!IS_ACTIVE_BEANSTALK_EMITTER) {
            logger.info(`Emitter: Queue emitter stopping gracefully...`)
            logger.info(`Emitter: Releasing clients to beanstalkd pool...`)
            teamClient.releaseClient();
            teamSeasonClient.releaseClient();
        }
    } finally {
        logger.info(`Emitter: Disconnecting from beanstalkd...`)
        BEANSTALK_CLIENT_POOL.disconnect();
    }

    logger.info(`Emitter: Queue emitter exiting.`)
}

startEmitter();