import { env } from "../config/env.js";
import type { Identity, OrgUnit, RoleCode, Task, TaskQuestion, TaskTarget, User } from "./types.js";

export const ids = {
  userAdmin: "user-dev-admin",
  identityAdmin: "identity-dev-admin",
  orgHq: "org-hq",
  orgBase: "org-base-sh",
  orgTeam: "org-team-a1",
  orgHall: "org-hall-001",
  anchor: "anchor-001",
};

export const users: User[] = [
  { id: ids.userAdmin, phone: env.DEV_ADMIN_PHONE, nickname: "开发管理", status: "active", mustChangePassword: false },
];

export const orgs: OrgUnit[] = [
  { id: ids.orgHq, orgCode: "QGCM001", orgType: "HQ", name: "公司总部", path: "/QGCM001", depth: 1, principalName: "总部负责人", status: "active" },
  { id: ids.orgBase, orgCode: "SH2605A", orgType: "BASE", name: "上海基地", parentId: ids.orgHq, path: "/QGCM001/SH2605A", depth: 2, principalName: "基地运营", status: "active" },
  { id: ids.orgTeam, orgCode: "SH2605AA1", orgType: "TEAM", name: "A1 团队", parentId: ids.orgBase, path: "/QGCM001/SH2605A/SH2605AA1", depth: 3, principalName: "团队运营", status: "active" },
  { id: ids.orgHall, orgCode: "HALL-DY-8888", orgType: "HALL", name: "星光直播厅", parentId: ids.orgTeam, path: "/QGCM001/SH2605A/SH2605AA1/HALL-DY-8888", depth: 4, principalName: "厅管理", douyinNo: "star8888", douyinUid: "88880001", brokerName: "运营经纪人", status: "active" },
];

export const identities: Identity[] = [
  { id: ids.identityAdmin, userId: ids.userAdmin, roleCode: "DEV_ADMIN", orgId: ids.orgHq, scopePath: "/QGCM001", status: "active" },
];

type AnchorProfile = { id: string; nickname: string; douyinNo?: string; douyinUid: string; hallOrgId: string; boundUserId?: string; status: "unbound" | "bound" | "inactive" };

export const anchorProfiles: AnchorProfile[] = [
  { id: ids.anchor, nickname: "小鹿", douyinNo: "xiaolu_live", douyinUid: "660001", hallOrgId: ids.orgHall, status: "unbound" },
];

export const applications = [
  { id: "app-001", userId: ids.userAdmin, anchorNickname: "小鹿", targetHallOrgId: ids.orgHall, douyinNo: "xiaolu_live", douyinUid: "660001", status: "pending", submittedAt: new Date().toISOString() },
];

export const rolePermissions: Record<RoleCode, string[]> = {
  DEV_ADMIN: ["*"],
  HQ_ADMIN: ["org:view", "org:create", "org:update", "org:pause", "org:restore", "account:view", "account:create", "identity:grant", "anchor:view", "anchor:profile:create", "anchor:profile:bind", "anchor:registration:review", "task:view", "task:create", "task:publish", "task:close", "report:view", "report:view_detail", "audit:view"],
  BASE_ADMIN: ["org:view", "org:create", "org:update", "account:view", "account:create", "identity:grant", "anchor:view", "anchor:profile:create", "anchor:profile:bind", "anchor:registration:review", "task:view", "task:create", "task:publish", "task:close", "report:view", "report:view_detail"],
  TEAM_ADMIN: ["org:view", "anchor:view", "task:view", "task:create", "task:publish", "report:view", "report:view_detail"],
  HALL_MANAGER: ["org:view", "anchor:view", "anchor:registration:review", "task:view", "report:view"],
  ANCHOR: ["task:view", "task:submit", "report:view"],
};

export const tasks: Task[] = [
  { id: "task-001", taskType: "daily", title: "今日直播前准备确认", description: "确认直播间标题、封面、设备和当日目标。", publisherUserId: ids.userAdmin, publisherIdentityId: ids.identityAdmin, publisherOrgId: ids.orgHq, status: "published", dueAt: new Date(Date.now() + 86400000).toISOString(), createdAt: new Date().toISOString() },
];

export const questions: TaskQuestion[] = [
  { id: "q-001", taskId: "task-001", questionType: "single_choice", title: "直播设备是否检查完成？", options: ["已完成", "未完成"], required: true, sortOrder: 1 },
  { id: "q-002", taskId: "task-001", questionType: "text", title: "今日直播目标与备注", required: true, sortOrder: 2 },
];

export const targets: TaskTarget[] = [
  { id: "target-001", taskId: "task-001", targetIdentityId: ids.identityAdmin, targetUserId: ids.userAdmin, targetOrgId: ids.orgHq, snapshotRoleCode: "DEV_ADMIN", snapshotOrgPath: "/QGCM001", status: "pending" },
];

export const submissions: Array<{ id: string; taskTargetId: string; submitterUserId: string; submitterIdentityId: string; answers: unknown; submittedAt: string }> = [];
export const auditLogs: Array<{ id: string; operatorUserId: string; operatorIdentityId: string; action: string; targetType: string; targetId?: string; createdAt: string }> = [];

export function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
