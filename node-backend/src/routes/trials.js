const express = require('express');
const pythonClient = require('../utils/pythonClient');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

        // Link trial to organization and save FDA forms
        const trialId = response.data.trial_id;
        if (trialId) {
            try {
                // Update trial with organization
                const updatedTrial = await prisma.clinicalTrial.updateMany({
                    where: { trialId: trialId },
                    data: { organizationId: req.user.organizationId }
                });
                console.log(`🔗 Linked trial ${trialId} to organization ${req.user.organizationId}`);

                // Fetch the trial to get FDA forms data
                const trial = await prisma.clinicalTrial.findFirst({
                    where: { trialId: trialId }
                });

                // Save FDA forms to database if extracted
                if (trial && (trial.fda1571 || trial.fda1572)) {
                    console.log(`📋 Saving FDA forms to database for trial ${trialId}`);

                    // Create FDADocument record
                    const fdaDoc = await prisma.fDADocument.create({
                        data: {
                            filename: req.file.originalname,
                            fileHash: crypto.createHash('sha256').update(req.file.originalname + Date.now()).digest('hex'),
                            status: 'extracted',
                            processedAt: new Date(),
                            organizationId: req.user.organizationId
                        }
                    });
                    console.log(`📄 Created FDA Document: ID ${fdaDoc.id}`);

                    // Save FDA Form 1571 if data exists
                    if (trial.fda1571 && Object.keys(trial.fda1571).length > 0) {
                        const form1571 = trial.fda1571;
                        try {
                            await prisma.fDAForm1571.create({
                                data: {
                                    documentId: fdaDoc.id,
                                    indNumber: form1571.ind_number || null,
                                    drugName: form1571.drug_name || null,
                                    indication: form1571.indication || null,
                                    studyPhase: form1571.study_phase || null,
                                    protocolTitle: form1571.protocol_title || null,
                                    sponsorName: form1571.sponsor || form1571.sponsor_name || null,
                                    sponsorAddress: form1571.sponsor_address || null,
                                    contactPerson: form1571.contact_person || null,
                                    contactPhone: form1571.contact_phone || null,
                                    contactEmail: form1571.contact_email || null,
                                    crossReferenceInds: form1571.cross_reference_inds || [],
                                    extractionMetadata: {}
                                }
                            });
                            console.log(`✅ Saved FDA Form 1571`);
                        } catch (err) {
                            console.error('⚠️ Failed to save FDA Form 1571:', err);
                        }
                    }

                    // Save FDA Form 1572 if data exists
                    if (trial.fda1572 && Object.keys(trial.fda1572).length > 0) {
                        const form1572 = trial.fda1572;
                        try {
                            await prisma.fDAForm1572.create({
                                data: {
                                    documentId: fdaDoc.id,
                                    protocolTitle: form1572.protocol_title || null,
                                    investigatorName: form1572.investigator_name || null,
                                    investigatorAddress: form1572.investigator_address || null,
                                    investigatorPhone: form1572.investigator_phone || null,
                                    investigatorEmail: form1572.investigator_email || null,
                                    studySites: form1572.study_sites || [],
                                    subInvestigators: form1572.sub_investigators || [],
                                    clinicalLaboratories: form1572.clinical_laboratories || [],
                                    extractionMetadata: {}
                                }
                            });
                            console.log(`✅ Saved FDA Form 1572`);
                        } catch (err) {
                            console.error('⚠️ Failed to save FDA Form 1572:', err);
                        }
                    }

                    // Link trial to FDA document
                    await prisma.clinicalTrial.update({
                        where: { id: trial.id },
                        data: { documentId: fdaDoc.id }
                    });
                    console.log(`🔗 Linked trial to FDA document ${fdaDoc.id}`);
                }

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
                console.error('Failed to link trial to organization or save FDA forms:', err);
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

/**
 * POST /api/trials/:trialId/save-insilico
 * Save InSilico analysis data for a trial
 */
router.post('/:trialId/save-insilico', authMiddleware, async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const { data } = req.body;

        console.log(`💾 Saving InSilico data for trial ${trialId}`);

        // Find the trial in the database
        const trial = await prisma.clinicalTrial.findFirst({
            where: {
                trialId: trialId,
                organizationId: req.user.organizationId
            }
        });

        if (!trial) {
            return res.status(404).json({ error: 'Trial not found' });
        }

        // Upsert InSilico analysis data
        const analysis = await prisma.inSilicoAnalysis.upsert({
            where: {
                trialId: trial.id
            },
            update: {
                drugName: data.drugName || data.drug_name || null,
                drugStructure: data.drugStructure || data.drug_structure || null,
                molecularTargets: data.molecularTargets || data.molecular_targets || null,
                ddiPredictions: data.ddiPredictions || data.ddi_predictions || null,
                toxicityPrediction: data.toxicityPrediction || data.toxicity_prediction || null,
                pkpdSimulation: data.pkpdSimulation || data.pkpd_simulation || null,
                otherAnalyses: data.otherAnalyses || data.other || null,
                analysisMetadata: data.metadata || {}
            },
            create: {
                trialId: trial.id,
                drugName: data.drugName || data.drug_name || null,
                drugStructure: data.drugStructure || data.drug_structure || null,
                molecularTargets: data.molecularTargets || data.molecular_targets || null,
                ddiPredictions: data.ddiPredictions || data.ddi_predictions || null,
                toxicityPrediction: data.toxicityPrediction || data.toxicity_prediction || null,
                pkpdSimulation: data.pkpdSimulation || data.pkpd_simulation || null,
                otherAnalyses: data.otherAnalyses || data.other || null,
                analysisMetadata: data.metadata || {}
            }
        });

        console.log(`✅ Saved InSilico analysis: ID ${analysis.id}`);

        // Create audit log
        await prisma.auditLog.create({
            data: {
                action: 'InSilico Data Saved',
                agent: 'Node Backend',
                targetType: 'trial',
                targetId: trialId,
                status: 'Success',
                organizationId: req.user.organizationId,
                details: {
                    analysisId: analysis.id,
                    user: req.user.username
                }
            }
        });

        res.json({ success: true, analysisId: analysis.id, data: analysis });
    } catch (error) {
        console.error('❌ Failed to save InSilico data:', error);
        next(error);
    }
});

