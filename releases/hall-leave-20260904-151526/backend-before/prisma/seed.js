import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../src/config/env.js";
const prisma = new PrismaClient();
async function main() {
    const passwordHash = await bcrypt.hash(env.DEV_ADMIN_PASSWORD, 10);
    await prisma.role.upsert({ where: { code: "DEV_ADMIN" }, update: {}, create: { code: "DEV_ADMIN", name: "开发管理员" } });
    await prisma.role.upsert({ where: { code: "HQ_ADMIN" }, update: {}, create: { code: "HQ_ADMIN", name: "公司总部" } });
    const org = await prisma.orgUnit.upsert({
        where: { orgCode: "QGCM001" },
        update: {},
        create: { orgCode: "QGCM001", orgType: "HQ", name: "公司总部", path: "/QGCM001", depth: 1 },
    });
    const user = await prisma.user.upsert({
        where: { phone: env.DEV_ADMIN_PHONE },
        update: { passwordHash },
        create: { phone: env.DEV_ADMIN_PHONE, nickname: "开发管理", passwordHash, mustChangePassword: true },
    });
    await prisma.userIdentity.upsert({
        where: { userId_roleCode_orgId_anchorProfileId: { userId: user.id, roleCode: "DEV_ADMIN", orgId: org.id, anchorProfileId: "" } },
        update: {},
        create: { userId: user.id, roleCode: "DEV_ADMIN", orgId: org.id, scopePath: org.path },
    }).catch(() => undefined);
}
main().finally(async () => prisma.$disconnect());
