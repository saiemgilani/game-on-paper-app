const logger = require("../utils/logger");
const axios = require("axios");
const { DateTime } = require("luxon");
const {sleep, generateChecksum} = require("../utils/misc");
const GamesModel = require("../cfb/resources/game")
const TeamsModel = require("../cfb/resources/team")
const { setCachedValue } = require("../utils/cache")
// const { putCdnFile } = require("./utils/cdn")

const BEANSTALK_CLIENT_POOL = require("../utils/beanstalk").BEANSTALK_CLIENT_POOL;
const BEANSTALK_RESERVE_TIMEOUT = process.env.BEANSTALK_RESERVE_TIMEOUT ?? 60;
const REDIS_GAME_TTL = process.env.REDIS_GAME_TTL ?? 120;
let IS_ACTIVE_BEANSTALK_WORKER = (process.env.IS_ACTIVE_BEANSTALK_WORKER == "true") ?? false;
const BEANSTALK_WORKER_TUBE_NAME = process.env.BEANSTALK_WORKER_TUBE_NAME ?? "game";

async function handleJob(client, tube, job) {
    try {
        logger.info(`Starting ${tube} job ${job.id} processing with payload: ${JSON.stringify(job.payload)}`);
        if (tube == "game") {
            // send to python and generate rendered HTML response
            const htmlResponse = await GamesModel.generateGameHtml(job.payload.id);

            if (htmlResponse) {
                // store in CDN
                // await putCdnFile(`${tube}/${job.payload.id}.html`, htmlResponse)
                // update checksum
                // const checksum = generateChecksum(job.payload)
                await setCachedValue(`game-${job.payload.id}`, htmlResponse, 0) // no TTL, manual updates only
            }
        } else if (tube == "team") {
            // send to python and generate rendered HTML response
            const htmlResponse = await TeamsModel.generateTeamHtml(job.payload.id);

            if (htmlResponse) {
                // store in CDN
                await putCdnFile(`teams/${job.payload.id}.html`, htmlResponse)
            }
        } else if (tube == "team-season") {
            // send to python and generate rendered HTML response
            const htmlResponse = await TeamsModel.generateTeamSeasonHtml(job.payload.year, job.payload.id);

            if (htmlResponse) {
                // store in CDN
                await putCdnFile(`seasons/${job.payload.year}/${job.payload.id}.html`, htmlResponse)
            }
        }

        logger.info(`Payload processing for ${tube} job ${job.id} was successful.`);
    } catch (err) {
        logger.error(`Error while handling ${tube} job ${job.id}: ${err}`);
    } finally {
        logger.info(`Removing job ${job.id} from queue after processing`);
        client.delete(job.id);
    }
}

function setupSignalHandlers() {
    logger.info(`Setting up process signal handlers...`)
    let sigHandle = (signal) => {
        if (IS_ACTIVE_BEANSTALK_WORKER) {
            logger.info(`Worker received ${signal}, queue processing will stop gracefully after this current job.`)
            IS_ACTIVE_BEANSTALK_WORKER = false;
        } else {
            logger.info(`Worker received ${signal} and is no longer an active worker.`)
        }
    }
    process.on('SIGBREAK', sigHandle);
    process.on('SIGINT', sigHandle);
    process.on('SIGTERM', sigHandle);
}

async function waitForSummaryEndpoint(maxTime = 30, delay = 5) {
    let summaryUp = false;
    let totalTime = 0;

    while (!summaryUp) {
        try {
            const resp = await axios.get("http://summary:3000/health");
            if (resp.status == 200) {
                summaryUp = true
                break;
            } else {
                throw new Error(`Summary service healthcheck returned HTTP status: ${resp.status}`)
            }
        } catch (err) {
            logger.error(`Summary service still not up: ${err}`)
            if (totalTime >= maxTime) {
                throw new Error(`summary service not up after ${maxTime} seconds, bailing out.`)
            } else {
                logger.info(`sleeping ${delay} seconds until summary service up`)
                totalTime += delay;
                await sleep(delay)
            }
        }
    }

    return true;
}


async function startWorker() {
    try {
        logger.info(`Worker: Starting up queue worker...`)
        setupSignalHandlers();

        logger.info(`Worker: Waiting for summary service to be fully up...`);
        await waitForSummaryEndpoint(30, 5);

        logger.info(`Worker: Creating beanstalkd pool and connecting client...`)
        let client = await BEANSTALK_CLIENT_POOL.connect();
        logger.info(`Worker: Watching tube ${BEANSTALK_WORKER_TUBE_NAME}...`)
        await client.watch(BEANSTALK_WORKER_TUBE_NAME);

        logger.info(`Worker: Starting queue worker loop...`)
        while (IS_ACTIVE_BEANSTALK_WORKER) {
            // read next match ID from queue - reserveWithTimeout blocks for BEANSTALK_RESERVE_TIMEOUT value (Default 60 sec)
            const job = await client.reserve();
            if (!job || !job.payload) {
                logger.info("Worker: received something that's not a real job, skipping...")
                continue;
            }

            // job.id, job.payload
            logger.info(`Worker: received valid ${BEANSTALK_WORKER_TUBE_NAME} job to process: ${JSON.stringify(job)}`)
            await handleJob(client, BEANSTALK_WORKER_TUBE_NAME, job);
            logger.info(`Worker: processed ${BEANSTALK_WORKER_TUBE_NAME} job: ${JSON.stringify(job)}, waiting for next job in queue...`)

            if (!IS_ACTIVE_BEANSTALK_WORKER) {
                logger.info(`Worker: Queue processing stopping gracefully...`)
                break;
            }
        }
        logger.info(`Worker: Releasing client to beanstalkd pool...`)
        client.releaseClient();
    } catch (err) {
        logger.error(`Worker: Uncaught error in queue worker: ${err}`)
        if (!IS_ACTIVE_BEANSTALK_WORKER) {
            logger.info(`Worker: Queue processing stopping gracefully...`)
            logger.info(`Worker: Releasing client to beanstalkd pool...`)
            client.releaseClient();
        }
    } finally {
        logger.info(`Worker: Disconnecting from beanstalkd...`)
        BEANSTALK_CLIENT_POOL.disconnect();
    }

    logger.info(`Worker: Queue worker exiting.`)
}


startWorker();