const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

/**
 * Middleware to verify JWT token and add user info to request
 */
const authMiddleware = (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Add user info to request
        req.user = {
            userId: decoded.userId,
            username: decoded.username,
            organizationId: decoded.organizationId,
            organizationName: decoded.organizationName,
            role: decoded.role
        };

        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(500).json({ error: 'Authentication error' });
    }
};

/**
 * Optional auth middleware - doesn't fail if no token
 */
const optionalAuth = (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = {
                userId: decoded.userId,
                username: decoded.username,
                organizationId: decoded.organizationId,
                organizationName: decoded.organizationName,
                role: decoded.role
            };
        }

        next();

    } catch (error) {
        // Continue without auth
        next();
    }
};

/**
 * Check if user is admin
 */
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    next();
};

module.exports = {
    authMiddleware,
    optionalAuth,
    requireAdmin
};
