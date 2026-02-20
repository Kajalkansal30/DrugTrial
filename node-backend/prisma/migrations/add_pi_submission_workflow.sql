-- Migration: Add Principal Investigator Submission Workflow
-- Date: 2026-02-19
-- Description: Add PI models, submission workflow, and update user roles

-- 1. Create enum for user roles (if not exists)
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('ORGANIZATION_ADMIN', 'ORGANIZATION_USER', 'PRINCIPAL_INVESTIGATOR', 'SYSTEM_ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Update users table to use enum and allow null organization_id
ALTER TABLE users 
    ALTER COLUMN organization_id DROP NOT NULL,
    ALTER COLUMN role TYPE "UserRole" USING role::"UserRole";

-- Set default role for existing users if needed
UPDATE users 
SET role = 'ORGANIZATION_USER'::"UserRole" 
WHERE role::text NOT IN ('ORGANIZATION_ADMIN', 'ORGANIZATION_USER', 'PRINCIPAL_INVESTIGATOR', 'SYSTEM_ADMIN');

-- Add index on role
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 3. Create principal_investigators table
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

-- 4. Create enum for submission status
DO $$ BEGIN
    CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'WITHDRAWN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 5. Create trial_submissions table
CREATE TABLE IF NOT EXISTS trial_submissions (
    id SERIAL PRIMARY KEY,
    trial_id INTEGER NOT NULL REFERENCES clinical_trials(id) ON DELETE CASCADE,
    principal_investigator_id INTEGER NOT NULL REFERENCES principal_investigators(id) ON DELETE CASCADE,
    submitted_by_user_id INTEGER NOT NULL REFERENCES users(id),
    status "SubmissionStatus" DEFAULT 'SUBMITTED' NOT NULL,
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

-- 6. Create submission_patients table
CREATE TABLE IF NOT EXISTS submission_patients (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES trial_submissions(id) ON DELETE CASCADE,
    patient_id VARCHAR(255) NOT NULL,
    patient_data JSONB,
    is_approved BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(submission_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_submission_patients_submission ON submission_patients(submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_patients_patient ON submission_patients(patient_id);

-- 7. Create enum for review type
DO $$ BEGIN
    CREATE TYPE "ReviewType" AS ENUM ('PATIENT_APPROVAL', 'PATIENT_REJECTION', 'DOCUMENT_APPROVAL', 'GENERAL_COMMENT', 'REQUEST_INFO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 8. Create pi_reviews table
CREATE TABLE IF NOT EXISTS pi_reviews (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES trial_submissions(id) ON DELETE CASCADE,
    review_type "ReviewType" NOT NULL,
    patient_id VARCHAR(255),
    comment TEXT,
    decision VARCHAR(50),
    reviewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pi_reviews_submission ON pi_reviews(submission_id);
CREATE INDEX IF NOT EXISTS idx_pi_reviews_type ON pi_reviews(review_type);
CREATE INDEX IF NOT EXISTS idx_pi_reviews_date ON pi_reviews(reviewed_at);

-- 9. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 10. Create triggers for updated_at
CREATE TRIGGER update_principal_investigators_updated_at BEFORE UPDATE ON principal_investigators
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trial_submissions_updated_at BEFORE UPDATE ON trial_submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_submission_patients_updated_at BEFORE UPDATE ON submission_patients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 11. Add audit log entries for migration
INSERT INTO audit_trail (action, target_type, agent, status, details)
VALUES (
    'SCHEMA_MIGRATION',
    'database',
    'system',
    'success',
    '{"migration": "add_pi_submission_workflow", "date": "2026-02-19", "description": "Added Principal Investigator submission workflow tables and enums"}'::jsonb
);

-- Migration completed successfully
SELECT 'Migration completed: PI Submission Workflow' AS result;
