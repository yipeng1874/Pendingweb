import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = {
    users: await prisma.user.findMany({
      select: { id: true, phone: true, nickname: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
    orgCount: await prisma.orgUnit.count(),
    anchorProfileCount: await prisma.anchorProfile.count(),
    applicationCount: await prisma.anchorRegistrationApplication.count(),
    taskTemplateCount: await prisma.taskTemplate.count(),
    taskAssignmentCount: await prisma.taskAssignment.count(),
    taskRecordCount: await prisma.taskRecord.count(),
    reminderCount: await prisma.personalReminder.count(),
    auditCount: await prisma.auditLog.count(),
    identityCount: await prisma.userIdentity.count(),
  };

  process.stdout.write(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
