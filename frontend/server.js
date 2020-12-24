const express = require('express');
const axios = require('axios');
const morgan = require("morgan");
const { spawn } = require('child_process');
var path = require('path');
const port = 8000;
const API_BASE_URL = process.env.API_BASE_URL;

const util = require('util');
const debuglog = util.debuglog('[frontend]');

const app = express();
app.use(morgan('[frontend] :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]'));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));

debuglog("API BASE URL: " + API_BASE_URL);

// index page
app.get('/', function(req, res) {
    res.redirect('/cfb');
});

// index page
app.get('/cfb', async function(req, res, next) {
    try {
        const response = await axios.get(API_BASE_URL + "/cfb/games");
        if (response.data == null) {
            throw Error(`Data not available for /cfb/games. An internal service may be down.`)
        }
        // debuglog(response.data)
        return res.render('pages/index', {
            scoreboard: (response.data != null && response.data.events != null) ? response.data.events : []
        });
    } catch(err) {
        return next(err)
    }
});

async function retrieveGameData(gameId) {
    debuglog("starting data retrieval for game " + gameId)
    var fullURL = (API_BASE_URL + '/cfb/pbp/' + gameId)
    debuglog("accessing URL " + fullURL)
    const res = await axios.get(fullURL);
    return res.data
}

app.get('/cfb/game/:gameId', async function(req, res, next) {
    try {
        let data = await retrieveGameData(req.params.gameId);
        if (data == null || data.gameInfo == null) {
            throw Error(`Data not available for game ${req.params.gameId}. An internal service may be down.`)
        }

        return res.render('pages/game', {
            gameData: data
        });
    } catch(err) {
        return next(err)
    }
});

// Start the Python service
const python = spawn('python app.py', {
    shell: true,
    cwd: "../python"
});

python.stdout.on('data', (data) => {
    console.log(`[python] ${data}`);
});

python.stderr.on('data', (data) => {
    console.error(`[python] ${data}`);
});

python.on('close', (code) => {
    console.error(`[python] child process exited with code ${code}`);
});

python.on('error', (err) => {
    console.error(`[python] Failed to start subprocess: ${err}`);
});

// Start the API service
const api = spawn('node server.js', { 
    shell: true,
    cwd: "../api",
    env: {
        RDATA_BASE_URL:"http://0.0.0.0:7000", 
        API_BASE_URL:"http://0.0.0.0:5000",
        NODE_DEBUG: "[api]"
    }
});

api.stdout.on('data', (data) => {
    console.log(`[api] ${data}`);
});

api.stderr.on('data', (data) => {
    console.error(`[api] ${data}`);
});

api.on('close', (code) => {
    console.error(`[api] child process exited with code ${code}`);
});

api.on('error', (err) => {
    console.error(`[api] Failed to start subprocess: ${err}`);
});

// Start the frontend service
app.listen(port, () => {
    debuglog(`listening on port ${port}`)
})

app.use(function (err, req, res, next) {
    debuglog(err.stack)
    return res.status(500).send(err.message)
})