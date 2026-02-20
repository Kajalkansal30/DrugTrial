const dotenv = require('dotenv');
dotenv.config();

module.exports = {
    // Server Configuration
    port: process.env.PORT || 4000,
    nodeEnv: process.env.NODE_ENV || 'development',

    // Python Backend
    pythonBackendUrl: process.env.PYTHON_BACKEND_URL || 'https://ai.veersalabs.com/drugtrial-be',

    // CORS
    corsOrigins: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
        : [],

    // Rate Limiting
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',

    // File Upload
    maxFileSize: 50 * 1024 * 1024, // 50MB
    uploadDir: './uploads'
};
