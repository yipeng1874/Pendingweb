import type { AnchorStatus } from "./types";

export const statusLabel: Record<AnchorStatus, string> = {
  unbound: "未绑定",
  bound: "使用中",
  inactive: "已停用",
};

export const statusClass: Record<AnchorStatus, string> = {
  unbound: "bg-amber-50 text-amber-700",
  bound: "bg-emerald-50 text-emerald-700",
  inactive: "bg-slate-100 text-slate-500",
};
