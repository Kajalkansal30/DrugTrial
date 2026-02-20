const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * Rate limiter middleware
 */
const rateLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMaxRequests,
    message: {
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = rateLimiter;
