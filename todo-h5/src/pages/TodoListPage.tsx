import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronRight, LogOut, RefreshCcw } from "lucide-react";
import { taskApi } from "../services/task";
import { useAuthStore } from "../stores/auth";
import type { PersonalReminder, TaskRecord } from "../types";

type PrimaryTab = "daily" | "temporary";
type TemporarySubTab = "pending" | "in_progress";

function taskStatusMeta(status: string) {
  if (status === "submitted") return { text: "已完成", cls: "tag-green" };
  if (status === "in_progress") return { text: "进行中", cls: "tag-blue" };
  if (status === "overdue") return { text: "已逾期", cls: "tag-red" };
  return { text: "待开始", cls: "tag-slate" };
}

function temporaryModeMeta(record: TaskRecord) {
  if (record.assignment?.temporaryMode === "MANAGER") return { label: "管理式", badge: "tag-purple" };
  if (record.assignment?.temporaryMode === "ANCHOR") return { label: "主播式", badge: "tag-blue" };
  return { label: "触达式", badge: "tag-slate" };
}

function formatDeadline(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
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
  if (reminder.status === "done") return false;
  const remindEnd = parseReminderTime(reminder.remindEnd);
  return Boolean(remindEnd && remindEnd.getTime() < Date.now());
}

function isReminderUrgent(reminder: PersonalReminder) {
  if (reminder.status === "done") return false;
  const remindEnd = parseReminderTime(reminder.remindEnd);
  if (!remindEnd) return false;
  const diff = remindEnd.getTime() - Date.now();
  return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000;
}

