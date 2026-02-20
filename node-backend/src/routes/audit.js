const express = require('express');
const pythonClient = require('../utils/pythonClient');
const { authMiddleware } = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * GET /api/audit/logs
 * Get audit logs for the user's organization
 */
router.get('/logs', authMiddleware, async (req, res, next) => {
    try {
        const { agent, action, limit = 100 } = req.query;

        // Build where clause with organization filter
        const where = {
            organizationId: req.user.organizationId
        };

        if (agent) where.agent = agent;
        if (action) where.action = action;

        // Fetch audit logs from database filtered by organization
        const logs = await prisma.auditLog.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: parseInt(limit),
            select: {
                id: true,
                timestamp: true,
                action: true,
                targetType: true,
                targetId: true,
                agent: true,
                status: true,
                details: true,
                documentHash: true,
                previousHash: true,
                entryHash: true
            }
        });

        console.log(`📋 Retrieved ${logs.length} audit logs for organization ${req.user.organizationId}`);

        res.json(logs);
    } catch (error) {
        console.error('❌ Error fetching audit logs:', error.message);
        next(error);
    }
});

/**
 * GET /api/audit/verify-integrity
 * Verify audit log integrity for the user's organization
 */
router.get('/verify-integrity', authMiddleware, async (req, res, next) => {
    try {
        // Fetch organization-specific audit logs ordered by timestamp
        const logs = await prisma.auditLog.findMany({
            where: { organizationId: req.user.organizationId },
            orderBy: { timestamp: 'asc' },
            select: {
                id: true,
                entryHash: true,
                previousHash: true,
                action: true,
                timestamp: true
            }
        });

        if (logs.length === 0) {
            return res.json({
                status: 'valid',
                message: 'No audit logs found for this organization',
                total_logs: 0
            });
        }

        // Verify hash chain integrity
        let isValid = true;
        const issues = [];

        for (let i = 1; i < logs.length; i++) {
            const currentLog = logs[i];
            const previousLog = logs[i - 1];

            if (currentLog.previousHash !== previousLog.entryHash) {
                isValid = false;
                issues.push({
                    log_id: currentLog.id,
                    issue: 'Hash chain broken',
                    expected: previousLog.entryHash,
                    actual: currentLog.previousHash
                });
            }
        }

        console.log(`🔒 Verified ${logs.length} audit logs for organization ${req.user.organizationId}: ${isValid ? 'Valid' : 'Invalid'}`);

        res.json({
            status: isValid ? 'valid' : 'invalid',
            total_logs: logs.length,
            issues: issues.length > 0 ? issues : undefined,
            message: isValid
                ? 'All audit logs have valid hash chains'
                : `Found ${issues.length} integrity issues`
        });
    } catch (error) {
        console.error('❌ Error verifying audit integrity:', error.message);
        next(error);
    }
});

module.exports = router;
