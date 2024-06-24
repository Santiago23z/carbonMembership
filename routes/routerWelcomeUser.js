const express = require('express');
const { WelcomeUser } = require('../controllers/functions.handler');
const router = express.Router();

router.get("/", (req, res) => {
  WelcomeUser()
});

module.exports = router