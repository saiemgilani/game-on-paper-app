const cheerio = require('cheerio');
module.exports = {
    casesByRegion: (req) => {
        const $ = cheerio.load(req.data)
        let tabBody = $('#main_table_countries > tbody > tr > td')
        let dataArray = tabBody.text().replace(/\s+/g, ' ').trim().split(' ');
        let casesByCountry = [];
        let caseCount = []
        let cases = {
            country: casesByCountry,
            count: caseCount
        }

        let i;
        for (i = 0; i < dataArray.length; i++) {
            if (i === dataArray.length - 1) {
                return cases
            }
            else if (!parseInt(dataArray[i]) && !dataArray[i].includes('+') && !parseFloat(dataArray[i])) {
                if (dataArray[i] === '0') {
                    console.log('is zero')
                }
                else if (!parseInt(dataArray[i + 1])) {
                    if(!parseInt(dataArray[i + 2])) {
                        if(!parseInt(dataArray[i + 3])){
                            casesByCountry.push(`${dataArray[i]} ${dataArray[i + 1]} ${dataArray[i + 2]} ${dataArray[i + 3]}`);
                            caseCount.push(dataArray[i + 4]);
                            i = i+4;
                        }
                        else {
                            casesByCountry.push(`${dataArray[i]} ${dataArray[i + 1]} ${dataArray[i + 2]}`);
                            caseCount.push(dataArray[i + 3]);
                            i = i+3;
                        }
                    }
                    else {
                        casesByCountry.push(`${dataArray[i]} ${dataArray[i + 1]}`);
                        caseCount.push(dataArray[i + 2]);
                        i++;
                    }
                    
                }
                else {
                    casesByCountry.push(dataArray[i])
                    caseCount.push(dataArray[i + 1])
                }
            }

        }

    },
    totalDeathCases: (req) => {
        let head = 'div:nth-child(2) > table > thead > tr'
        let body = 'div:nth-child(2) > table > tbody'
        return totalDeathCasesScraper(req, head, body)
    },
    casesWithOutcome: (req) => {
        let head = 'div:nth-child(2) > div > table > tbody > tr:nth-child(1) > td'
        let body = ' div:nth-child(2) > div > table > tbody > tr'
        return casesWithOutcome(req, head, body)
    },
    currentlyInfected: (req) => {
        let head = 'div:nth-child(1) > div > table > tbody > tr:nth-child(1) > td'
        let body = 'div:nth-child(1) > div > table > tbody > tr'
        return currentlyInfected(req, head, body)
    }
}

function casesWithOutcome(req, headSelector, bodySelector) {
    const $ = cheerio.load(req.data)
    let tabBody = $(bodySelector)
    let dataArray = tabBody.text();
    dataArray = dataArray.replace(/\s+/g, ' ').trim().split(' ');
    let result = []
    let condition;
    dataArray.forEach(element => {
        condition = parseInt(element.replace(/,/g, ''))
        if (element.includes(',')) {
            result.push(condition)
        }
    });
    return {
        cases_with_outcome: result[0],
        recovered: result[1],
        deaths: result[2]
    }
}

function currentlyInfected(req, headSelector, bodySelector) {
    const $ = cheerio.load(req.data)
    let tabBody = $(bodySelector)
    let dataArray = tabBody.text();
    dataArray = dataArray.replace(/\s+/g, ' ').trim().split(' ');
    let result = []
    let condition;
    dataArray.forEach(element => {
        condition = parseInt(element.replace(/,/g, ''))
        if (element.includes(',')) {
            result.push(condition)
        }
    });
    return {
        currently_infected: result[0],
        mild_condition: result[1],
        critical: result[2]
    }
}

function totalDeathCasesScraper(req, headSelector, bodySelector) {
    const $ = cheerio.load(req.data)
    let tabHeader = $(headSelector)
    let tabBody = $(bodySelector)
    let dataArray = tabHeader.text().concat(tabBody.text());
    dataArray = dataArray.replace(/\s+/g, ' ').trim().split(' ');
    let date = [];
    let totalDeaths = []
    let changeInTotalDeaths = []
    let cases = {
        date: date,
        total_deaths: totalDeaths,
        change_in_total_deaths: changeInTotalDeaths
    }
    let i;
    for (i = 10; i < dataArray.length; i++) {
        if (i === dataArray.length - 1) {
            return cases
        }
        switch (dataArray[i]) {
            case 'Feb.':
                date.push(`${dataArray[i]} ${dataArray[i + 1]}`)
                totalDeaths.push(dataArray[i + 2])
                changeInTotalDeaths.push(dataArray[i + 3])
                break;
            case 'Jan.':
                date.push(`${dataArray[i]} ${dataArray[i + 1]}`)
                totalDeaths.push(dataArray[i + 2])
                changeInTotalDeaths.push(dataArray[i + 3])
                break;
            case 'Mar.':
                date.push(`${dataArray[i]} ${dataArray[i + 1]}`)
                totalDeaths.push(dataArray[i + 2])
                changeInTotalDeaths.push(dataArray[i + 3])
                break;
            case 'Apr.':
                date.push(`${dataArray[i]} ${dataArray[i + 1]}`)
                totalDeaths.push(dataArray[i + 2])
                changeInTotalDeaths.push(dataArray[i + 3])
                break;
        }
    }
}