/**
 * GET /api/trials/:trialId/insilico
 * Get InSilico analysis data for a trial
 */
router.get('/:trialId/insilico', authMiddleware, async (req, res, next) => {
    try {
        const { trialId } = req.params;

        // Find the trial
        const trial = await prisma.clinicalTrial.findFirst({
            where: {
                trialId: trialId,
                organizationId: req.user.organizationId
            },
            include: {
                insilicoAnalysis: true
            }
        });

        if (!trial) {
            return res.status(404).json({ error: 'Trial not found' });
        }

        const analysis = trial.insilicoAnalysis || null;

        res.json({
            success: true,
            data: analysis ? {
                id: analysis.id,
                drug_name: analysis.drugName,
                drug_structure: analysis.drugStructure,
                molecular_targets: analysis.molecularTargets,
                ddi_predictions: analysis.ddiPredictions,
                toxicity_prediction: analysis.toxicityPrediction,
                pkpd_simulation: analysis.pkpdSimulation,
                other_analyses: analysis.otherAnalyses,
                metadata: analysis.analysisMetadata,
                created_at: analysis.createdAt,
                updated_at: analysis.updatedAt
            } : null
        });
    } catch (error) {
        console.error('❌ Failed to get InSilico data:', error);
        next(error);
    }
});

/**
 * POST /api/trials/:trialId/save-research-intelligence
 * Save Research Intelligence (LTAA) data for a trial
 */
