import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const profiles = await prisma.anchorProfile.findMany({
    select: {
      id: true,
      nickname: true,
      douyinNo: true,
      douyinUid: true,
      boundUserId: true,
      identities: { where: { roleCode: "ANCHOR" }, select: { userId: true } },
    },
  });

  let updated = 0;

  for (const profile of profiles) {
    const userIds = Array.from(new Set([profile.boundUserId, ...profile.identities.map((item) => item.userId)].filter(Boolean)));
    if (!userIds.length && !profile.douyinUid) continue;

    const result = await prisma.taskRecord.updateMany({
      where: {
        OR: [
          ...(userIds.length ? [{ subjectUserId: { in: userIds } }, { userId: { in: userIds } }] : []),
          ...(profile.douyinUid ? [{ subjectKey: profile.douyinUid }] : []),
        ],
      },
      data: {
        subjectName: profile.nickname,
      },
    });

    updated += result.count;
  }

  console.log(JSON.stringify({ profiles: profiles.length, updatedTaskRecords: updated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
