const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUsers() {
    try {
        const users = await prisma.$queryRaw`SELECT id, username, role, organization_id FROM users LIMIT 10`;
        console.log('Existing users:');
        console.table(users);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

checkUsers();
