import { prisma } from "./prisma.js";

const roles = [
  ["DEV_ADMIN", "开发管理员"],
  ["HQ_ADMIN", "总部管理员"],
  ["BASE_ADMIN", "基地管理员"],
  ["TEAM_ADMIN", "团队管理员"],
  ["HALL_MANAGER", "厅管理"],
  ["ANCHOR", "主播"],
] as const;

const permissions = [
  ["*", "全部权限", "system"],
  ["org:view", "查看组织", "organization"],
  ["org:create", "创建组织", "organization"],
  ["org:update", "更新组织", "organization"],
  ["org:pause", "暂停组织", "organization"],
  ["org:restore", "恢复组织", "organization"],
  ["account:view", "查看账号", "account"],
  ["account:create", "创建账号", "account"],
  ["identity:grant", "授权身份", "identity"],
  ["anchor:view", "查看主播", "anchor"],
  ["anchor:profile:create", "创建主播档案", "anchor"],
  ["anchor:profile:bind", "绑定主播档案", "anchor"],
  ["anchor:registration:review", "审核主播注册", "anchor"],
  ["audit:view", "查看审计", "audit"],
  ["task:template:manage", "管理任务模板", "task"],
  ["task:assignment:manage", "发放任务", "task"],
  ["task:assignment:view", "查看任务发放", "task"],
  ["task:record:submit", "提交任务执行", "task"],
  ["task:record:view", "查看任务执行记录", "task"],
  ["task:exemption:apply", "申请豁免", "task"],
  ["task:exemption:review", "审批豁免", "task"],
  ["task:report:view", "查看任务报表", "task"],
  ["task:reminder:manage", "管理个人提醒", "task"],
] as const;

const rolePermissions: Record<string, string[]> = {
  DEV_ADMIN: ["*"],
  HQ_ADMIN: [
    "org:view", "org:create", "org:update", "org:pause", "org:restore",
    "account:view", "account:create", "identity:grant",
    "anchor:view", "anchor:profile:create", "anchor:profile:bind", "anchor:registration:review",
    "audit:view",
    "task:template:manage", "task:assignment:manage", "task:assignment:view",
    "task:record:submit", "task:record:view", "task:exemption:apply", "task:exemption:review", "task:report:view", "task:reminder:manage",
  ],
  BASE_ADMIN: [
    "org:view", "org:create", "org:update", "org:pause", "org:restore",
    "account:view", "account:create", "identity:grant",
    "anchor:view", "anchor:profile:create", "anchor:profile:bind", "anchor:registration:review",
    "task:template:manage", "task:assignment:manage", "task:assignment:view",
    "task:record:submit", "task:record:view", "task:exemption:apply", "task:exemption:review", "task:report:view", "task:reminder:manage",
  ],
  TEAM_ADMIN: [
    "org:view", "org:create", "org:update",
    "account:view", "account:create", "identity:grant",
    "anchor:view", "anchor:profile:create", "anchor:profile:bind", "anchor:registration:review",
    "task:template:manage", "task:assignment:manage", "task:assignment:view",
    "task:record:submit", "task:record:view", "task:exemption:apply", "task:report:view", "task:reminder:manage",
  ],
  HALL_MANAGER: [
    "org:view",
    "anchor:view",
    "task:assignment:view", "task:record:submit", "task:record:view", "task:exemption:apply", "task:report:view", "task:reminder:manage",
  ],
  ANCHOR: [
    "task:record:submit", "task:exemption:apply", "task:reminder:manage",
  ],
};

export async function syncRolePermissions() {
  for (const [code, name] of roles) {
    await prisma.role.upsert({ where: { code }, update: { name }, create: { code, name } });
  }

  for (const [code, name, module] of permissions) {
    await prisma.permission.upsert({ where: { code }, update: { name, module }, create: { code, name, module } });
  }

  for (const [roleCode, permissionCodes] of Object.entries(rolePermissions)) {
    await prisma.rolePermission.deleteMany({ where: { roleCode, permissionCode: { notIn: permissionCodes } } });
    for (const permissionCode of permissionCodes) {
      await prisma.rolePermission.upsert({
        where: { roleCode_permissionCode: { roleCode, permissionCode } },
        update: {},
        create: { roleCode, permissionCode },
      });
    }
  }
}
