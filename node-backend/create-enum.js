const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createUserRoleEnum() {
    try {
        console.log('🔄 Creating UserRole enum type...\n');

        // Drop existing enum if it exists (to handle any conflicts)
        try {
            await prisma.$executeRaw`DROP TYPE IF EXISTS "UserRole" CASCADE`;
        } catch (e) {
            console.log('Note: UserRole enum did not exist');
        }

        // Create the UserRole enum
        await prisma.$executeRaw`
            CREATE TYPE "UserRole" AS ENUM (
                'ORGANIZATION_ADMIN',
                'ORGANIZATION_USER',
                'PRINCIPAL_INVESTIGATOR',
                'SYSTEM_ADMIN'
            )
        `;
        console.log('✅ UserRole enum type created');

        // Alter the users table to use the enum type
        console.log('🔄 Updating users table to use enum type...');

        // First, add a temp column with the enum type
        await prisma.$executeRaw`ALTER TABLE users ADD COLUMN role_new "UserRole"`;

        // Copy values from old column to new column
        await prisma.$executeRaw`UPDATE users SET role_new = role::"UserRole"`;

        // Drop old column
        await prisma.$executeRaw`ALTER TABLE users DROP COLUMN role`;

        // Rename new column to role
        await prisma.$executeRaw`ALTER TABLE users RENAME COLUMN role_new TO role`;

        // Set default and not null
        await prisma.$executeRaw`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'ORGANIZATION_USER'::"UserRole"`;
        await prisma.$executeRaw`ALTER TABLE users ALTER COLUMN role SET NOT NULL`;

        console.log('✅ Users table updated to use UserRole enum\n');
        console.log('You can now run: npx prisma db seed\n');

    } catch (e) {
        console.error('❌ Error:', e.message);
        console.log('\nIf error says enum already exists, you can proceed to seed.\n');
    } finally {
        await prisma.$disconnect();
    }
}

createUserRoleEnum();
