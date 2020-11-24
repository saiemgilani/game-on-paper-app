
const axios = require('axios');
const utility = require('../utility/utility')

module.exports = {
    casesByRegion: (req, res) => {
        const casesByCountryUrl = 'https://www.worldometers.info/coronavirus/'
        axios(casesByCountryUrl).then((result) => {
            const response = utility.casesByRegion(result)
            res.send(response);
    })
    
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


