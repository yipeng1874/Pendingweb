import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const profiles = await prisma.anchorProfile.findMany({
    include: {
      identities: { where: { roleCode: "ANCHOR" }, select: { userId: true } },
    },
  });

  let usersUpdated = 0;
  let recordsUpdated = 0;

  for (const profile of profiles) {
    const userIds = Array.from(new Set([profile.boundUserId, ...profile.identities.map((item) => item.userId)].filter(Boolean)));

    if (userIds.length) {
      const userResult = await prisma.user.updateMany({
        where: { id: { in: userIds }, nickname: { not: profile.nickname } },
        data: { nickname: profile.nickname },
      });
      usersUpdated += userResult.count;

      const identityResult = await prisma.userIdentity.updateMany({
        where: { userId: { in: userIds }, roleCode: "ANCHOR", anchorProfileId: profile.id },
        data: { orgId: profile.hallOrgId },
      });
      void identityResult;
    }

    const recordResult = await prisma.taskRecord.updateMany({
      where: {
        OR: [
          ...(userIds.length ? [{ subjectUserId: { in: userIds } }, { userId: { in: userIds } }] : []),
          ...(profile.douyinUid ? [{ subjectKey: profile.douyinUid }] : []),
        ],
      },
      data: {
        subjectName: profile.nickname,
        ...(profile.douyinUid ? { subjectKey: profile.douyinUid } : {}),
        subjectOrgId: profile.hallOrgId,
      },
    });
    recordsUpdated += recordResult.count;
  }

  console.log(JSON.stringify({ profiles: profiles.length, usersUpdated, recordsUpdated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
