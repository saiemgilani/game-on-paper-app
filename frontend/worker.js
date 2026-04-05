const logger = require("./utils/logger");
const ejs = require("ejs");
const axios = require("axios");
const {sleep} = require("./utils/misc");
const GamesModel = require("./cfb/resources/game")
const SummaryModel = require("./cfb/resources/summary")
const { setCachedValue } = require("./utils/cache")

const BEANSTALK_CLIENT_POOL = require("./utils/beanstalk").BEANSTALK_CLIENT_POOL;
const BEANSTALK_RESERVE_TIMEOUT = process.env.BEANSTALK_RESERVE_TIMEOUT ?? 60;
const REDIS_GAME_TTL = process.env.REDIS_GAME_TTL ?? 120;
let IS_ACTIVE_BEANSTALK_WORKER = (process.env.IS_ACTIVE_BEANSTALK_WORKER == "true") ?? false;


async function generateGameHtml(gameId, header) {
    try {
        if (GamesModel.QUARANTINE_LIST.includes(gameId)) {
            throw new Error(`Game ${gameId} has been quarantined`);
        }
        // if it's past/live, send to normal template
        const data = await GamesModel.retrievePBP(gameId);
        if (data == null || data.gameInfo == null) {
            throw Error(`Data not available for game ${gameId}. An internal service may be down.`)
        }

        let percentiles = [];
        try {
            const inputSeason = data["header"]["season"]["year"];
            const season = Math.min(Math.max(inputSeason, 2014), 2025); // always clamped a season behind until week 4
            logger.info(`retreiving percentiles for season ${season}, input was ${inputSeason} clamped to 2014 to 2025`)
            percentiles = await SummaryModel.retrievePercentiles(season);
        } catch (e) {
            logger.error(`error while retrieving league percentiles: ${e}`)
        }

        return ejs.renderFile('./views/pages/cfb/game.ejs', {
            gameData: data,
            percentiles,
            season
        });
    } catch (e) {
        logger.error(`Error while loading PBP data: ${e}`);
        return ejs.renderFile('./views/pages/cfb/game_error.ejs', {
            gameData: {
                gameInfo: header["competitions"][0]
            },
            errorType: (e.message.includes('quarantine')) ? 'quarantine' : 'pbp'
        });
    }
}

async function generatePreviewHtml(gameId, header) {
    const game = header["competitions"][0];
    const season = header["season"]["year"];
    const week = header["week"];
    const homeComp = game.competitors[0];
    const awayComp = game.competitors[1];
    const homeTeam = homeComp.team;
    const awayTeam = awayComp.team;

    const homeBreakdown = await SummaryModel.retrieveTeamData(2025, homeTeam.id, 'overall');
    const awayBreakdown = await SummaryModel.retrieveTeamData(2025, awayTeam.id, 'overall');
    return ejs.renderFile('./views/pages/cfb/pregame.ejs', {
        season,
        week,
        view_full: false,
        gameData: {
            gameInfo: game,
            header,
            matchup: {
                team: [
                    ...awayBreakdown, ...homeBreakdown
                ]
            }
        }
    });
}

async function handleJob(client, job) {
    try {
        logger.info(`Starting job ${job.id} processing with payload: ${JSON.stringify(job.payload)}`);
        // send to python and retrieve rendered HTML response
        const page = await GamesModel.retrieveGamePage(job.payload.gameId);
        const gameHeader = page["gamepackageJSON"]["header"];
        const game = gameHeader["competitions"][0];

        let htmlResponse = null;
        if (game["status"]["type"]["name"] === 'STATUS_SCHEDULED') {
            // if it's in the future, send to pregame template
            htmlResponse = await generatePreviewHtml(job.payload.gameId, gameHeader)
        } else {
            // if it's old or current, send to current template
            htmlResponse = await generateGameHtml(job.payload.gameId, gameHeader)
        }

        if (htmlResponse) {
            // store in redis
            await setCachedValue(job.payload.gameId, htmlResponse, parseInt(REDIS_GAME_TTL))
        }
        logger.info(`Payload processing for ${JSON.stringify(job.payload)} was successful.`);
    } catch (err) {
        logger.error(`Error while handling payload ${JSON.stringify(job.payload)}: ${err}`);
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
        logger.info(`Starting up queue worker...`)
        setupSignalHandlers();

        logger.info(`Waiting for summary service to be fully up...`);
        await waitForSummaryEndpoint(30, 5);

        logger.info(`Creating beanstalkd pool and connecting client...`)
        let client = await BEANSTALK_CLIENT_POOL.connect();

        logger.info(`Starting queue worker loop...`)
        while (IS_ACTIVE_BEANSTALK_WORKER) {
            // read next match ID from queue - reserveWithTimeout blocks for BEANSTALK_RESERVE_TIMEOUT value (Default 60 sec)
            const job = await client.reserve(); //WithTimeout(parseInt(BEANSTALK_RESERVE_TIMEOUT));
            if (!job || !job.payload) {
                logger.info("not a real job, skipping...")
            }
            // job.id, job.payload
            await handleJob(client, job);

            if (!IS_ACTIVE_BEANSTALK_WORKER) {
                logger.info(`Queue processing stopping gracefully...`)
                break;
            }
        }
        logger.info(`Releasing client to beanstalkd pool...`)
        client.releaseClient();
    } catch (err) {
        logger.error(`Uncaught error in queue worker: ${err}`)
    } finally {
        logger.info(`Disconnecting from beanstalkd...`)
        BEANSTALK_CLIENT_POOL.disconnect();
    }

    logger.info(`Queue worker exiting.`)
}


startWorker();