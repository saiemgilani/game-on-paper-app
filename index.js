const express = require('express')
const axios = require("axios")
const cheerio = require('cheerio');

const bodyParser = require("body-parser")
const port = process.env.PORT || 5000
const app = express()

app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

app.get("/", (req, res) => {
    res.send("Welcome to the sportsdataverse!")
  })


app.get('/status', (req, res) => res.send({status: "I'm alive!"}))

// # create a get cfb schedule endpoint
app.get('/cfb/schedule', (req, res) => {
  // if (!req.query.week) {
  //     res.json("No week found in reqest body.")
  // } else {
    const baseUrl = 'http://cdn.espn.com/core/college-football/schedule'
    const params = {
      dates: req.query.year,
      week: req.query.week,
      group: req.query.groups,
      seasontype: req.query.seasontype,
      date: 2020,
      xhr: 1
    }
    axios.get(baseUrl, {params})
      .then(function(response){
        res.json({schedule: response.data.content.schedule,
                  params: response.data.content.parameters,
                  calendar: response.data.content.calendar
        })
      }).catch(function(error) {
          res.json("Error occured!")  
        })
  // }
})  

app.get('/cfb/pbp', (req, res) => {
    if (!req.query.id) {
        res.json("No ID found in reqest body.")
    } else {
      axios.get(`http://cdn.espn.com/core/college-football/playbyplay?gameId=${req.query.id}&render=false&xhr=1&userab=1`)
        .then(function(response){
          res.json({drives: response.data.gamepackageJSON.drives,
                    previousDrives: response.data.gamepackageJSON.drives.previous,
                    currentDrives: response.data.gamepackageJSON.drives.current,
                    awayTeamLogo: response.data.__gamepackage__.awayTeamLogo,
                    awayTeamScore: response.data.__gamepackage__.awayTeam.score,
                    awayTeamWinner: response.data.__gamepackage__.awayTeam.winner,
                    awayTeamPossession: response.data.__gamepackage__.awayTeam.possession,
                    awayTeamRank: response.data.__gamepackage__.awayTeam.rank,
                    awayTeamRecord: response.data.__gamepackage__.awayTeam.record,
                    awayTeamId: response.data.__gamepackage__.awayTeam.id,
                    awayTeamDisplayName: response.data.__gamepackage__.awayTeam.team.displayName,
                    awayTeamName: response.data.__gamepackage__.awayTeam.team.nickname,
                    awayTeamLocation: response.data.__gamepackage__.awayTeam.team.location,
                    awayTeamAbbr: response.data.__gamepackage__.awayTeam.team.abbreviation,
                    awayTeamColor: response.data.__gamepackage__.awayTeam.team.color,
                    awayTeamAltColor: response.data.__gamepackage__.awayTeam.team.alternateColor,
                    homeTeamLogo: response.data.__gamepackage__.homeTeamLogo,
                    homeTeamScore: response.data.__gamepackage__.homeTeam.score,
                    homeTeamWinner: response.data.__gamepackage__.homeTeam.winner,
                    homeTeamPossession: response.data.__gamepackage__.homeTeam.possession,
                    homeTeamRank: response.data.__gamepackage__.homeTeam.rank,
                    homeTeamRecord: response.data.__gamepackage__.homeTeam.record,
                    homeTeamId: response.data.__gamepackage__.homeTeam.id,
                    homeDisplayName: response.data.__gamepackage__.homeTeam.team.displayName,
                    homeTeamName: response.data.__gamepackage__.homeTeam.team.nickname,
                    homeTeamLocation: response.data.__gamepackage__.homeTeam.team.location,
                    homeTeamAbbr: response.data.__gamepackage__.homeTeam.team.abbreviation,
                    homeTeamColor: response.data.__gamepackage__.homeTeam.team.color,
                    homeTeamAltColor: response.data.__gamepackage__.homeTeam.team.alternateColor,
                    scoringPlays: response.data.gamepackageJSON.scoringPlays,
                    winprobability: response.data.gamepackageJSON.winprobability,
                    teams: response.data.gamepackageJSON.header.competitions[0].competitors,
                    boxscore: response.data.gamepackageJSON.boxscore,
                    competitions:  response.data.gamepackageJSON.header.competitions,
                    gameId: response.data.gameId,
                    year: response.data.gamepackageJSON.header.season.year,
                    seasonType: response.data.gamepackageJSON.header.season.type,
                    week: response.data.gamepackageJSON.header.week,
                    date: response.data.gamepackageJSON.header.date,
                    conferenceCompetition: response.data.gamepackageJSON.header.competitions[0].conferenceCompetition,
                    timeValid: response.data.gamepackageJSON.header.timeValid,
                    isTournament: response.data.gamepackageJSON.header.isTournament,
                    statusState: response.data.content.statusState,
                    videos: response.data.gamepackageJSON.videos
          })}).catch(function(error) {
            res.json("Error occured!")  
          })
    }
})  

// # create a get cfb schedule endpoint
app.get('/cbb/schedule', (req, res) => {
  // if (!req.query.week) {
  //     res.json("No week found in reqest body.")
  // } else {
    const baseUrl = 'http://cdn.espn.com/core/mens-college-basketball/schedule'
    const params = {
      dates: req.query.year,
      week: req.query.week,
      group: req.query.groups,
      seasontype: req.query.seasontype,
      date: 2020,
      xhr: 1
    }
    axios.get(baseUrl, {params})
      .then(function(response){
        res.json({schedule: response.data.content.schedule,
                  params: response.data.content.parameters,
                  calendar: response.data.content.calendar
        })
      }).catch(function(error) {
          res.json("Error occured!")  
        })
  // }
})  


app.get('/cbb/pbp', (req, res) => {
  if (!req.query.id) {
      res.json("No ID found in reqest body.")
  } else {
    axios.get(`http://cdn.espn.com/core/mens-college-basketball/playbyplay?gameId=${req.query.id}&render=false&xhr=1&userab=1`)
      .then(function(response){
        res.json({plays: response.data.gamepackageJSON.plays,
                  videos: response.data.gamepackageJSON.videos,
                  winprobability: response.data.gamepackageJSON.winprobability,
                  teams: response.data.gamepackageJSON.header.competitions[0].competitors,
                  competitions:  response.data.gamepackageJSON.header.competitions,
                  content: response.data.content,
                  statusState: response.data.content.statusState,
                  year: response.data.gamepackageJSON.header.season.year,
                  seasonType: response.data.gamepackageJSON.header.season.type,
                  week: response.data.gamepackageJSON.header.week,
                  gameId: response.data.gameId,
                  shotChartAvailable:  response.data.gamepackageJSON.header.competitions[0].shotChartAvailable,
                  timeoutsAvailable:  response.data.gamepackageJSON.header.competitions[0].timeoutsAvailable,
                  neutralSite:  response.data.gamepackageJSON.header.competitions[0].neutralSite,
                  boxscoreSource:  response.data.gamepackageJSON.header.competitions[0].boxscoreSource,
                  possessionArrowAvailable:  response.data.gamepackageJSON.header.competitions[0].possessionArrowAvailable,
                  recent:  response.data.gamepackageJSON.header.competitions[0].recent
        })}).catch(function(error) {
          res.json("Error occured!")  
        })
  }
})  

app.listen(port, () => console.log(`Example app listening on port ${port}!`))