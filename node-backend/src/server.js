const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const logger = require('./middleware/logger');
const rateLimiter = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const apiRouter = require('./routes');

// Create Express app
const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);

        if (config.corsOrigins.includes(origin) || config.nodeEnv === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Compression
app.use(compression());

// Body parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
app.use(logger);

// Rate limiting (apply to all routes)
if (config.nodeEnv === 'production') {
    app.use(rateLimiter);
}

// Ensure upload directories exist
const uploadDirs = [
    'uploads/fda',
    'uploads/trials'
];
uploadDirs.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
});

// Mount API routes
app.use('/api', apiRouter);

// Catch-all for root
app.get('/', (req, res) => {
    res.json({
        message: 'DrugTrial Node.js Backend',
        version: '1.0.0',
        status: 'running',
        environment: config.nodeEnv,
        endpoints: {
            api: '/api',
            health: '/api/health',
            patients: '/api/patients',
            trials: '/api/trials',
            eligibility: '/api/eligibility',
            fda: '/api/fda',
            ltaa: '/api/ltaa',
            insilico: '/api/insilico',
            privacy: '/api/privacy',
            audit: '/api/audit',
            chat: '/api/chat'
        }
    });
});

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Start server
const PORT = config.port;
const server = app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log(`🚀 DrugTrial Node.js Backend`);
    console.log('='.repeat(60));
    console.log(`📍 Environment: ${config.nodeEnv}`);
    console.log(`🌐 Server running on: http://localhost:${PORT}`);
    console.log(`🔗 Python Backend: ${config.pythonBackendUrl}`);
    console.log(`🔒 CORS enabled for: ${config.corsOrigins.join(', ')}`);
    console.log('='.repeat(60));
    console.log('📋 Available endpoints:');
    console.log(`   GET  /                      - API info`);
    console.log(`   GET  /api/health            - Health check`);
    console.log(`   GET  /api/patients          - List patients`);
    console.log(`   POST /api/trials/upload     - Upload protocol`);
    console.log(`   POST /api/fda/upload        - Upload FDA forms`);
    console.log(`   POST /api/eligibility/check - Check eligibility`);
    console.log(`   POST /api/chat              - Chat with agent`);
    console.log('='.repeat(60));
});

// Set server timeout to 35 minutes for long-running uploads
server.timeout = 2100000; // 35 minutes
server.keepAliveTimeout = 2100000;
server.headersTimeout = 2100000;

module.exports = app;
