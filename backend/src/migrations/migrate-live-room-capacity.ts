/**
 * live_room_capacities 结构升级（使用 Prisma raw SQL）
 *
 * 执行：cd backend && npx tsx src/migrations/migrate-live-room-capacity.ts
 *
 * 此脚本会：
 *   1. 创建 live_room_sites 新表
 *   2. 为已有基地创建默认场地
 *   3. 添加 site_details JSON 列
 *   4. 迁移旧数据
 *   5. 删除旧列（total_count, live_room_used, office_used）
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrate() {
  console.log("=== live_room_capacities 结构升级 ===\n");

  // 1. 创建 live_room_sites 表
  console.log("1/6 创建 live_room_sites 表...");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`live_room_sites\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`base_org_id\` VARCHAR(36) NOT NULL,
      \`base_org_name\` VARCHAR(255) NOT NULL,
      \`name\` VARCHAR(255) NOT NULL,
      \`sort\` INT NOT NULL DEFAULT 0,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`live_room_sites_base_org_id_name_key\` (\`base_org_id\`, \`name\`),
      INDEX \`live_room_sites_base_org_id_idx\` (\`base_org_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 2. 为已有基地创建默认场地
  console.log("2/6 创建默认场地...");
  await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO \`live_room_sites\` (\`id\`, \`base_org_id\`, \`base_org_name\`, \`name\`, \`sort\`)
    SELECT UUID(), \`base_org_id\`, \`base_org_name\`, '默认场地', 0
    FROM \`live_room_capacities\`;
  `);

  // 3. 添加 site_details 列
  console.log("3/6 添加 site_details 列...");
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`live_room_capacities\`
      ADD COLUMN \`site_details\` JSON NULL AFTER \`base_org_name\`;
    `);
  } catch (e: any) {
    if (e.message?.includes("Duplicate column")) {
      console.log("  → site_details 列已存在，跳过");
    } else {
      throw e;
    }
  }

  // 4. 迁移数据
  console.log("4/6 迁移旧数据...");
  await prisma.$executeRawUnsafe(`
    UPDATE \`live_room_capacities\` lc
    SET \`site_details\` = (
      SELECT JSON_ARRAY(
        JSON_OBJECT(
          'siteId', ls.id,
          'siteName', ls.name,
          'rooms', JSON_ARRAY(
            JSON_OBJECT('typeName', '直播间', 'used', lc.live_room_used, 'total', lc.total_count),
            JSON_OBJECT('typeName', '办公室', 'used', lc.office_used, 'total', lc.total_count)
          )
        )
      )
      FROM \`live_room_sites\` ls
      WHERE ls.base_org_id = lc.base_org_id AND ls.name = '默认场地'
      LIMIT 1
    );
  `);

  // 5. 确保非空
  console.log("5/6 设置 site_details 为 NOT NULL...");
  await prisma.$executeRawUnsafe(`
    UPDATE \`live_room_capacities\` SET \`site_details\` = JSON_ARRAY() WHERE \`site_details\` IS NULL
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE \`live_room_capacities\` MODIFY COLUMN \`site_details\` JSON NOT NULL
  `);

  // 6. 删除旧列
  console.log("6/6 删除旧列...");
  try { await prisma.$executeRawUnsafe(`ALTER TABLE \`live_room_capacities\` DROP COLUMN \`total_count\``); } catch {}
  try { await prisma.$executeRawUnsafe(`ALTER TABLE \`live_room_capacities\` DROP COLUMN \`live_room_used\``); } catch {}
  try { await prisma.$executeRawUnsafe(`ALTER TABLE \`live_room_capacities\` DROP COLUMN \`office_used\``); } catch {}

  console.log("\n=== 迁移完成！===");
  console.log("请在 backend 目录执行 npx prisma generate 以更新 Prisma Client");
}

migrate()
  .catch((e) => {
    console.error("迁移失败:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
