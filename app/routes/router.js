const express = require('express');
const Controller = require('../controller/controller');

const router = express.Router();


router.get('/casesByRegion', Controller.casesByRegion);
router.get('/totalDeaths', Controller.totalDeaths);
router.get('/casesWithOutcome', Controller.casesWithOutcome)
router.get('/currentlyInfected', Controller.currentlyInfected)

module.exports = router;