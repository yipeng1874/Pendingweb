import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { useAuthStore } from "./stores/authStore";
import { useIdentityStore } from "./stores/identityStore";

const LoginPage = lazy(() => import("./pages/login/LoginPage").then((m) => ({ default: m.LoginPage })));
const IdentityPage = lazy(() => import("./pages/identity/IdentityPage").then((m) => ({ default: m.IdentityPage })));
const OrganizationPage = lazy(() => import("./pages/organization/OrganizationPage").then((m) => ({ default: m.OrganizationPage })));
const FeishuConfigPage = lazy(() => import("./pages/organization/FeishuConfigPage").then((m) => ({ default: m.FeishuConfigPage })));
const AccountsPage = lazy(() => import("./pages/accounts/AccountsPage").then((m) => ({ default: m.AccountsPage })));
const AnchorAccountsPage = lazy(() => import("./pages/anchors/AnchorAccountsPage").then((m) => ({ default: m.AnchorAccountsPage })));
const AnchorReviewsPage = lazy(() => import("./pages/anchors/AnchorReviewsPage").then((m) => ({ default: m.AnchorReviewsPage })));
const AnchorRegisterPage = lazy(() => import("./pages/anchor-register/AnchorRegisterPage").then((m) => ({ default: m.AnchorRegisterPage })));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const FeishuCallbackPage = lazy(() => import("./pages/auth/FeishuCallbackPage").then((m) => ({ default: m.FeishuCallbackPage })));
const FeishuEntryPage = lazy(() => import("./pages/feishu-entry/FeishuEntryPage").then((m) => ({ default: m.FeishuEntryPage })));
const TaskDashboardPage = lazy(() => import("./pages/tasks/dashboard/TaskDashboardPage").then((m) => ({ default: m.TaskDashboardPage })));
const DailyTaskDashboardPage = lazy(() => import("./pages/tasks/dashboard/DailyTaskDashboardPage").then((m) => ({ default: m.DailyTaskDashboardPage })));
const TemporaryTaskDashboardPage = lazy(() => import("./pages/tasks/dashboard/TemporaryTaskDashboardPage").then((m) => ({ default: m.TemporaryTaskDashboardPage })));
const ReminderPage = lazy(() => import("./pages/tasks/reminder/ReminderPage").then((m) => ({ default: m.ReminderPage })));
const DailyIssuePage = lazy(() => import("./pages/tasks/manage/DailyIssuePage").then((m) => ({ default: m.DailyIssuePage })));
const TemporaryIssuePage = lazy(() => import("./pages/tasks/manage/TemporaryIssuePage").then((m) => ({ default: m.TemporaryIssuePage })));
const HallDailyIssuePage = lazy(() => import("./pages/tasks/manage/HallDailyIssuePage").then((m) => ({ default: m.HallDailyIssuePage })));
const ProgressReportPage = lazy(() => import("./pages/tasks/manage/ProgressReportPage").then((m) => ({ default: m.ProgressReportPage })));
const CockpitPage = lazy(() => import("./pages/tasks/cockpit/CockpitPage").then((m) => ({ default: m.CockpitPage })));
const WorkflowTaskPage = lazy(() => import("./pages/tasks/collaboration/WorkflowTaskPage").then((m) => ({ default: m.WorkflowTaskPage })));
const WorkflowBoardPage = lazy(() => import("./pages/tasks/dashboard/WorkflowBoardPage").then((m) => ({ default: m.WorkflowBoardPage })));
const HallDailyDashboardPage = lazy(() => import("./pages/tasks/dashboard/HallDailyDashboardPage").then((m) => ({ default: m.HallDailyDashboardPage })));

function Protected() {
  const token = useAuthStore((state) => state.token);
  return token ? <AppLayout /> : <Navigate to="/login" replace />;
}

