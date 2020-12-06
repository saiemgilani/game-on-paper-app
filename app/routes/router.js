const express = require('express');
const Controller = require('../controller/controller');

const router = express.Router();

router.get('/cfb/pbp', Controller.getPBP);


module.exports = router;