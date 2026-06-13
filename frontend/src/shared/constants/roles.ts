import type { RoleCode } from "../../types";

export const roleLabelMap: Record<RoleCode, string> = {
  DEV_ADMIN: "开发管理员",
  HQ_ADMIN: "总部管理",
  BASE_ADMIN: "基地运营",
  TEAM_ADMIN: "团队运营",
  HALL_MANAGER: "厅管理",
  ANCHOR: "主播",
};