export function TodoListPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const currentIdentity = useAuthStore((state) => state.currentIdentity);
  const [records, setRecords] = useState<TaskRecord[]>([]);
  const [reminders, setReminders] = useState<PersonalReminder[]>([]);
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("daily");
  const [temporarySubTab, setTemporarySubTab] = useState<TemporarySubTab>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [taskData, reminderData] = await Promise.all([
        taskApi.getMyRecords(),
        taskApi.getReminders("active").catch(() => [] as PersonalReminder[]),
      ]);
      setRecords(taskData);
      setReminders(reminderData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载待办失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const dailyRecords = useMemo(() => records.filter((item) => item.assignment?.category === "DAILY").slice(0, 2), [records]);
  const temporaryRecords = useMemo(() => records.filter((item) => item.assignment?.category === "TEMPORARY"), [records]);
  const pendingCount = useMemo(() => temporaryRecords.filter((item) => item.status === "pending").length, [temporaryRecords]);
  const inProgressCount = useMemo(() => temporaryRecords.filter((item) => item.status === "in_progress").length, [temporaryRecords]);
  const reminderSummary = useMemo(() => ({
    total: reminders.length,
    overdue: reminders.filter(isReminderOverdue).length,
    urgent: reminders.filter(isReminderUrgent).length,
    important: reminders.filter((item) => item.isImportant).length,
  }), [reminders]);

  const currentList = useMemo(() => {
    if (primaryTab === "daily") return dailyRecords;
    return temporaryRecords.filter((item) => item.status === temporarySubTab);
  }, [dailyRecords, primaryTab, temporaryRecords, temporarySubTab]);

  return (
    <div className="page-shell">
      <div className="mobile-page bottom-safe">
        <div className="hero-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="hero-kicker">{currentIdentity?.roleCode ?? "当前身份"}</div>
              <h1 className="hero-title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>我的待办</h1>
              <p className="hero-subtitle">{currentIdentity?.org?.name ?? currentIdentity?.anchorProfile?.nickname ?? "当前身份"}</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="btn btn-ghost icon-btn" onClick={() => void load()} title="刷新">
                <RefreshCcw size={16} />
              </button>
              <button className="btn btn-ghost" style={{ paddingInline: 12 }} onClick={() => navigate("/identity")}>身份</button>
              <button className="btn btn-ghost icon-btn" onClick={() => { logout(); navigate("/login", { replace: true }); }} title="退出登录">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="section" style={{ paddingTop: 0 }}>

          <div className="card" style={{ padding: 10, marginBottom: 14 }}>
            <div className="segmented" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <button className={`btn ${primaryTab === "daily" ? "btn-primary" : "btn-ghost"}`} onClick={() => setPrimaryTab("daily")}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span>主播日常任务</span>
                  <span className={`tab-badge ${primaryTab === "daily" ? "tab-badge-active" : "tab-badge-muted"}`}>{dailyRecords.length}</span>
                </span>
              </button>
              <button className={`btn ${primaryTab === "temporary" ? "btn-primary" : "btn-ghost"}`} onClick={() => setPrimaryTab("temporary")}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span>临时任务</span>
                  <span className={`tab-badge ${primaryTab === "temporary" ? "tab-badge-active" : "tab-badge-muted"}`}>{temporaryRecords.length}</span>
                </span>
              </button>
            </div>

            {primaryTab === "temporary" ? (
              <div style={{ marginTop: 10 }}>
                <div className="segmented" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <button className={`btn ${temporarySubTab === "pending" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTemporarySubTab("pending")}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span>待开始</span>
                      <span className={`tab-badge ${temporarySubTab === "pending" ? "tab-badge-active" : "tab-badge-muted"}`}>{pendingCount}</span>
                    </span>
                  </button>
                  <button className={`btn ${temporarySubTab === "in_progress" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTemporarySubTab("in_progress")}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span>进行中</span>
                      <span className={`tab-badge ${temporarySubTab === "in_progress" ? "tab-badge-active" : "tab-badge-muted"}`}>{inProgressCount}</span>
                    </span>
                  </button>
                </div>
              </div>
            ) : null}

            <button className="reminder-entry-card" onClick={() => navigate("/reminders")}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div className="reminder-entry-icon"><Bell size={18} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <div className="card-title" style={{ margin: 0, fontSize: 15 }}>个人提醒</div>
                      {reminderSummary.overdue > 0 ? <span className="tag tag-red">逾期 {reminderSummary.overdue}</span> : null}
                      {reminderSummary.urgent > 0 ? <span className="tag tag-purple">紧急 {reminderSummary.urgent}</span> : null}
                    </div>
                    <div className="section-note" style={{ marginTop: 4 }}>
                      {reminderSummary.total > 0 ? `进行中 ${reminderSummary.total} 条，重要 ${reminderSummary.important} 条` : "记录自己的事项"}
                    </div>
                  </div>
                </div>
                <ChevronRight size={18} color="#64748b" />
              </div>
            </button>
          </div>

          {loading ? <div className="card" style={{ padding: 18 }}>加载中...</div> : null}
          {error ? <div className="card error" style={{ padding: 18 }}>{error}</div> : null}

          {!loading && !error ? (
            <div className="list">
              {currentList.map((record) => {
                const status = taskStatusMeta(record.status);
                const temporaryMode = primaryTab === "temporary" ? temporaryModeMeta(record) : null;
                return (
                  <button key={record.id} className="todo-card-button" onClick={() => navigate(`/todos/${record.id}`)}>
                    <div className="card todo-card card-strong">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 6 }}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {primaryTab === "daily" ? <span className="tag tag-blue">日常</span> : null}
                              {primaryTab === "daily" && record.recordDate ? <span className="tag tag-slate">{record.recordDate}</span> : null}
                              {temporaryMode ? <span className={`tag ${temporaryMode.badge}`}>{temporaryMode.label}</span> : null}
                            </div>
                            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>进度 {record.doneItems}/{record.totalItems}</span>
                          </div>
                          <p className="todo-title">{record.assignment?.template?.title ?? record.subjectName ?? record.subjectKey}</p>
                          {record.assignment?.template?.description?.trim() ? <div className="todo-meta" style={{ marginTop: 8 }}>{record.assignment.template.description.trim()}</div> : null}
                          <div className="todo-meta todo-meta-inline" style={{ marginTop: 10 }}>
                            <span className="meta-inline-item">主体：{record.subjectName ?? record.subjectKey}</span>
                            <span className="meta-inline-item">截止：{formatDeadline(record.deadlineAt)}</span>
                            <span className="meta-inline-item">发布人：{record.assignment?.publisher?.label ?? "-"}</span>
                          </div>
                        </div>
                        <span className={`tag ${status.cls}`}>{status.text}</span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 10 }}>
                        <ChevronRight size={18} color="#64748b" />
                      </div>
                    </div>
                  </button>
                );
              })}
              {currentList.length === 0 ? <div className="card" style={{ padding: 18 }}>当前分类下暂无内容</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
