import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Building2, CalendarClock, ChevronDown, ChevronRight, ClipboardCheck, ClipboardList, GitBranch, LayoutDashboard, ListTodo, LogOut, PanelLeftClose, PanelLeftOpen, RefreshCw, Send, Settings2, UserRoundCheck, Users } from "lucide-react";
import { IdentitySwitcher } from "./IdentitySwitcher";
import { PermissionGate } from "./PermissionGate";
import { useAuthStore } from "../stores/authStore";
import { useIdentityStore } from "../stores/identityStore";
import { api } from "../services/http";
import { isInFeishuApp } from "../shared/utils/feishu";

const orgSubItems = [
  { to: "/organization", label: "组织设立变更", icon: Building2 },
  { to: "/accounts", label: "组织账号管理", icon: Users },
  { to: "/organization/feishu-configs", label: "飞书企业配置", icon: Settings2 },
];

const anchorSubItems = [
  { to: "/anchor-reviews", label: "注册审核", icon: ClipboardCheck },
  { to: "/anchor-accounts", label: "账号管理", icon: UserRoundCheck },
];

const taskSubItems = [
  { to: "/tasks/cockpit", label: "全局仪表台", icon: LayoutDashboard },
  { to: "/tasks/dashboard", label: "我的待办", icon: ListTodo },
];

const taskBoardSubItems = [
  { to: "/tasks/dashboard/daily-board", label: "主播日常任务看板", icon: ClipboardCheck },
  { to: "/tasks/dashboard/hall-daily-board", label: "厅管日常任务看板", icon: Building2 },
  { to: "/tasks/dashboard/temporary-board", label: "临时任务看板", icon: CalendarClock },
  { to: "/tasks/dashboard/workflow-board", label: "协同任务看板", icon: GitBranch },
];

const issueSubItems = [
  { to: "/tasks/templates/daily-library", label: "主播日常任务", icon: ClipboardCheck },
  { to: "/tasks/issue/hall-daily", label: "厅管日常任务", icon: Building2 },
  { to: "/tasks/issue/temporary", label: "临时任务", icon: CalendarClock },
  { to: "/tasks/collaboration/workflow", label: "协同任务", icon: GitBranch },
];

const SIDEBAR_STORAGE_KEY = "app.sidebar.collapsed";

