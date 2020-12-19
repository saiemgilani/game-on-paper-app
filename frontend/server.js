const express = require('express');
const axios = require('axios');
const morgan = require("morgan");
var path = require('path');
const port = 8000;
const API_BASE_URL = process.env.API_BASE_URL;

const app = express();
app.use(morgan('common'));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));

// index page
app.get('/', function(req, res) {
    res.redirect('/cfb');
});

// index page
app.get('/cfb', function(req, res) {
    res.render('pages/index');
});

async function retrieveGameData(gameId) {
    const res = await axios.get(API_BASE_URL + '/cfb/pbp/' + gameId);
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
