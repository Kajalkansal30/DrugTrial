const express = require('express');
const pythonClient = require('../utils/pythonClient');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const JWT_EXPIRES_IN = '7d'; // Token valid for 7 days

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Get user from database with organization
        const user = await prisma.user.findUnique({
            where: { username },
            include: {
                organization: true
            }
        });

        if (!user || user.status !== 'active') {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.passwordHash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        // Generate JWT token
        const token = jwt.sign(
            {
                userId: user.id,
                username: user.username,
                organizationId: user.organizationId,
                organizationName: user.organization.name,
                role: user.role
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                organization: {
                    id: user.organization.id,
                    name: user.organization.name,
                    domain: user.organization.domain
                }
            }
        });

    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/auth/me
 * Get current user info (requires authentication)
 */
router.get('/me', async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Get fresh user data from database
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            include: {
                organization: true
            }
        });

        if (!user || user.status !== 'active') {
            return res.status(401).json({ error: 'User not found or inactive' });
        }

        res.json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                organization: {
                    id: user.organization.id,
                    name: user.organization.name,
                    domain: user.organization.domain
                }
            }
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        next(error);
    }
});

/**
 * POST /api/auth/logout
 * Logout (client-side clears token)
 */
router.post('/logout', (req, res) => {
    // JWT is stateless, so logout is handled client-side by removing the token
    res.json({ message: 'Logged out successfully' });
});

/**
 * POST /api/auth/change-password
 * Change user password
 */
router.post('/change-password', async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { currentPassword, newPassword } = req.body;

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new passwords are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Get user
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId }
        });

        if (!user || user.status !== 'active') {
            return res.status(401).json({ error: 'User not found' });
        }

        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        // Update password
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: newPasswordHash }
        });

        res.json({ message: 'Password changed successfully' });

    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        next(error);
    }
});

module.exports = router;
