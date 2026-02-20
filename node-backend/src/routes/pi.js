const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRY = '7d';

/**
 * POST /api/pi/register
 * Register new Principal Investigator
 */
router.post('/register', async (req, res) => {
    try {
        const {
            username,
            password,
            email,
            fullName,
            licenseNumber,
            specialization,
            institution,
            address,
            phone,
            bio,
            qualifications
        } = req.body;

        // Validate required fields
        if (!username || !password || !email || !fullName) {
            return res.status(400).json({
                error: 'Username, password, email, and full name are required'
            });
        }

        // Check if username already exists
        const existingUser = await prisma.user.findUnique({
            where: { username }
        });

        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user and PI profile in transaction
        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    username,
                    passwordHash,
                    email,
                    fullName,
                    role: 'PRINCIPAL_INVESTIGATOR',
                    status: 'active'
                }
            });

            const pi = await tx.principalInvestigator.create({
                data: {
                    userId: user.id,
                    licenseNumber,
                    specialization,
                    institution,
                    address,
                    phone,
                    email,
                    bio,
                    qualifications: qualifications || {},
                    status: 'active'
                }
            });

            // Create audit log
            await tx.auditLog.create({
                data: {
                    action: 'PI_REGISTERED',
                    targetType: 'principal_investigator',
                    targetId: pi.id.toString(),
                    agent: username,
                    status: 'success',
                    details: {
                        username,
                        fullName,
                        institution,
                        specialization
                    }
                }
            });

            return { user, pi };
        });

        // Generate JWT token
        const token = jwt.sign(
            {
                id: result.user.id,
                username: result.user.username,
                role: result.user.role,
                organizationId: null
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRY }
        );

        res.status(201).json({
            message: 'Principal Investigator registered successfully',
            token,
            user: {
                id: result.user.id,
                username: result.user.username,
                fullName: result.user.fullName,
                email: result.user.email,
                role: result.user.role
            },
            pi: result.pi
        });
    } catch (error) {
        console.error('Error registering PI:', error);
        res.status(500).json({
            error: 'Failed to register Principal Investigator',
            details: error.message
        });
    }
});

/**
 * GET /api/pi/profile
 * Get PI profile (authenticated)
 */
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: {
                principalInvestigator: true
            }
        });

        if (!user || !user.principalInvestigator) {
            return res.status(404).json({ error: 'Principal Investigator profile not found' });
        }

        res.json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                status: user.status
            },
            pi: user.principalInvestigator
        });
    } catch (error) {
        console.error('Error fetching PI profile:', error);
        res.status(500).json({
            error: 'Failed to fetch profile',
            details: error.message
        });
    }
});

/**
 * PUT /api/pi/profile
 * Update PI profile
 */
router.put('/profile', authMiddleware, async (req, res) => {
    try {
        const {
            fullName,
            email,
            licenseNumber,
            specialization,
            institution,
            address,
            phone,
            bio,
            qualifications
        } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { principalInvestigator: true }
        });

        if (!user || !user.principalInvestigator) {
            return res.status(404).json({ error: 'Principal Investigator profile not found' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // Update user
            const updatedUser = await tx.user.update({
                where: { id: req.user.userId },
                data: {
                    fullName: fullName || user.fullName,
                    email: email || user.email
                }
            });

            // Update PI profile
            const updatedPI = await tx.principalInvestigator.update({
                where: { id: user.principalInvestigator.id },
                data: {
                    licenseNumber: licenseNumber !== undefined ? licenseNumber : user.principalInvestigator.licenseNumber,
                    specialization: specialization !== undefined ? specialization : user.principalInvestigator.specialization,
                    institution: institution !== undefined ? institution : user.principalInvestigator.institution,
                    address: address !== undefined ? address : user.principalInvestigator.address,
                    phone: phone !== undefined ? phone : user.principalInvestigator.phone,
                    email: email !== undefined ? email : user.principalInvestigator.email,
                    bio: bio !== undefined ? bio : user.principalInvestigator.bio,
                    qualifications: qualifications !== undefined ? qualifications : user.principalInvestigator.qualifications
                }
            });

            return { user: updatedUser, pi: updatedPI };
        });

        res.json({
            message: 'Profile updated successfully',
            user: result.user,
            pi: result.pi
        });
    } catch (error) {
        console.error('Error updating PI profile:', error);
        res.status(500).json({
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

/**
 * GET /api/pi/list
 * List all active PIs (for organization to select when sending)
 */
router.get('/list', authMiddleware, async (req, res) => {
    try {
        const pis = await prisma.principalInvestigator.findMany({
            where: { status: 'active' },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        fullName: true,
                        email: true,
                        status: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ pis });
    } catch (error) {
        console.error('Error fetching PI list:', error);
        res.status(500).json({
            error: 'Failed to fetch Principal Investigators',
            details: error.message
        });
    }
});

/**
 * GET /api/pi/dashboard
 * Get PI dashboard data
 */
router.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { principalInvestigator: true }
        });

        if (!user || !user.principalInvestigator) {
            return res.status(403).json({ error: 'Not a Principal Investigator' });
        }

        const piId = user.principalInvestigator.id;

        // Get submission statistics
        const totalSubmissions = await prisma.trialSubmission.count({
            where: { principalInvestigatorId: piId }
        });

        const pendingSubmissions = await prisma.trialSubmission.count({
            where: {
                principalInvestigatorId: piId,
                status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }
            }
        });

        const approvedSubmissions = await prisma.trialSubmission.count({
            where: {
                principalInvestigatorId: piId,
                status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] }
            }
        });

        const rejectedSubmissions = await prisma.trialSubmission.count({
            where: {
                principalInvestigatorId: piId,
                status: 'REJECTED'
            }
        });

        // Get total patients reviewed
        const totalPatients = await prisma.submissionPatient.count({
            where: {
                submission: {
                    principalInvestigatorId: piId
                }
            }
        });

        const approvedPatients = await prisma.submissionPatient.count({
            where: {
                submission: {
                    principalInvestigatorId: piId
                },
                isApproved: true
            }
        });

        // Get recent submissions
        const recentSubmissions = await prisma.trialSubmission.findMany({
            where: { principalInvestigatorId: piId },
            include: {
                trial: true,
                submittedByUser: {
                    include: { organization: true }
                },
                _count: {
                    select: {
                        patients: true,
                        reviews: true
                    }
                }
            },
            orderBy: { submissionDate: 'desc' },
            take: 10
        });

        res.json({
            profile: {
                user,
                pi: user.principalInvestigator
            },
            stats: {
                totalSubmissions,
                pendingSubmissions,
                approvedSubmissions,
                rejectedSubmissions,
                totalPatients,
                approvedPatients
            },
            recentSubmissions
        });
    } catch (error) {
        console.error('Error fetching PI dashboard:', error);
        res.status(500).json({
            error: 'Failed to fetch dashboard data',
            details: error.message
        });
    }
});

module.exports = router;
