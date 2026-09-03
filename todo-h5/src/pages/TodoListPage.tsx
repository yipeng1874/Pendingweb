import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Building2, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, GitBranch, ListTodo, LogOut, Megaphone, RefreshCcw, Send, UserRound, Users } from "lucide-react";
import { taskApi } from "../services/task";
import { useAuthStore } from "../stores/auth";
import { WorkflowCard, BroadcastCard } from "../components/CollaborationTaskCards";
import { MobileBottomNav } from "../components/MobileBottomNav";
import type { BroadcastTask, HallDailyRecord, TaskRecord, WorkflowTask } from "../types";

type CategoryKey = "daily" | "hall" | "account" | "anchor" | "manager" | "workflow" | "broadcast";

const categories: Array<{ key: CategoryKey; label: string; icon: ReactNode; tone: string }> = [
  { key: "daily", label: "主播日常", icon: <CheckCircle2 size={20} />, tone: "blue" },
  { key: "hall", label: "厅管日常", icon: <Building2 size={20} />, tone: "teal" },
  { key: "account", label: "触达式", icon: <Send size={20} />, tone: "sky" },
  { key: "anchor", label: "主播式", icon: <UserRound size={20} />, tone: "green" },
  { key: "manager", label: "管理式", icon: <Users size={20} />, tone: "violet" },
  { key: "workflow", label: "流转任务", icon: <GitBranch size={20} />, tone: "indigo" },
  { key: "broadcast", label: "厅内直达", icon: <Megaphone size={20} />, tone: "orange" },
];

const roleLabels: Record<string, string> = {
  DEV_ADMIN: "开发管理员",
  HQ_ADMIN: "总部管理员",
  BASE_ADMIN: "基地运营",
  TEAM_ADMIN: "团队运营",
  HALL_MANAGER: "厅管",
  ANCHOR: "主播",
};

function isComplete(status: string) {
  return status === "submitted" || status === "completed";
}

function workflowComplete(task: WorkflowTask, userId?: string) {
  const mySteps = task.steps.filter((step) => step.assigneeUserId === userId);
  return task.status === "completed" || (mySteps.length > 0 && mySteps.every((step) => step.status === "completed"));
}

function taskStatusMeta(status: string) {
  if (status === "submitted" || status === "completed") return { text: "已完成", cls: "tag-green" };
  if (status === "in_progress" || status === "active") return { text: "进行中", cls: "tag-blue" };
  if (status === "overdue") return { text: "已逾期", cls: "tag-red" };
  return { text: "待开始", cls: "tag-slate" };
}

function temporaryModeMeta(record: TaskRecord) {
  if (record.assignment?.temporaryMode === "MANAGER") return { label: "管理式", badge: "tag-purple" };
  if (record.assignment?.temporaryMode === "ANCHOR") return { label: "主播式", badge: "tag-blue" };
  return { label: "触达式", badge: "tag-slate" };
}

function formatDeadline(value?: string | null) {
  if (!value) return "无截止时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function DashboardSection({ icon, title, count, tone, children }: { icon: ReactNode; title: string; count: number; tone: string; children: ReactNode }) {
  return <section className="dashboard-section card"><div className="dashboard-section-header"><span className={`dashboard-section-icon ${tone}`}>{icon}</span><h2>{title}</h2><span className="dashboard-section-count">{count}</span></div><div className="list">{children}</div></section>;
}

type CategoryEntry = { id: string; completed: boolean; content: ReactNode };

function CompletionGroupedList({ entries }: { entries: CategoryEntry[] }) {
  const pending = entries.filter((entry) => !entry.completed);
  const completed = entries.filter((entry) => entry.completed);
  return <>
    {pending.map((entry) => <div key={entry.id}>{entry.content}</div>)}
    {completed.length > 0 ? <details className="todo-completed-group">
      <summary><CheckCircle2 size={16} /><span>已完成（{completed.length}）</span><ChevronDown size={16} /></summary>
      <div className="list">{completed.map((entry) => <div key={entry.id}>{entry.content}</div>)}</div>
    </details> : null}
  </>;
}

