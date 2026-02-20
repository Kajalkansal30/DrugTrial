const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();
const prisma = new PrismaClient();

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'https://ai.veersalabs.com/drugtrial-be';

// ==================== Organization Routes ====================

/**
 * POST /api/submissions
 * Create new submission - Organization sends trial to PI
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { trialId, principalInvestigatorId, patientIds, notes, reportData, selectAll, patientData } = req.body;

        // Log incoming request for debugging
        console.log('Creating submission with:', {
            trialId,
            principalInvestigatorId,
            patientCount: patientIds?.length,
            selectAll,
            hasPatientData: !!patientData
        });

        // Validate required fields
        if (!trialId || !principalInvestigatorId) {
            return res.status(400).json({
                error: 'Missing required fields',
                details: `trialId (${trialId}) and principalInvestigatorId (${principalInvestigatorId}) are required`
            });
        }

        const parsedTrialId = parseInt(trialId);
        const parsedPIId = parseInt(principalInvestigatorId);

        if (isNaN(parsedTrialId) || isNaN(parsedPIId)) {
            return res.status(400).json({
                error: 'Invalid input',
                details: 'trialId and principalInvestigatorId must be valid numbers'
            });
        }

        // Verify trial belongs to user's organization
        const trial = await prisma.clinicalTrial.findFirst({
            where: {
                id: parsedTrialId,
                organizationId: req.user.organizationId
            }
        });

        if (!trial) {
            return res.status(404).json({ error: 'Trial not found or access denied' });
        }

        // Verify PI exists
        const pi = await prisma.principalInvestigator.findUnique({
            where: { id: parsedPIId },
            include: { user: true }
        });

        if (!pi || pi.status !== 'active') {
            return res.status(404).json({ error: 'Principal Investigator not found or inactive' });
        }

        // Fetch patient eligibility results from Python backend
        let patientsToSubmit = [];

        // Option 1: Use patient data sent from frontend (preferred)
        if (patientData && Array.isArray(patientData) && patientData.length > 0) {
            console.log(`Using patient data provided by frontend: ${patientData.length} patients`);
            console.log('Sample patient data:', JSON.stringify(patientData[0], null, 2));
            patientsToSubmit = patientData;
        }
        // Option 2: Fetch from Python backend
        else if (selectAll || (patientIds && patientIds.length > 0)) {
            // Fetch all eligible patients for this trial from Python backend
            try {
                // Use trial.id (numeric database ID), not trial.trialId (string identifier)
                const url = `${PYTHON_API_URL}/api/eligibility/results/${trial.id}`;
                console.log(`Fetching patient data from: ${url}`);
                console.log(`Trial info - ID: ${trial.id}, TrialID: ${trial.trialId}, Title: ${trial.protocolTitle}`);

                const response = await axios.get(url, {
                    timeout: 10000,
                    validateStatus: function (status) {
                        return status < 500; // Resolve for status codes less than 500
                    }
                });

                if (response.status === 404) {
                    console.warn(`No eligibility results found for trial ${trial.id}`);
                    if (selectAll) {
                        return res.status(404).json({
                            error: 'No eligibility results found for this trial',
                            details: 'Please ensure patient eligibility data is included in the request or saved in the database.',
                            suggestion: 'Make sure to send patientData array with the submission.'
                        });
                    }
                } else if (response.status !== 200) {
                    console.error(`Python backend returned status ${response.status}:`, response.data);
                    throw new Error(`Python backend returned status ${response.status}`);
                }

                const allPatients = response.data || [];
                console.log(`Received ${allPatients.length} patients from Python backend`);

                if (selectAll) {
                    // Submit all eligible patients
                    patientsToSubmit = allPatients.filter(p => {
                        const status = (p.status || '').toLowerCase();
                        return status.includes('eligible') || status.includes('highly');
                    });
                    console.log(`Filtered to ${patientsToSubmit.length} eligible patients`);
                } else {
                    // Submit only selected patients
                    patientsToSubmit = allPatients.filter(p =>
                        patientIds.includes(p.patient_id)
                    );
                    console.log(`Filtered to ${patientsToSubmit.length} selected patients`);
                }

                console.log(`Submitting ${patientsToSubmit.length} patients for trial ${trial.id}`);
            } catch (error) {
                console.error('Error fetching patients from Python backend:', error.message);
                console.error('Error details:', error.response?.data || error);
                console.error('URL attempted:', `${PYTHON_API_URL}/api/eligibility/results/${trial.id}`);

                // If Python backend fails, we can still proceed with an empty list
                // but only if selectAll is false (meaning frontend selected specific patients)
                if (selectAll) {
                    return res.status(500).json({
                        error: 'Failed to fetch patient data from eligibility system',
                        details: error.message,
                        hint: 'Please include patientData in the request body'
                    });
                }
                console.warn('Continuing with empty patient list since selectAll=false');
            }
        }

        if (patientsToSubmit.length === 0) {
            return res.status(400).json({ error: 'No patients to submit' });
        }

        console.log(`Creating submission with ${patientsToSubmit.length} patients:`,
            patientsToSubmit.map(p => ({ id: p.patient_id, status: p.status }))
        );

        // Create submission in transaction with extended timeout for large patient batches
        const submission = await prisma.$transaction(async (tx) => {
            const newSubmission = await tx.trialSubmission.create({
                data: {
                    trialId: trial.id,
                    principalInvestigatorId: pi.id,
                    submittedByUserId: req.user.userId,
                    status: 'SUBMITTED',
                    notes,
                    reportData: reportData || {}
                },
                include: {
                    trial: true,
                    principalInvestigator: {
                        include: { user: true }
                    },
                    submittedByUser: true
                }
            });

            // Create submission patients
            const submissionPatients = await tx.submissionPatient.createMany({
                data: patientsToSubmit.map(patient => {
                    const patientDataToStore = {
                        patient_id: patient.patient_id || patient.id || patient.patientId,
                        age: patient.age,
                        gender: patient.gender,
                        status: patient.status || patient.eligibility_status,
                        confidence: patient.confidence || patient.confidence_score,
                        reasons: patient.reasons || []
                    };
                    console.log('Storing patient data:', patientDataToStore);
                    return {
                        submissionId: newSubmission.id,
                        patientId: patient.patient_id || patient.id || patient.patientId,
                        patientData: patientDataToStore
                    };
                })
            });

            // Create audit log
            await tx.auditLog.create({
                data: {
                    action: 'SUBMISSION_CREATED',
                    targetType: 'trial_submission',
                    targetId: newSubmission.id.toString(),
                    agent: req.user.username,
                    status: 'success',
                    details: {
                        trialId: trial.trialId,
                        trialTitle: trial.protocolTitle,
                        piName: pi.user.fullName,
                        patientCount: patientsToSubmit.length,
                        selectAll
                    },
                    organizationId: req.user.organizationId
                }
            });

            return newSubmission;
        }, {
            maxWait: 10000, // Maximum wait time to get a transaction from the pool
            timeout: 15000  // Maximum time the transaction can run (15 seconds for large patient batches)
        });

        res.status(201).json({
            message: 'Trial submitted to Principal Investigator successfully',
            submission
        });
    } catch (error) {
        console.error('Error creating submission:', error);
        res.status(500).json({
            error: 'Failed to create submission',
            details: error.message
        });
    }
});

/**
 * GET /api/submissions
 * List submissions (filtered by role)
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userWithPI = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { principalInvestigator: true }
        });

        let submissions;

        if (userWithPI.role === 'PRINCIPAL_INVESTIGATOR' && userWithPI.principalInvestigator) {
            // PI sees submissions sent to them
            submissions = await prisma.trialSubmission.findMany({
                where: {
                    principalInvestigatorId: userWithPI.principalInvestigator.id
                },
                include: {
                    trial: true,
                    principalInvestigator: {
                        include: { user: true }
                    },
                    submittedByUser: {
                        include: { organization: true }
                    },
                    patients: true,
                    reviews: {
                        orderBy: { reviewedAt: 'desc' }
                    },
                    _count: {
                        select: {
                            patients: true,
                            reviews: true
                        }
                    }
                },
                orderBy: { submissionDate: 'desc' }
            });
        } else {
            // Organization users see submissions they created
            submissions = await prisma.trialSubmission.findMany({
                where: {
                    submittedByUser: {
                        organizationId: req.user.organizationId
                    }
                },
                include: {
                    trial: true,
                    principalInvestigator: {
                        include: { user: true }
                    },
                    submittedByUser: true,
                    patients: true,
                    reviews: {
                        orderBy: { reviewedAt: 'desc' }
                    },
                    _count: {
                        select: {
                            patients: true,
                            reviews: true
                        }
                    }
                },
                orderBy: { submissionDate: 'desc' }
            });
        }

        res.json({ submissions });
    } catch (error) {
        console.error('Error fetching submissions:', error);
        res.status(500).json({
            error: 'Failed to fetch submissions',
            details: error.message
        });
    }
});

/**
 * GET /api/submissions/:id
 * Get submission details
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const submissionId = parseInt(req.params.id);

        if (isNaN(submissionId)) {
            return res.status(400).json({ error: 'Invalid submission ID' });
        }

        const submission = await prisma.trialSubmission.findUnique({
            where: { id: submissionId },
            include: {
                trial: {
                    include: {
                        fdaDocument: true,
                        organization: true
                    }
                },
                principalInvestigator: {
                    include: { user: true }
                },
                submittedByUser: {
                    include: { organization: true }
                },
                patients: {
                    orderBy: { createdAt: 'asc' }
                },
                reviews: {
                    orderBy: { reviewedAt: 'desc' }
                }
            }
        });

        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        // Verify access
        const userWithPI = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { principalInvestigator: true }
        });

        const isPI = userWithPI.principalInvestigator?.id === submission.principalInvestigatorId;
        const isOrgUser = submission.submittedByUser.organizationId === req.user.organizationId;

        if (!isPI && !isOrgUser) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Log sample patient data for debugging
        if (submission.patients.length > 0) {
            console.log('Sample patient data:', JSON.stringify(submission.patients[0], null, 2));
        }

        res.json({ submission, userRole: isPI ? 'PI' : 'ORG' });
    } catch (error) {
        console.error('Error fetching submission details:', error);
        res.status(500).json({
            error: 'Failed to fetch submission',
            details: error.message
        });
    }
});

// ==================== PI Routes ====================

/**
 * PUT /api/submissions/:id/approve-patient
 * PI approves or rejects specific patient
 */
