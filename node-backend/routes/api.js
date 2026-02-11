/**
 * API Proxy Routes
 * Forwards all requests to the Python FastAPI backend
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'https://ai.veersalabs.com/drugtrial-be';

/**
 * Generic proxy handler with streaming support
 * Forwards requests to Python backend and returns the response
 */
const proxyRequest = async (req, res, next) => {
    try {
        const url = `${PYTHON_BACKEND_URL}${req.originalUrl}`;

        console.log(`Proxying ${req.method} request to: ${url}`);

        // Prepare headers
        const headers = { ...req.headers };
        delete headers['host'];
        delete headers['connection'];
        delete headers['content-length'];
        delete headers['origin']; // Remove origin to avoid CORS issues

        const config = {
            method: req.method,
            url: url,
            headers: headers,
            params: req.query,
            data: req.body,
            maxRedirects: 5,
            validateStatus: () => true, // Don't throw on any status code
            responseType: 'stream', // Enable streaming
        };

        const response = await axios(config);

        // Forward status code
        res.status(response.status);

        // Forward headers
        Object.keys(response.headers).forEach(key => {
            if (key !== 'transfer-encoding') { // Skip transfer-encoding
                res.setHeader(key, response.headers[key]);
            }
        });

        // Stream the response
        response.data.pipe(res);

    } catch (error) {
        next(error);
    }
};

/**
 * Special handler for file uploads with streaming
 */
const proxyStreamingRequest = async (req, res, next) => {
    try {
        const url = `${PYTHON_BACKEND_URL}${req.originalUrl}`;

        console.log(`Proxying streaming ${req.method} request to: ${url}`);

        // Prepare headers - keep content-type for multipart
        const headers = { ...req.headers };
        delete headers['host'];
        delete headers['connection'];
        delete headers['origin'];
        // Keep content-type and content-length for multipart uploads

        const config = {
            method: req.method,
            url: url,
            headers: headers,
            params: req.query,
            data: req, // Stream the request body directly
            maxRedirects: 5,
            validateStatus: () => true,
            responseType: 'stream',
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        };

        const response = await axios(config);

        // Forward status code
        res.status(response.status);

        // Forward headers
        Object.keys(response.headers).forEach(key => {
            if (key !== 'transfer-encoding') {
                res.setHeader(key, response.headers[key]);
            }
        });

        // Stream the response
        response.data.pipe(res);

    } catch (error) {
        console.error('Streaming proxy error:', error.message);
        next(error);
    }
};

// Health check endpoint (local, not proxied)
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Node.js Express Backend',
        pythonBackend: PYTHON_BACKEND_URL,
        timestamp: new Date().toISOString()
    });
});

// Root endpoint
router.get('/', (req, res) => {
    res.json({
        message: 'Drug Trial Automation - Node.js Backend',
        version: '1.0.0',
        pythonBackend: PYTHON_BACKEND_URL,
        endpoints: {
            health: '/health',
            api: '/api/*',
            patients: '/api/patients',
            trials: '/api/trials',
            eligibility: '/api/eligibility',
            fda: '/api/fda',
            audit: '/api/audit',
            privacy: '/api/privacy',
            ltaa: '/api/ltaa',
            insilico: '/api/insilico'
        }
    });
});

// Special handling for file upload endpoints (streaming)
router.post('/api/fda/upload', proxyStreamingRequest);
router.post('/api/trials/upload', proxyStreamingRequest);

// Proxy all other /api/* requests to Python backend
router.all('/api/*', proxyRequest);

// Proxy root-level API endpoints that don't have /api prefix
router.all('/patients*', proxyRequest);
router.all('/trials*', proxyRequest);
router.all('/eligibility*', proxyRequest);

module.exports = router;
