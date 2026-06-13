export type RoleCode = "DEV_ADMIN" | "HQ_ADMIN" | "BASE_ADMIN" | "TEAM_ADMIN" | "HALL_MANAGER" | "ANCHOR";
export type TaskType = "daily" | "activity";
export type TaskStatus = "draft" | "published" | "closed" | "cancelled";
export type TargetStatus = "pending" | "submitted" | "overdue" | "closed";

export interface User {
  id: string;
  phone: string;
  nickname: string;
  status: "active" | "disabled" | "locked";
  mustChangePassword: boolean;
}

export interface Identity {
  id: string;
  userId: string;
  roleCode: RoleCode;
  orgId?: string;
  anchorProfileId?: string;
  scopePath?: string;
  status: "active" | "disabled" | "expired";
}

export interface OrgUnit {
  id: string;
  orgCode: string;
  orgType: "HQ" | "BASE" | "TEAM" | "HALL";
  name: string;
  parentId?: string;
  path: string;
  depth: number;
  principalName?: string;
  contactPhone?: string;
  douyinNo?: string;
  douyinUid?: string;
  brokerName?: string;
  remark?: string;
  status: "active" | "paused";
}

export interface TaskQuestion {
  id: string;
  taskId: string;
  questionType: "text" | "single_choice" | "multiple_choice" | "blank" | "link";
  title: string;
  options?: string[];
  linkUrl?: string;
  required: boolean;
  sortOrder: number;
}

export interface Task {
  id: string;
  taskType: TaskType;
  title: string;
  description?: string;
  publisherUserId: string;
  publisherIdentityId: string;
  publisherOrgId?: string;
  status: TaskStatus;
  startAt?: string;
  dueAt?: string;
  createdAt: string;
}

export interface TaskTarget {
  id: string;
  taskId: string;
  targetIdentityId: string;
  targetUserId: string;
  targetOrgId?: string;
  targetAnchorProfileId?: string;
  snapshotRoleCode: RoleCode;
  snapshotOrgPath?: string;
  status: TargetStatus;
  submittedAt?: string;
}
