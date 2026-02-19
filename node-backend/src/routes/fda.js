const express = require('express');
const pythonClient = require('../utils/pythonClient');
const axios = require('axios');
const config = require('../config');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Configure multer for PDF uploads
const upload = multer({
    dest: 'uploads/fda/',
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    }
});

/**
 * POST /api/fda/upload
 * Upload and process FDA forms (returns immediately, processing happens in background)
 */
router.post('/upload', authMiddleware, upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log(`📤 Uploading FDA document: ${req.file.originalname} (${req.file.size} bytes) for organization ${req.user.organizationId}`);

        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), {
            filename: req.file.originalname,
            contentType: 'application/pdf'
        });

        // Send to Python backend (returns immediately with document_id)
        // Use axios directly (not pythonClient) to avoid default json headers
        let response;
        try {
            response = await axios.post(
                `${config.pythonBackendUrl}/api/fda/upload`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 0,
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity,
                }
            );
        } catch (uploadError) {
            // Clean up file on error
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            
            console.error('❌ Python backend upload failed:');
            if (uploadError.response) {
                console.error(`   Status: ${uploadError.response.status}`);
                console.error(`   Data:`, uploadError.response.data);
                return res.status(uploadError.response.status).json({
                    error: 'Python backend error',
                    details: uploadError.response.data,
                    message: typeof uploadError.response.data === 'string' ? uploadError.response.data : uploadError.message
                });
            } else {
                console.error(`   ${uploadError.message}`);
                return res.status(503).json({
                    error: 'Python backend unavailable',
                    message: uploadError.message
                });
            }
        }

        console.log(`✅ FDA document uploaded successfully: Document ID ${response.data.document_id}`);

        // Clean up uploaded file
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        // Link document to organization (don't fail if this errors)
        const documentId = response.data.document_id;
        if (documentId && req.user?.organizationId) {
            try {
                await prisma.fDADocument.update({
                    where: { id: documentId },
                    data: { organizationId: req.user.organizationId }
                });
                console.log(`🔗 Linked document ${documentId} to organization ${req.user.organizationId}`);
                
                // Create organization-scoped audit log
                await prisma.auditLog.create({
                    data: {
                        action: 'FDA Document Uploaded',
                        agent: 'Node Backend',
                        targetType: 'document',
                        targetId: documentId.toString(),
                        status: 'Success',
                        organizationId: req.user.organizationId,
                        details: {
                            filename: req.file.originalname,
                            fileSize: req.file.size,
                            user: req.user.username
                        }
                    }
                });
            } catch (linkErr) {
                console.warn('⚠️  Failed to link document to organization:', linkErr.message);
                // Don't fail the request if linking fails
            }
        }

        // Return document_id to frontend for polling
        res.json(response.data);

    } catch (error) {
        console.error('❌ Unexpected error in FDA upload handler:', error.message);
        next(error);
    }
});

/**
 * GET /api/fda/documents
 * List all FDA documents for the user's organization
 */
router.get('/documents', authMiddleware, async (req, res, next) => {
    // Extend timeout for document list which can be slow
    req.setTimeout(900000); // 15 minutes
    res.setTimeout(900000);

    try {
        // Fetch documents filtered by organization
        const documents = await prisma.fDADocument.findMany({
            where: { organizationId: req.user.organizationId },
            orderBy: { uploadDate: 'desc' }
        });
        
        res.json(documents);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/fda/status/:documentId
 * Get processing status for a document (for polling-based uploads)
 */
router.get('/status/:documentId', async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const response = await pythonClient.get(`/api/fda/status/${documentId}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/fda/forms/:documentId
 * Get form details by document ID
 */
router.get('/forms/:documentId', async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const response = await pythonClient.get(`/api/fda/forms/${documentId}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/fda/forms/:documentId
 * Update form data
 */
router.put('/forms/:documentId', async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const response = await pythonClient.put(`/api/fda/forms/${documentId}`, req.body);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/fda/forms/:documentId/review
 * Review a form
 */
router.post('/forms/:documentId/review', async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const response = await pythonClient.post(`/api/fda/forms/${documentId}/review`, req.body);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/fda/forms/:documentId/sign
 * E-sign a form
 */
router.post('/forms/:documentId/sign', async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const response = await pythonClient.post(`/api/fda/forms/${documentId}/sign`, req.body);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/fda/documents/:documentId
 * Delete a document
 */
router.delete('/documents/:documentId', async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const response = await pythonClient.delete(`/api/fda/documents/${documentId}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/fda/test-criteria
 * Test eligibility criteria extraction
 */
router.post('/test-criteria', async (req, res, next) => {
    try {
        const response = await pythonClient.post('/api/fda/test-criteria', req.body, {
            timeout: 600000 // 10 minutes for criteria testing
        });
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/fda/documents/:documentId/create-trial
 * Create trial from FDA document
 */
router.post('/documents/:documentId/create-trial', authMiddleware, async (req, res, next) => {
    try {
        const { documentId } = req.params;
        
        console.log(`🔨 Creating trial from FDA document ${documentId} for organization ${req.user.organizationId}`);
        
        const response = await pythonClient.post(`/api/fda/documents/${documentId}/create-trial`, req.body, {
            timeout: 600000 // 10 minutes for trial creation
        });
        
        // Link trial to organization using Prisma
        const trialId = response.data.trial_id;
        const dbId = response.data.db_id;
        
        if (dbId) {
            try {
                await prisma.clinicalTrial.update({
                    where: { id: dbId },
                    data: { organizationId: req.user.organizationId }
                });
                console.log(`✅ Trial ${trialId} linked to organization ${req.user.organizationId}`);
                
                // Create organization-scoped audit log
                await prisma.auditLog.create({
                    data: {
                        action: 'Trial Created from FDA Document',
                        agent: 'Node Backend',
                        targetType: 'trial',
                        targetId: trialId,
                        status: 'Success',
                        organizationId: req.user.organizationId,
                        details: {
                            documentId: parseInt(documentId),
                            trialId: trialId,
                            dbId: dbId,
                            user: req.user.username
                        }
                    }
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

module.exports = router;
