const morgan = require('morgan');
const config = require('../config');

/**
 * Custom logging format
 */
const customFormat = ':method :url :status :res[content-length] - :response-time ms';

/**
 * Create logger based on environment
 */
const logger = config.nodeEnv === 'production'
    ? morgan('combined')
    : morgan(customFormat);

module.exports = logger;
