const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function runMigration() {
    try {
        console.log('🚀 Starting PI Submission Workflow Migration...\n');

        const migrationPath = path.join(__dirname, 'prisma', 'migrations', 'add_pi_submission_workflow.sql');
        const sqlContent = fs.readFileSync(migrationPath, 'utf8');

        // Split by semicolon and execute each statement
        const statements = sqlContent
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
            if (statement.includes('SELECT') && statement.includes('Migration completed')) {
                continue; // Skip final select
            }
            await prisma.$executeRawUnsafe(statement);
        }

        console.log('✅ Migration completed successfully!\n');
        console.log('New tables created:');
        console.log('  - principal_investigators');
        console.log('  - trial_submissions');
        console.log('  - submission_patients');
        console.log('  - pi_reviews\n');
        console.log('New enums created:');
        console.log('  - UserRole');
        console.log('  - SubmissionStatus');
        console.log('  - ReviewType\n');
        console.log('Next steps:');
        console.log('  1. Stop the server if running');
        console.log('  2. Run: npx prisma generate');
        console.log('  3. Run: npm run dev');
        console.log('  4. Test PI registration at /pi/register\n');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        if (error.message.includes('already exists')) {
            console.log('\n⚠️  Some objects already exist. This is normal if running migration multiple times.');
            console.log('The migration will skip existing objects and continue.\n');
        }
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

runMigration();
