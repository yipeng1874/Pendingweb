import { prisma } from "./prisma.js";

type ColumnSpec = {
  columnName: string;
  definition: string;
  after?: string;
};

type IndexSpec = {
  indexName: string;
  definition: string;
};

type CountRow = {
  count: bigint | number;
};

type ColumnRow = {
  COLUMN_NAME: string;
};

type IndexRow = {
  INDEX_NAME: string;
};

type PermissionSpec = {
  code: string;
  name: string;
  module: string;
  roleCodes: string[];
};

const requiredColumns: ColumnSpec[] = [
  { columnName: "target_role_codes", definition: "JSON NULL", after: "target_admin_levels" },
  { columnName: "target_user_ids", definition: "JSON NULL", after: "target_role_codes" },
  { columnName: "temporary_mode", definition: "ENUM('ACCOUNT','ANCHOR','MANAGER') COLLATE utf8mb4_unicode_ci NULL", after: "target_user_ids" },
  { columnName: "temporary_subject_org_type", definition: "ENUM('HQ','BASE','TEAM','HALL') COLLATE utf8mb4_unicode_ci NULL", after: "temporary_mode" },
  { columnName: "created_by_identity_id", definition: "VARCHAR(191) COLLATE utf8mb4_unicode_ci NULL", after: "created_by_org_id" },
];

const requiredIndexes: IndexSpec[] = [
  { indexName: "task_assignments_created_by_category_status_idx", definition: "(`created_by`, `category`, `status`)" },
  { indexName: "task_assignments_temporary_mode_category_idx", definition: "(`temporary_mode`, `category`)" },
];

const requiredTaskPermissions: PermissionSpec[] = [
  { code: "task:template:manage", name: "管理任务模板", module: "task", roleCodes: ["HQ_ADMIN", "BASE_ADMIN"] },
  { code: "task:assignment:manage", name: "发放任务", module: "task", roleCodes: ["HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"] },
  { code: "task:assignment:view", name: "查看任务发放", module: "task", roleCodes: ["HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"] },
  { code: "task:record:submit", name: "提交待办任务", module: "task", roleCodes: ["HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER", "ANCHOR"] },
  { code: "task:record:view", name: "查看任务执行记录", module: "task", roleCodes: ["HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"] },
  { code: "task:exemption:apply", name: "申请任务豁免", module: "task", roleCodes: ["HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER", "ANCHOR"] },
  { code: "task:exemption:review", name: "审批豁免", module: "task", roleCodes: ["HQ_ADMIN", "BASE_ADMIN"] },
  { code: "task:report:view", name: "查看任务报表", module: "task", roleCodes: ["HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"] },
  { code: "task:reminder:manage", name: "管理个人提醒", module: "task", roleCodes: ["HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER", "ANCHOR"] },
];

const taskPermissionRoleCodes = Array.from(new Set(requiredTaskPermissions.flatMap((permission) => permission.roleCodes)));

async function ensureTaskExecutionPermissions() {
  for (const permission of requiredTaskPermissions) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { name: permission.name, module: permission.module },
      create: { code: permission.code, name: permission.name, module: permission.module },
    });
  }

  const existingRoles = await prisma.role.findMany({
    where: { code: { in: taskPermissionRoleCodes } },
    select: { code: true },
  });
  const existingRoleSet = new Set(existingRoles.map((role) => role.code));
  const data = requiredTaskPermissions.flatMap((permission) =>
    permission.roleCodes
      .filter((roleCode) => existingRoleSet.has(roleCode))
      .map((roleCode) => ({ roleCode, permissionCode: permission.code }))
  );
  if (!data.length) return [] as string[];

  const existingLinks = await prisma.rolePermission.findMany({
    where: {
      roleCode: { in: Array.from(existingRoleSet) },
      permissionCode: { in: requiredTaskPermissions.map((permission) => permission.code) },
    },
    select: { roleCode: true, permissionCode: true },
  });
  const existingSet = new Set(existingLinks.map((item) => `${item.roleCode}:${item.permissionCode}`));
  const missing = data.filter((item) => !existingSet.has(`${item.roleCode}:${item.permissionCode}`));
  if (missing.length) await prisma.rolePermission.createMany({ data: missing, skipDuplicates: true });
  return missing.map((item) => `${item.roleCode}:${item.permissionCode}`);
}

