import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const KEEP_PHONE = "15555353696";
const HQ_ORG_CODE = "QGCM001";
const HQ_NAME = "总公司";

async function main() {
  const keepUser = await prisma.user.findUnique({ where: { phone: KEEP_PHONE } });
  if (!keepUser) {
    throw new Error(`KEEP_USER_NOT_FOUND: ${KEEP_PHONE}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskItemAttachment.deleteMany();
    await tx.taskItemRecord.deleteMany();
    await tx.taskRecordIdentityLink.deleteMany();
    await tx.taskExemption.deleteMany();
    await tx.taskRecord.deleteMany();
    await tx.taskAssignmentExclusion.deleteMany();
    await tx.taskAssignmentTarget.deleteMany();
    await tx.taskAssignment.deleteMany();
    await tx.taskItemOption.deleteMany();
    await tx.taskItem.deleteMany();
    await tx.taskTemplateSnapshot.deleteMany();
    await tx.taskTemplate.deleteMany();
    await tx.personalReminder.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.anchorRegistrationApplication.deleteMany();
    await tx.anchorProfile.deleteMany();

    await tx.userIdentity.deleteMany({ where: { userId: { not: keepUser.id } } });
    await tx.user.deleteMany({ where: { id: { not: keepUser.id } } });

    await tx.userIdentity.deleteMany({ where: { userId: keepUser.id } });
    await tx.orgUnit.deleteMany();

    const hq = await tx.orgUnit.create({
      data: {
        orgCode: HQ_ORG_CODE,
        orgType: "HQ",
        name: HQ_NAME,
        parentId: null,
        path: `/${HQ_ORG_CODE}`,
        depth: 1,
        status: "active",
      },
    });

    const devIdentity = await tx.userIdentity.create({
      data: {
        userId: keepUser.id,
        roleCode: "DEV_ADMIN",
        orgId: hq.id,
        scopePath: hq.path,
        status: "active",
      },
    });

    await tx.user.update({
      where: { id: keepUser.id },
      data: { status: "active" },
    });

    process.stdout.write(JSON.stringify({
      keptUser: { id: keepUser.id, phone: keepUser.phone, nickname: keepUser.nickname },
      rebuiltHq: { id: hq.id, orgCode: hq.orgCode, name: hq.name, path: hq.path },
      rebuiltIdentity: { id: devIdentity.id, roleCode: devIdentity.roleCode },
    }, null, 2));
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