router.post('/:trialId/save-research-intelligence', authMiddleware, async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const { data } = req.body;

        console.log(`💾 Saving Research Intelligence for trial ${trialId}`);

        // Find the trial
        const trial = await prisma.clinicalTrial.findFirst({
            where: {
                trialId: trialId,
                organizationId: req.user.organizationId
            }
        });

        if (!trial) {
            return res.status(404).json({ error: 'Trial not found' });
        }

        // Upsert Research Intelligence data
        const intelligence = await prisma.researchIntelligence.upsert({
            where: {
                trialId: trial.id
            },
            update: {
                disease: data.disease || null,
                targetGenes: data.targetGenes || data.target_genes || null,
                biomarkers: data.biomarkers || null,
                pathways: data.pathways || null,
                publications: data.publications || null,
                clinicalTrials: data.clinicalTrials || data.clinical_trials || null,
                drugCandidates: data.drugCandidates || data.drug_candidates || null,
                analysisMetadata: data.metadata || {}
            },
            create: {
                trialId: trial.id,
                disease: data.disease || null,
                targetGenes: data.targetGenes || data.target_genes || null,
                biomarkers: data.biomarkers || null,
                pathways: data.pathways || null,
                publications: data.publications || null,
                clinicalTrials: data.clinicalTrials || data.clinical_trials || null,
                drugCandidates: data.drugCandidates || data.drug_candidates || null,
                analysisMetadata: data.metadata || {}
            }
        });

        console.log(`✅ Saved Research Intelligence: ID ${intelligence.id}`);

        // Create audit log
        await prisma.auditLog.create({
            data: {
                action: 'Research Intelligence Saved',
                agent: 'Node Backend',
                targetType: 'trial',
                targetId: trialId,
                status: 'Success',
                organizationId: req.user.organizationId,
                details: {
                    intelligenceId: intelligence.id,
                    disease: data.disease,
                    user: req.user.username
                }
            }
        });

        res.json({ success: true, intelligenceId: intelligence.id, data: intelligence });
    } catch (error) {
        console.error('❌ Failed to save Research Intelligence:', error);
        next(error);
    }
});

/**
 * GET /api/trials/:trialId/research-intelligence
 * Get Research Intelligence data for a trial
 */
router.get('/:trialId/research-intelligence', authMiddleware, async (req, res, next) => {
    try {
        const { trialId } = req.params;

        // Find the trial
        const trial = await prisma.clinicalTrial.findFirst({
            where: {
                trialId: trialId,
                organizationId: req.user.organizationId
            },
            include: {
                researchIntelligence: true
            }
        });

        if (!trial) {
            return res.status(404).json({ error: 'Trial not found' });
        }

        const intelligence = trial.researchIntelligence || null;

        res.json({
            success: true,
            data: intelligence ? {
                id: intelligence.id,
                disease: intelligence.disease,
                target_genes: intelligence.targetGenes,
                biomarkers: intelligence.biomarkers,
                pathways: intelligence.pathways,
                publications: intelligence.publications,
                clinical_trials: intelligence.clinicalTrials,
                drug_candidates: intelligence.drugCandidates,
                metadata: intelligence.analysisMetadata,
                created_at: intelligence.createdAt,
                updated_at: intelligence.updatedAt
            } : null
        });
    } catch (error) {
        console.error('❌ Failed to get Research Intelligence:', error);
        next(error);
    }
});

/**
 * POST /api/trials/:trialId/save-all-data
 * Comprehensive save endpoint - saves all trial data (FDA forms, InSilico, Research Intelligence)
 */
