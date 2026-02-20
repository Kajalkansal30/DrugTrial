const express = require('express');
const pythonClient = require('../utils/pythonClient');

const router = express.Router();

/**
 * POST /api/chat
 * Chat with the trial agent
 */
router.post('/', async (req, res, next) => {
    try {
        const response = await pythonClient.post('/api/chat', req.body);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
