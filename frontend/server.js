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
        let espnData = response.data;
        var gameList = (espnData.events != null) ? espnData.events : [];
        gameList = gameList.filter(g => {
            const gameComp = g.competitions[0];
            const homeComp = gameComp.competitors[0];
            const awayComp = gameComp.competitors[1];

            return (parseFloat(homeComp.id) >= 0 && parseFloat(awayComp.id) >= 0);
        })

        return res.render('pages/index', {
            scoreboard: gameList
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

        if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
            return res.json(data);
        } else {
            return res.render('pages/game', {
                gameData: data
            });
        }
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

// Start the API service -- this one has its own debug logs so no prefix needed
const api = spawn('node server.js', { 
    shell: true,
    cwd: "../api",
    env: {
        RDATA_BASE_URL: process.env.RDATA_BASE_URL,
        NODE_DEBUG: "[API]"
    }
});

api.stdout.on('data', (data) => {
    console.log(`${data}`);
});

api.stderr.on('data', (data) => {
    console.error(`${data}`);
});

api.on('close', (code) => {
    console.error(`[API] child process exited with code ${code}`);
});

api.on('error', (err) => {
    console.error(`[API] Failed to start subprocess: ${err}`);
});

// Start the frontend service
app.listen(port, () => {
    debuglog(`listening on port ${port}`)
})

app.use(function (err, req, res, next) {
    debuglog(err.stack)
    if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
        return res.status(500).json({
            status: 500,
            message: err.message
        });
    } else {
        return res.status(500).send(err.message)
    }
})