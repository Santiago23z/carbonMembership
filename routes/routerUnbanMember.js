const express = require('express');
const { UnbanChatMember } = require('../controllers/functions.handler');
const router = express.Router();


router.post("/", (req, res) => {
    const { telegram_id } = req.body;
    UnbanChatMember(telegram_id);
    res.sendStatus(200);
});

module.exports = router