router.post('/:trialId/save-all-data', authMiddleware, async (req, res, next) => {
    try {
        const { trialId } = req.params;
        const { fdaForms, insilicoData, researchIntelData, documentId } = req.body;

        console.log(`💾 Comprehensive save for trial ${trialId}`);

        // Find the trial
        const trial = await prisma.clinicalTrial.findFirst({
            where: {
                trialId: trialId,
                organizationId: req.user.organizationId
            }
        });

        if (!trial) {
            return res.status(404).json({ error: 'Trial not found' });
        }

        const savedItems = [];

        // Save FDA Form 1571 if provided
        if (fdaForms?.['1571'] && documentId) {
            try {
                const form1571 = await prisma.fDAForm1571.upsert({
                    where: { documentId: parseInt(documentId) },
                    update: {
                        indNumber: fdaForms['1571'].ind_number || null,
                        drugName: fdaForms['1571'].drug_name || null,
                        indication: fdaForms['1571'].indication || null,
                        studyPhase: fdaForms['1571'].study_phase || null,
                        protocolTitle: fdaForms['1571'].protocol_title || null,
                        sponsorName: fdaForms['1571'].sponsor || fdaForms['1571'].sponsor_name || null,
                        sponsorAddress: fdaForms['1571'].sponsor_address || null,
                        contactPerson: fdaForms['1571'].contact_person || null,
                        contactPhone: fdaForms['1571'].contact_phone || null,
                        contactEmail: fdaForms['1571'].contact_email || null,
                        crossReferenceInds: fdaForms['1571'].cross_reference_inds || [],
                        extractionMetadata: fdaForms['1571'].extraction_metadata || {}
                    },
                    create: {
                        documentId: parseInt(documentId),
                        indNumber: fdaForms['1571'].ind_number || null,
                        drugName: fdaForms['1571'].drug_name || null,
                        indication: fdaForms['1571'].indication || null,
                        studyPhase: fdaForms['1571'].study_phase || null,
                        protocolTitle: fdaForms['1571'].protocol_title || null,
                        sponsorName: fdaForms['1571'].sponsor || fdaForms['1571'].sponsor_name || null,
                        sponsorAddress: fdaForms['1571'].sponsor_address || null,
                        contactPerson: fdaForms['1571'].contact_person || null,
                        contactPhone: fdaForms['1571'].contact_phone || null,
                        contactEmail: fdaForms['1571'].contact_email || null,
                        crossReferenceInds: fdaForms['1571'].cross_reference_inds || [],
                        extractionMetadata: fdaForms['1571'].extraction_metadata || {}
                    }
                });
                savedItems.push({ type: 'FDA Form 1571', id: form1571.id });
                console.log(`✅ Saved FDA Form 1571`);
            } catch (error) {
                console.error('⚠️  Failed to save FDA Form 1571:', error.message);
            }
        }

        // Save FDA Form 1572 if provided
        if (fdaForms?.['1572'] && documentId) {
            try {
                const form1572 = await prisma.fDAForm1572.upsert({
                    where: { documentId: parseInt(documentId) },
                    update: {
                        protocolTitle: fdaForms['1572'].protocol_title || null,
                        investigatorName: fdaForms['1572'].investigator_name || null,
                        investigatorAddress: fdaForms['1572'].investigator_address || null,
                        investigatorPhone: fdaForms['1572'].investigator_phone || null,
                        investigatorEmail: fdaForms['1572'].investigator_email || null,
                        studySites: fdaForms['1572'].study_sites || [],
                        subInvestigators: fdaForms['1572'].sub_investigators || [],
                        clinicalLaboratories: fdaForms['1572'].clinical_laboratories || [],
                        extractionMetadata: fdaForms['1572'].extraction_metadata || {}
                    },
                    create: {
                        documentId: parseInt(documentId),
                        protocolTitle: fdaForms['1572'].protocol_title || null,
                        investigatorName: fdaForms['1572'].investigator_name || null,
                        investigatorAddress: fdaForms['1572'].investigator_address || null,
                        investigatorPhone: fdaForms['1572'].investigator_phone || null,
                        investigatorEmail: fdaForms['1572'].investigator_email || null,
                        studySites: fdaForms['1572'].study_sites || [],
                        subInvestigators: fdaForms['1572'].sub_investigators || [],
                        clinicalLaboratories: fdaForms['1572'].clinical_laboratories || [],
                        extractionMetadata: fdaForms['1572'].extraction_metadata || {}
                    }
                });
                savedItems.push({ type: 'FDA Form 1572', id: form1572.id });
                console.log(`✅ Saved FDA Form 1572`);
            } catch (error) {
                console.error('⚠️  Failed to save FDA Form 1572:', error.message);
            }
        }

        // Save InSilico data if provided
        if (insilicoData) {
            try {
                const analysis = await prisma.inSilicoAnalysis.upsert({
                    where: { trialId: trial.id },
                    update: {
                        drugName: insilicoData.drugName || insilicoData.drug_name || null,
                        drugStructure: insilicoData.drugStructure || insilicoData.drug_structure || null,
                        molecularTargets: insilicoData.molecularTargets || insilicoData.molecular_targets || null,
                        ddiPredictions: insilicoData.ddiPredictions || insilicoData.ddi_predictions || null,
                        toxicityPrediction: insilicoData.toxicityPrediction || insilicoData.toxicity_prediction || null,
                        pkpdSimulation: insilicoData.pkpdSimulation || insilicoData.pkpd_simulation || null,
                        otherAnalyses: insilicoData.otherAnalyses || insilicoData.other || null,
                        analysisMetadata: insilicoData.metadata || {}
                    },
                    create: {
                        trialId: trial.id,
                        drugName: insilicoData.drugName || insilicoData.drug_name || null,
                        drugStructure: insilicoData.drugStructure || insilicoData.drug_structure || null,
                        molecularTargets: insilicoData.molecularTargets || insilicoData.molecular_targets || null,
                        ddiPredictions: insilicoData.ddiPredictions || insilicoData.ddi_predictions || null,
                        toxicityPrediction: insilicoData.toxicityPrediction || insilicoData.toxicity_prediction || null,
                        pkpdSimulation: insilicoData.pkpdSimulation || insilicoData.pkpd_simulation || null,
                        otherAnalyses: insilicoData.otherAnalyses || insilicoData.other || null,
                        analysisMetadata: insilicoData.metadata || {}
                    }
                });
                savedItems.push({ type: 'InSilico Analysis', id: analysis.id });
                console.log(`✅ Saved InSilico analysis`);
            } catch (error) {
                console.error('⚠️  Failed to save InSilico data:', error.message);
            }
        }

        // Save Research Intelligence if provided
        if (researchIntelData) {
            try {
                const intelligence = await prisma.researchIntelligence.upsert({
                    where: { trialId: trial.id },
                    update: {
                        disease: researchIntelData.disease || null,
                        targetGenes: researchIntelData.targetGenes || researchIntelData.target_genes || null,
                        biomarkers: researchIntelData.biomarkers || null,
                        pathways: researchIntelData.pathways || null,
                        publications: researchIntelData.publications || null,
                        clinicalTrials: researchIntelData.clinicalTrials || researchIntelData.clinical_trials || null,
                        drugCandidates: researchIntelData.drugCandidates || researchIntelData.drug_candidates || null,
                        analysisMetadata: researchIntelData.metadata || {}
                    },
                    create: {
                        trialId: trial.id,
                        disease: researchIntelData.disease || null,
                        targetGenes: researchIntelData.targetGenes || researchIntelData.target_genes || null,
                        biomarkers: researchIntelData.biomarkers || null,
                        pathways: researchIntelData.pathways || null,
                        publications: researchIntelData.publications || null,
                        clinicalTrials: researchIntelData.clinicalTrials || researchIntelData.clinical_trials || null,
                        drugCandidates: researchIntelData.drugCandidates || researchIntelData.drug_candidates || null,
                        analysisMetadata: researchIntelData.metadata || {}
                    }
                });
                savedItems.push({ type: 'Research Intelligence', id: intelligence.id });
                console.log(`✅ Saved Research Intelligence`);
            } catch (error) {
                console.error('⚠️  Failed to save Research Intelligence:', error.message);
            }
        }

        // Create comprehensive audit log
        await prisma.auditLog.create({
            data: {
                action: 'Trial Data Comprehensive Save',
                agent: 'Node Backend',
                targetType: 'trial',
                targetId: trialId,
                status: 'Success',
                organizationId: req.user.organizationId,
                details: {
                    savedItems,
                    user: req.user.username
                }
            }
        });

        res.json({
            success: true,
            message: 'All trial data saved successfully',
            savedItems
        });
    } catch (error) {
        console.error('❌ Failed to save trial data:', error);
        next(error);
    }
});

