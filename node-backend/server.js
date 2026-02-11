/**
 * Main Express Server
 * Drug Trial Automation - Node.js Backend
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import middleware
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');

// Import routes
const apiRoutes = require('./routes/api');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for API
    crossOriginEmbedderPolicy: false
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://ai.veersalabs.com'];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1 || NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting (optional, can be adjusted)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

if (NODE_ENV === 'production') {
    app.use(limiter);
}

// Body parsing middleware
// Skip parsing for upload routes to allow streaming
const uploadRoutes = ['/api/fda/upload', '/api/trials/upload'];

app.use((req, res, next) => {
    if (uploadRoutes.includes(req.path)) {
        return next();
    }
    express.json({ limit: '50mb' })(req, res, next);
});

app.use((req, res, next) => {
    if (uploadRoutes.includes(req.path)) {
        return next();
    }
    express.urlencoded({ extended: true, limit: '50mb' })(req, res, next);
});

// Custom logger
app.use(logger);

// Mount API routes
app.use('/', apiRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 Drug Trial Automation - Node.js Backend');
    console.log('='.repeat(60));
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`Server running on: http://localhost:${PORT}`);
    console.log(`Python Backend: ${process.env.PYTHON_BACKEND_URL}`);
    console.log(`Allowed Origins: ${allowedOrigins.join(', ')}`);
    console.log('='.repeat(60));
    console.log('Available endpoints:');
    console.log(`  - Health Check: http://localhost:${PORT}/health`);
    console.log(`  - API Proxy: http://localhost:${PORT}/api/*`);
    console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    process.exit(0);
});

module.exports = app;
