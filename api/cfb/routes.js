const express = require('express');
const Controller = require('./controller');

const router = express.Router();

router.get('/games', Controller.getGameList);
router.get('/pbp/:gameId', Controller.getPBP);
router.get('/healthcheck', Controller.getServiceHealth)

module.exports = router