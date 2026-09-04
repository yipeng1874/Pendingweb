import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { IdentityRequiredRoute } from "./components/IdentityRequiredRoute";

const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const IdentityPage = lazy(() => import("./pages/IdentityPage").then((m) => ({ default: m.IdentityPage })));
const TemporaryPublishPage = lazy(() => import("./pages/TemporaryPublishPage").then(m => ({ default: m.TemporaryPublishPage })));
const PublishTypePage = lazy(() => import("./pages/PublishTypePage").then(m => ({ default: m.PublishTypePage })));
const BroadcastPublishPage = lazy(() => import("./pages/BroadcastPublishPage").then(m => ({ default: m.BroadcastPublishPage })));
const WorkflowPublishPage = lazy(() => import("./pages/WorkflowPublishPage").then((m) => ({ default: m.WorkflowPublishPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const TodoListPage = lazy(() => import("./pages/TodoListPage").then((m) => ({ default: m.TodoListPage })));
const TodoDetailPage = lazy(() => import("./pages/TodoDetailPage").then((m) => ({ default: m.TodoDetailPage })));
const ReminderPage = lazy(() => import("./pages/ReminderPage").then((m) => ({ default: m.ReminderPage })));
const FeishuCallbackPage = lazy(() => import("./pages/FeishuCallbackPage").then((m) => ({ default: m.FeishuCallbackPage })));
const FeishuEntryPage = lazy(() => import("./pages/FeishuEntryPage").then((m) => ({ default: m.FeishuEntryPage })));

export function App() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", background: "#f8fafc" }}>页面加载中...</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<FeishuCallbackPage />} />
        <Route path="/feishu-entry" element={<FeishuEntryPage />} />
        <Route path="/identity" element={<ProtectedRoute><IdentityPage /></ProtectedRoute>} />
        <Route path="/dashboard" element={<IdentityRequiredRoute><DashboardPage /></IdentityRequiredRoute>} />
        <Route path="/todos" element={<IdentityRequiredRoute><TodoListPage /></IdentityRequiredRoute>} />
        <Route path="/publish" element={<IdentityRequiredRoute><PublishTypePage /></IdentityRequiredRoute>} />
        <Route path="/publish/workflow" element={<IdentityRequiredRoute><WorkflowPublishPage /></IdentityRequiredRoute>} />
        <Route path="/publish/temporary" element={<IdentityRequiredRoute><TemporaryPublishPage /></IdentityRequiredRoute>} />
        <Route path="/publish/broadcast" element={<IdentityRequiredRoute><BroadcastPublishPage /></IdentityRequiredRoute>} />
        <Route path="/todos/hall/:id" element={<IdentityRequiredRoute><TodoDetailPage kind="hall" /></IdentityRequiredRoute>} />
        <Route path="/todos/:id" element={<IdentityRequiredRoute><TodoDetailPage /></IdentityRequiredRoute>} />
        <Route path="/reminders" element={<IdentityRequiredRoute><ReminderPage /></IdentityRequiredRoute>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
