-- Query to check what patient screening data is saved
-- Run this in your PostgreSQL database

-- 1. Check basic eligibility results
SELECT 
    patient_id,
    trial_id,
    eligibility_status,
    confidence_score,
    evaluation_date
FROM patient_eligibility
WHERE trial_id = 60  -- TRIAL_DNDI_E140
ORDER BY evaluation_date DESC
LIMIT 5;

-- 2. Check detailed audit records (with criteria breakdown)
SELECT 
    patient_id,
    trial_id,
    status,
    confidence,
    criteria_met,
    criteria_total,
    matched_at,
    details::text  -- Convert JSON to text for display
FROM eligibility_audits
WHERE trial_id = 60
ORDER BY matched_at DESC
LIMIT 5;

-- 3. Count how many patients have been screened
SELECT 
    COUNT(*) as total_screened,
    COUNT(DISTINCT patient_id) as unique_patients
FROM patient_eligibility
WHERE trial_id = 60;

-- 4. Get statistics by status
SELECT 
    eligibility_status,
    COUNT(*) as count,
    AVG(confidence_score) as avg_confidence
FROM patient_eligibility
WHERE trial_id = 60
GROUP BY eligibility_status;
