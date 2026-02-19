/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Handle Axios errors from Python backend
    if (err.response) {
        return res.status(err.response.status).json({
            error: err.response.data.detail || err.response.data.error || 'Error from backend service',
            details: err.response.data
        });
    }

    // Handle request timeout
    if (err.code === 'ECONNABORTED') {
        return res.status(504).json({
            error: 'Request timeout',
            message: 'The backend service took too long to respond'
        });
    }

    // Handle network errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        return res.status(503).json({
            error: 'Service unavailable',
            message: 'Unable to connect to backend service'
        });
    }

    // Handle validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation error',
            details: err.message
        });
    }

    // Default error response
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

/**
 * 404 handler
 */
const notFoundHandler = (req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Route ${req.method} ${req.url} not found`
    });
};

module.exports = {
    errorHandler,
    notFoundHandler
};
