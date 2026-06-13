import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const DEV_ADMIN_PHONE = process.env.DEV_ADMIN_PHONE ?? "15555353696";
const DEV_ADMIN_PASSWORD = process.env.DEV_ADMIN_PASSWORD ?? "Admin@123456";

const roles = [
  ["DEV_ADMIN", "开发管理员"],
  ["HQ_ADMIN", "总部管理员"],
  ["BASE_ADMIN", "基地管理员"],
  ["TEAM_ADMIN", "团队管理员"],
  ["HALL_MANAGER", "厅管理"],
  ["ANCHOR", "主播"],
];

const permissions = [
  ["*", "全部权限", "system"],
  ["org:view", "查看组织", "organization"],
  ["org:create", "创建组织", "organization"],
  ["org:update", "更新组织", "organization"],
  ["org:pause", "暂停组织", "organization"],
  ["org:restore", "恢复组织", "organization"],
  ["account:view", "查看账号", "account"],
  ["account:create", "创建账号", "account"],
  ["identity:grant", "授权身份", "identity"],
  ["anchor:view", "查看主播", "anchor"],
  ["anchor:profile:create", "创建主播档案", "anchor"],
  ["anchor:profile:bind", "绑定主播档案", "anchor"],
  ["anchor:registration:review", "审核主播注册", "anchor"],
  ["audit:view", "查看审计", "audit"],
];

const rolePermissions = {
  DEV_ADMIN: ["*"],
  HQ_ADMIN: ["org:view", "org:create", "org:update", "org:pause", "org:restore", "account:view", "account:create", "identity:grant", "anchor:view", "anchor:profile:create", "anchor:profile:bind", "anchor:registration:review", "audit:view"],
  BASE_ADMIN: ["org:view", "org:create", "org:update", "account:view", "account:create", "identity:grant", "anchor:view", "anchor:profile:create", "anchor:profile:bind", "anchor:registration:review"],
  TEAM_ADMIN: ["org:view", "anchor:view"],
  HALL_MANAGER: ["org:view", "anchor:view", "anchor:registration:review"],
  ANCHOR: [],
};

async function main() {
  await prisma.anchorRegistrationApplication.deleteMany();
  await prisma.userIdentity.deleteMany();
  await prisma.anchorProfile.deleteMany();
  await prisma.user.deleteMany({ where: { phone: { not: DEV_ADMIN_PHONE } } });
  await prisma.orgUnit.deleteMany({ where: { orgCode: { not: "QGCM001" } } });
  await prisma.auditLog.deleteMany();

  for (const [code, name] of roles) {
    await prisma.role.upsert({ where: { code }, update: { name }, create: { code, name } });
  }

  for (const [code, name, module] of permissions) {
    await prisma.permission.upsert({ where: { code }, update: { name, module }, create: { code, name, module } });
  }

  for (const [roleCode, permissionCodes] of Object.entries(rolePermissions)) {
    for (const permissionCode of permissionCodes) {
      await prisma.rolePermission.upsert({
        where: { roleCode_permissionCode: { roleCode, permissionCode } },
        update: {},
        create: { roleCode, permissionCode },
      });
    }
  }

  const hq = await prisma.orgUnit.upsert({
    where: { orgCode: "QGCM001" },
    update: { orgType: "HQ", name: "公司总部", path: "/QGCM001", depth: 1, principalName: "总部负责人", status: "active" },
    create: { orgCode: "QGCM001", orgType: "HQ", name: "公司总部", path: "/QGCM001", depth: 1, principalName: "总部负责人", status: "active" },
  });

  const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { phone: DEV_ADMIN_PHONE },
    update: { nickname: "开发管理", passwordHash, status: "active", mustChangePassword: false },
    create: { phone: DEV_ADMIN_PHONE, nickname: "开发管理", passwordHash, status: "active", mustChangePassword: false },
  });

  await prisma.userIdentity.upsert({
    where: { userId_roleCode_orgId_anchorProfileId: { userId: user.id, roleCode: "DEV_ADMIN", orgId: hq.id, anchorProfileId: "" } },
    update: { scopePath: hq.path, status: "active", expiredAt: null },
    create: { userId: user.id, roleCode: "DEV_ADMIN", orgId: hq.id, scopePath: hq.path, status: "active" },
  });

  console.log(`Seed completed. Only HQ and admin ${DEV_ADMIN_PHONE} were preserved.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
