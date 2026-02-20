const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createStatusEnum() {
    try {
        console.log('🔄 Creating SubmissionStatus enum type...\n');

        // Create the SubmissionStatus enum
        await prisma.$executeRaw`
            CREATE TYPE "SubmissionStatus" AS ENUM (
                'SUBMITTED',
                'UNDER_REVIEW',
                'APPROVED',
                'PARTIALLY_APPROVED',
                'REJECTED',
                'WITHDRAWN'
            )
        `;
        console.log('✅ SubmissionStatus enum type created');

        // Alter trial_submissions table to use the enum type
        console.log('🔄 Updating trial_submissions table to use enum type...');

        // Add a temp column with the enum type
        await prisma.$executeRaw`ALTER TABLE trial_submissions ADD COLUMN status_new "SubmissionStatus"`;

        // Copy values from old column to new column
        await prisma.$executeRaw`UPDATE trial_submissions SET status_new = status::"SubmissionStatus"`;

        // Drop old column
        await prisma.$executeRaw`ALTER TABLE trial_submissions DROP COLUMN status`;

        // Rename new column to status
        await prisma.$executeRaw`ALTER TABLE trial_submissions RENAME COLUMN status_new TO status`;

        // Set default and not null
        await prisma.$executeRaw`ALTER TABLE trial_submissions ALTER COLUMN status SET DEFAULT 'SUBMITTED'::"SubmissionStatus"`;
        await prisma.$executeRaw`ALTER TABLE trial_submissions ALTER COLUMN status SET NOT NULL`;

        console.log('✅ trial_submissions table updated to use SubmissionStatus enum\n');
        console.log('✅ Setup complete! Server should work now.\n');

    } catch (e) {
        console.error('❌ Error:', e.message);
        if (e.message.includes('already exists')) {
            console.log('\n⚠️  Enum already exists. This is normal if running setup again.\n');
        }
    } finally {
        await prisma.$disconnect();
    }
}

createStatusEnum();