router.put('/:id/approve-patient', authMiddleware, async (req, res) => {
    try {
        const { patientId, approved, comment } = req.body;
        const submissionId = parseInt(req.params.id);

        console.log('Approve patient request:', { submissionId, patientId, approved, comment });

        if (isNaN(submissionId)) {
            return res.status(400).json({ error: 'Invalid submission ID' });
        }

        if (!patientId || typeof patientId !== 'string') {
            return res.status(400).json({ error: 'Invalid patientId - must be a string' });
        }

        if (typeof approved !== 'boolean') {
            return res.status(400).json({ error: 'Invalid approved status - must be a boolean' });
        }

        // Verify user is PI for this submission
        const userWithPI = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { principalInvestigator: true }
        });

        if (!userWithPI.principalInvestigator) {
            return res.status(403).json({ error: 'Only Principal Investigators can approve patients' });
        }

        const submission = await prisma.trialSubmission.findUnique({
            where: { id: submissionId },
            include: { trial: true }
        });

        if (!submission || submission.principalInvestigatorId !== userWithPI.principalInvestigator.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Update patient approval status with extended timeout for concurrent requests
        await prisma.$transaction(async (tx) => {
            await tx.submissionPatient.updateMany({
                where: {
                    submissionId,
                    patientId
                },
                data: {
                    isApproved: approved
                }
            });

            // Create review record
            await tx.pIReview.create({
                data: {
                    submissionId,
                    reviewType: approved ? 'PATIENT_APPROVAL' : 'PATIENT_REJECTION',
                    patientId,
                    comment,
                    decision: approved ? 'approved' : 'rejected'
                }
            });

            // Update submission status
            const patients = await tx.submissionPatient.findMany({
                where: { submissionId }
            });

            const allReviewed = patients.every(p => p.isApproved !== null);
            const anyApproved = patients.some(p => p.isApproved === true);
            const allApproved = patients.every(p => p.isApproved === true);

            let newStatus = submission.status;
            if (allReviewed) {
                if (allApproved) {
                    newStatus = 'APPROVED';
                } else if (anyApproved) {
                    newStatus = 'PARTIALLY_APPROVED';
                } else {
                    newStatus = 'REJECTED';
                }
            } else {
                newStatus = 'UNDER_REVIEW';
            }

            await tx.trialSubmission.update({
                where: { id: submissionId },
                data: {
                    status: newStatus,
                    reviewedAt: new Date()
                }
            });
        }, {
            maxWait: 20000, // Wait up to 20 seconds to start a transaction (for concurrent requests)
            timeout: 20000  // Allow transaction to run for up to 20 seconds
        });

        res.json({
            message: `Patient ${approved ? 'approved' : 'rejected'} successfully`
        });
    } catch (error) {
        console.error('Error approving patient:', error);
        res.status(500).json({
            error: 'Failed to update patient approval',
            details: error.message
        });
    }
});

