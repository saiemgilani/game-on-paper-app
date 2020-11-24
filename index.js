const express = require('express')
const axios = require("axios")
const port = process.env.PORT || 5000

const app = express()

app.get("/", (req, res) => {
    res.send("Welcome to your App!")
  })

app.get("/users", (req, res) => {
  axios.get("https://jsonplaceholder.typicode.com/users")
    .then(function(response) {
      res.json(response.data)
    }).catch(function(error) {
      res.json("Error occured!")
  })
})  

app.get('/status', (req, res) => res.send({status: "I'm alive!"}))
exports.getPlayByPlay = async (id) => {
    const baseUrl = 'http://cdn.espn.com/core/college-football/playbyplay';
    const params = {
        gameId: id,
        xhr: 1,
        render: 'false',
        userab: 18
    };

    const res = await axios.get(baseUrl, {
        params
    });

    return {
        scoringPlays: res.data.gamepackageJSON.scoringPlays,
        videos: res.data.gamepackageJSON.videos,
        drives: res.data.gamepackageJSON.drives,
        teams: res.data.gamepackageJSON.header.competitions[0].competitors,
        id: res.data.gamepackageJSON.header.id,
        competitions: res.data.gamepackageJSON.header.competitions,
        season: res.data.gamepackageJSON.header.season,
        week: res.data.gamepackageJSON.header.week
    };
};

exports.getBoxScore = async (id) => {
    const baseUrl = 'http://cdn.espn.com/core/college-football/boxscore';
    const params = {
        gameId: id,
        xhr: 1,
        render: false,
        device: 'desktop',
        userab: 18
    };

    const res = await axios.get(baseUrl, {
        params
    });

    const game = res.data.gamepackageJSON.boxscore;
    game.id = res.data.gameId;

    return game;
};

exports.getSummary = async (id) => {
    const baseUrl = 'http://site.api.espn.com/apis/site/v2/sports/football/college-football/summary';
    const params = {
        event: id
    };

    const res = await axios.get(baseUrl, {
        params
    });

    return res.data;
};

app.listen(port, () => console.log(`Example app listening on port ${port}!`))