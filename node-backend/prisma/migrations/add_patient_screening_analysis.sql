-- Migration: Add patient_screening_analysis table
-- Stores comprehensive patient eligibility analysis data

CREATE TABLE IF NOT EXISTS patient_screening_analysis (
    id SERIAL PRIMARY KEY,
    trial_id INTEGER NOT NULL,
    patient_id VARCHAR(50) NOT NULL,
    organization_id INTEGER NOT NULL,
    
    -- Match Status
    eligibility_status VARCHAR(50) NOT NULL,
    confidence_score REAL NOT NULL,
    
    -- Patient Basic Info
    patient_age INTEGER,
    patient_gender VARCHAR(10),
    patient_birthdate TIMESTAMP,
    
    -- Criteria Counts
    criteria_met_count INTEGER,
    criteria_total_count INTEGER,
    exclusions_triggered INTEGER,
    hard_exclusions INTEGER,
    soft_exclusions INTEGER,
    
    -- Detailed Analysis Data
    analysis_reasons JSONB NOT NULL,
    patient_conditions JSONB,
    patient_observations JSONB,
    
    -- Metadata
    screened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(trial_id, patient_id, organization_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_patient_screening_trial_id ON patient_screening_analysis(trial_id);
CREATE INDEX IF NOT EXISTS idx_patient_screening_patient_id ON patient_screening_analysis(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_screening_org_id ON patient_screening_analysis(organization_id);
CREATE INDEX IF NOT EXISTS idx_patient_screening_status ON patient_screening_analysis(eligibility_status);
CREATE INDEX IF NOT EXISTS idx_patient_screening_screened_at ON patient_screening_analysis(screened_at);