/**
 * GET /api/trials/:trialId/complete-data
 * Get complete trial data including FDA forms, InSilico, and Research Intelligence
 */
router.get('/:trialId/complete-data', authMiddleware, async (req, res, next) => {
    try {
        const { trialId } = req.params;

        console.log(`📊 Fetching complete data for trial ${trialId}`);

        // Find the trial with all relationships
        const trial = await prisma.clinicalTrial.findFirst({
            where: {
                trialId: trialId,
                organizationId: req.user.organizationId
            },
            include: {
                fdaDocument: {
                    include: {
                        fdaForm1571: true,
                        fdaForm1572: true
                    }
                },
                insilicoAnalysis: true,
                researchIntelligence: true
            }
        });

        if (!trial) {
            return res.status(404).json({ error: 'Trial not found' });
        }

        // Transform data for frontend
        const completeData = {
            trial: {
                id: trial.id,
                trial_id: trial.trialId,
                protocol_title: trial.protocolTitle,
                phase: trial.phase,
                indication: trial.indication,
                drug_name: trial.drugName,
                status: trial.status,
                document_id: trial.documentId,
                protocol_file_path: trial.protocolFilePath,
                fda_1571: trial.fda1571,
                fda_1572: trial.fda1572,
                matching_config: trial.matchingConfig,
                analysis_results: trial.analysisResults,
                analysis_status: trial.analysisStatus,
                organization_id: trial.organizationId,
                created_at: trial.createdAt
            },
            fdaForms: null,
            insilicoData: null,
            researchIntelligence: null
        };

        // Add FDA forms if available
        if (trial.fdaDocument) {
            completeData.fdaForms = {
                document: {
                    id: trial.fdaDocument.id,
                    filename: trial.fdaDocument.filename,
                    file_path: trial.fdaDocument.filePath,
                    status: trial.fdaDocument.status,
                    reviewed_by: trial.fdaDocument.reviewedBy,
                    reviewed_at: trial.fdaDocument.reviewedAt,
                    signed_by: trial.fdaDocument.signedBy,
                    signed_at: trial.fdaDocument.signedAt
                },
                forms: {}
            };

            if (trial.fdaDocument.fdaForm1571) {
                const form = trial.fdaDocument.fdaForm1571;
                completeData.fdaForms.forms['1571'] = {
                    ind_number: form.indNumber,
                    drug_name: form.drugName,
                    indication: form.indication,
                    study_phase: form.studyPhase,
                    protocol_title: form.protocolTitle,
                    sponsor_name: form.sponsorName,
                    sponsor: form.sponsorName,
                    sponsor_address: form.sponsorAddress,
                    contact_person: form.contactPerson,
                    contact_phone: form.contactPhone,
                    contact_email: form.contactEmail,
                    cross_reference_inds: form.crossReferenceInds,
                    extraction_metadata: form.extractionMetadata
                };
            }

            if (trial.fdaDocument.fdaForm1572) {
                const form = trial.fdaDocument.fdaForm1572;
                completeData.fdaForms.forms['1572'] = {
                    protocol_title: form.protocolTitle,
                    investigator_name: form.investigatorName,
                    investigator_address: form.investigatorAddress,
                    investigator_phone: form.investigatorPhone,
                    investigator_email: form.investigatorEmail,
                    study_sites: form.studySites,
                    sub_investigators: form.subInvestigators,
                    clinical_laboratories: form.clinicalLaboratories,
                    extraction_metadata: form.extractionMetadata
                };
            }
        }

        // Add InSilico data if available
        if (trial.insilicoAnalysis) {
            const analysis = trial.insilicoAnalysis;
            completeData.insilicoData = {
                id: analysis.id,
                drug_name: analysis.drugName,
                drug_structure: analysis.drugStructure,
                molecular_targets: analysis.molecularTargets,
                ddi_predictions: analysis.ddiPredictions,
                toxicity_prediction: analysis.toxicityPrediction,
                pkpd_simulation: analysis.pkpdSimulation,
                other_analyses: analysis.otherAnalyses,
                metadata: analysis.analysisMetadata,
                created_at: analysis.createdAt,
                updated_at: analysis.updatedAt
            };
        }

        // Add Research Intelligence if available
        if (trial.researchIntelligence) {
            const intel = trial.researchIntelligence;
            completeData.researchIntelligence = {
                id: intel.id,
                disease: intel.disease,
                target_genes: intel.targetGenes,
                biomarkers: intel.biomarkers,
                pathways: intel.pathways,
                publications: intel.publications,
                clinical_trials: intel.clinicalTrials,
                drug_candidates: intel.drugCandidates,
                metadata: intel.analysisMetadata,
                created_at: intel.createdAt,
                updated_at: intel.updatedAt
            };
        }

        res.json(completeData);
    } catch (error) {
        console.error('❌ Failed to get complete trial data:', error);
        next(error);
    }
});

/**
 * GET /api/trials/:trialId/protocol/download
 * Download protocol document for a trial
 */
router.get('/:trialId/protocol/download', authMiddleware, async (req, res, next) => {
    try {
        const { trialId } = req.params;

        console.log(`📥 Downloading protocol for trial ${trialId}`);

        // Find the trial
        const trial = await prisma.clinicalTrial.findFirst({
            where: {
                trialId: trialId,
                organizationId: req.user.organizationId
            }
        });

        if (!trial) {
            return res.status(404).json({ error: 'Trial not found' });
        }

        if (!trial.protocolFilePath) {
            return res.status(404).json({ error: 'Protocol file not found' });
        }

        // Check if file exists
        if (!fs.existsSync(trial.protocolFilePath)) {
            return res.status(404).json({ error: 'Protocol file not found on server' });
        }

        // Get filename from path
        const filename = path.basename(trial.protocolFilePath);

        // Set appropriate headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Stream the file
        const fileStream = fs.createReadStream(trial.protocolFilePath);
        fileStream.pipe(res);
    } catch (error) {
        console.error('❌ Error downloading protocol:', error);
        next(error);
    }
});

module.exports = router;
