const express = require('express');
const pythonClient = require('../utils/pythonClient');

const router = express.Router();

/**
 * GET /api/patients
 * List all patients (de-identified)
 */
router.get('/', async (req, res, next) => {
    try {
        const { limit = 100 } = req.query;
        const response = await pythonClient.get('/api/patients', {
            params: { limit }
        });
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/patients/:patientId
 * Get patient details
 */
router.get('/:patientId', async (req, res, next) => {
    try {
        const { patientId } = req.params;
        const response = await pythonClient.get(`/api/patients/${patientId}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