function RecordCard({ record, daily, onOpen }: { record: TaskRecord; daily: boolean; onOpen: () => void }) {
  const status = taskStatusMeta(record.status);
  const mode = daily ? null : temporaryModeMeta(record);
  return <button className="todo-card-button" onClick={onOpen}><div className="dashboard-task-card"><div className="dashboard-card-topline"><div className="dashboard-tags"><span className={`tag ${daily ? "tag-blue" : mode?.badge}`}>{daily ? "主播日常" : mode?.label}</span>{daily && record.recordDate ? <span className="tag tag-slate">{record.recordDate}</span> : null}</div><span className={`tag ${status.cls}`}>{status.text}</span></div><p className="todo-title">{record.assignment?.template?.title ?? record.subjectName ?? record.subjectKey}</p>{record.assignment?.template?.description?.trim() ? <p className="dashboard-description">{record.assignment.template.description.trim()}</p> : null}<div className="dashboard-meta"><span>进度 {record.doneItems}/{record.totalItems}</span><span>截止 {formatDeadline(record.deadlineAt)}</span><span>{record.subjectName ?? record.subjectKey}</span></div><div className="dashboard-progress"><span style={{ width: `${record.totalItems ? Math.round(record.doneItems / record.totalItems * 100) : 0}%` }} /></div></div></button>;
}

function HallCard({ record }: { record: HallDailyRecord }) {
  const status = taskStatusMeta(record.status);
  return <div className="dashboard-task-card"><div className="dashboard-card-topline"><div className="dashboard-tags"><span className="tag tag-teal">厅管日常</span><span className="tag tag-slate">{record.recordDate}</span></div><span className={`tag ${status.cls}`}>{status.text}</span></div><p className="todo-title">{record.assignment?.template?.title ?? "厅管日常任务"}</p><div className="dashboard-meta"><span>{record.hallOrg?.name ?? "当前厅"}</span><span>进度 {record.doneItems}/{record.totalItems}</span></div><div className="dashboard-progress dashboard-progress-teal"><span style={{ width: `${record.totalItems ? Math.round(record.doneItems / record.totalItems * 100) : 0}%` }} /></div></div>;
}

