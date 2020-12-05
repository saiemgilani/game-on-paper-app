const express = require('express');
const Controller = require('../controller/controller');

const router = express.Router();


router.get('/cfb/pbp', Controller.getPBP);
router.get('/cfb/box', Controller.getBox);
router.get('/cfb/summary', Controller.getSummary)
router.get('/currentlyInfected', Controller.currentlyInfected)

module.exports = router;