function RoleProtected({
  roles,
  permissions,
  children,
}: {
  roles?: Array<"DEV_ADMIN" | "HQ_ADMIN" | "BASE_ADMIN" | "TEAM_ADMIN" | "HALL_MANAGER" | "ANCHOR">;
  permissions?: string[];
  children: JSX.Element;
}) {
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const currentPermissions = useIdentityStore((state) => state.permissions);

  if (!currentIdentity) return <Navigate to="/identity" replace />;

  const roleAllowed = !roles?.length || roles.includes(currentIdentity.roleCode);
  const permissionAllowed = !permissions?.length || permissions.some((permission) => currentPermissions.includes("*") || currentPermissions.includes(permission));

  return roleAllowed && permissionAllowed ? children : <Navigate to="/tasks/dashboard" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 14 }}>页面加载中...</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/anchor-register" element={<AnchorRegisterPage />} />
        <Route path="/pc/auth/callback" element={<FeishuCallbackPage />} />
        <Route path="/feishu-entry" element={<FeishuEntryPage />} />
        <Route path="/identity" element={<IdentityPage />} />
        <Route element={<Protected />}>
          <Route path="/organization" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"]} permissions={["org:view"]}><OrganizationPage /></RoleProtected>} />
          <Route path="/organization/feishu-configs" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"]} permissions={["org:view"]}><FeishuConfigPage /></RoleProtected>} />
          <Route path="/accounts" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"]} permissions={["account:view"]}><AccountsPage /></RoleProtected>} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/anchor-reviews" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"]} permissions={["anchor:registration:review"]}><AnchorReviewsPage /></RoleProtected>} />
          <Route path="/anchor-accounts" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"]} permissions={["anchor:view"]}><AnchorAccountsPage /></RoleProtected>} />
          <Route path="/anchors" element={<Navigate to="/anchor-accounts" replace />} />
          {/* 待办任务模块 */}
          <Route path="/tasks" element={<Navigate to="/tasks/cockpit" replace />} />
          <Route path="/tasks/cockpit" element={<CockpitPage />} />
          <Route path="/tasks/dashboard" element={<TaskDashboardPage />} />
          <Route path="/tasks/dashboard/daily-board" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"]} permissions={["task:report:view"]}><DailyTaskDashboardPage /></RoleProtected>} />
          <Route path="/tasks/dashboard/hall-daily-board" element={<RoleProtected roles={["HALL_MANAGER"]} permissions={["task:report:view"]}><HallDailyDashboardPage /></RoleProtected>} />
          <Route path="/tasks/dashboard/temporary-board" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"]}><TemporaryTaskDashboardPage /></RoleProtected>} />
          <Route path="/tasks/dashboard/workflow-board" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"]}><WorkflowBoardPage /></RoleProtected>} />
          <Route path="/tasks/reminders" element={<ReminderPage />} />
          <Route path="/tasks/templates/daily-library" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"]} permissions={["task:template:manage"]}><DailyIssuePage /></RoleProtected>} />
          <Route path="/tasks/issue/daily" element={<Navigate to="/tasks/templates/daily-library" replace />} />
          <Route path="/tasks/issue/temporary" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"]}><TemporaryIssuePage /></RoleProtected>} />
          <Route path="/tasks/issue/hall-daily" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"]}><HallDailyIssuePage /></RoleProtected>} />
          <Route path="/tasks/collaboration/workflow" element={<RoleProtected roles={["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"]}><WorkflowTaskPage /></RoleProtected>} />
          <Route path="/tasks/issue" element={<Navigate to="/tasks/issue/daily" replace />} />
          <Route path="/tasks/assignment-management" element={<Navigate to="/tasks/issue/temporary" replace />} />
          <Route path="/tasks/assignment-management/daily" element={<Navigate to="/tasks/templates/daily-library" replace />} />
          <Route path="/tasks/assignment-management/temporary" element={<Navigate to="/tasks/issue/temporary" replace />} />
          <Route path="/tasks/templates" element={<Navigate to="/tasks/issue/temporary" replace />} />
          <Route path="/tasks/templates/daily" element={<Navigate to="/tasks/templates/daily-library" replace />} />
          <Route path="/tasks/templates/temporary" element={<Navigate to="/tasks/issue/temporary" replace />} />
          <Route path="/tasks/assignments" element={<Navigate to="/tasks/assignment-management" replace />} />
          <Route path="/tasks/assignments/new-temp" element={<Navigate to="/tasks/issue/temporary" replace />} />
          <Route path="/tasks/report" element={<ProgressReportPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/organization" replace />} />
      </Routes>
    </Suspense>
  );
}
