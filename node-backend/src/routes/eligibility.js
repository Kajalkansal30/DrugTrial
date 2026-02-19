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
            return res.status(404).json({ error: 'Trial not found or access denied' });
        }
        
        // Forward to Python backend using the database ID
        const response = await pythonClient.get(`/api/eligibility/results/${trial.id}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
