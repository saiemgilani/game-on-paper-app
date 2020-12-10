const express = require('express');
const axios = require('axios');
var path = require('path');
const port = 8000;

const app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));

// index page
app.get('/', function(req, res) {
    res.render('pages/index');
});

async function retrieveGameData(gameId) {
    const res = await axios.get('http://api:5000/cfb/pbp?gameId=' + gameId);
    return res.data
}

app.get('/game/:gameId', async function(req, res) {
    let data = await retrieveGameData(req.params.gameId);
    res.render('pages/game', {
        gameData: data
    });
});

app.listen(port, () => {
    console.log(`listening on port ${port}`)
})
