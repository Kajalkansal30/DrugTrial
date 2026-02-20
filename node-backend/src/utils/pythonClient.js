const axios = require('axios');
const config = require('../config');

/**
 * Create axios instance for Python backend communication
 */
const pythonClient = axios.create({
    baseURL: config.pythonBackendUrl,
    timeout: 0, // No global timeout - per-route timeouts will control this
    headers: {
        'Content-Type': 'application/json',
    },
});

/**
 * Request interceptor for logging
 */
pythonClient.interceptors.request.use(
    (config) => {
        console.log(`[Python API] ${config.method.toUpperCase()} ${config.url}`);
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

/**
 * Response interceptor for error handling
 */
pythonClient.interceptors.response.use(
    (response) => {
        return response;
    },
    (error) => {
        if (error.response) {
            console.error(`[Python API Error] ${error.response.status}: ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            console.error('[Python API Error] No response received:', error.message);
        } else {
            console.error('[Python API Error]', error.message);
        }
        return Promise.reject(error);
    }
);

module.exports = pythonClient;
