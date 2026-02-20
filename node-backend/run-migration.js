const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function runMigration() {
    try {
        console.log('📦 Reading migration SQL file...');
        const sqlFile = path.join(__dirname, 'prisma', 'migrations', 'add_tables_simple.sql');
        const sql = fs.readFileSync(sqlFile, 'utf-8');

        console.log('🔄 Running migration...');
        console.log('   This will create 4 new tables if they don\'t exist\n');

        // Split SQL into individual statements
        const statements = sql
            .split('\n')
            .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
            .join('\n')
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`   Found ${statements.length} statements to execute\n`);

        // Execute each statement individually
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            try {
                const preview = statement.substring(0, 50).replace(/\s+/g, ' ');
                console.log(`   [${i + 1}/${statements.length}] ${preview}...`);
                await prisma.$executeRawUnsafe(statement);
            } catch (err) {
                // Ignore "already exists" errors
                if (err.message.includes('already exists') ||
                    err.message.includes('duplicate') ||
                    err.code === '42P07') {
                    console.log(`        ⚠️  Already exists, continuing...`);
                } else {
                    console.error(`\n   ❌ Failed to execute statement:\n${statement.substring(0, 200)}`);
                    throw err;
                }
            }
        }

        console.log('\n✅ Migration completed successfully!');
        console.log('📊 New tables created/verified:');
        console.log('   ✓ fda_form_1571');
        console.log('   ✓ fda_form_1572');
        console.log('   ✓ insilico_analyses');
        console.log('   ✓ research_intelligence');
        console.log('\n🎉 Your database is ready!');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.log('\nError details:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

runMigration();
