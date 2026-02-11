/**
 * Error Handler Middleware
 * Catches and formats errors from the Python backend
 */

const errorHandler = (err, req, res, next) => {
    console.error('Error occurred:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method
    });

    // If error is from axios (proxy error)
    if (err.response) {
        // Python backend returned an error
        return res.status(err.response.status).json({
            error: err.response.data?.detail || err.response.data?.error || err.message,
            status: err.response.status,
            data: err.response.data
        });
    }

    // If error is a connection error
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        return res.status(503).json({
            error: 'Python backend is unavailable',
            message: 'Cannot connect to the Python backend service',
            code: err.code
        });
    }

    // Generic error
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        status: err.status || 500
    });
};

module.exports = errorHandler;
