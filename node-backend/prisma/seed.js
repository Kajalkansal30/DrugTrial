const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    // Create Organizations
    const veersaLabs = await prisma.organization.upsert({
        where: { name: 'Veersa Labs' },
        update: {},
        create: {
            name: 'Veersa Labs',
            domain: 'veersalabs.com',
            status: 'active'
        }
    });

    const dndiResearch = await prisma.organization.upsert({
        where: { name: 'DNDi Research' },
        update: {},
        create: {
            name: 'DNDi Research',
            domain: 'dndi.org',
            status: 'active'
        }
    });

    const clintechPharma = await prisma.organization.upsert({
        where: { name: 'ClinTech Pharma' },
        update: {},
        create: {
            name: 'ClinTech Pharma',
            domain: 'clintech.com',
            status: 'active'
        }
    });

    console.log('✅ Organizations created');

    // Hash password (same for all demo users)
    const passwordHash = await bcrypt.hash('password123', 10);

    // Create Users
    await prisma.user.upsert({
        where: { username: 'admin@veersa' },
        update: {},
        create: {
            username: 'admin@veersa',
            passwordHash,
            email: 'admin@veersalabs.com',
            fullName: 'Veersa Admin',
            organizationId: veersaLabs.id,
            role: 'admin',
            status: 'active'
        }
    });

    await prisma.user.upsert({
        where: { username: 'user@veersa' },
        update: {},
        create: {
            username: 'user@veersa',
            passwordHash,
            email: 'user@veersalabs.com',
            fullName: 'Veersa User',
            organizationId: veersaLabs.id,
            role: 'user',
            status: 'active'
        }
    });

    await prisma.user.upsert({
        where: { username: 'admin@dndi' },
        update: {},
        create: {
            username: 'admin@dndi',
            passwordHash,
            email: 'admin@dndi.org',
            fullName: 'DNDi Admin',
            organizationId: dndiResearch.id,
            role: 'admin',
            status: 'active'
        }
    });

    await prisma.user.upsert({
        where: { username: 'user@clintech' },
        update: {},
        create: {
            username: 'user@clintech',
            passwordHash,
            email: 'user@clintech.com',
            fullName: 'ClinTech User',
            organizationId: clintechPharma.id,
            role: 'user',
            status: 'active'
        }
    });

    console.log('✅ Users created');
    console.log('');
    console.log('📝 Default Credentials:');
    console.log('   Username: admin@veersa | Password: password123');
    console.log('   Username: user@veersa  | Password: password123');
    console.log('   Username: admin@dndi   | Password: password123');
    console.log('   Username: user@clintech | Password: password123');
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
