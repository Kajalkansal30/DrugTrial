const express = require('express');
const pythonClient = require('../utils/pythonClient');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/trials/',
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

/**
 * GET /api/trials
 * List all trials for the user's organization
 */
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        // Fetch trials filtered by organization
        const trials = await prisma.clinicalTrial.findMany({
            where: { organizationId: req.user.organizationId },
            orderBy: { createdAt: 'desc' },
            include: {
                fdaDocument: {
                    select: {
                        id: true,
                        filename: true,
                        status: true
                    }
                }
            }
        });
        
        // Transform camelCase to snake_case for frontend compatibility
        const transformedTrials = trials.map(trial => ({
            id: trial.id,
            trial_id: trial.trialId,
            protocol_title: trial.protocolTitle,
            phase: trial.phase,
            indication: trial.indication,
            drug_name: trial.drugName,
            status: trial.status,
            document_id: trial.documentId,
            fda_1571: trial.fda1571,
            fda_1572: trial.fda1572,
            matching_config: trial.matchingConfig,
            analysis_results: trial.analysisResults,
            analysis_status: trial.analysisStatus,
            organization_id: trial.organizationId,
            created_at: trial.createdAt,
            fdaDocument: trial.fdaDocument
        }));
        
        res.json(transformedTrials);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/trials
 * Create a new trial
 */
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        // Add organization_id to the request body
        const bodyWithOrg = {
            ...req.body,
            organization_id: req.user.organizationId
        };
        
        const response = await pythonClient.post('/api/trials', bodyWithOrg);
        
        // Update the trial in Prisma to link to organization
        const trialId = response.data.id;
        if (trialId) {
            try {
                await prisma.clinicalTrial.update({
                    where: { id: trialId },
                    data: { organizationId: req.user.organizationId }
                });
            } catch (err) {
                console.error('Failed to link trial to organization:', err);
            }
        }
        
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/trials/upload
 * Upload protocol document
 */
router.post('/upload', authMiddleware, upload.single('file'), async (req, res, next) => {
    // Extend timeout for this long-running request
    req.setTimeout(1800000); // 30 minutes
    res.setTimeout(1800000);

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), {
            filename: req.file.originalname
        });

        console.log(`📤 Uploading protocol for organization ${req.user.organizationId}`);

        const response = await pythonClient.post('/api/trials/upload', formData, {
            headers: {
                ...formData.getHeaders(),
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 1800000, // 30 minutes for protocol processing
        });

        console.log(`✅ Trial created from protocol: ${response.data.trial_id}`);

        // Link trial to organization using Prisma
        const trialId = response.data.trial_id;
        if (trialId) {
            try {
                await prisma.clinicalTrial.updateMany({
                    where: { trialId: trialId },
                    data: { organizationId: req.user.organizationId }
                });
                console.log(`🔗 Linked trial ${trialId} to organization ${req.user.organizationId}`);
                
                // Create organization-scoped audit log
                await prisma.auditLog.create({
                    data: {
                        action: 'Trial Created from Protocol Upload',
                        agent: 'Node Backend',
                        targetType: 'trial',
                        targetId: trialId,
                        status: 'Success',
                        organizationId: req.user.organizationId,
                        details: {
                            filename: req.file.originalname,
                            fileSize: req.file.size,
                            trialId: trialId,
                            user: req.user.username
                        }
                    }
                });
            } catch (err) {
                console.error('Failed to link trial to organization:', err);
            }
        }

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json(response.data);
    } catch (error) {
        // Clean up file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        next(error);
    }
});

/**
 * GET /api/trials/:trialId/rules
 * Get trial eligibility rules
 */
router.get('/:trialId/rules', async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const response = await pythonClient.get(`/api/trials/${trialId}/rules`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/trials/:trialId/glossary
 * Get trial glossary
 */
router.get('/:trialId/glossary', async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const response = await pythonClient.get(`/api/trials/${trialId}/glossary`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/trials/:trialId/approve-forms
 * Approve FDA forms for trial
 */
router.post('/:trialId/approve-forms', async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const response = await pythonClient.post(`/api/trials/${trialId}/approve-forms`, req.body);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/trials/:trialId/extract-criteria
 * Extract eligibility criteria from trial
 */
router.post('/:trialId/extract-criteria', async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const response = await pythonClient.post(`/api/trials/${trialId}/extract-criteria`, req.body);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/trials/:trialId/criteria-status
 * Get criteria extraction status
 */
router.get('/:trialId/criteria-status', async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const response = await pythonClient.get(`/api/trials/${trialId}/criteria-status`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/trials/:trialId/run-analysis
 * Run eligibility analysis
 */
router.post('/:trialId/run-analysis', async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const response = await pythonClient.post(`/api/trials/${trialId}/run-analysis`, req.body);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/trials/:trialId/analysis-status
 * Get analysis status
 */
router.get('/:trialId/analysis-status', async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const response = await pythonClient.get(`/api/trials/${trialId}/analysis-status`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/trials/:trialId
 * Delete a trial
 */
router.delete('/:trialId', async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const response = await pythonClient.delete(`/api/trials/${trialId}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