/**
 * PUT /api/submissions/:id/approve-bulk
 * PI approves multiple selected patients in one transaction
 */
router.put('/:id/approve-bulk', authMiddleware, async (req, res) => {
    try {
        const { patientIds, comment } = req.body;
        const submissionId = parseInt(req.params.id);

        console.log('Bulk approve request:', { submissionId, patientIds, comment });

        if (isNaN(submissionId)) {
            return res.status(400).json({ error: 'Invalid submission ID' });
        }

        if (!Array.isArray(patientIds) || patientIds.length === 0) {
            return res.status(400).json({ error: 'patientIds must be a non-empty array' });
        }

        // Verify user is PI for this submission
        const userWithPI = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { principalInvestigator: true }
        });

        if (!userWithPI.principalInvestigator) {
            return res.status(403).json({ error: 'Only Principal Investigators can approve patients' });
        }

        const submission = await prisma.trialSubmission.findUnique({
            where: { id: submissionId }
        });

        if (!submission || submission.principalInvestigatorId !== userWithPI.principalInvestigator.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Approve all selected patients in one transaction
        await prisma.$transaction(async (tx) => {
            // Update all selected patients
            await tx.submissionPatient.updateMany({
                where: {
                    submissionId,
                    patientId: { in: patientIds }
                },
                data: { isApproved: true }
            });

            // Create review record for bulk approval
            await tx.pIReview.create({
                data: {
                    submissionId,
                    reviewType: 'PATIENT_APPROVAL',
                    comment: comment || `Bulk approved ${patientIds.length} patients`,
                    decision: 'approved'
                }
            });

            // Update submission status
            const allPatients = await tx.submissionPatient.findMany({
                where: { submissionId }
            });

            const allReviewed = allPatients.every(p => p.isApproved !== null);
            const anyApproved = allPatients.some(p => p.isApproved === true);
            const allApproved = allPatients.every(p => p.isApproved === true);

            let newStatus = submission.status;
            if (allReviewed) {
                if (allApproved) {
                    newStatus = 'APPROVED';
                } else if (anyApproved) {
                    newStatus = 'PARTIALLY_APPROVED';
                } else {
                    newStatus = 'REJECTED';
                }
            } else {
                newStatus = 'UNDER_REVIEW';
            }

            await tx.trialSubmission.update({
                where: { id: submissionId },
                data: {
                    status: newStatus,
                    reviewedAt: new Date()
                }
            });
        }, {
            maxWait: 20000,
            timeout: 20000
        });

        res.json({
            message: `Successfully approved ${patientIds.length} patients`
        });
    } catch (error) {
        console.error('Error bulk approving patients:', error);
        res.status(500).json({
            error: 'Failed to bulk approve patients',
            details: error.message
        });
    }
});

