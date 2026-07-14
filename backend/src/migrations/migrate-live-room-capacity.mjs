/**
 * 旧数据迁移脚本：live_room_capacities 结构升级
 *
 * 步骤：
 *   1. 停止后端服务
 *   2. cd backend && npx prisma db push
 *   3. 执行本脚本：npx tsx src/migrations/migrate-live-room-capacity.mjs
 *
 * 逻辑：
 *   读取旧版记录（如果字段还在），为每个基地创建"默认场地"，
 *   把旧的 totalCount/liveRoomUsed/officeUsed 转为 siteDetails JSON。
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrate() {
  console.log("=== live_room_capacities 旧数据迁移 ===\n");

  // 检查是否已经迁移过
  const all = await prisma.liveRoomCapacity.findMany({ take: 5 });
  let hasMigrated = false;
  for (const r of all) {
    const sd = r.siteDetails as any[];
    if (sd && Array.isArray(sd) && sd.length > 0) {
      hasMigrated = true;
      break;
    }
  }
  if (hasMigrated) {
    console.log("✅ 数据已包含 siteDetails，无需迁移。");
    return;
  }

  console.log(`当前有 ${all.length} 条容量记录，siteDetails 为空\n`);

  // 尝试用 raw query 读取旧字段（db push 后旧列可能已被删）
  let oldRecords: any[] = [];
  try {
    oldRecords = await prisma.$queryRawUnsafe<any[]>(
      `SELECT base_org_id, base_org_name, total_count, live_room_used, office_used, updated_by, updater_name FROM live_room_capacities`
    );
  } catch {
    console.log("⚠️ 旧字段（total_count 等）已不存在，db push 已完成。");
  }

  if (oldRecords.length === 0 && all.length === 0) {
    console.log("✅ 无旧数据，无需迁移。");
    return;
  }

  for (const cap of all) {
    // 查找对应的旧字段
    const old = oldRecords.find((r: any) => r.base_org_id === cap.baseOrgId);

    // 检查是否已有 siteDetails
    const sd = cap.siteDetails as any[];
    if (sd && Array.isArray(sd) && sd.length > 0) {
      console.log(`  ⏭ ${cap.baseOrgName} — 已有 siteDetails，跳过`);
      continue;
    }

    // 创建默认场地
    let defaultSite = await prisma.liveRoomSite.findFirst({
      where: { baseOrgId: cap.baseOrgId, name: "默认场地" },
    });
    if (!defaultSite) {
      defaultSite = await prisma.liveRoomSite.create({
        data: {
          baseOrgId: cap.baseOrgId,
          baseOrgName: cap.baseOrgName,
          name: "默认场地",
          sort: 0,
        },
      });
      console.log(`  🏗  ${cap.baseOrgName} → 创建默认场地`);
    }

    // 构建 siteDetails
    const totalCount = old?.total_count ?? 0;
    const liveRoomUsed = old?.live_room_used ?? 0;
    const officeUsed = old?.office_used ?? 0;

    const rooms: any[] = [];
    if (totalCount > 0 || liveRoomUsed > 0 || officeUsed > 0) {
      rooms.push({ typeName: "直播间", used: liveRoomUsed, total: totalCount });
      rooms.push({ typeName: "办公室", used: officeUsed, total: totalCount });
    }

    await prisma.liveRoomCapacity.update({
      where: { id: cap.id },
      data: {
        siteDetails: rooms.length > 0
          ? [{ siteId: defaultSite.id, siteName: defaultSite.name, rooms }]
          : [],
      },
    });

    console.log(`  ✅ ${cap.baseOrgName} → 迁移完成 (${rooms.length} 种类型)`);
  }

  // 如果 all 为空但 oldRecords 有数据，说明 db push 删了所有行，需要从 oldRecords 恢复
  if (all.length === 0 && oldRecords.length > 0) {
    console.log("\n⚠️ 容量记录为空但从旧数据检测到数据，正在恢复...");
    for (const old of oldRecords) {
      const baseOrgId = old.base_org_id;
      const baseOrgName = old.base_org_name;

      let defaultSite = await prisma.liveRoomSite.findFirst({
        where: { baseOrgId, name: "默认场地" },
      });
      if (!defaultSite) {
        defaultSite = await prisma.liveRoomSite.create({
          data: { baseOrgId, baseOrgName, name: "默认场地", sort: 0 },
        });
      }

      const totalCount = old.total_count ?? 0;
      const liveRoomUsed = old.live_room_used ?? 0;
      const officeUsed = old.office_used ?? 0;

      const rooms: any[] = [];
      if (totalCount > 0 || liveRoomUsed > 0 || officeUsed > 0) {
        rooms.push({ typeName: "直播间", used: liveRoomUsed, total: totalCount });
        rooms.push({ typeName: "办公室", used: officeUsed, total: totalCount });
      }

      await prisma.liveRoomCapacity.create({
        data: {
          baseOrgId,
          baseOrgName,
          siteDetails: rooms.length > 0
            ? [{ siteId: defaultSite.id, siteName: defaultSite.name, rooms }]
            : [],
          updatedBy: old.updated_by || "migration",
          updaterName: old.updater_name || "数据迁移",
        },
      });

      console.log(`  ✅ ${baseOrgName} → 恢复完成`);
    }
  }

  console.log("\n=== 迁移完成 ===");
}

migrate()
  .catch((e) => {
    console.error("迁移失败:", e.message);
    console.error("详细信息:", e);
  })
  .finally(() => prisma.$disconnect());
