/**
 * 创建 process_metric_configs 表
 * 执行：cd backend && npx tsx src/migrations/migrate-process-metric-config.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrate() {
  console.log("=== 创建 process_metric_configs 表 ===\n");

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`process_metric_configs\` (
        \`base_org_id\` VARCHAR(36) NOT NULL,
        \`team_ids\`   TEXT NOT NULL COMMENT 'JSON 数组，如 ["id1","id2"]',
        \`updated_by\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`base_org_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✅ 表创建成功！");
  } catch (e) {
    console.error("❌ 创建失败:", e.message);
  }

  await prisma.$disconnect();
}

migrate();
