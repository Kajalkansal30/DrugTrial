const express = require('express');
const pythonClient = require('../utils/pythonClient');

const router = express.Router();

// Import all route modules
const authRouter = require('./auth');
const patientsRouter = require('./patients');
const trialsRouter = require('./trials');
const eligibilityRouter = require('./eligibility');
const fdaRouter = require('./fda');
const ltaaRouter = require('./ltaa');
const insilicoRouter = require('./insilico');
const privacyRouter = require('./privacy');
const auditRouter = require('./audit');
const chatRouter = require('./chat');
const submissionsRouter = require('./submissions');
const piRouter = require('./pi');
const patientAnalysisRouter = require('./patient-analysis');

/**
 * Root endpoint - API information
 */
router.get('/', async (req, res, next) => {
    try {
        const response = await pythonClient.get('/');
        res.json({
            ...response.data,
            proxy: 'Node.js Backend',
            version: '1.0.0'
        });
    } catch (error) {
        // Fallback if Python backend is unavailable
        res.json({
            message: 'Drug Trial Automation API - Node.js Proxy',
            version: '1.0.0',
            status: 'running',
            note: 'Acting as middleware between frontend and Python backend',
            python_backend: process.env.PYTHON_BACKEND_URL
        });
    }
});

/**
 * Health check endpoint
 */
router.get('/health', async (req, res, next) => {
    try {
        const response = await pythonClient.get('/health');
        res.json({
            node_backend: 'healthy',
            python_backend: response.data
        });
    } catch (error) {
        res.status(503).json({
            node_backend: 'healthy',
            python_backend: 'unavailable',
            error: error.message
        });
    }
});

/**
 * Stats endpoint
 */
router.get('/stats', async (req, res, next) => {
    try {
        let statsData = null;

        // Try to get stats from Python backend
        try {
            const response = await pythonClient.get('/api/stats');
            statsData = response.data;
        } catch (pythonError) {
            // Python backend unavailable - return fallback stats
            console.log('[Stats] Python backend temporarily unavailable, using fallback data');
            statsData = {
                total_trials: 0,
                total_patients: 0,
                screening_runs: 0,
                eligible_rate: 0
            };
        }

        // If user is authenticated, add organization-specific stats
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const jwt = require('jsonwebtoken');
                const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
                const decoded = jwt.verify(token, JWT_SECRET);

                const { PrismaClient } = require('@prisma/client');
                const prisma = new PrismaClient();

                // Count organization-specific data
                const orgTrials = await prisma.clinicalTrial.count({
                    where: { organizationId: decoded.organizationId }
                });

                statsData.organization_trials = orgTrials;
            } catch (err) {
                // Continue without org stats if auth fails
            }
        }

        res.json(statsData);
    } catch (error) {
        next(error);
    }
});

// Mount all sub-routers
router.use('/auth', authRouter);
router.use('/patients', patientsRouter);
router.use('/trials', trialsRouter);
router.use('/eligibility', eligibilityRouter);
router.use('/fda', fdaRouter);
router.use('/ltaa', ltaaRouter);
router.use('/insilico', insilicoRouter);
router.use('/privacy', privacyRouter);
router.use('/audit', auditRouter);
router.use('/chat', chatRouter);
router.use('/submissions', submissionsRouter);
router.use('/pi', piRouter);
router.use('/patient-analysis', patientAnalysisRouter);

module.exports = router;
