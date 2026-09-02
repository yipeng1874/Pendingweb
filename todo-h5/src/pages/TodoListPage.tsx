import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Building2, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, GitBranch, LogOut, Megaphone, RefreshCcw, Send } from "lucide-react";
import { taskApi } from "../services/task";
import { useAuthStore } from "../stores/auth";
import { MobileBottomNav } from "../components/MobileBottomNav";
import type { BroadcastTask, CollaborationAnswer, CollaborationQuestion, HallDailyRecord, PersonalReminder, TaskRecord, WorkflowTask } from "../types";

type DashboardView = "all" | "daily" | "hall" | "temporary" | "workflow" | "broadcast";

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

function parseReminderTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isReminderOverdue(reminder: PersonalReminder) {
  const remindEnd = parseReminderTime(reminder.remindEnd);
  return reminder.status !== "done" && Boolean(remindEnd && remindEnd.getTime() < Date.now());
}

function isReminderUrgent(reminder: PersonalReminder) {
  const remindEnd = parseReminderTime(reminder.remindEnd);
  if (reminder.status === "done" || !remindEnd) return false;
  const diff = remindEnd.getTime() - Date.now();
  return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000;
}

function hasAnswer(answer?: CollaborationAnswer) {
  return Boolean(answer && (answer.answerText?.trim() || answer.answerOptions?.length || answer.isLinkConfirmed || answer.attachmentUrls?.length));
}

