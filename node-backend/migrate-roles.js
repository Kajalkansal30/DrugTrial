const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrateRoles() {
    try {
        console.log('🔄 Migrating user roles to new enum values...\n');

        // Update 'admin' to 'ORGANIZATION_ADMIN'
        const adminUpdates = await prisma.$executeRaw`
            UPDATE users SET role = 'ORGANIZATION_ADMIN' WHERE role = 'admin'
        `;
        console.log(`✅ Updated ${adminUpdates} admin users to ORGANIZATION_ADMIN`);

        // Update 'user' to 'ORGANIZATION_USER'  
        const userUpdates = await prisma.$executeRaw`
            UPDATE users SET role = 'ORGANIZATION_USER' WHERE role = 'user'
        `;
        console.log(`✅ Updated ${userUpdates} regular users to ORGANIZATION_USER`);

        console.log('\n✅ Role migration completed!\n');
        console.log('You can now run: npx prisma db seed\n');

    } catch (e) {
        console.error('❌ Migration failed:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

migrateRoles();
