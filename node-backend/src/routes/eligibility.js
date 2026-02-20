const express = require('express');
const pythonClient = require('../utils/pythonClient');
const { authMiddleware } = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * POST /api/eligibility/check
 * Check eligibility for a single patient
 */
router.post('/check', authMiddleware, async (req, res, next) => {
    try {
        // Add organization_id to the request
        const bodyWithOrg = {
            ...req.body,
            organization_id: req.user.organizationId
        };

        const response = await pythonClient.post('/api/eligibility/check', bodyWithOrg);

        // Create organization-scoped audit log
        try {
            await prisma.auditLog.create({
                data: {
                    action: 'Eligibility Check Performed',
                    agent: 'Node Backend',
                    targetType: 'patient',
                    targetId: req.body.patient_id?.toString(),
                    status: 'Success',
                    organizationId: req.user.organizationId,
                    details: {
                        trialId: req.body.trial_id,
                        patientId: req.body.patient_id,
                        user: req.user.username
                    }
                }
            });
        } catch (auditErr) {
            console.warn('⚠️  Failed to create audit log:', auditErr.message);
        }

        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/eligibility/batch-check
 * Check eligibility for multiple patients
 */
router.post('/batch-check', authMiddleware, async (req, res, next) => {
    try {
        // Add organization_id to the request
        const bodyWithOrg = {
            ...req.body,
            organization_id: req.user.organizationId
        };

        const response = await pythonClient.post('/api/eligibility/batch-check', bodyWithOrg);

        // Create organization-scoped audit log
        try {
            await prisma.auditLog.create({
                data: {
                    action: 'Batch Eligibility Check Performed',
                    agent: 'Node Backend',
                    targetType: 'trial',
                    targetId: req.body.trial_id?.toString(),
                    status: 'Success',
                    organizationId: req.user.organizationId,
                    details: {
                        trialId: req.body.trial_id,
                        patientCount: req.body.patient_ids?.length || 0,
                        user: req.user.username
                    }
                }
            });
        } catch (auditErr) {
            console.warn('⚠️  Failed to create audit log:', auditErr.message);
        }

        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/eligibility/results/:trialId
 * Get all eligibility results for a specific trial
 */
router.get('/results/:trialId', authMiddleware, async (req, res, next) => {
    try {
        const { trialId } = req.params;

        console.log('[Eligibility] Looking for trial:', trialId, 'for org:', req.user.organizationId);

        // trialId could be either the string trial_id or numeric id
        // Try to find by trialId (string) first
        let trial = await prisma.clinicalTrial.findFirst({
            where: {
                trialId: trialId,
                organizationId: req.user.organizationId
            }
        });

        // If not found and trialId is numeric, try by id
        if (!trial && !isNaN(trialId)) {
            trial = await prisma.clinicalTrial.findFirst({
                where: {
                    id: parseInt(trialId),
                    organizationId: req.user.organizationId
                }
            });
        }

        if (!trial) {
            console.log('[Eligibility] Trial not found:', trialId);
            return res.status(404).json({
                error: 'Trial not found or access denied',
                details: `Trial ${trialId} not found for organization ${req.user.organizationId}`
            });
        }

        console.log('[Eligibility] Found trial:', trial.id, trial.trialId);

        // Forward to Python backend using the database ID
        try {
            const response = await pythonClient.get(`/api/eligibility/results/${trial.id}`);
            res.json(response.data);
        } catch (apiError) {
            // If Python backend returns 404, it means screening hasn't been run yet
            // Return empty results instead of error to allow graceful handling
            if (apiError.response?.status === 404) {
                console.log('[Eligibility] No screening results found for trial:', trial.id, '(not run yet)');
                return res.json({ results: [], message: 'No eligibility screening results available' });
            }
            // For other errors, throw to error handler
            throw apiError;
        }
    } catch (error) {
        console.error('[Eligibility] Error:', error.message);
        next(error);
    }
});

module.exports = router;