function OrgNavGroup({ collapsed, onExpandRequest }: { collapsed: boolean; onExpandRequest: () => void }) {
  const location = useLocation();
  const currentRoleCode = useIdentityStore((state) => state.currentIdentity?.roleCode);
  const permissions = useIdentityStore((state) => state.permissions);
  const visibleItems = orgSubItems.filter((item) => {
    if (item.to === "/organization") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(currentRoleCode))
        && (permissions.includes("*") || permissions.includes("org:view"));
    }
    if (item.to === "/organization/feishu-configs") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"].includes(currentRoleCode))
        && (permissions.includes("*") || permissions.includes("org:view"));
    }
    if (item.to === "/accounts") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(currentRoleCode))
        && (permissions.includes("*") || permissions.includes("account:view"));
    }
    return false;
  });
  const isChildActive = visibleItems.some((item) => location.pathname.startsWith(item.to));
  const [open, setOpen] = useState(isChildActive);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        title="组织管理"
        onClick={() => {
          if (collapsed) {
            onExpandRequest();
            return;
          }
          setOpen((prev) => !prev);
        }}
        className={`flex w-full items-center rounded-[16px] text-sm font-medium transition-all duration-200 ${collapsed ? "justify-center px-2 py-3" : "gap-3 px-4 py-3"} ${isChildActive ? "bg-feishu-pale text-feishu-blue shadow-[0_8px_20px_rgba(76,114,255,0.08)]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
      >
        <Building2 size={18} />
        {!collapsed && <span className="flex-1 text-left">组织管理</span>}
        {!collapsed && (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
      </button>
      {!collapsed && open && (
        <div className="mt-1 flex flex-col gap-1 pl-4">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `flex items-center gap-3 rounded-[14px] px-4 py-2.5 text-sm font-medium transition-all duration-200 ${isActive ? "bg-feishu-pale text-feishu-blue shadow-[0_6px_16px_rgba(76,114,255,0.06)]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnchorNavGroup({ collapsed, onExpandRequest }: { collapsed: boolean; onExpandRequest: () => void }) {
  const location = useLocation();
  const currentRoleCode = useIdentityStore((state) => state.currentIdentity?.roleCode);
  const permissions = useIdentityStore((state) => state.permissions);
  const visibleItems = anchorSubItems.filter((item) => {
    if (item.to === "/anchor-accounts") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(currentRoleCode))
        && (permissions.includes("*") || permissions.includes("anchor:view"));
    }
    if (item.to === "/anchor-reviews") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(currentRoleCode))
        && (permissions.includes("*") || permissions.includes("anchor:registration:review"));
    }
    return false;
  });
  const isChildActive = visibleItems.some((item) => location.pathname.startsWith(item.to));
  const [open, setOpen] = useState(isChildActive);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        title="主播账号管理"
        onClick={() => {
          if (collapsed) {
            onExpandRequest();
            return;
          }
          setOpen((prev) => !prev);
        }}
        className={`flex w-full items-center rounded-[16px] text-sm font-medium transition-all duration-200 ${collapsed ? "justify-center px-2 py-3" : "gap-3 px-4 py-3"} ${isChildActive ? "bg-feishu-pale text-feishu-blue shadow-[0_8px_20px_rgba(76,114,255,0.08)]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
      >
        <UserRoundCheck size={18} />
        {!collapsed && <span className="flex-1 text-left">主播账号管理</span>}
        {!collapsed && (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
      </button>
      {!collapsed && open && (
        <div className="mt-1 flex flex-col gap-1 pl-4">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `flex items-center gap-3 rounded-[14px] px-4 py-2.5 text-sm font-medium transition-all duration-200 ${isActive ? "bg-feishu-pale text-feishu-blue shadow-[0_6px_16px_rgba(76,114,255,0.06)]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskNavGroup({ collapsed, onExpandRequest }: { collapsed: boolean; onExpandRequest: () => void }) {
  const location = useLocation();
  const isChildActive = taskSubItems.some((item) => location.pathname.startsWith(item.to));
  const [open, setOpen] = useState(isChildActive);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        title="待办任务"
        onClick={() => {
          if (collapsed) {
            onExpandRequest();
            return;
          }
          setOpen((prev) => !prev);
        }}
        className={`flex w-full items-center rounded-[16px] text-sm font-medium transition-all duration-200 ${collapsed ? "justify-center px-2 py-3" : "gap-3 px-4 py-3"} ${isChildActive ? "bg-feishu-pale text-feishu-blue shadow-[0_8px_20px_rgba(76,114,255,0.08)]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
      >
        <ListTodo size={18} />
        {!collapsed && <span className="flex-1 text-left">待办任务</span>}
        {!collapsed && (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
      </button>
      {!collapsed && open && (
        <div className="mt-1 flex flex-col gap-1 pl-4">
          {taskSubItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) => `flex items-center gap-3 rounded-[14px] px-4 py-2.5 text-sm font-medium transition-all duration-200 ${isActive ? "bg-feishu-pale text-feishu-blue shadow-[0_6px_16px_rgba(76,114,255,0.06)]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskBoardNavGroup({ collapsed, onExpandRequest }: { collapsed: boolean; onExpandRequest: () => void }) {
  const location = useLocation();
  const currentRoleCode = useIdentityStore((state) => state.currentIdentity?.roleCode);
  const permissions = useIdentityStore((state) => state.permissions);
  const visibleItems = taskBoardSubItems.filter((item) => {
    if (item.to === "/tasks/dashboard/daily-board") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(currentRoleCode))
        && (permissions.includes("*") || permissions.includes("task:report:view"));
    }
    if (item.to === "/tasks/dashboard/hall-daily-board") {
      return Boolean(currentRoleCode && currentRoleCode === "HALL_MANAGER")
        && (permissions.includes("*") || permissions.includes("task:report:view"));
    }
    if (item.to === "/tasks/dashboard/temporary-board") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(currentRoleCode));
    }
    if (item.to === "/tasks/dashboard/workflow-board") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(currentRoleCode));
    }
    return false;
  });
  const isChildActive = visibleItems.some((item) => location.pathname.startsWith(item.to));
  const [open, setOpen] = useState(isChildActive);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  if (!visibleItems.length) return null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        title="任务看板"
        onClick={() => {
          if (collapsed) {
            onExpandRequest();
            return;
          }
          setOpen((prev) => !prev);
        }}
        className={`flex w-full items-center rounded-[16px] text-sm font-medium transition-all duration-200 ${collapsed ? "justify-center px-2 py-3" : "gap-3 px-4 py-3"} ${isChildActive ? "bg-feishu-pale text-feishu-blue shadow-[0_8px_20px_rgba(76,114,255,0.08)]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
      >
        <ClipboardList size={18} />
        {!collapsed && <span className="flex-1 text-left">任务看板</span>}
        {!collapsed && (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
      </button>
      {!collapsed && open && (
        <div className="mt-1 flex flex-col gap-1 pl-4">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `flex items-center gap-3 rounded-[14px] px-4 py-2.5 text-sm font-medium transition-all duration-200 ${isActive ? "bg-feishu-pale text-feishu-blue shadow-[0_6px_16px_rgba(76,114,255,0.06)]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskIssueNavGroup({ collapsed, onExpandRequest }: { collapsed: boolean; onExpandRequest: () => void }) {
  const location = useLocation();
  const currentRoleCode = useIdentityStore((state) => state.currentIdentity?.roleCode);
  const permissions = useIdentityStore((state) => state.permissions);
  const visibleItems = issueSubItems.filter((item) => {
    if (item.to === "/tasks/templates/daily-library") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"].includes(currentRoleCode))
        && (permissions.includes("*") || permissions.includes("task:template:manage") || permissions.includes("task:assignment:manage"));
    }
    if (item.to === "/tasks/issue/hall-daily") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(currentRoleCode));
    }
    if (item.to === "/tasks/issue/temporary") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(currentRoleCode));
    }
    if (item.to === "/tasks/collaboration/workflow") {
      return Boolean(currentRoleCode && ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(currentRoleCode));
    }
    return false;
  });
  const isChildActive = visibleItems.some((item) => location.pathname.startsWith(item.to));
  const [open, setOpen] = useState(isChildActive);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        title="任务发布"
        onClick={() => {
          if (collapsed) {
            onExpandRequest();
            return;
          }
          setOpen((prev) => !prev);
        }}
        className={`flex w-full items-center rounded-[16px] text-sm font-medium transition-all duration-200 ${collapsed ? "justify-center px-2 py-3" : "gap-3 px-4 py-3"} ${isChildActive ? "bg-feishu-pale text-feishu-blue shadow-[0_8px_20px_rgba(76,114,255,0.08)]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
      >
        <Send size={18} />
        {!collapsed && <span className="flex-1 text-left">任务发布</span>}
        {!collapsed && (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
      </button>
      {!collapsed && open && (
        <div className="mt-1 flex flex-col gap-1 pl-4">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `flex items-center gap-3 rounded-[14px] px-4 py-2.5 text-sm font-medium transition-all duration-200 ${isActive ? "bg-feishu-pale text-feishu-blue shadow-[0_6px_16px_rgba(76,114,255,0.06)]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const setPermissions = useIdentityStore((state) => state.setPermissions);
  const navigate = useNavigate();
  const feishuAppId = localStorage.getItem("feishu_entry_app_id");
  const showFeishuRelogin = Boolean(feishuAppId && isInFeishuApp());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  });

  useEffect(() => {
    if (currentIdentity) api.get<string[]>("/me/permissions").then(setPermissions).catch(console.error);
  }, [currentIdentity, setPermissions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  return (
    <div className="min-h-screen text-slate-900">
      <header className="fixed left-0 right-0 top-0 z-20 flex h-[72px] items-center justify-between border-b border-white/70 bg-white/90 px-6 shadow-[0_10px_28px_rgba(15,23,42,0.05)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <div className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-gradient-to-br from-feishu-blue to-[#7B9DFF] text-[18px] font-semibold text-white shadow-[0_14px_30px_rgba(76,114,255,0.24)]">管</div>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-[-0.02em] text-slate-950">千广组织协同成长平台</p>
            <p className="text-[12px] text-slate-500">聚焦组织、账号与主播管理</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <IdentitySwitcher />
          <span className="max-w-[180px] truncate text-sm text-slate-600">{user?.nickname}</span>
          {showFeishuRelogin && (
            <button
              type="button"
              title="飞书重新登录"
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs text-feishu-blue transition hover:bg-feishu-pale"
              onClick={() => { window.location.href = `/feishu-entry?appId=${feishuAppId}`; }}
            >
              <RefreshCw size={14} />
              <span>飞书重登</span>
            </button>
          )}
          <button
            type="button"
            title="退出登录"
            className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={() => { logout(); navigate("/login"); }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <aside className={`fixed bottom-0 left-0 top-[72px] z-10 flex flex-col border-r border-white/70 bg-white/90 shadow-[8px_0_24px_rgba(15,23,42,0.03)] backdrop-blur-xl transition-all duration-300 ${sidebarCollapsed ? "w-20" : "w-60"}`}>
        <nav className={`flex flex-1 flex-col gap-1.5 overflow-y-auto py-5 ${sidebarCollapsed ? "px-2" : "px-3"}`}>
          <TaskNavGroup collapsed={sidebarCollapsed} onExpandRequest={() => setSidebarCollapsed(false)} />
          <PermissionGate roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"]} permissions={["org:view", "anchor:view"]}>
            <OrgNavGroup collapsed={sidebarCollapsed} onExpandRequest={() => setSidebarCollapsed(false)} />
          </PermissionGate>
          <PermissionGate roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"]} permission="anchor:view">
            <AnchorNavGroup collapsed={sidebarCollapsed} onExpandRequest={() => setSidebarCollapsed(false)} />
          </PermissionGate>
          <TaskBoardNavGroup collapsed={sidebarCollapsed} onExpandRequest={() => setSidebarCollapsed(false)} />
          <TaskIssueNavGroup collapsed={sidebarCollapsed} onExpandRequest={() => setSidebarCollapsed(false)} />
        </nav>

        <div className={`border-t border-slate-100 py-3 ${sidebarCollapsed ? "px-2" : "px-3"}`}>
          <NavLink
            to="/settings"
            title="个人账号管理"
            className={({ isActive }) =>
              `flex items-center rounded-[16px] transition-all duration-200 ${sidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"} ${isActive ? "bg-feishu-pale text-feishu-blue shadow-[0_8px_20px_rgba(76,114,255,0.08)]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`
            }
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-feishu-blue to-[#7B9DFF] text-xs font-semibold text-white shadow-[0_4px_10px_rgba(76,114,255,0.22)]">
              {user?.nickname?.[0] ?? "我"}
            </div>
            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight text-slate-800">{user?.nickname ?? "—"}</p>
                  <p className="text-[11px] leading-tight text-slate-400">个人账号管理</p>
                </div>
                <Settings2 size={15} className="shrink-0 text-slate-400" />
              </>
            )}
          </NavLink>
        </div>
      </aside>
      <main className={`pt-[72px] transition-all duration-300 ${sidebarCollapsed ? "pl-20" : "pl-60"}`}>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
