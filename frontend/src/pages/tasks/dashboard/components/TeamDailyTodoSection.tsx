import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import type { TeamTaskRecord } from "../../../../services/teamDaily";
import { TeamDailyRecordCard } from "./TeamDailyRecordCard";
import { TaskDashboardSection } from "./TaskDashboardSection";

type Props = {
  records: TeamTaskRecord[];
  error: string;
  onRefresh: () => Promise<void>;
  isHighlighted?: boolean;
  onHighlightDone?: () => void;
};
export function TeamDailyTodoSection({ records, error, onRefresh, isHighlighted, onHighlightDone }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"today" | "overdue">("today");
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const pending = (r: TeamTaskRecord) => r.status !== "submitted" && !r.leaveRequests?.some(l => l.status === "approved");
  const overdue = records.filter(r => r.recordDate < today && pending(r));
  const visible = view === "today" ? records.filter(r => r.recordDate === today) : overdue;
  useEffect(() => {
    const refresh = () => { void onRefresh(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [onRefresh]);
  return <TaskDashboardSection icon={<Building2 size={18} />} title="团队管理日常任务"
    description="每个团队每日共同完成一份，由团队管理员填写并提交。"
    count={visible.length} pendingCount={visible.filter(pending).length} urgentCount={0} overdueCount={overdue.length}
    tone="bg-teal-50 text-teal-600" sectionKey="teamDaily" isHighlighted={isHighlighted} onHighlightDone={onHighlightDone}
    emptyText={error || (view === "today" ? "今日暂无团队任务；立即生效的任务发布后会直接显示在这里。" : "当前没有昨日待补录的团队任务。")}
    action={ <div className="flex gap-3 text-sm"><button className={view === "today" ? "text-blue-600" : "text-slate-500"} onClick={() => setView("today")}>今日</button><button className={view === "overdue" ? "text-blue-600" : "text-slate-500"} onClick={() => setView("overdue")}>昨日补录</button><button className="text-blue-600" onClick={() => void onRefresh()}>刷新</button></div>}>
    {visible.map(record => <TeamDailyRecordCard key={record.id} record={record} expanded={expanded.has(record.id)} onToggle={() => setExpanded(prev => { const next = new Set(prev); next.has(record.id) ? next.delete(record.id) : next.add(record.id); return next; })} onRefresh={onRefresh} />)}
  </TaskDashboardSection>;
}