/**
 * PUT /api/submissions/:id/approve-all
 * PI approves all patients
 */
router.put('/:id/approve-all', authMiddleware, async (req, res) => {
    try {
        const { comment } = req.body;
        const submissionId = parseInt(req.params.id);

        if (isNaN(submissionId)) {
            return res.status(400).json({ error: 'Invalid submission ID' });
        }

        // Verify user is PI for this submission
        const userWithPI = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { principalInvestigator: true }
        });

        if (!userWithPI.principalInvestigator) {
            return res.status(403).json({ error: 'Only Principal Investigators can approve patients' });
        }

        const submission = await prisma.trialSubmission.findUnique({
            where: { id: submissionId },
            include: {
                trial: true,
                patients: true
            }
        });

        if (!submission || submission.principalInvestigatorId !== userWithPI.principalInvestigator.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Approve all patients with extended timeout
        await prisma.$transaction(async (tx) => {
            await tx.submissionPatient.updateMany({
                where: { submissionId },
                data: { isApproved: true }
            });

            // Create review record
            await tx.pIReview.create({
                data: {
                    submissionId,
                    reviewType: 'PATIENT_APPROVAL',
                    comment: comment || `Approved all ${submission.patients.length} patients`,
                    decision: 'approved'
                }
            });

            // Update submission status
            await tx.trialSubmission.update({
                where: { id: submissionId },
                data: {
                    status: 'APPROVED',
                    reviewedAt: new Date()
                }
            });
        }, {
            maxWait: 20000,
            timeout: 20000
        });

        res.json({
            message: `All ${submission.patients.length} patients approved successfully`
        });
    } catch (error) {
        console.error('Error approving all patients:', error);
        res.status(500).json({
            error: 'Failed to approve all patients',
            details: error.message
        });
    }
});

