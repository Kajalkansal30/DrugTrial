const express = require('express');
const pythonClient = require('../utils/pythonClient');

const router = express.Router();

/**
 * POST /api/insilico/analyze/text
 * Analyze drug text for in-silico predictions
 */
router.post('/analyze/text', async (req, res, next) => {
    try {
        const response = await pythonClient.post('/api/insilico/analyze/text', req.body, {
            timeout: 180000 // 3 minutes for in-silico analysis
        });
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/insilico/results/:trialId
 * Get in-silico analysis results
 */
router.get('/results/:trialId', async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const response = await pythonClient.get(`/api/insilico/results/${trialId}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/insilico/drug/:name
 * Get drug information
 */
router.get('/drug/:name', async (req, res, next) => {
    try {
        const { name } = req.params;
        const response = await pythonClient.get(`/api/insilico/drug/${name}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
