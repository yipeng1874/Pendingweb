import type { Anchor } from "../types";
import { statusClass, statusLabel } from "../constants";

interface AnchorCardProps {
  anchor: Anchor;
  onEdit: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onDelete: () => void;
  onResetPassword?: () => void;
}

export function AnchorCard({ anchor, onEdit, onDisable, onEnable, onDelete, onResetPassword }: AnchorCardProps) {
  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-slate-900">{anchor.nickname}</p>
          <p className="mt-2 text-sm text-slate-500">抖音号：{anchor.douyinNo || "未登记"}</p>
          <p className="text-sm text-slate-500">UID：{anchor.douyinUid}</p>
          <p className="text-sm text-slate-500">归属厅：{anchor.hallOrg?.name || "未关联"}</p>
          <p className="text-sm text-slate-500">绑定账号：{anchor.boundUserId ? "已绑定" : "未绑定"}</p>
          <p className="text-sm text-slate-500">手机号：{anchor.boundUser?.phone || "未绑定账号"}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs ${statusClass[anchor.status]}`}>{statusLabel[anchor.status]}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600" onClick={onEdit}>编辑资料</button>
        {anchor.status === "inactive"
          ? <button className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700" onClick={onEnable}>启用</button>
          : <button className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600" onClick={onDisable}>停用</button>}
        {onResetPassword && (
          <button
            className="rounded-xl bg-feishu-blue px-3 py-2 text-xs text-white"
            title="将登录密码重置为 123456"
            onClick={onResetPassword}
          >
            重置密码
          </button>
        )}
        <button className="rounded-xl bg-red-500 px-3 py-2 text-xs text-white" onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}
