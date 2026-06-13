import type { RoleCode, TaskRecordSubjectType, TemporaryTaskMode } from "../../types";

export const accountTemporaryRoleOptions: RoleCode[] = ["ANCHOR", "TEAM_ADMIN", "HALL_MANAGER", "BASE_ADMIN", "HQ_ADMIN"];
export const managerTemporaryRoleOptions: RoleCode[] = ["BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"];

export const temporaryModeMeta: Record<
  TemporaryTaskMode,
  {
    label: string;
    badge: string;
    title: string;
    desc: string;
    summary: string;
  }
> = {
  ACCOUNT: {
    label: "触达式任务",
    badge: "bg-blue-50 text-blue-700",
    title: "按账号归并完成",
    desc: "按账号归并任务完成口径；不再单独选择可见身份。只要账号被明确选中，或被范围框选命中，该账号下所有有效身份都会看到同一份任务。",
    summary: "任一身份确认，即该账号完成。",
  },
  ANCHOR: {
    label: "主播式任务",
    badge: "bg-emerald-50 text-emerald-700",
    title: "只触达主播身份",
    desc: "固定只推送给主播身份，管理账号不会收到这类任务；适合主播侧专项动作与回收。",
    summary: "管理账号不推送。",
  },
  MANAGER: {
    label: "管理式任务",
    badge: "bg-violet-50 text-violet-700",
    title: "按组织协同完成",
    desc: "固定只触达管理账号，主播账号不会推送；如果同一账号属于多个组织管理，则会按多个组织视角分别推送。",
    summary: "主播账号不推送，多组织管理会多次推送。",
  },
};

export const recordSubjectMeta: Record<
  TaskRecordSubjectType,
  {
    label: string;
    badge: string;
    hint: string;
  }
> = {
  USER: {
    label: "账号主体",
    badge: "bg-sky-50 text-sky-700",
    hint: "按账号口径统计完成",
  },
  ORG: {
    label: "组织主体",
    badge: "bg-purple-50 text-purple-700",
    hint: "按组织口径统计完成",
  },
};
