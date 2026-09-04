import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft, RefreshCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";

const roles: Record<string, string> = { DEV_ADMIN: "开发管理员", HQ_ADMIN: "总部管理员", BASE_ADMIN: "基地运营", TEAM_ADMIN: "团队运营", HALL_MANAGER: "厅管", ANCHOR: "主播" };

export function PublishHeader({ title, icon, back, disabled, onRefresh }: { title: string; icon: ReactNode; back?: boolean; disabled?: boolean; onRefresh?: () => void }) {
  const identity = useAuthStore(s => s.currentIdentity);
  const navigate = useNavigate();
  return <header className="todo-header publish-header">
    <div className="mobile-page-brand">{back ? <button className="publish-back" disabled={disabled} aria-label="返回任务类型" onClick={() => navigate("/publish")}><ChevronLeft size={19} /></button> : <span>{icon}</span>}<h1>{title}</h1></div>
    <button className="todo-identity-switch" disabled={disabled} onClick={() => navigate("/identity")} aria-label="切换身份"><span className="todo-identity-copy"><strong>{identity?.org?.name ?? identity?.anchorProfile?.nickname ?? "当前组织"}</strong><span>{roles[identity?.roleCode ?? ""] ?? "当前身份"}</span></span><ChevronDown size={13} /></button>
    {onRefresh && <button className="todo-header-logout" disabled={disabled} onClick={onRefresh} aria-label="刷新"><RefreshCcw size={16} /></button>}
  </header>;
}
