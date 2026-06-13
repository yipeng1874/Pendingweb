import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { IdentityRequiredRoute } from "./components/IdentityRequiredRoute";

const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const IdentityPage = lazy(() => import("./pages/IdentityPage").then((m) => ({ default: m.IdentityPage })));
const TodoListPage = lazy(() => import("./pages/TodoListPage").then((m) => ({ default: m.TodoListPage })));
const TodoDetailPage = lazy(() => import("./pages/TodoDetailPage").then((m) => ({ default: m.TodoDetailPage })));
const ReminderPage = lazy(() => import("./pages/ReminderPage").then((m) => ({ default: m.ReminderPage })));
const FeishuCallbackPage = lazy(() => import("./pages/FeishuCallbackPage").then((m) => ({ default: m.FeishuCallbackPage })));

export function App() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", background: "#f8fafc" }}>页面加载中...</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<FeishuCallbackPage />} />
        <Route path="/identity" element={<ProtectedRoute><IdentityPage /></ProtectedRoute>} />
        <Route path="/todos" element={<IdentityRequiredRoute><TodoListPage /></IdentityRequiredRoute>} />
        <Route path="/todos/:id" element={<IdentityRequiredRoute><TodoDetailPage /></IdentityRequiredRoute>} />
        <Route path="/reminders" element={<IdentityRequiredRoute><ReminderPage /></IdentityRequiredRoute>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
