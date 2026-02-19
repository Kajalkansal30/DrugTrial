const express = require('express');
const pythonClient = require('../utils/pythonClient');

const router = express.Router();

/**
 * GET /api/privacy/summary
 * Get privacy summary
 */
router.get('/summary', async (req, res, next) => {
    try {
        const response = await pythonClient.get('/api/privacy/summary');
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/privacy/verify-samples
 * Verify de-identification samples
 */
router.get('/verify-samples', async (req, res, next) => {
    try {
        const response = await pythonClient.get('/api/privacy/verify-samples');
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
