const express = require('express');
const morgan = require("morgan");
const { spawn } = require('child_process');
const cfb = require('./cfb/routes.js');
const { timingMiddleware } = require('./cfb/timing.js');
var path = require('path');
const port = process.env.PORT || 8000;

const util = require('util');
const debuglog = util.debuglog('[frontend]');

// Per-request fields that may be considered PII under GDPR/CCPA when retained
// in logs. Default-on preserves existing behavior (the original morgan format
// included :remote-addr); set LOG_INCLUDE_PII=false to drop these fields if
// your retention/aggregation policy requires it.
const LOG_INCLUDE_PII = process.env.LOG_INCLUDE_PII !== 'false';

const app = express();
app.use(morgan(function (tokens, req, res) {
    const line = {
        event: 'access',
        method: tokens.method(req, res),
        url: tokens.url(req, res),
        status: Number(tokens.status(req, res)) || 0,
        contentLength: Number(tokens.res(req, res, 'content-length')) || 0,
        responseTimeMs: Number(tokens['response-time'](req, res)) || 0,
        date: tokens.date(req, res, 'iso'),
    };
    if (LOG_INCLUDE_PII) {
        line.remoteAddr = tokens['remote-addr'](req, res);
        line.userAgent = tokens['user-agent'](req, res);
        line.referrer = tokens.referrer(req, res);
    }
    return JSON.stringify(line);
}));
app.use(timingMiddleware());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));

const BANNED_USER_AGENT_LIST = [
    'my-tiny-bot',
    'fidget-spinner-bot',
    'facebot',
    'twitterbot',
    'bingbot',
    'facebookexternalhit',
    'ahrefssiteaudit'
]
const BANNED_USER_AGENT_LIST_REGEX = new RegExp(BANNED_USER_AGENT_LIST.join("|"))

app.use((req, res, next) => {
    if (req.get('User-Agent').toLocaleLowerCase().match(BANNED_USER_AGENT_LIST_REGEX)) {
        return res.status(429).json({
            status: 429,
            message: "Too many requests."
        });
    } else if (!["GET", "POST"].includes(req.method)) {
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
    debuglog(`listening on port ${port}`)
})

app.use(function (err, req, res, next) {
    debuglog(err.stack)
    if (req.method == "POST" || req.query.json == true || req.query.json == "true" || req.query.json == "1") {
        return res.status(500).json({
            status: 500,
            message: err.message
        });
    } else {
        return res.status(500).render('error', {
            error: err
        });
    }
})
