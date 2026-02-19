/**
 * API Configuration
 * Centralized configuration for API endpoints
 */

// Get the base API URL from environment variable or use default
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// API Endpoints
export const API_ENDPOINTS = {
    // Root
    root: '/',
    health: '/api/health',
    stats: '/api/stats',

    // Patients
    patients: '/api/patients',
    patientDetail: (patientId) => `/api/patients/${patientId}`,

    // Trials
    trials: '/api/trials',
    trialUpload: '/api/trials/upload',
    trialRules: (trialId) => `/api/trials/${trialId}/rules`,
    trialGlossary: (trialId) => `/api/trials/${trialId}/glossary`,
    trialApproveForms: (trialId) => `/api/trials/${trialId}/approve-forms`,
    trialDelete: (trialId) => `/api/trials/${trialId}`,

    // Eligibility
    eligibilityCheck: '/api/eligibility/check',
    eligibilityBatchCheck: '/api/eligibility/batch-check',

    // FDA
    fdaUpload: '/api/fda/upload',
    fdaDocuments: '/api/fda/documents',
    fdaForms: (documentId) => `/api/fda/forms/${documentId}`,
    fdaFormsUpdate: (documentId) => `/api/fda/forms/${documentId}`,
    fdaFormsReview: (documentId) => `/api/fda/forms/${documentId}/review`,
    fdaFormsSign: (documentId) => `/api/fda/forms/${documentId}/sign`,
    fdaDocumentDelete: (documentId) => `/api/fda/documents/${documentId}`,
    fdaTestCriteria: '/api/fda/test-criteria',
    fdaCreateTrial: (documentId) => `/api/fda/documents/${documentId}/create-trial`,

    // LTAA (Literature Analysis)
    ltaaAnalyze: '/api/ltaa/analyze',
    ltaaReport: (disease) => `/api/ltaa/report/${encodeURIComponent(disease)}`,

    // In-Silico Analysis
    insilicoAnalyzeText: '/api/insilico/analyze/text',
    insilicoResults: (trialId) => `/api/insilico/results/${trialId}`,
    insilicoDrug: (name) => `/api/insilico/drug/${encodeURIComponent(name)}`,

    // Privacy
    privacySummary: '/api/privacy/summary',
    privacyVerifySamples: '/api/privacy/verify-samples',

    // Audit
    auditLogs: '/api/audit/logs',
    auditVerifyIntegrity: '/api/audit/verify-integrity',

    // Chat
    chat: '/api/chat',
};

/**
 * Build full URL for an endpoint
 * @param {string} endpoint - The endpoint path
 * @returns {string} Full URL
 */
export const buildUrl = (endpoint) => {
    return `${API_BASE_URL}${endpoint}`;
};

export default {
    API_BASE_URL,
    API_ENDPOINTS,
    buildUrl,
};
