const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function setupPI() {
    try {
        console.log('🚀 Setting up PI Submission Workflow...\n');

        console.log('📊 Step 1: Creating principal_investigators table...');
        await prisma.$executeRaw`
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
            )`;

        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_pi_status ON principal_investigators(status)`;
        console.log('✅ principal_investigators table created');

        console.log('📊 Step 2: Creating trial_submissions table...');
        await prisma.$executeRaw`
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
            )`;

        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_submissions_trial ON trial_submissions(trial_id)`;
        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_submissions_pi ON trial_submissions(principal_investigator_id)`;
        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_submissions_status ON trial_submissions(status)`;
        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_submissions_date ON trial_submissions(submission_date)`;
        console.log('✅ trial_submissions table created');

        console.log('📊 Step 3: Creating submission_patients table...');
        await prisma.$executeRaw`
            CREATE TABLE IF NOT EXISTS submission_patients (
                id SERIAL PRIMARY KEY,
                submission_id INTEGER NOT NULL REFERENCES trial_submissions(id) ON DELETE CASCADE,
                patient_id VARCHAR(255) NOT NULL,
                patient_data JSONB,
                is_approved BOOLEAN,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                CONSTRAINT unique_submission_patient UNIQUE(submission_id, patient_id)
            )`;

        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_submission_patients_submission ON submission_patients(submission_id)`;
        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_submission_patients_patient ON submission_patients(patient_id)`;
        console.log('✅ submission_patients table created');

        console.log('📊 Step 4: Creating pi_reviews table...');
        await prisma.$executeRaw`
            CREATE TABLE IF NOT EXISTS pi_reviews (
                id SERIAL PRIMARY KEY,
                submission_id INTEGER NOT NULL REFERENCES trial_submissions(id) ON DELETE CASCADE,
                review_type VARCHAR(50) NOT NULL,
                patient_id VARCHAR(255),
                comment TEXT,
                decision VARCHAR(50),
                reviewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
            )`;

        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_pi_reviews_submission ON pi_reviews(submission_id)`;
        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_pi_reviews_type ON pi_reviews(review_type)`;
        await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_pi_reviews_date ON pi_reviews(reviewed_at)`;
        console.log('✅ pi_reviews table created');

        console.log('📊 Step 5: Creating triggers...');
        await prisma.$executeRaw`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql`;

        await prisma.$executeRaw`DROP TRIGGER IF EXISTS update_principal_investigators_updated_at ON principal_investigators`;
        await prisma.$executeRaw`
            CREATE TRIGGER update_principal_investigators_updated_at BEFORE UPDATE ON principal_investigators
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`;

        await prisma.$executeRaw`DROP TRIGGER IF EXISTS update_trial_submissions_updated_at ON trial_submissions`;
        await prisma.$executeRaw`
            CREATE TRIGGER update_trial_submissions_updated_at BEFORE UPDATE ON trial_submissions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`;

        await prisma.$executeRaw`DROP TRIGGER IF EXISTS update_submission_patients_updated_at ON submission_patients`;
        await prisma.$executeRaw`
            CREATE TRIGGER update_submission_patients_updated_at BEFORE UPDATE ON submission_patients
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`;
        console.log('✅ Triggers created');

        console.log('📊 Step 6: Updating users table...');
        try {
            await prisma.$executeRaw`ALTER TABLE users ALTER COLUMN organization_id DROP NOT NULL`;
            console.log('✅ Users table updated (organization_id now nullable)');
        } catch (e) {
            console.log('⚠️  Users table already configured');
        }

        console.log('\n✅ Database setup completed successfully!\n');
        console.log('Next step: Seed the database with PI accounts');
        console.log('Command: npx prisma db seed\n');

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        if (error.message.includes('already exists')) {
            console.log('\n⚠️  Tables already exist. This is normal if running setup again.');
            console.log('You can proceed to seed: npx prisma db seed\n');
        } else {
            console.log('\nError details:', error);
        }
    } finally {
        await prisma.$disconnect();
    }
}

setupPI();
