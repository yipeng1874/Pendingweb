import { prisma } from "../shared/prisma.js";
import { ensureTaskAssignmentSchemaCompatibility } from "../shared/task-assignment-schema-compat.js";

async function main() {
  const result = await ensureTaskAssignmentSchemaCompatibility();
  if (!result.addedColumns.length && !result.addedIndexes.length) {
    console.log("[db] task_assignments 结构已是最新，无需修复");
  }

  await prisma.taskAssignment.findMany({
    take: 1,
    select: { id: true },
  });
  console.log("[db] taskAssignment 查询验证通过");
}

main()
  .catch((error) => {
    console.error("[db] 修复 task_assignments 结构失败", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
