import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const KEEP_PHONE = "15555353696";

async function main() {
  const managementIdentityUserIds = await prisma.userIdentity.findMany({
    where: {
      roleCode: { not: "ANCHOR" },
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  const keepUserIds = new Set(managementIdentityUserIds.map((item) => item.userId));
  const keepPhoneUser = await prisma.user.findUnique({ where: { phone: KEEP_PHONE }, select: { id: true } });
  if (keepPhoneUser?.id) keepUserIds.add(keepPhoneUser.id);

  const keepUserIdList = Array.from(keepUserIds);

  const managementOnlyIdentityIds = await prisma.userIdentity.findMany({
    where: {
      roleCode: { not: "ANCHOR" },
      userId: { in: keepUserIdList },
    },
    select: { id: true },
  }).then((rows) => rows.map((row) => row.id));

  const anchorOnlyUserIds = await prisma.user.findMany({
    where: {
      ...(keepUserIdList.length ? { id: { notIn: keepUserIdList } } : {}),
    },
    select: { id: true },
  }).then((rows) => rows.map((row) => row.id));

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
    await tx.userIdentity.deleteMany({ where: { roleCode: "ANCHOR" } });
    await tx.userIdentity.deleteMany({
      where: {
        ...(managementOnlyIdentityIds.length ? { id: { notIn: managementOnlyIdentityIds } } : {}),
      },
    });
    await tx.anchorProfile.deleteMany();

    if (anchorOnlyUserIds.length) {
      await tx.user.deleteMany({ where: { id: { in: anchorOnlyUserIds } } });
    }

    await tx.orgUnit.deleteMany();
  });

  const summary = {
    keptPhone: KEEP_PHONE,
    keptUserIds: keepUserIdList,
    deletedAnchorOrNonManagementUserIds: anchorOnlyUserIds,
  };

  process.stdout.write(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