async function ensureDailyNotifyScheduleTable() {
  const [tableRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*) AS count
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'daily_notify_schedules'
  `;

  if (Number(tableRow?.count ?? 0) > 0) {
    return { createdTable: false };
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE \`daily_notify_schedules\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`base_org_id\` VARCHAR(191) NOT NULL,
      \`enabled\` BOOLEAN NOT NULL DEFAULT false,
      \`interval_hours\` INTEGER NOT NULL DEFAULT 3,
      \`prefix\` VARCHAR(191) NOT NULL DEFAULT '来自系统提醒',
      \`last_triggered_slot\` VARCHAR(191) NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL,
      UNIQUE INDEX \`daily_notify_schedules_base_org_id_key\`(\`base_org_id\`),
      INDEX \`daily_notify_schedules_enabled_interval_hours_idx\`(\`enabled\`, \`interval_hours\`),
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`daily_notify_schedules_base_org_id_fkey\`
        FOREIGN KEY (\`base_org_id\`) REFERENCES \`org_units\`(\`id\`)
        ON DELETE RESTRICT ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  return { createdTable: true };
}

export async function ensureTaskAssignmentSchemaCompatibility() {
  const [tableRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*) AS count
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'task_assignments'
  `;

  const [addedRolePermissions, dailyNotifyScheduleState] = await Promise.all([
    ensureTaskExecutionPermissions(),
    ensureDailyNotifyScheduleTable(),
  ]);

  if (Number(tableRow?.count ?? 0) === 0) {
    console.warn("[db] 未找到 task_assignments 表，跳过临时任务兼容补丁");
    if (dailyNotifyScheduleState.createdTable || addedRolePermissions.length) {
      console.log(
        `[db] 已补齐任务模块兼容结构：自动通知表=${dailyNotifyScheduleState.createdTable ? "已创建" : "无"}；角色权限=${addedRolePermissions.join(",") || "无"}`
      );
    }
    return {
      addedColumns: [] as string[],
      addedIndexes: [] as string[],
      addedRolePermissions,
      createdDailyNotifyScheduleTable: dailyNotifyScheduleState.createdTable,
    };
  }

  const columnRows = await prisma.$queryRaw<ColumnRow[]>`
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'task_assignments'
  `;
  const existingColumns = new Set(columnRows.map((row) => row.COLUMN_NAME));
  const addedColumns: string[] = [];

  for (const column of requiredColumns) {
    if (existingColumns.has(column.columnName)) continue;
    const afterClause = column.after && existingColumns.has(column.after) ? ` AFTER \`${column.after}\`` : "";
    await prisma.$executeRawUnsafe(
      `ALTER TABLE \`task_assignments\` ADD COLUMN \`${column.columnName}\` ${column.definition}${afterClause}`
    );
    existingColumns.add(column.columnName);
    addedColumns.push(column.columnName);
  }

  const indexRows = await prisma.$queryRaw<IndexRow[]>`
    SELECT DISTINCT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'task_assignments'
  `;
  const existingIndexes = new Set(indexRows.map((row) => row.INDEX_NAME));
  const addedIndexes: string[] = [];

  for (const index of requiredIndexes) {
    if (existingIndexes.has(index.indexName)) continue;
    await prisma.$executeRawUnsafe(
      `ALTER TABLE \`task_assignments\` ADD INDEX \`${index.indexName}\` ${index.definition}`
    );
    existingIndexes.add(index.indexName);
    addedIndexes.push(index.indexName);
  }

  if (addedColumns.length || addedIndexes.length || addedRolePermissions.length || dailyNotifyScheduleState.createdTable) {
    console.log(
      `[db] 已补齐任务兼容结构：列=${addedColumns.join(",") || "无"}；索引=${addedIndexes.join(",") || "无"}；自动通知表=${dailyNotifyScheduleState.createdTable ? "已创建" : "无"}；角色权限=${addedRolePermissions.join(",") || "无"}`
    );
  }

  return {
    addedColumns,
    addedIndexes,
    addedRolePermissions,
    createdDailyNotifyScheduleTable: dailyNotifyScheduleState.createdTable,
  };
}
