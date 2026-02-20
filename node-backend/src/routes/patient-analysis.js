const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * POST /api/patient-analysis/save-batch
 * Save multiple patient screening analyses after screening completes
 */
router.post('/save-batch', authMiddleware, async (req, res) => {
    try {
        const { trialId, analyses } = req.body;
        const organizationId = req.user.organizationId;

        if (!organizationId) {
            return res.status(403).json({
                error: 'Forbidden',
                details: 'Only organization users can save patient analyses'
            });
        }

        if (!trialId || !analyses || !Array.isArray(analyses)) {
            return res.status(400).json({
                error: 'Missing required fields',
                details: 'trialId and analyses array are required'
            });
        }

        console.log(`Saving ${analyses.length} patient analyses for trial ${trialId}, org ${organizationId}`);

        const savedAnalyses = [];

        for (const analysis of analyses) {
            const {
                patientId,
                eligibility_status,
                confidence_score,
                reasons,
                patient
            } = analysis;

            if (!patientId) {
                console.warn('Skipping analysis with missing patientId');
                continue;
            }

            // Extract criteria counts from reasons
            const inclusionMet = reasons?.inclusion_details?.filter(d => d.met).length || 0;
            const inclusionTotal = reasons?.inclusion_details?.length || 0;
            const exclusionTriggered = reasons?.exclusion_details?.filter(d => d.met).length || 0;
            const hardExclusions = reasons?.hard_exclusions || 0;
            const softExclusions = reasons?.soft_exclusions || 0;

            console.log(`📝 Saving analysis for ${patientId}:`, {
                inclusionMet,
                inclusionTotal,
                exclusionTriggered,
                hardExclusions,
                softExclusions,
                hasInclusionDetails: !!reasons?.inclusion_details,
                inclusionDetailsLength: reasons?.inclusion_details?.length || 0,
                hasExclusionDetails: !!reasons?.exclusion_details,
                exclusionDetailsLength: reasons?.exclusion_details?.length || 0,
                reasonsKeys: Object.keys(reasons || {}),
                fullReasons: JSON.stringify(reasons).substring(0, 500) // First 500 chars
            });

            // Calculate age  from birthdate if available
            let patientAge = null;
            if (patient?.birthdate) {
                const today = new Date();
                const birthDate = new Date(patient.birthdate);
                patientAge = today.getFullYear() - birthDate.getFullYear();
                const m = today.getMonth() - birthDate.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                    patientAge--;
                }
            }

            // Upsert (update if exists, create if not)
            const saved = await prisma.patientScreeningAnalysis.upsert({
                where: {
                    trialId_patientId_organizationId: {
                        trialId: parseInt(trialId),
                        patientId: patientId,
                        organizationId: organizationId
                    }
                },
                update: {
                    eligibilityStatus: eligibility_status || 'UNKNOWN',
                    confidenceScore: parseFloat(confidence_score) || 0.0,
                    patientAge: patientAge,
                    patientGender: patient?.gender || null,
                    patientBirthDate: patient?.birthdate ? new Date(patient.birthdate) : null,
                    criteriaMetCount: inclusionMet,
                    criteriaTotalCount: inclusionTotal,
                    exclusionsTriggered: exclusionTriggered,
                    hardExclusions: hardExclusions,
                    softExclusions: softExclusions,
                    analysisReasons: reasons || {},
                    patientConditions: patient?.conditions || null,
                    patientObservations: patient?.observations || null,
                    screenedAt: new Date(),
                    updatedAt: new Date()
                },
                create: {
                    trialId: parseInt(trialId),
                    patientId: patientId,
                    organizationId: organizationId,
                    eligibilityStatus: eligibility_status || 'UNKNOWN',
                    confidenceScore: parseFloat(confidence_score) || 0.0,
                    patientAge: patientAge,
                    patientGender: patient?.gender || null,
                    patientBirthDate: patient?.birthdate ? new Date(patient.birthdate) : null,
                    criteriaMetCount: inclusionMet,
                    criteriaTotalCount: inclusionTotal,
                    exclusionsTriggered: exclusionTriggered,
                    hardExclusions: hardExclusions,
                    softExclusions: softExclusions,
                    analysisReasons: reasons || {},
                    patientConditions: patient?.conditions || null,
                    patientObservations: patient?.observations || null
                }
            });

            savedAnalyses.push(saved);
        }

        console.log(`✅ Saved ${savedAnalyses.length} patient analyses`);

        // Create audit log
        try {
            await prisma.auditLog.create({
                data: {
                    action: 'Patient Screening Analyses Saved',
                    agent: 'Node Backend',
                    targetType: 'trial',
                    targetId: trialId.toString(),
                    status: 'Success',
                    organizationId: organizationId,
                    details: {
                        patientCount: savedAnalyses.length,
                        user: req.user.username
                    }
                }
            });
        } catch (auditErr) {
            console.warn('⚠️  Failed to create audit log:', auditErr.message);
        }

        res.json({
            success: true,
            message: `Saved ${savedAnalyses.length} patient analyses`,
            count: savedAnalyses.length
        });

    } catch (error) {
        console.error('Error saving patient analyses:', error);
        res.status(500).json({
            error: 'Failed to save patient analyses',
            details: error.message
        });
    }
});

/**
 * GET /api/patient-analysis/trial/:trialId
 * Get all patient screening analyses for a trial
 */
