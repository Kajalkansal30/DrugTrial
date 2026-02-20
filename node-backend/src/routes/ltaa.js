const express = require('express');
const pythonClient = require('../utils/pythonClient');

const router = express.Router();

/**
 * POST /api/ltaa/analyze
 * Analyze disease for literature targets
 */
router.post('/analyze', async (req, res, next) => {
    try {
        const response = await pythonClient.post('/api/ltaa/analyze', req.body, {
            timeout: 180000 // 3 minutes for literature analysis
        });
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/ltaa/report/:disease
 * Get LTAA report for disease
 */
router.get('/report/:disease', async (req, res, next) => {
    try {
        const { disease } = req.params;
        const response = await pythonClient.get(`/api/ltaa/report/${disease}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
