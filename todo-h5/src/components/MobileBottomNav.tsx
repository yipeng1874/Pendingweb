import { BarChart3, ListTodo, Send } from "lucide-react";
import { canPublishWorkflow } from "../services/workflowPublish";
import { NavLink } from "react-router-dom";
import { canOpenDashboard } from "../utils/entry";
import { useAuthStore } from "../stores/auth";

export function MobileBottomNav() {
  const identity = useAuthStore((state) => state.currentIdentity);
  return (
    <nav className="mobile-bottom-nav" aria-label="手机端主导航">
      {canOpenDashboard(identity) ? <NavLink to="/dashboard" className={({ isActive }) => `mobile-nav-item ${isActive ? "mobile-nav-active" : ""}`}><BarChart3 size={19} /><span>仪表台</span></NavLink> : null}
      <NavLink to="/todos" className={({ isActive }) => `mobile-nav-item ${isActive ? "mobile-nav-active" : ""}`}><ListTodo size={19} /><span>我的待办</span></NavLink>
      {canPublishWorkflow(identity) ? <NavLink to="/publish" className={({ isActive }) => `mobile-nav-item ${isActive ? "mobile-nav-active" : ""}`}><Send size={19} /><span>任务发布</span></NavLink> : null}
    </nav>
  );
}
