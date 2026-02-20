const express = require('express');
const pythonClient = require('../utils/pythonClient');
const axios = require('axios');
const config = require('../config');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
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

        // Link document to organization and save file path
        const documentId = response.data.document_id;
        if (documentId && req.user?.organizationId) {
            try {
                // Move uploaded file to permanent storage
                const uploadsDir = path.join(__dirname, '../../uploads/fda');
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }

                const permanentPath = path.join(uploadsDir, `${documentId}_${req.file.originalname}`);
                fs.renameSync(req.file.path, permanentPath);
                console.log(`📁 FDA document saved to: ${permanentPath}`);

                // Update document with organization and file path
                await prisma.fDADocument.update({
                    where: { id: documentId },
                    data: {
                        organizationId: req.user.organizationId,
                        filePath: permanentPath
                    }
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
                            filePath: permanentPath,
                            user: req.user.username
                        }
                    }
                });
            } catch (linkErr) {
                console.warn('⚠️  Failed to link document to organization or save file:', linkErr.message);
                // Clean up file on error
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
                // Don't fail the request if linking fails
            }
        } else {
            // Clean up uploaded file if no document ID or organization
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
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
 * Get form details by document ID - returns from Node DB if available, otherwise from Python backend
 */
router.get('/forms/:documentId', authMiddleware, async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const docId = parseInt(documentId);

        // Try to get from Node backend structured tables first
        try {
            const [form1571, form1572, document] = await Promise.all([
                prisma.fDAForm1571.findUnique({ where: { documentId: docId } }),
                prisma.fDAForm1572.findUnique({ where: { documentId: docId } }),
                prisma.fDADocument.findFirst({
                    where: {
                        id: docId,
                        organizationId: req.user.organizationId
                    }
                })
            ]);

            if (document && (form1571 || form1572)) {
                // Return data from Node backend
                return res.json({
                    document,
                    forms: {
                        '1571': form1571 ? {
                            ind_number: form1571.indNumber,
                            drug_name: form1571.drugName,
                            indication: form1571.indication,
                            study_phase: form1571.studyPhase,
                            protocol_title: form1571.protocolTitle,
                            sponsor_name: form1571.sponsorName,
                            sponsor: form1571.sponsorName,
                            sponsor_address: form1571.sponsorAddress,
                            contact_person: form1571.contactPerson,
                            contact_phone: form1571.contactPhone,
                            contact_email: form1571.contactEmail,
                            cross_reference_inds: form1571.crossReferenceInds,
                            extraction_metadata: form1571.extractionMetadata
                        } : null,
                        '1572': form1572 ? {
                            protocol_title: form1572.protocolTitle,
                            investigator_name: form1572.investigatorName,
                            investigator_address: form1572.investigatorAddress,
                            investigator_phone: form1572.investigatorPhone,
                            investigator_email: form1572.investigatorEmail,
                            study_sites: form1572.studySites,
                            sub_investigators: form1572.subInvestigators,
                            clinical_laboratories: form1572.clinicalLaboratories,
                            extraction_metadata: form1572.extractionMetadata
                        } : null
                    }
                });
            }
        } catch (dbError) {
            console.warn('⚠️  Failed to fetch from Node backend DB, falling back to Python backend:', dbError.message);
        }

        // Fallback to Python backend
        const response = await pythonClient.get(`/api/fda/forms/${documentId}`);
        res.json(response.data);
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/fda/forms/:documentId
 * Update form data - saves to both Python backend and Node backend DB
 */
router.put('/forms/:documentId', authMiddleware, async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const { form_type, updates } = req.body;

        console.log(`📝 Updating FDA form ${form_type} for document ${documentId}`);

        // Update in Python backend first
        const response = await pythonClient.put(`/api/fda/forms/${documentId}`, req.body);

        // Also save to structured Node backend tables
        try {
            if (form_type === '1571' && updates) {
                // Upsert FDA Form 1571
                await prisma.fDAForm1571.upsert({
                    where: { documentId: parseInt(documentId) },
                    update: {
                        indNumber: updates.ind_number || null,
                        drugName: updates.drug_name || null,
                        indication: updates.indication || null,
                        studyPhase: updates.study_phase || null,
                        protocolTitle: updates.protocol_title || null,
                        sponsorName: updates.sponsor || updates.sponsor_name || null,
                        sponsorAddress: updates.sponsor_address || null,
                        contactPerson: updates.contact_person || null,
                        contactPhone: updates.contact_phone || null,
                        contactEmail: updates.contact_email || null,
                        crossReferenceInds: updates.cross_reference_inds || [],
                        extractionMetadata: updates.extraction_metadata || {}
                    },
                    create: {
                        documentId: parseInt(documentId),
                        indNumber: updates.ind_number || null,
                        drugName: updates.drug_name || null,
                        indication: updates.indication || null,
                        studyPhase: updates.study_phase || null,
                        protocolTitle: updates.protocol_title || null,
                        sponsorName: updates.sponsor || updates.sponsor_name || null,
                        sponsorAddress: updates.sponsor_address || null,
                        contactPerson: updates.contact_person || null,
                        contactPhone: updates.contact_phone || null,
                        contactEmail: updates.contact_email || null,
                        crossReferenceInds: updates.cross_reference_inds || [],
                        extractionMetadata: updates.extraction_metadata || {}
                    }
                });
                console.log(`✅ Saved FDA Form 1571 to database`);
            } else if (form_type === '1572' && updates) {
                // Upsert FDA Form 1572
                await prisma.fDAForm1572.upsert({
                    where: { documentId: parseInt(documentId) },
                    update: {
                        protocolTitle: updates.protocol_title || null,
                        investigatorName: updates.investigator_name || null,
                        investigatorAddress: updates.investigator_address || null,
                        investigatorPhone: updates.investigator_phone || null,
                        investigatorEmail: updates.investigator_email || null,
                        studySites: updates.study_sites || [],
                        subInvestigators: updates.sub_investigators || [],
                        clinicalLaboratories: updates.clinical_laboratories || [],
                        extractionMetadata: updates.extraction_metadata || {}
                    },
                    create: {
                        documentId: parseInt(documentId),
                        protocolTitle: updates.protocol_title || null,
                        investigatorName: updates.investigator_name || null,
                        investigatorAddress: updates.investigator_address || null,
                        investigatorPhone: updates.investigator_phone || null,
                        investigatorEmail: updates.investigator_email || null,
                        studySites: updates.study_sites || [],
                        subInvestigators: updates.sub_investigators || [],
                        clinicalLaboratories: updates.clinical_laboratories || [],
                        extractionMetadata: updates.extraction_metadata || {}
                    }
                });
                console.log(`✅ Saved FDA Form 1572 to database`);
            }

            // Create audit log
            if (req.user?.organizationId) {
                await prisma.auditLog.create({
                    data: {
                        action: `FDA Form ${form_type} Updated`,
                        agent: 'Node Backend',
                        targetType: 'fda_form',
                        targetId: documentId.toString(),
                        status: 'Success',
                        organizationId: req.user.organizationId,
                        details: {
                            formType: form_type,
                            user: req.user.username,
                            fieldsUpdated: Object.keys(updates)
                        }
                    }
                });
            }
        } catch (dbError) {
            console.error('⚠️  Failed to save FDA form to Node backend DB:', dbError);
            // Don't fail the request if DB save fails
        }

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

/**
 * GET /api/fda/documents/:documentId/download
 * Download the FDA document PDF
 */
router.get('/documents/:documentId/download', authMiddleware, async (req, res, next) => {
    try {
        const { documentId } = req.params;

        // Find the document
        const document = await prisma.fDADocument.findFirst({
            where: {
                id: parseInt(documentId),
                organizationId: req.user.organizationId
            }
        });

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        if (!document.filePath) {
            return res.status(404).json({ error: 'Document file not found' });
        }

        // Check if file exists
        if (!fs.existsSync(document.filePath)) {
            return res.status(404).json({ error: 'Document file not found on server' });
        }

        // Set appropriate headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);

        // Stream the file
        const fileStream = fs.createReadStream(document.filePath);
        fileStream.pipe(res);
    } catch (error) {
        console.error('Error downloading FDA document:', error);
        next(error);
    }
});

module.exports = router;