/**
 * POST /api/submissions/:id/review
 * PI adds review/comment
 */
router.post('/:id/review', authMiddleware, async (req, res) => {
    try {
        const { reviewType, patientId, comment, decision } = req.body;
        const submissionId = parseInt(req.params.id);

        if (isNaN(submissionId)) {
            return res.status(400).json({ error: 'Invalid submission ID' });
        }

        // Verify user is PI for this submission
        const userWithPI = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { principalInvestigator: true }
        });

        if (!userWithPI.principalInvestigator) {
            return res.status(403).json({ error: 'Only Principal Investigators can add reviews' });
        }

        const submission = await prisma.trialSubmission.findUnique({
            where: { id: submissionId }
        });

        if (!submission || submission.principalInvestigatorId !== userWithPI.principalInvestigator.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const review = await prisma.pIReview.create({
            data: {
                submissionId,
                reviewType: reviewType || 'GENERAL_COMMENT',
                patientId,
                comment,
                decision
            }
        });

        // Update submission to UNDER_REVIEW if still SUBMITTED
        if (submission.status === 'SUBMITTED') {
            await prisma.trialSubmission.update({
                where: { id: submissionId },
                data: { status: 'UNDER_REVIEW' }
            });
        }

        res.status(201).json({
            message: 'Review added successfully',
            review
        });
    } catch (error) {
        console.error('Error adding review:', error);
        res.status(500).json({
            error: 'Failed to add review',
            details: error.message
        });
    }
});

/**
 * GET /api/submissions/stats/summary
 * Get submission statistics for dashboard
 */
