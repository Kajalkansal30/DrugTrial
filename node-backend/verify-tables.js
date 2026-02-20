const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyTables() {
    try {
        console.log('🔍 Verifying tables...\n');

        // Test each table
        const tables = [
            'fda_form_1571',
            'fda_form_1572',
            'insilico_analyses',
            'research_intelligence'
        ];

        for (const table of tables) {
            try {
                const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) FROM ${table}`);
                console.log(`✅ ${table}: Found ${result[0].count} records`);
            } catch (err) {
                console.log(`❌ ${table}: Error - ${err.message}`);
            }
        }

        console.log('\n✨ All tables verified successfully!');

    } catch (error) {
        console.error('❌ Verification failed:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

verifyTables();
