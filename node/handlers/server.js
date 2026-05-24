import express from 'express';
import morgan from 'morgan';
import cfb from '../cfb/routes.js';
import logger from '../utils/logger.js';
// var path = require('path');
import path from "path";
const port = process.env.PORT || 8000;

const app = express();
app.use(morgan('[frontend] :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]'));
app.set('views', path.join(import.meta.dirname, "../", 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(import.meta.dirname, "../", 'public')));

const BANNED_USER_AGENT_LIST = [
    'my-tiny-bot',
    'fidget-spinner-bot',
    'facebot',
    'twitterbot',
    'bingbot',
    'facebookexternalhit',
    'ahrefssiteaudit',
    "AdsBot-Google",
    "Amazonbot",
    "anthropic-ai",
    "Applebot",
    "Applebot-Extended",
    "AwarioRssBot",
    "AwarioSmartBot",
    "Bytespider",
    "CCBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-Web",
    "cohere-ai",
    "DataForSeoBot",
    "Diffbot",
    "FacebookBot",
    "FriendlyCrawler",
    "Google-Extended",
    "GoogleOther",
    "GPTBot",
    "img2dataset",
    "ImagesiftBot",
    "magpie-crawler",
    "Meltwater",
    "omgili",
    "omgilibot",
    "peer39_crawler",
    "peer39_crawler/1.0",
    "PerplexityBot",
    "PiplBot",
    "scoop.it",
    "Seekr",
    "YouBot"
]
const BANNED_USER_AGENT_LIST_REGEX = new RegExp(BANNED_USER_AGENT_LIST.join("|"))

app.use((req, res, next) => {
    if ((req.get('User-Agent')?.toLocaleLowerCase().match(BANNED_USER_AGENT_LIST_REGEX) ?? false)) {
        return res.status(429).json({
            status: 429,
            message: "Too many requests."
        });
    } else if (!["GET", "HEAD"].includes(req.method)) {
        return res.status(405).json({
            status: 405,
            message: "Method not allowed."
        });
    } else {
        next()
    }
})

app.use('/cfb', cfb);

// index page
app.get('/', function(req, res) {
    res.redirect('/cfb/');
});

// Start the frontend service
app.listen(port, () => {
    logger.info(`listening on port ${port}`)
})

app.use(function (err, req, res, next) {
    logger.error(err.stack)
    return res.status(500).render(path.join(import.meta.dirname, "..", 'views', 'error'), {
        error: err
    });
})