router.get('/stats/summary', authMiddleware, async (req, res) => {
    try {
        const userWithPI = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { principalInvestigator: true }
        });

        let stats;

        if (userWithPI.role === 'PRINCIPAL_INVESTIGATOR' && userWithPI.principalInvestigator) {
            // PI stats
            const totalReceived = await prisma.trialSubmission.count({
                where: { principalInvestigatorId: userWithPI.principalInvestigator.id }
            });

            const pending = await prisma.trialSubmission.count({
                where: {
                    principalInvestigatorId: userWithPI.principalInvestigator.id,
                    status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }
                }
            });

            const approved = await prisma.trialSubmission.count({
                where: {
                    principalInvestigatorId: userWithPI.principalInvestigator.id,
                    status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] }
                }
            });

            stats = { totalReceived, pending, approved };
        } else {
            // Organization stats
            const totalSent = await prisma.trialSubmission.count({
                where: {
                    submittedByUser: {
                        organizationId: req.user.organizationId
                    }
                }
            });

            const pending = await prisma.trialSubmission.count({
                where: {
                    submittedByUser: {
                        organizationId: req.user.organizationId
                    },
                    status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }
                }
            });

            const approved = await prisma.trialSubmission.count({
                where: {
                    submittedByUser: {
                        organizationId: req.user.organizationId
                    },
                    status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] }
                }
            });

            stats = { totalSent, pending, approved };
        }

        res.json({ stats });
    } catch (error) {
        console.error('Error fetching submission stats:', error);
        res.status(500).json({
            error: 'Failed to fetch statistics',
            details: error.message
        });
    }
});

/**
 * GET /api/submissions/eligibility/:trialId
 * Get eligibility results for a trial with patient demographic data
 * Combines data from patient_eligibility and patients tables
 */
router.get('/eligibility/:trialId', authMiddleware, async (req, res) => {
    try {
        const { trialId } = req.params;
        const parsedTrialId = parseInt(trialId);

        if (isNaN(parsedTrialId)) {
            return res.status(400).json({
                error: 'Invalid trial ID',
                details: 'Trial ID must be a valid number'
            });
        }

        console.log(`Fetching eligibility results for trial ${parsedTrialId}`);

        // Query database to get LATEST eligibility result per patient
        // Also include PI approval status from submission_patients table
        const results = await prisma.$queryRaw`
            SELECT DISTINCT ON (pe.patient_id)
                pe.patient_id,
                pe.trial_id,
                CASE 
                    WHEN sp.is_approved = true THEN 'APPROVED'
                    WHEN sp.is_approved = false THEN 'REJECTED'
                    ELSE COALESCE(ea.status, pe.eligibility_status)
                END as status,
                COALESCE(ea.confidence, pe.confidence_score) as confidence,
                ea.criteria_met,
                ea.criteria_total,
                pe.evaluation_date,
                ea.details,
                p.gender,
                EXTRACT(YEAR FROM AGE(p.birthdate)) as age,
                sp.updated_at as approval_date,
                CASE 
                    WHEN sp.is_approved = true THEN 'APPROVED'
                    WHEN sp.is_approved = false THEN 'REJECTED'
                    ELSE NULL
                END as approval_status
            FROM patient_eligibility pe
            LEFT JOIN eligibility_audits ea ON pe.patient_id = ea.patient_id AND pe.trial_id = ea.trial_id
            LEFT JOIN patients p ON pe.patient_id = p.id
            LEFT JOIN (
                SELECT sp.patient_data->>'patient_id' as patient_id,
                       sp.is_approved,
                       sp.updated_at,
                       ts.trial_id
                FROM submission_patients sp
                JOIN trial_submissions ts ON sp.submission_id = ts.id
                WHERE ts.trial_id = ${parsedTrialId}
            ) sp ON sp.patient_id = pe.patient_id AND sp.trial_id = pe.trial_id
            WHERE pe.trial_id = ${parsedTrialId}
            ORDER BY pe.patient_id, pe.evaluation_date DESC
        `;

        console.log(`Found ${results.length} unique patients with eligibility results for trial ${parsedTrialId}`);

        // Format the results to match expected frontend format
        const formattedResults = results.map(r => ({
            patient_id: r.patient_id,
            trial_id: r.trial_id,
            status: r.status,
            confidence: parseFloat(r.confidence),
            criteria_met: r.criteria_met,
            criteria_total: r.criteria_total,
            evaluation_date: r.evaluation_date,
            details: r.details,
            gender: r.gender,
            age: parseInt(r.age),
            approval_status: r.approval_status,
            approval_date: r.approval_date
        }));

        res.json(formattedResults);
    } catch (error) {
        console.error('Error fetching eligibility results:', error);
        res.status(500).json({
            error: 'Failed to fetch eligibility results',
            details: error.message
        });
    }
});

module.exports = router;
