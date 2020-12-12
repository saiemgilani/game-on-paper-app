const express = require('express');
const Controller = require('../controller/controller');

const router = express.Router();

router.get('/cfb/pbp', Controller.getPBP);
router.get('/cfb/healthcheck', Controller.getServiceHealth)

module.exports = router;