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
            role: 'ORGANIZATION_ADMIN',
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
            role: 'ORGANIZATION_USER',
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
            role: 'ORGANIZATION_ADMIN',
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
            role: 'ORGANIZATION_USER',
            status: 'active'
        }
    });

    console.log('✅ Users created');

    // Create Principal Investigators
    const piSmith = await prisma.user.upsert({
        where: { username: 'pi_dr_smith' },
        update: {},
        create: {
            username: 'pi_dr_smith',
            passwordHash,
            email: 'john.smith@cityhospital.com',
            fullName: 'Dr. John Smith',
            role: 'PRINCIPAL_INVESTIGATOR',
            status: 'active'
        }
    });

    await prisma.principalInvestigator.upsert({
        where: { userId: piSmith.id },
        update: {},
        create: {
            userId: piSmith.id,
            licenseNumber: 'MD-123456',
            specialization: 'Oncology',
            institution: 'City General Hospital',
            address: '123 Medical Center Dr, New York, NY 10001',
            phone: '+1-212-555-0101',
            email: 'john.smith@cityhospital.com',
            bio: 'Board-certified oncologist with 15 years of experience in clinical trials. Specialized in early-phase cancer drug studies.',
            qualifications: {
                degrees: ['MD', 'PhD'],
                certifications: ['Board Certified Oncology', 'GCP Certified'],
                yearsExperience: 15
            },
            status: 'active'
        }
    });

    const piJones = await prisma.user.upsert({
        where: { username: 'pi_dr_jones' },
        update: {},
        create: {
            username: 'pi_dr_jones',
            passwordHash,
            email: 'sarah.jones@researchinstitute.org',
            fullName: 'Dr. Sarah Jones',
            role: 'PRINCIPAL_INVESTIGATOR',
            status: 'active'
        }
    });

    await prisma.principalInvestigator.upsert({
        where: { userId: piJones.id },
        update: {},
        create: {
            userId: piJones.id,
            licenseNumber: 'MD-789012',
            specialization: 'Infectious Diseases',
            institution: 'National Research Institute',
            address: '456 Research Blvd, Boston, MA 02115',
            phone: '+1-617-555-0202',
            email: 'sarah.jones@researchinstitute.org',
            bio: 'Infectious disease specialist focusing on tropical diseases and vaccine trials. Lead investigator for multiple international studies.',
            qualifications: {
                degrees: ['MD', 'MPH'],
                certifications: ['Board Certified Infectious Disease', 'Clinical Research Certified'],
                yearsExperience: 12
            },
            status: 'active'
        }
    });

    const piWilliams = await prisma.user.upsert({
        where: { username: 'pi_dr_williams' },
        update: {},
        create: {
            username: 'pi_dr_williams',
            passwordHash,
            email: 'michael.williams@universitymed.edu',
            fullName: 'Dr. Michael Williams',
            role: 'PRINCIPAL_INVESTIGATOR',
            status: 'active'
        }
    });

    await prisma.principalInvestigator.upsert({
        where: { userId: piWilliams.id },
        update: {},
        create: {
            userId: piWilliams.id,
            licenseNumber: 'MD-345678',
            specialization: 'Cardiology',
            institution: 'University Medical Center',
            address: '789 Academic Way, San Francisco, CA 94143',
            phone: '+1-415-555-0303',
            email: 'michael.williams@universitymed.edu',
            bio: 'Cardiologist and clinical researcher with expertise in cardiovascular drug trials and device studies. Professor of Medicine.',
            qualifications: {
                degrees: ['MD', 'FACC'],
                certifications: ['Board Certified Cardiology', 'Advanced Heart Failure Specialist'],
                yearsExperience: 18
            },
            status: 'active'
        }
    });

    console.log('✅ Principal Investigators created');
    console.log('');
    console.log('✅ Principal Investigators created');
    console.log('');
    console.log('📝 Default Credentials:');
    console.log('   Organization Users:');
    console.log('   - Username: admin@veersa   | Password: password123');
    console.log('   - Username: user@veersa    | Password: password123');
    console.log('   - Username: admin@dndi     | Password: password123');
    console.log('   - Username: user@clintech  | Password: password123');
    console.log('');
    console.log('   Principal Investigators:');
    console.log('   - Username: pi_dr_smith    | Password: password123 | Dr. John Smith (Oncology)');
    console.log('   - Username: pi_dr_jones    | Password: password123 | Dr. Sarah Jones (Infectious Diseases)');
    console.log('   - Username: pi_dr_williams | Password: password123 | Dr. Michael Williams (Cardiology)');
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
