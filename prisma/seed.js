const { PrismaClient, UserRole, UserStatus, OrgRole, PlanType, PlanStatus, BillingCycle } = require('@prisma/client');

const prisma = new PrismaClient();

const FIRST_ADMIN_EMAIL = 'chulocr8v@gmail.com';

function displayNameFromEmail(email) {
  return email.split('@')[0];
}

function avatarFor(email) {
  const backgrounds = ['fdf2f8', 'eef2ff', 'ecfeff', 'fef3c7', 'dcfce7'];
  return `https://api.dicebear.com/7.x/lorelei/svg?seed=${encodeURIComponent(email)}&backgroundColor=${backgrounds.join(',')}`;
}

async function main() {
  const email = FIRST_ADMIN_EMAIL.trim().toLowerCase();

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      role: UserRole.SUPERADMIN,
      orgRole: OrgRole.OWNER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      normalizedEmail: email,
    },
    create: {
      email,
      normalizedEmail: email,
      displayName: displayNameFromEmail(email),
      photoUrl: avatarFor(email),
      role: UserRole.SUPERADMIN,
      orgRole: OrgRole.OWNER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  await prisma.plan.upsert({
    where: { userId: admin.id },
    update: {
      adminUserId: admin.id,
      status: PlanStatus.active,
    },
    create: {
      userId: admin.id,
      adminUserId: admin.id,
      type: PlanType.Free,
      status: PlanStatus.active,
      billingCycle: BillingCycle.monthly,
    },
  });

  console.log(`Seeded first admin: ${email}`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
