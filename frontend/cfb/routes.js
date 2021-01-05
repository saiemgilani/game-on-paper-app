const express = require('express');
const Controller = require('./controller');

const router = express.Router();

router.get('/healthcheck', Controller.getServiceHealth)

// index page
router.get('/', async function(req, res, next) {
    try {
        const response = await Controller.getGameList();
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
                return res.render('pages/game', {
                    gameData: data
                });
            }
        } catch(err) {
            return next(err)
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