function answerText(question: CollaborationQuestion, answer?: CollaborationAnswer) {
  if (!answer || !hasAnswer(answer)) return "未填写";
  if (question.itemType === "QA" || question.itemType === "FILL_BLANK") return answer.answerText || "未填写";
  if (question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") return answer.answerOptions?.join("、") || "未选择";
  if (question.itemType === "LINK") return answer.isLinkConfirmed ? "已完成学习并确认" : "未确认";
  if (question.itemType === "ATTACHMENT") return `已上传 ${answer.attachmentUrls?.length ?? 0} 个文件`;
  return "已填写";
}

function DashboardSection({ icon, title, count, tone, children }: { icon: ReactNode; title: string; count: number; tone: string; children: ReactNode }) {
  return <section className="dashboard-section card"><div className="dashboard-section-header"><span className={`dashboard-section-icon ${tone}`}>{icon}</span><h2>{title}</h2><span className="dashboard-section-count">{count}</span></div><div className="list">{children}</div></section>;
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

function WorkflowCard({ task, currentUserId }: { task: WorkflowTask; currentUserId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const mySteps = task.steps.filter((step) => step.assigneeUserId === currentUserId);
  const mineDone = mySteps.length > 0 && mySteps.every((step) => step.status === "completed");
  const status = task.status === "completed" || mineDone ? taskStatusMeta("completed") : taskStatusMeta("in_progress");
  return <div className="dashboard-task-card"><button className="dashboard-card-toggle" onClick={() => setExpanded((value) => !value)}><div className="dashboard-card-main"><div className="dashboard-card-topline"><span className="tag tag-purple">流转任务</span><span className={`tag ${status.cls}`}>{status.text}</span></div><p className="todo-title">{task.title}</p><div className="dashboard-meta"><span>{task.createdByName}</span><span>{task.targetOrgName}</span><span>截止 {formatDeadline(task.dueAt)}</span></div></div>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>{expanded ? <div className="dashboard-expanded">{task.description ? <p className="dashboard-description dashboard-description-full">说明：{task.description}</p> : null}{task.steps.map((step) => <div className="collaboration-step" key={step.id}><div className="dashboard-card-topline"><strong>{step.order}. {step.title}</strong><span className={`tag ${taskStatusMeta(step.status).cls}`}>{taskStatusMeta(step.status).text}</span></div>{step.requirement ? <p className="dashboard-description dashboard-description-full">{step.requirement}</p> : null}{step.questions.map((question) => { const answer = step.stepAnswers?.find((item) => item.questionId === question.id); return <div className="answer-row" key={question.id}><span>{question.title}</span><strong>{answerText(question, answer)}</strong></div>; })}</div>)}</div> : null}</div>;
}

function BroadcastCard({ task }: { task: BroadcastTask }) {
  const [expanded, setExpanded] = useState(false);
  const answered = task.questions.filter((question) => hasAnswer(task.myRecord.answers.find((answer) => answer.questionId === question.id))).length;
  const status = taskStatusMeta(task.myRecord.status);
  return <div className="dashboard-task-card"><button className="dashboard-card-toggle" onClick={() => setExpanded((value) => !value)}><div className="dashboard-card-main"><div className="dashboard-card-topline"><span className="tag tag-orange">厅内直达</span><span className={`tag ${status.cls}`}>{status.text}</span></div><p className="todo-title">{task.title}</p><div className="dashboard-meta"><span>{task.createdByName} · {task.hallOrgName}</span><span>进度 {answered}/{task.questions.length}</span><span>截止 {formatDeadline(task.dueAt)}</span></div></div>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>{expanded ? <div className="dashboard-expanded">{task.description ? <p className="dashboard-description dashboard-description-full">说明：{task.description}</p> : null}{task.questions.map((question) => { const answer = task.myRecord.answers.find((item) => item.questionId === question.id); return <div className="answer-row" key={question.id}><span>{question.title}</span><strong>{answerText(question, answer)}</strong></div>; })}</div> : null}</div>;
}

export function TodoListPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const currentIdentity = useAuthStore((state) => state.currentIdentity);
  const [records, setRecords] = useState<TaskRecord[]>([]);
  const [hallRecords, setHallRecords] = useState<HallDailyRecord[]>([]);
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowTask[]>([]);
  const [broadcastTasks, setBroadcastTasks] = useState<BroadcastTask[]>([]);
  const [reminders, setReminders] = useState<PersonalReminder[]>([]);
  const [view, setView] = useState<DashboardView>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [taskData, reminderData, hallData, workflowData, broadcastData] = await Promise.all([
        taskApi.getMyRecords(),
        taskApi.getReminders("active").catch(() => [] as PersonalReminder[]),
        taskApi.getHallDailyRecords().catch(() => [] as HallDailyRecord[]),
        taskApi.getWorkflowTasks().catch(() => [] as WorkflowTask[]),
        taskApi.getBroadcastTasks().catch(() => [] as BroadcastTask[]),
      ]);
      setRecords(taskData); setReminders(reminderData); setHallRecords(hallData); setWorkflowTasks(workflowData); setBroadcastTasks(broadcastData);
    } catch (err) { setError(err instanceof Error ? err.message : "加载待办失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [currentIdentity?.id]);
  const dailyRecords = useMemo(() => records.filter((item) => item.assignment?.category === "DAILY"), [records]);
  const temporaryRecords = useMemo(() => records.filter((item) => item.assignment?.category === "TEMPORARY"), [records]);
  const reminderSummary = useMemo(() => ({ total: reminders.length, overdue: reminders.filter(isReminderOverdue).length, urgent: reminders.filter(isReminderUrgent).length, important: reminders.filter((item) => item.isImportant).length }), [reminders]);
  const totalTasks = dailyRecords.length + hallRecords.length + temporaryRecords.length + workflowTasks.length + broadcastTasks.length;
  const tabs: Array<{ key: DashboardView; label: string; count: number; icon: ReactNode }> = [
    { key: "all", label: "全部", count: totalTasks, icon: <CheckCircle2 size={15} /> },
    { key: "daily", label: "主播日常", count: dailyRecords.length, icon: <CheckCircle2 size={15} /> },
    { key: "hall", label: "厅管日常", count: hallRecords.length, icon: <Building2 size={15} /> },
    { key: "temporary", label: "临时任务", count: temporaryRecords.length, icon: <Send size={15} /> },
    { key: "workflow", label: "流转任务", count: workflowTasks.length, icon: <GitBranch size={15} /> },
    { key: "broadcast", label: "厅内直达", count: broadcastTasks.length, icon: <Megaphone size={15} /> },
  ];
  const show = (key: Exclude<DashboardView, "all">) => view === "all" || view === key;

  return <div className="page-shell"><div className="mobile-page bottom-safe dashboard-page">
    <div className="hero-panel dashboard-hero"><div className="dashboard-hero-row"><div className="dashboard-identity"><div className="hero-kicker">{currentIdentity?.roleCode ?? "当前身份"}</div><h1 className="hero-title">我的待办</h1><p className="hero-subtitle">{currentIdentity?.org?.name ?? currentIdentity?.anchorProfile?.nickname ?? "当前身份"}</p></div><div className="dashboard-actions"><button className="btn btn-ghost icon-btn" onClick={() => void load()} title="刷新"><RefreshCcw size={16} /></button><button className="btn btn-ghost dashboard-identity-button" onClick={() => navigate("/identity")}>身份</button><button className="btn btn-ghost icon-btn" onClick={() => { logout(); navigate("/login", { replace: true }); }} title="退出登录"><LogOut size={16} /></button></div></div></div>
    <div className="section dashboard-content">
      <div className="dashboard-summary card"><div><strong>{totalTasks}</strong><span>截止前任务</span></div><div><strong>{workflowTasks.length}</strong><span>流转任务</span></div><div><strong>{broadcastTasks.length}</strong><span>直达任务</span></div><div><strong>{reminderSummary.total}</strong><span>个人提醒</span></div></div>
      <div className="dashboard-tabs" role="tablist" aria-label="任务分类">{tabs.map((tab) => <button key={tab.key} role="tab" aria-selected={view === tab.key} className={`dashboard-tab ${view === tab.key ? "dashboard-tab-active" : ""}`} onClick={() => setView(tab.key)}>{tab.icon}<span>{tab.label}</span><b>{tab.count}</b></button>)}</div>
      <button className="reminder-entry-card card" onClick={() => navigate("/reminders") }><div className="reminder-entry-content"><div className="reminder-entry-icon"><Bell size={18} /></div><div className="reminder-entry-main"><div className="dashboard-card-topline"><div className="card-title">个人提醒</div>{reminderSummary.overdue > 0 ? <span className="tag tag-red">逾期 {reminderSummary.overdue}</span> : null}{reminderSummary.urgent > 0 ? <span className="tag tag-purple">紧急 {reminderSummary.urgent}</span> : null}</div><div className="section-note">{reminderSummary.total > 0 ? `进行中 ${reminderSummary.total} 条，重要 ${reminderSummary.important} 条` : "记录自己的事项"}</div></div><ChevronRight size={18} color="#64748b" /></div></button>
      {loading ? <div className="card dashboard-state">正在加载全部待办...</div> : null}{error ? <div className="card error dashboard-state">{error}</div> : null}
      {!loading && !error ? <div className="dashboard-sections">
        {show("daily") ? <DashboardSection icon={<CheckCircle2 size={17} />} title="主播日常任务" count={dailyRecords.length} tone="section-blue">{dailyRecords.map((record) => <RecordCard key={record.id} record={record} daily onOpen={() => navigate(`/todos/${record.id}`)} />)}{dailyRecords.length === 0 ? <div className="dashboard-empty">今日暂无主播日常任务</div> : null}</DashboardSection> : null}
        {show("hall") ? <DashboardSection icon={<Building2 size={17} />} title="厅管日常任务" count={hallRecords.length} tone="section-teal">{hallRecords.map((record) => <HallCard key={record.id} record={record} />)}{hallRecords.length === 0 ? <div className="dashboard-empty">今日暂无厅管日常任务</div> : null}</DashboardSection> : null}
        {show("temporary") ? <DashboardSection icon={<Send size={17} />} title="临时任务" count={temporaryRecords.length} tone="section-violet">{temporaryRecords.map((record) => <RecordCard key={record.id} record={record} daily={false} onOpen={() => navigate(`/todos/${record.id}`)} />)}{temporaryRecords.length === 0 ? <div className="dashboard-empty">暂无截止前临时任务</div> : null}</DashboardSection> : null}
        {show("workflow") ? <DashboardSection icon={<GitBranch size={17} />} title="流转任务" count={workflowTasks.length} tone="section-indigo">{workflowTasks.map((task) => <WorkflowCard key={task.id} task={task} currentUserId={currentIdentity?.userId} />)}{workflowTasks.length === 0 ? <div className="dashboard-empty">暂无截止前流转任务</div> : null}</DashboardSection> : null}
        {show("broadcast") ? <DashboardSection icon={<Megaphone size={17} />} title="厅内直达任务" count={broadcastTasks.length} tone="section-orange">{broadcastTasks.map((task) => <BroadcastCard key={task.id} task={task} />)}{broadcastTasks.length === 0 ? <div className="dashboard-empty">暂无截止前厅内直达任务</div> : null}</DashboardSection> : null}
      </div> : null}
      <MobileBottomNav />
    </div>
  </div></div>;
}