export function TodoListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const category = categories.find((item) => item.key === searchParams.get("category"));
  const hideEmpty = searchParams.get("hideEmpty") !== "0";
  const logout = useAuthStore((state) => state.logout);
  const currentIdentity = useAuthStore((state) => state.currentIdentity);
  const [records, setRecords] = useState<TaskRecord[]>([]);
  const [hallRecords, setHallRecords] = useState<HallDailyRecord[]>([]);
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowTask[]>([]);
  const [broadcastTasks, setBroadcastTasks] = useState<BroadcastTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoryErrors, setCategoryErrors] = useState<Partial<Record<CategoryKey, string>>>({});
  const requestId = useRef(0);

  async function load() {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const [taskData, hallData, workflowData, broadcastData] = await Promise.allSettled([
        taskApi.getMyRecords(),
        taskApi.getHallDailyRecords(),
        taskApi.getWorkflowTasks(),
        taskApi.getBroadcastTasks(),
      ]);
      if (id !== requestId.current) return;
      setRecords(taskData.status === "fulfilled" ? taskData.value : []);
      setHallRecords(hallData.status === "fulfilled" ? hallData.value : []);
      setWorkflowTasks(workflowData.status === "fulfilled" ? workflowData.value : []);
      setBroadcastTasks(broadcastData.status === "fulfilled" ? broadcastData.value : []);
      const errors: Partial<Record<CategoryKey, string>> = {};
      for (const key of ["daily", "account", "anchor", "manager"] as const) {
        if (taskData.status === "rejected") errors[key] = "任务加载失败，请刷新重试";
      }
      if (hallData.status === "rejected") errors.hall = "厅管日常加载失败，请刷新重试";
      if (workflowData.status === "rejected") errors.workflow = "流转任务加载失败，请刷新重试";
      if (broadcastData.status === "rejected") errors.broadcast = "厅内直达加载失败，请刷新重试";
      setCategoryErrors(errors);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : "加载待办失败，请刷新重试");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [currentIdentity?.id]);

  useEffect(() => { window.scrollTo(0, 0); }, [category?.key]);

  const dailyRecords = records.filter((item) => item.assignment?.category === "DAILY");
  const temporaryRecords = records.filter((item) => item.assignment?.category === "TEMPORARY");
  const recordGroups: Partial<Record<CategoryKey, TaskRecord[]>> = {
    daily: dailyRecords,
    account: temporaryRecords.filter((item) => !item.assignment?.temporaryMode || item.assignment.temporaryMode === "ACCOUNT"),
    anchor: temporaryRecords.filter((item) => item.assignment?.temporaryMode === "ANCHOR"),
    manager: temporaryRecords.filter((item) => item.assignment?.temporaryMode === "MANAGER"),
  };
  const pendingDaily = dailyRecords.filter((item) => !isComplete(item.status));
  const dailyTotal = pendingDaily.reduce((sum, item) => sum + item.totalItems, 0);
  const dailyDone = pendingDaily.reduce((sum, item) => sum + item.doneItems, 0);
  const dailyProgress = dailyTotal ? Math.min(100, Math.round(dailyDone / dailyTotal * 100)) : 0;
  const groups = categories.map((item) => {
    const rows = recordGroups[item.key] ?? [];
    let total = rows.length;
    let pending = rows.filter((row) => !isComplete(row.status)).length;
    if (item.key === "hall") {
      total = hallRecords.length;
      pending = hallRecords.filter((row) => !isComplete(row.status)).length;
    } else if (item.key === "workflow") {
      total = workflowTasks.length;
      pending = workflowTasks.filter((row) => !workflowComplete(row, currentIdentity?.userId)).length;
    } else if (item.key === "broadcast") {
      total = broadcastTasks.length;
      pending = broadcastTasks.filter((row) => !isComplete(row.myRecord.status)).length;
    }
    return { ...item, total, pending, error: categoryErrors[item.key] };
  });
  const pendingCount = groups.reduce((sum, item) => sum + item.pending, 0);
  const visibleGroups = hideEmpty ? groups.filter((item) => item.total > 0 || item.error) : groups;
  const selectedGroup = groups.find((item) => item.key === category?.key);
  const incompleteSummary = category ? Boolean(selectedGroup?.error) : Object.keys(categoryErrors).length > 0;

  function categoryEntries(): CategoryEntry[] {
    if (!category) return [];
    if (category.key === "hall") return hallRecords.map((record) => ({ id: record.id, completed: isComplete(record.status), content: <button className="todo-card-button" onClick={() => navigate(`/todos/hall/${record.id}`)}><HallCard record={record} /></button> }));
    if (category.key === "workflow") return workflowTasks.map((task) => ({ id: task.id, completed: workflowComplete(task, currentIdentity?.userId), content: <WorkflowCard task={task} currentUserId={currentIdentity?.userId} onUpdate={(updated) => setWorkflowTasks((rows) => rows.map((row) => row.id === updated.id ? updated : row))} /> }));
    if (category.key === "broadcast") return broadcastTasks.map((task) => ({ id: task.id, completed: isComplete(task.myRecord.status), content: <BroadcastCard task={task} onUpdate={(updated) => setBroadcastTasks((rows) => rows.map((row) => row.id === updated.id ? updated : row))} /> }));
    return (recordGroups[category.key] ?? []).map((record) => ({ id: record.id, completed: isComplete(record.status), content: <RecordCard record={record} daily={category.key === "daily"} onOpen={() => navigate(`/todos/${record.id}`)} /> }));
  }

  function openCategory(key: CategoryKey) {
    const params = new URLSearchParams(searchParams);
    params.set("category", key);
    setSearchParams(params);
  }

  function showOverview() {
    const params = new URLSearchParams(searchParams);
    params.delete("category");
    setSearchParams(params);
  }

  function toggleEmpty() {
    const params = new URLSearchParams(searchParams);
    if (hideEmpty) params.set("hideEmpty", "0");
    else params.delete("hideEmpty");
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="page-shell">
      <div className="mobile-page bottom-safe dashboard-page todo-overview-page">
        <header className="todo-header">
          <div className="mobile-page-brand"><span><ListTodo size={19} /></span><h1>我的待办</h1></div>
          <button className="todo-identity-switch" onClick={() => navigate("/identity")} aria-label="切换身份">
            <span className="todo-identity-copy"><strong>{currentIdentity?.org?.name ?? currentIdentity?.anchorProfile?.nickname ?? "当前组织"}</strong><span>{roleLabels[currentIdentity?.roleCode ?? ""] ?? "当前身份"}</span></span>
            <ChevronDown size={13} />
          </button>
          <button className="todo-header-logout" aria-label="退出登录" onClick={() => { logout(); navigate("/login", { replace: true }); }}><LogOut size={16} /></button>
        </header>
        <main className="section dashboard-content">
          <section className="todo-overview-panel" aria-label={category ? `${category.label}任务列表` : "我的待办汇总"}>
            <div className="todo-overview-heading">
              <div className="todo-overview-title">
                {category ? <button className="btn btn-ghost icon-btn" aria-label="返回待办汇总" onClick={showOverview}><ChevronLeft size={19} /></button> : <span className="todo-overview-symbol"><ListTodo size={19} /></span>}
                <h2>{category?.label ?? "待办汇总"}</h2>
              </div>
              <span className="todo-pending-label" aria-live="polite">{loading ? "加载中" : error || incompleteSummary ? "加载异常" : `${selectedGroup?.pending ?? pendingCount}项未完成`}</span>
              <div className="todo-overview-actions">
                {!category ? <button className="todo-empty-toggle" disabled={loading || Boolean(error)} aria-label={hideEmpty ? "显示全部分类" : "自动隐藏空项"} title={hideEmpty ? "已自动隐藏空项，点击显示全部" : "自动隐藏空项"} aria-pressed={hideEmpty} onClick={toggleEmpty}>{hideEmpty ? <EyeOff size={15} /> : <Eye size={15} />}</button> : null}
                <button className="todo-overview-refresh" aria-label="刷新" title="刷新" disabled={loading} onClick={() => void load()}><RefreshCcw size={15} className={loading ? "animate-spin" : ""} /></button>
              </div>
            </div>
            {loading ? <div className="dashboard-state" role="status">正在加载待办...</div> : error ? <div className="error dashboard-state" role="alert">{error}</div> : category && selectedGroup ? (
              <DashboardSection icon={category.icon} title={category.label.endsWith("任务") ? category.label : `${category.label}任务`} count={selectedGroup.total} tone={`section-${category.tone}`}>
                <CompletionGroupedList key={`${currentIdentity?.id}:${category.key}`} entries={categoryEntries()} />
                {selectedGroup.error ? <div className="error dashboard-state" role="alert">{selectedGroup.error}</div> : selectedGroup.total === 0 ? <div className="dashboard-empty">暂无{category.label}任务</div> : null}
              </DashboardSection>
            ) : (
              <>
                <div className="todo-category-grid">
                  {visibleGroups.map((group) => (
                    <button key={group.key} className={`todo-category-card todo-tone-${group.tone}`} onClick={() => openCategory(group.key)}>
                      <span className="todo-category-icon">{group.icon}</span>
                      <div className="todo-category-copy"><h3>{group.label}</h3><span>{group.error ? "加载失败" : `共${group.total}项`}</span></div>
                      <div className="todo-category-metric">{group.error ? <span className="error">请刷新</span> : <><span>未完<strong>{group.pending}</strong></span>{group.key === "daily" ? <strong className="todo-daily-percent" aria-label={`子任务完成进度 ${dailyProgress}%`}>{dailyProgress}<small>%</small></strong> : null}</>}</div>
                      <ChevronRight className="todo-category-chevron" size={16} />
                    </button>
                  ))}
                </div>
                {visibleGroups.length === 0 ? <div className="todo-overview-empty"><CheckCircle2 size={28} /><strong>当前暂无任务</strong><span>新任务到达后，对应分类会自动显示</span><button className="btn btn-ghost" onClick={toggleEmpty}>查看全部分类</button></div> : null}
              </>
            )}
          </section>
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
