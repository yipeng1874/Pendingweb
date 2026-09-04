import { useEffect, useState } from "react";
import { temporaryApi } from "../services/temporaryPublish";
import { PublishHeader } from "../components/PublishHeader";
import { Link, Navigate } from "react-router-dom";
import { GitBranch, Send, ChevronRight } from "lucide-react";
import { useAuthStore } from "../stores/auth";
import { canPublishWorkflow } from "../services/workflowPublish";
import { MobileBottomNav } from "../components/MobileBottomNav";
import "./workflowPublish.css";
import "./broadcastPublish.css";

export function PublishTypePage() {
  const identity = useAuthStore(s => s.currentIdentity);
  const [temporaryAllowed, setTemporaryAllowed] = useState(false);
  useEffect(() => { let cancelled = false; setTemporaryAllowed(false); temporaryApi.permissions().then(p => { if (!cancelled) setTemporaryAllowed(p.includes("*") || p.includes("task:assignment:manage")); }).catch(() => {}); return () => { cancelled = true; }; }, [identity?.id]);
  if (!canPublishWorkflow(identity)) return <Navigate to="/todos" replace />;
  return <div className="page-shell"><div className="mobile-page bottom-safe wp-page bp-page">
    <PublishHeader title="任务发布" icon={<Send size={19} />} />
    <main className="wp-content bp-types">
      <Link to="/publish/workflow"><GitBranch /><div><strong>流转任务</strong><p>按节点顺序，由不同执行人依次完成</p></div><ChevronRight /></Link>
      {["HALL_MANAGER", "TEAM_ADMIN"].includes(identity!.roleCode) && <Link to="/publish/broadcast"><Send /><div><strong>群发任务</strong><p>一套题目发给多人，各自独立完成</p></div><ChevronRight /></Link>}
      {temporaryAllowed && <Link to="/publish/temporary"><Send /><div><strong>临时任务 · 触达式</strong><p>搜索选择接收账号，各自独立完成</p></div><ChevronRight /></Link>}
    </main><MobileBottomNav />
  </div></div>;
}
