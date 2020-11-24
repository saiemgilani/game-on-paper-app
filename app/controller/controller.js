
const axios = require('axios');
const utility = require('../services/game.service')

module.exports = {
    getPlayByPlay = async (id) => {
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
        }
    },
    casesWithOutcome: (req, res) => {
        const casesByDateUrl = 'https://www.worldometers.info/coronavirus/coronavirus-cases/'
        axios(casesByDateUrl).then((result) => {
            const response = utility.casesWithOutcome(result)
            res.send(response)
        })
    },
    currentlyInfected: (req, res) => {
        const casesByDateUrl = 'https://www.worldometers.info/coronavirus/coronavirus-cases/'
        axios(casesByDateUrl).then((result) => {
            const response = utility.currentlyInfected(result)
            res.send(response)
        })
    },
    totalDeaths: (req, res) => {
        const casesByDeathUrl = 'https://www.worldometers.info/coronavirus/coronavirus-death-toll/'
        axios(casesByDeathUrl).then((result) => {
            const response = utility.totalDeathCases(result)
            res.send(response);
        })

    }

}


