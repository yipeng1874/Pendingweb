import type { OrgType, OrgForm } from "./types";

export const nextTypeMap: Record<OrgType, OrgType | undefined> = {
  HQ: "BASE",
  BASE: "TEAM",
  TEAM: "HALL",
  HALL: undefined,
};

export const parentTypeMap: Record<OrgType, OrgType | undefined> = {
  HQ: undefined,
  BASE: "HQ",
  TEAM: "BASE",
  HALL: "TEAM",
};

export const orgTypeMeta: Record<OrgType, { label: string; badge: string; text: string; size: string }> = {
  HQ: { label: "总部", badge: "bg-blue-100 text-blue-700", text: "text-base font-semibold", size: "h-7 min-w-10" },
  BASE: { label: "基地", badge: "bg-violet-100 text-violet-700", text: "text-[15px] font-semibold", size: "h-6 min-w-10" },
  TEAM: { label: "团队", badge: "bg-emerald-100 text-emerald-700", text: "text-sm font-medium", size: "h-6 min-w-10" },
  HALL: { label: "厅", badge: "bg-amber-100 text-amber-700", text: "text-[13px] font-medium", size: "h-5 min-w-7" },
};

export const requiredHallKeys = ["principalName", "contactPhone", "douyinNo", "douyinUid", "brokerName", "remark"] as const;

export const emptyOrgForm: OrgForm = {
  name: "",
  orgCode: "",
  principalName: "",
  contactPhone: "",
  douyinNo: "",
  douyinUid: "",
  brokerName: "",
  remark: "",
};
