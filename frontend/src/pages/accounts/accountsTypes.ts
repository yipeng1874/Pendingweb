import { api } from "../../services/http";
import type { ApiResponse, Identity, OrgUnit, RoleCode, User } from "../../types";

export type Account = User & { identities: Identity[] };

export function getDisplayAccountNickname(account: Account) {
  return account.anchorProfile?.nickname || account.nickname;
}
export type OrgNode = OrgUnit & { children: OrgNode[] };
export type SearchAccount = Account;
export type ConflictDetail = { id: string; roleCode: RoleCode; orgId?: string; orgName?: string; orgCode?: string };
export type ViewMode = "by-org" | "by-account";

export const roleOptions: Array<{ value: RoleCode; label: string; orgTypes: OrgUnit["orgType"][] }> = [
  { value: "HQ_ADMIN", label: "总部管理", orgTypes: ["HQ"] },
  { value: "BASE_ADMIN", label: "基地运营", orgTypes: ["BASE"] },
  { value: "TEAM_ADMIN", label: "团队运营", orgTypes: ["TEAM"] },
  { value: "HALL_MANAGER", label: "厅管理", orgTypes: ["HALL"] },
];

export const roleLabelMap: Record<RoleCode, string> = {
  DEV_ADMIN: "开发管理员",
  HQ_ADMIN: "总部管理",
  BASE_ADMIN: "基地运营",
  TEAM_ADMIN: "团队运营",
  HALL_MANAGER: "厅管理",
  ANCHOR: "主播",
};

export const orgTypeLabelMap: Record<OrgUnit["orgType"], string> = {
  HQ: "总部",
  BASE: "基地",
  TEAM: "团队",
  HALL: "厅",
};

export function buildOrgTree(orgs: OrgUnit[]): OrgNode[] {
  const map = new Map<string, OrgNode>();
  orgs.forEach((org) => map.set(org.id, { ...org, children: [] }));
  const roots: OrgNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) map.get(node.parentId)!.children.push(node);
    else roots.push(node);
  });
  return roots;
}

export function isManagementIdentity(identity: Identity) {
  return identity.roleCode !== "ANCHOR";
}

export function isRoleVisibleForOrg(identity: Identity, org?: OrgUnit) {
  if (!org) return true;
  if (org.orgType === "HQ") return identity.roleCode === "HQ_ADMIN" || identity.roleCode === "DEV_ADMIN";
  if (org.orgType === "BASE") return identity.roleCode === "BASE_ADMIN";
  if (org.orgType === "TEAM") return identity.roleCode === "TEAM_ADMIN";
  if (org.orgType === "HALL") return identity.roleCode === "HALL_MANAGER";
  return true;
}

export function formatOrgPath(path?: string) {
  if (!path) return "—";
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/-/g, "－"))
    .join(" / ");
}

export async function grantManagementIdentity(userId: string, payload: { roleCode: RoleCode; orgId: string }) {
  try {
    return await api.post<Identity>(`/accounts/${userId}/identities`, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "授权失败";
    const apiError = err as Error & { responseBody?: ApiResponse<unknown> };
    const body = apiError.responseBody;
    if (body?.error?.code === "ORG_SCOPE_CONFLICT") {
      const conflictError = new Error(body.error.message) as Error & { code?: string; details?: ConflictDetail[] };
      conflictError.code = body.error.code;
      conflictError.details = body.error.details as ConflictDetail[] | undefined;
      throw conflictError;
    }
    throw new Error(message);
  }
}
