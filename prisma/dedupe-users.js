const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

async function main() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: { billingPlan: true },
  });

  const groups = new Map();
  for (const user of users) {
    const normalizedEmail = normalizeEmail(user.email);
    const current = groups.get(normalizedEmail) || [];
    current.push(user);
    groups.set(normalizedEmail, current);
  }

  for (const [normalizedEmail, group] of groups.entries()) {
    const [primary, ...duplicates] = group;

    for (const duplicate of duplicates) {
      await prisma.$transaction([
        prisma.meeting.updateMany({ where: { ownerId: duplicate.id }, data: { ownerId: primary.id } }),
        prisma.participant.deleteMany({ where: { userId: duplicate.id } }),
        prisma.template.updateMany({ where: { ownerId: duplicate.id }, data: { ownerId: primary.id } }),
        prisma.notification.updateMany({ where: { userId: duplicate.id }, data: { userId: primary.id } }),
        prisma.invitation.updateMany({ where: { invitedBy: duplicate.id }, data: { invitedBy: primary.id } }),
        prisma.usageLog.updateMany({ where: { userId: duplicate.id }, data: { userId: primary.id } }),
        prisma.adminAuditLog.updateMany({ where: { actorId: duplicate.id }, data: { actorId: primary.id } }),
        prisma.plan.deleteMany({ where: { userId: duplicate.id } }),
        prisma.user.delete({ where: { id: duplicate.id } }),
      ]);
      console.log(`Merged duplicate ${duplicate.email} into ${primary.email}`);
    }

    await prisma.user.update({
      where: { id: primary.id },
      data: {
        email: normalizedEmail,
        normalizedEmail,
      },
    });
  }

  console.log('User email dedupe complete.');
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
