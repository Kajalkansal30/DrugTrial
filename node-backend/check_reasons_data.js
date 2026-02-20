// Quick script to check what's in the database
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkReasonsData() {
    try {
        console.log('🔍 Checking patient analysis data in database...\n');

        // Get a sample record
        const sample = await prisma.patientScreeningAnalysis.findFirst({
            orderBy: { screenedAt: 'desc' }
        });

        if (!sample) {
            console.log('❌ No patient analyses found in database');
            return;
        }

        console.log('📊 Sample Record:');
        console.log('Patient ID:', sample.patientId);
        console.log('Trial ID:', sample.trialId);
        console.log('Eligibility Status:', sample.eligibilityStatus);
        console.log('\n📝 Analysis Reasons (JSONB field):');
        console.log('Type:', typeof sample.analysisReasons);
        console.log('Keys:', Object.keys(sample.analysisReasons || {}));
        console.log('\n📋 Inclusion Details:');
        console.log('Has inclusion_details?', !!sample.analysisReasons?.inclusion_details);
        console.log('Length:', sample.analysisReasons?.inclusion_details?.length || 0);
        if (sample.analysisReasons?.inclusion_details) {
            console.log('First 3 items:', sample.analysisReasons.inclusion_details.slice(0, 3));
        }
        console.log('\n📋 Exclusion Details:');
        console.log('Has exclusion_details?', !!sample.analysisReasons?.exclusion_details);
        console.log('Length:', sample.analysisReasons?.exclusion_details?.length || 0);
        if (sample.analysisReasons?.exclusion_details) {
            console.log('First 3 items:', sample.analysisReasons.exclusion_details.slice(0, 3));
        }

        console.log('\n📦 Full analysisReasons object:');
        console.log(JSON.stringify(sample.analysisReasons, null, 2));

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkReasonsData();
