-- Phase 4: Operational Features

-- 1. Add matching_config to clinical_trials
ALTER TABLE clinical_trials
ADD COLUMN IF NOT EXISTS matching_config JSON;

-- 2. Create eligibility_audits table
CREATE TABLE IF NOT EXISTS eligibility_audits (
    id SERIAL PRIMARY KEY,
    trial_id INTEGER REFERENCES clinical_trials(id),
    patient_id VARCHAR(10) REFERENCES patients(id),
    matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50), -- ELIGIBLE, INELIGIBLE, UNCERTAIN
    confidence FLOAT,
    criteria_met INTEGER,
    criteria_total INTEGER,
    details JSON -- Stores breakdown of mismatched criteria
);

CREATE INDEX IF NOT EXISTS ix_eligibility_audits_trial_patient ON eligibility_audits(trial_id, patient_id);

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'clinical_trials' AND column_name = 'matching_config';

SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'eligibility_audits';
