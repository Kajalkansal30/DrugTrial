-- Simplified PI Submission Workflow Setup
-- Run this directly in PostgreSQL

-- 1. Update users table to support PI role (careful with existing data)
-- Skip enum creation if it fails - table might already exist  
DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role_temp TEXT;
    UPDATE users SET role_temp = role::TEXT;
    ALTER TABLE users DROP COLUMN IF EXISTS role CASCADE;
    ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'ORGANIZATION_USER';
    UPDATE users SET role = role_temp WHERE role_temp IS NOT NULL;
    ALTER TABLE users DROP COLUMN IF EXISTS role_temp;
    ALTER TABLE users ALTER COLUMN organization_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Users table update skipped or partially applied';
END $$;

-- 2. Create principal_investigators table
CREATE TABLE IF NOT EXISTS principal_investigators (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    license_number VARCHAR(255),
    specialization VARCHAR(255),
    institution VARCHAR(255),
    address VARCHAR(500),
    phone VARCHAR(50),
    email VARCHAR(255),
    bio TEXT,
    qualifications JSONB,
    status VARCHAR(50) DEFAULT 'active' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pi_status ON principal_investigators(status);

-- 3. Create trial_submissions table
CREATE TABLE IF NOT EXISTS trial_submissions (
    id SERIAL PRIMARY KEY,
    trial_id INTEGER NOT NULL REFERENCES clinical_trials(id) ON DELETE CASCADE,
    principal_investigator_id INTEGER NOT NULL REFERENCES principal_investigators(id) ON DELETE CASCADE,
    submitted_by_user_id INTEGER NOT NULL REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'SUBMITTED' NOT NULL,
    submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reviewed_at TIMESTAMP,
    notes TEXT,
    report_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_trial ON trial_submissions(trial_id);
CREATE INDEX IF NOT EXISTS idx_submissions_pi ON trial_submissions(principal_investigator_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON trial_submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_date ON trial_submissions(submission_date);

-- 4. Create submission_patients table
CREATE TABLE IF NOT EXISTS submission_patients (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES trial_submissions(id) ON DELETE CASCADE,
    patient_id VARCHAR(255) NOT NULL,
    patient_data JSONB,
    is_approved BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_submission_patient UNIQUE(submission_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_submission_patients_submission ON submission_patients(submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_patients_patient ON submission_patients(patient_id);

-- 5. Create pi_reviews table
CREATE TABLE IF NOT EXISTS pi_reviews (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES trial_submissions(id) ON DELETE CASCADE,
    review_type VARCHAR(50) NOT NULL,
    patient_id VARCHAR(255),
    comment TEXT,
    decision VARCHAR(50),
    reviewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pi_reviews_submission ON pi_reviews(submission_id);
CREATE INDEX IF NOT EXISTS idx_pi_reviews_type ON pi_reviews(review_type);
CREATE INDEX IF NOT EXISTS idx_pi_reviews_date ON pi_reviews(reviewed_at);

-- 6. Create or replace update trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create triggers
DROP TRIGGER IF EXISTS update_principal_investigators_updated_at ON principal_investigators;
CREATE TRIGGER update_principal_investigators_updated_at BEFORE UPDATE ON principal_investigators
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_trial_submissions_updated_at ON trial_submissions;
CREATE TRIGGER update_trial_submissions_updated_at BEFORE UPDATE ON trial_submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_submission_patients_updated_at ON submission_patients;
CREATE TRIGGER update_submission_patients_updated_at BEFORE UPDATE ON submission_patients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Done!
SELECT 'PI Submission Workflow tables created successfully!' AS result;
