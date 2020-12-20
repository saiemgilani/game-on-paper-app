const express = require('express');
const axios = require('axios');
const morgan = require("morgan");
var path = require('path');
const port = 8000;
const API_BASE_URL = process.env.API_BASE_URL;

const app = express();
app.use(morgan('[frontend] :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]'));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));

console.log("API BASE URL: " + API_BASE_URL);

// index page
app.get('/', function(req, res) {
    res.redirect('/cfb');
});

// index page
app.get('/cfb', async function(req, res) {
    const response = await axios.get(API_BASE_URL + "/cfb/games");
    // console.info(response.data)
    return res.render('pages/index', {
        scoreboard: (response.data != null && response.data.events != null) ? response.data.events : []
    });
});

async function retrieveGameData(gameId) {
    console.log("starting data retrieval for game " + gameId)
    var fullURL = (API_BASE_URL + '/cfb/pbp/' + gameId)
    console.log("accessing URL " + fullURL)
    const res = await axios.get(fullURL);
    return res.data
}

app.get('/cfb/game/:gameId', async function(req, res) {
    let data = await retrieveGameData(req.params.gameId);
    res.render('pages/game', {
        gameData: data
    });
});

app.listen(port, () => {
    console.log(`listening on port ${port}`)
})
