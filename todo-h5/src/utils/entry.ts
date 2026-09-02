import type { Identity } from "../types";

export const DASHBOARD_ROLES = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"] as const;

export function canOpenDashboard(identity?: Identity | null) {
  return Boolean(identity && DASHBOARD_ROLES.includes(identity.roleCode as (typeof DASHBOARD_ROLES)[number]));
}

export function entryPathForIdentity(identity?: Identity | null) {
  return canOpenDashboard(identity) ? "/dashboard" : "/todos";
}
