const express = require('express');
const Controller = require('../controller/controller');

const router = express.Router();

router.get('/cfb/games', Controller.getGameList);
router.get('/cfb/pbp/:gameId', Controller.getPBP);
router.get('/cfb/healthcheck', Controller.getServiceHealth)

module.exports = router;