router.get('/trial/:trialId', authMiddleware, async (req, res) => {
    try {
        const { trialId } = req.params;
        let organizationId = req.user.organizationId;

        // If user doesn't have organizationId (e.g., PI user), get it from the trial
        if (!organizationId) {
            const trial = await prisma.trial.findUnique({
                where: { id: parseInt(trialId) },
                select: { organizationId: true }
            });

            if (!trial) {
                return res.status(404).json({
                    error: 'Trial not found',
                    details: 'Could not find trial to fetch patient analyses'
                });
            }

            organizationId = trial.organizationId;
        }

        const analyses = await prisma.patientScreeningAnalysis.findMany({
            where: {
                trialId: parseInt(trialId),
                organizationId: organizationId
            },
            orderBy: {
                screenedAt: 'desc'
            }
        });

        console.log(`Found ${analyses.length} patient analyses for trial ${trialId}`);

        // Format response to match expected structure
        const formattedAnalyses = analyses.map(a => ({
            id: a.id,
            patientId: a.patientId,
            trialId: a.trialId,
            eligibility_status: a.eligibilityStatus,
            confidence_score: a.confidenceScore,
            patient: {
                id: a.patientId,
                age: a.patientAge,
                gender: a.patientGender,
                birthdate: a.patientBirthDate,
                conditions: a.patientConditions,
                observations: a.patientObservations
            },
            reasons: a.analysisReasons,
            criteria_met: a.criteriaMetCount,
            criteria_total: a.criteriaTotalCount,
            exclusions_triggered: a.exclusionsTriggered,
            hard_exclusions: a.hardExclusions,
            soft_exclusions: a.softExclusions,
            screened_at: a.screenedAt
        }));

        res.json(formattedAnalyses);

    } catch (error) {
        console.error('Error fetching patient analyses:', error);
        res.status(500).json({
            error: 'Failed to fetch patient analyses',
            details: error.message
        });
    }
});

/**
 * GET /api/patient-analysis/patient/:trialId/:patientId
 * Get single patient analysis for a specific trial
 */
router.get('/patient/:trialId/:patientId', authMiddleware, async (req, res) => {
    try {
        const { trialId, patientId } = req.params;
        let organizationId = req.user.organizationId;

        // If user doesn't have organizationId (e.g., PI user), get it from the trial
        if (!organizationId) {
            const trial = await prisma.trial.findUnique({
                where: { id: parseInt(trialId) },
                select: { organizationId: true }
            });

            if (!trial) {
                return res.status(404).json({
                    error: 'Trial not found',
                    details: 'Could not find trial to fetch patient analysis'
                });
            }

            organizationId = trial.organizationId;
        }

        const analysis = await prisma.patientScreeningAnalysis.findUnique({
            where: {
                trialId_patientId_organizationId: {
                    trialId: parseInt(trialId),
                    patientId: patientId,
                    organizationId: organizationId
                }
            }
        });

        if (!analysis) {
            return res.status(404).json({
                error: 'Patient analysis not found',
                details: 'No screening analysis found for this patient and trial'
            });
        }

        console.log('📊 Raw analysis from DB:', {
            analysisReasons: analysis.analysisReasons,
            inclusionDetailsLength: analysis.analysisReasons?.inclusion_details?.length,
            exclusionDetailsLength: analysis.analysisReasons?.exclusion_details?.length
        });

        // Format response
        const formatted = {
            id: analysis.id,
            patientId: analysis.patientId,
            trialId: analysis.trialId,
            eligibility_status: analysis.eligibilityStatus,
            confidence_score: analysis.confidenceScore,
            patient: {
                id: analysis.patientId,
                age: analysis.patientAge,
                gender: analysis.patientGender,
                birthdate: analysis.patientBirthDate,
                conditions: analysis.patientConditions,
                observations: analysis.patientObservations
            },
            reasons: analysis.analysisReasons,
            criteria_met: analysis.criteriaMetCount,
            criteria_total: analysis.criteriaTotalCount,
            exclusions_triggered: analysis.exclusionsTriggered,
            hard_exclusions: analysis.hardExclusions,
            soft_exclusions: analysis.softExclusions,
            screened_at: analysis.screenedAt
        };

        console.log('📤 Formatted response reasons:', {
            inclusion_details_count: formatted.reasons?.inclusion_details?.length || 0,
            exclusion_details_count: formatted.reasons?.exclusion_details?.length || 0,
            has_reasons: !!formatted.reasons
        });

        res.json(formatted);

    } catch (error) {
        console.error('Error fetching patient analysis:', error);
        res.status(500).json({
            error: 'Failed to fetch patient analysis',
            details: error.message
        });
    }
});

/**
 * DELETE /api/patient-analysis/trial/:trialId
 * Delete all patient analyses for a trial (useful when re-running screening)
 */
router.delete('/trial/:trialId', authMiddleware, async (req, res) => {
    try {
        const { trialId } = req.params;
        let organizationId = req.user.organizationId;

        // If user doesn't have organizationId (e.g., PI user), they shouldn't delete analyses
        if (!organizationId) {
            return res.status(403).json({
                error: 'Forbidden',
                details: 'Only organization users can delete patient analyses'
            });
        }

        const result = await prisma.patientScreeningAnalysis.deleteMany({
            where: {
                trialId: parseInt(trialId),
                organizationId: organizationId
            }
        });

        console.log(`Deleted ${result.count} patient analyses for trial ${trialId}`);

        res.json({
            success: true,
            message: `Deleted ${result.count} patient analyses`,
            count: result.count
        });

    } catch (error) {
        console.error('Error deleting patient analyses:', error);
        res.status(500).json({
            error: 'Failed to delete patient analyses',
            details: error.message
        });
    }
});

module.exports = router;
