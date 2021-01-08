const express = require('express');
const Controller = require('./controller');
const Schedule = require('./schedule');
const router = express.Router();

router.get('/healthcheck', Controller.getServiceHealth)

async function retrieveGameList(url, params) {
    var gameList = await Controller.getGameList(params);
    if (gameList == null) {
        throw Error(`Data not available for ${url} because of a service error.`)
    }
    gameList = gameList.filter(g => {
        const gameComp = g.competitions[0];
        const homeComp = gameComp.competitors[0];
        const awayComp = gameComp.competitors[1];

        return (parseFloat(homeComp.id) >= 0 && parseFloat(awayComp.id) >= 0);
    })
    return gameList;
}

router.get('/', async function(req, res, next) {
    try {
        let gameList = await retrieveGameList(req.originalUrl, null);
        let weekList = await Schedule.getWeeksMap();
        return res.render('pages/cfb/index', {
            scoreboard: gameList,
            weekList: weekList,
            year: req.params.year,
            week: req.params.week,
            seasontype: 2
        });
    } catch(err) {
        return next(err)
    }
});

router.route('/year/:year/type/:type/week/:week')
    .get(async function(req, res, next) {
        try {
            let gameList = await retrieveGameList(req.originalUrl, { year: req.params.year, week:req.params.week, type: req.params.type, group: req.query.group });
            let weekList = await Schedule.getWeeksMap();
            return res.render('pages/cfb/index', {
                scoreboard: gameList,
                weekList: weekList,
                year: req.params.year,
                week: req.params.week,
                seasontype: req.params.type
            });
        } catch(err) {
            return next(err)
        }
    })
    .post(async function(req, res, next) {
        try {
            let data = await retrieveGameList(req.originalUrl, { year: req.params.year, week:req.params.week, type: req.params.type, group: req.query.group })
            return res.json(data);
        } catch(err) {
            return next(err)
        }
    });

router.route('/game/:gameId')
    .get(async function(req, res, next) {
        try {
            let data = await Controller.getPBP(req.params.gameId);
            if (data == null || data.gameInfo == null) {
                throw Error(`Data not available for game ${req.params.gameId}. An internal service may be down.`)
            }
            if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
                return res.json(data);
            } else {
                return res.render('pages/cfb/game', {
                    gameData: data
                });
            }
        } catch(err) {
            // invalid gameId should be routed to the index to select a different game
            let gameList = await retrieveGameList(req.originalUrl, null);
            return res.render('pages/cfb/index', {
                gameId: req.params.gameId,
                scoreboard: gameList
            });
        }
    })
    .post(async function(req, res, next) {
        try {
            let data = await Controller.getPBP(req, res);
            if (data == null || data.gameInfo == null) {
                throw Error(`Data not available for game ${req.params.gameId}. An internal service may be down.`)
            }
    
            return res.json(data);
        } catch(err) {
            return next(err)
        }
    });

module.exports = router