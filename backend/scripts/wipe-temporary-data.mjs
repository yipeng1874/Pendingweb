import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function resolveFilePathFromUrl(fileUrl) {
  if (!fileUrl) return null;
  const normalized = String(fileUrl).replace(/^\/+/, "");
  return path.join(process.cwd(), normalized);
}

async function main() {
  const templates = await prisma.taskTemplate.findMany({
    where: { category: "TEMPORARY" },
    select: { id: true },
  });
  const templateIds = templates.map((item) => item.id);

  const assignments = await prisma.taskAssignment.findMany({
    where: { category: "TEMPORARY" },
    select: { id: true },
  });
  const assignmentIds = assignments.map((item) => item.id);

  const records = assignmentIds.length
    ? await prisma.taskRecord.findMany({
        where: { assignmentId: { in: assignmentIds } },
        select: { id: true },
      })
    : [];
  const recordIds = records.map((item) => item.id);

  const itemRecords = recordIds.length
    ? await prisma.taskItemRecord.findMany({
        where: { taskRecordId: { in: recordIds } },
        select: { id: true },
      })
    : [];
  const itemRecordIds = itemRecords.map((item) => item.id);

  const attachments = itemRecordIds.length
    ? await prisma.taskItemAttachment.findMany({
        where: { taskItemRecordId: { in: itemRecordIds } },
        select: { id: true, fileUrl: true },
      })
    : [];

  const snapshotCountBefore = templateIds.length
    ? await prisma.taskTemplateSnapshot.count({ where: { templateId: { in: templateIds } } })
    : 0;
  const itemCountBefore = templateIds.length
    ? await prisma.taskItem.count({ where: { templateId: { in: templateIds } } })
    : 0;
  const targetCountBefore = assignmentIds.length
    ? await prisma.taskAssignmentTarget.count({ where: { assignmentId: { in: assignmentIds } } })
    : 0;
  const exclusionCountBefore = assignmentIds.length
    ? await prisma.taskAssignmentExclusion.count({ where: { assignmentId: { in: assignmentIds } } })
    : 0;
  const identityLinkCountBefore = recordIds.length
    ? await prisma.taskRecordIdentityLink.count({ where: { taskRecordId: { in: recordIds } } })
    : 0;
  const exemptionCountBefore = recordIds.length
    ? await prisma.taskExemption.count({ where: { taskRecordId: { in: recordIds } } })
    : 0;

  for (const attachment of attachments) {
    const filePath = resolveFilePathFromUrl(attachment.fileUrl);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.warn(`failed to delete file: ${filePath}`, error);
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    if (itemRecordIds.length) {
      await tx.taskItemAttachment.deleteMany({ where: { taskItemRecordId: { in: itemRecordIds } } });
    }
    if (recordIds.length) {
      await tx.taskExemption.deleteMany({ where: { taskRecordId: { in: recordIds } } });
      await tx.taskRecordIdentityLink.deleteMany({ where: { taskRecordId: { in: recordIds } } });
    }
    if (itemRecordIds.length) {
      await tx.taskItemRecord.deleteMany({ where: { id: { in: itemRecordIds } } });
    }
    if (recordIds.length) {
      await tx.taskRecord.deleteMany({ where: { id: { in: recordIds } } });
    }
    if (assignmentIds.length) {
      await tx.taskAssignmentExclusion.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
      await tx.taskAssignmentTarget.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
      await tx.taskAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    }
    if (templateIds.length) {
      await tx.taskTemplateSnapshot.deleteMany({ where: { templateId: { in: templateIds } } });
      await tx.taskItemOption.deleteMany({ where: { taskItem: { templateId: { in: templateIds } } } });
      await tx.taskItem.deleteMany({ where: { templateId: { in: templateIds } } });
      await tx.taskTemplate.deleteMany({ where: { id: { in: templateIds } } });
    }
  });

  console.log(JSON.stringify({
    deleted: {
      templates: templateIds.length,
      templateSnapshots: snapshotCountBefore,
      assignments: assignmentIds.length,
      assignmentTargets: targetCountBefore,
      assignmentExclusions: exclusionCountBefore,
      records: recordIds.length,
      recordIdentityLinks: identityLinkCountBefore,
      itemRecords: itemRecordIds.length,
      attachments: attachments.length,
      exemptions: exemptionCountBefore,
      taskItems: itemCountBefore,
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
