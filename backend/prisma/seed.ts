import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../src/config/env.js";
import { syncRolePermissions } from "../src/shared/sync-role-permissions.js";

const prisma = new PrismaClient();

async function main() {
  await prisma.anchorRegistrationApplication.deleteMany();
  await prisma.userIdentity.deleteMany();
  await prisma.anchorProfile.deleteMany();
  await prisma.user.deleteMany({ where: { phone: { not: env.DEV_ADMIN_PHONE } } });
  await prisma.orgUnit.deleteMany({ where: { orgCode: { not: "QGCM001" } } });
  await prisma.auditLog.deleteMany();

  await syncRolePermissions();

  const hq = await prisma.orgUnit.upsert({
    where: { orgCode: "QGCM001" },
    update: { orgType: "HQ", name: "公司总部", path: "/QGCM001", depth: 1, principalName: "总部负责人", status: "active" },
    create: { orgCode: "QGCM001", orgType: "HQ", name: "公司总部", path: "/QGCM001", depth: 1, principalName: "总部负责人", status: "active" },
  });

  const passwordHash = await bcrypt.hash(env.DEV_ADMIN_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { phone: env.DEV_ADMIN_PHONE },
    update: { passwordHash, nickname: "开发管理", status: "active", mustChangePassword: false },
    create: { phone: env.DEV_ADMIN_PHONE, nickname: "开发管理", passwordHash, status: "active", mustChangePassword: false },
  });

  await prisma.userIdentity.upsert({
    where: { userId_roleCode_orgId_anchorProfileId: { userId: user.id, roleCode: "DEV_ADMIN", orgId: hq.id, anchorProfileId: "" } },
    update: { scopePath: hq.path, status: "active", expiredAt: null },
    create: { userId: user.id, roleCode: "DEV_ADMIN", orgId: hq.id, scopePath: hq.path, status: "active" },
  });

  console.log(`Seed completed. Only HQ and admin ${env.DEV_ADMIN_PHONE} were preserved.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
