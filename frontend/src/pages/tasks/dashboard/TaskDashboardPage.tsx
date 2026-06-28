import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Building2, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, GitBranch, Megaphone, Plus, RefreshCw, Send, Sparkles, UserRound, Users2, X } from "lucide-react";

import type { PersonalReminder, TaskRecord, TemporaryTaskMode } from "../../../types";
import { hallDailyApi, recordApi, reminderApi } from "../../../services/task";
import type { HallTaskRecord } from "../../../services/task";
import { workflowTaskApi } from "../../../services/workflowTask";
import type { WorkflowMyTask } from "../../../services/workflowTask";
import { broadcastTaskApi } from "../../../services/broadcastTask";
import type { BroadcastTaskForAnchor } from "../../../services/broadcastTask";
import { useIdentityStore } from "../../../stores/identityStore";
import { TaskRecordCard } from "../my-todos/TaskRecordCard";
import { ReminderTodoCard, isReminderOverdue, isReminderUrgent, sortReminders } from "../reminder/components/ReminderTodoCard";
import { TaskDashboardSection } from "./components/TaskDashboardSection";
import { HallDailyRecordCard } from "./components/HallDailyRecordCard";
import { WorkflowTaskCard } from "./components/WorkflowTaskCard";
import { BroadcastTaskCard } from "./components/BroadcastTaskCard";
import { MiniDatePicker, MiniTimePicker } from "../../../shared/components/date-time/MiniDateTimePickers";

type ReminderFormState = {
  title: string;
  note: string;
  remindEnd: string;
  isImportant: boolean;
};

const defaultReminderForm = (): ReminderFormState => ({
  title: "",
  note: "",
  remindEnd: "",
  isImportant: true,
});

function parseRecordDate(recordDate: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(recordDate);
  if (!matched) return null;
  return {
    year: Number(matched[1]),
    month: Number(matched[2]),
    day: Number(matched[3]),
  };
}

function formatRecordDate(recordDate: string) {
  const parsed = parseRecordDate(recordDate);
  if (!parsed) return recordDate;
  return `${parsed.month}月${parsed.day}日`;
}

function addDays(recordDate: string, days: number) {
  const parsed = parseRecordDate(recordDate);
  if (!parsed) return recordDate;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function isRecordPending(record: TaskRecord) {
  return record.status !== "submitted";
}

function getRecordDeadlineMs(record: TaskRecord) {
  const timestamp = new Date(record.deadlineAt).getTime();
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function isRecordOverdue(record: TaskRecord) {
  if (record.status === "overdue") return true;
  return record.assignment?.category !== "DAILY" && isRecordPending(record) && getRecordDeadlineMs(record) < Date.now();
}

function isRecordUrgent(record: TaskRecord) {
  if (record.assignment?.category === "DAILY") return false;
  const diff = getRecordDeadlineMs(record) - Date.now();
  return isRecordPending(record) && !isRecordOverdue(record) && diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

function sortTaskRecords(records: TaskRecord[]) {
  return [...records].sort((left, right) => {
    const pendingCompare = Number(isRecordPending(right)) - Number(isRecordPending(left));
    if (pendingCompare !== 0) return pendingCompare;

    const overdueCompare = Number(isRecordOverdue(right)) - Number(isRecordOverdue(left));
    if (overdueCompare !== 0) return overdueCompare;

    const urgentCompare = Number(isRecordUrgent(right)) - Number(isRecordUrgent(left));
    if (urgentCompare !== 0) return urgentCompare;

    const deadlineCompare = getRecordDeadlineMs(left) - getRecordDeadlineMs(right);
    if (deadlineCompare !== 0) return deadlineCompare;

    return new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime();
  });
}

function countPendingRecords(records: TaskRecord[]) {
  return records.filter(isRecordPending).length;
}

function getBeijingRecordDate(offsetDays = 0) {
  const now = new Date();
  const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  beijingNow.setUTCDate(beijingNow.getUTCDate() + offsetDays);
  const year = beijingNow.getUTCFullYear();
  const month = String(beijingNow.getUTCMonth() + 1).padStart(2, "0");
  const day = String(beijingNow.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayRecordDate() {
  return getBeijingRecordDate(0);
}

function getYesterdayRecordDate() {
  return getBeijingRecordDate(-1);
}

function countTodayFocusedDailyRecords(records: TaskRecord[]) {
  const today = getTodayRecordDate();
  return records.filter((record) => record.assignment?.category === "DAILY" && record.recordDate === today && record.status !== "submitted").length;
}

function countUrgentRecords(records: TaskRecord[]) {
  return records.filter(isRecordUrgent).length;
}

function countOverdueRecords(records: TaskRecord[]) {
  return records.filter(isRecordOverdue).length;
}

function countPendingReminders(reminders: PersonalReminder[]) {
  return reminders.filter((reminder) => reminder.status === "active").length;
}

function countUrgentReminders(reminders: PersonalReminder[]) {
  return reminders.filter(isReminderUrgent).length;
}

function countOverdueReminders(reminders: PersonalReminder[]) {
  return reminders.filter(isReminderOverdue).length;
}

function SubSection({
  tone,
  icon,
  title,
  description,
  records,
  emptyText,
  activeRecordId,
  setActiveRecordId,
  load,
  formatDeadline,
  isRecordUrgent,
  isRecordOverdue,
  currentIdentityId,
}: {
  tone: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  records: TaskRecord[];
  emptyText: string;
  activeRecordId: string | null;
  setActiveRecordId: (id: string | null) => void;
  load: () => void;
  formatDeadline: (record: TaskRecord) => string;
  isRecordUrgent: (r: TaskRecord) => boolean;
  isRecordOverdue: (r: TaskRecord) => boolean;
  currentIdentityId?: string;
}) {
  const [collapsed, setCollapsed] = useState(() => records.length === 0);

  const incompleteCount = React.useMemo(() => records.filter((r) => r.status !== "submitted").length, [records]);

  const summaryText = React.useMemo(() => {
    if (records.length === 0) return description;
    const latestRecord = [...records].sort((left, right) => getRecordDeadlineMs(left) - getRecordDeadlineMs(right)).at(-1);
    const deadlineStr = latestRecord ? formatDeadline(latestRecord) : "";
    return `共计 ${incompleteCount} 项未完成${deadlineStr ? `，最迟 ${deadlineStr}` : ""}`;
  }, [records, incompleteCount, description, formatDeadline]);

  return (
    <div className="min-w-0 rounded-2xl border border-slate-100 bg-slate-50/60 p-2">
      <div
        className="flex cursor-pointer items-center justify-between gap-2"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-700">{title}</p>
            <p className={`truncate text-xs font-medium ${records.length > 0 ? "text-violet-500" : "text-slate-400"}`}>{summaryText}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-white px-2 py-0.5 text-sm font-bold text-slate-600">{incompleteCount}</span>
          <span className="text-slate-400">{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
        </div>
      </div>
      {!collapsed && (
        <div className="mt-2">
          {records.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 py-6 text-center text-[11px] text-slate-400">{emptyText}</div>
          ) : (
            <div className="space-y-2">
              {records.map((record) => {
                const total = record.totalItems ?? 0;
                const done = record.doneItems ?? 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <TaskRecordCard
                    key={record.id}
                    record={record}
                    expanded={activeRecordId === record.id}
                    onToggle={() => setActiveRecordId(activeRecordId === record.id ? null : record.id)}
                    onRefresh={load}
                    formatDeadline={formatDeadline}
                    urgent={isRecordUrgent(record) || isRecordOverdue(record)}
                    compact
                    currentIdentityId={currentIdentityId}
                    rightSlot={
                      <div className="flex flex-col items-end gap-1">
                        <div className="w-14">
                          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-600 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        {total > 0 && (
                          <span className="tabular-nums text-[10px] text-slate-400">{done}/{total}</span>
                        )}
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskDashboardPage() {
  const navigate = useNavigate();
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const [records, setRecords] = useState<TaskRecord[]>([]);
  const [reminders, setReminders] = useState<PersonalReminder[]>([]);
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowMyTask[]>([]);
  const [broadcastTasks, setBroadcastTasks] = useState<BroadcastTaskForAnchor[]>([]);
  const [hallDailyRecords, setHallDailyRecords] = useState<HallTaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [dailyRecordView, setDailyRecordView] = useState<"today" | "overdue">("today");
  const [hallDailyRecordView, setHallDailyRecordView] = useState<"today" | "overdue">("today");
  const [expandedHallDailyIds, setExpandedHallDailyIds] = useState<Set<string>>(new Set());
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderForm, setReminderForm] = useState<ReminderFormState>(defaultReminderForm());
  const [savingReminder, setSavingReminder] = useState(false);


  async function load() {
    setLoading(true);
    // 厅管日常任务：HALL_MANAGER 身份必然请求；ANCHOR 身份也请求（账号可能同时有厅管身份，后端融通返回数据）
    const shouldFetchHallDaily = currentIdentity?.roleCode === "HALL_MANAGER" || currentIdentity?.roleCode === "ANCHOR";
    const [recordRows, reminderRows, workflowRows, broadcastRows, hallDailyRows] = await Promise.all([
      recordApi.getMyRecords().catch(() => [] as TaskRecord[]),
      reminderApi.list("active").catch(() => [] as PersonalReminder[]),
      workflowTaskApi.myTasks().then((rows) =>
        // 前端二次保险：过滤掉已结束（ended）的任务，只展示进行中和已完成
        rows.filter((t) => t.status !== "ended")
      ).catch(() => [] as WorkflowMyTask[]),
      broadcastTaskApi.myTasks().then((rows) =>
        // 前端二次保险：过滤掉已结束（到截止时间）的任务
        rows.filter((t) => t.status !== "ended")
      ).catch(() => [] as BroadcastTaskForAnchor[]),
      shouldFetchHallDaily
        ? hallDailyApi.getMyRecords().catch(() => [] as HallTaskRecord[])
        : Promise.resolve([] as HallTaskRecord[]),
    ]);
    setRecords(recordRows);
    setReminders(reminderRows);
    setWorkflowTasks(workflowRows);
    setBroadcastTasks(broadcastRows);
    setHallDailyRecords(hallDailyRows);
    setLoading(false);
  }

  // 仅刷新厅管日常任务数据，不触发全局 loading，避免卡片展开状态丢失
  async function refreshHallDailyOnly() {
    const shouldFetchHallDaily = currentIdentity?.roleCode === "HALL_MANAGER" || currentIdentity?.roleCode === "ANCHOR";
    if (!shouldFetchHallDaily) return;
    const hallDailyRows = await hallDailyApi.getMyRecords().catch(() => [] as HallTaskRecord[]);
    setHallDailyRecords(hallDailyRows);
  }

  useEffect(() => {
    void load();
  }, [currentIdentity?.id]);

  const todayRecordDate = useMemo(() => getTodayRecordDate(), []);
  const yesterdayRecordDate = useMemo(() => getYesterdayRecordDate(), []);

  const dailyRecords = useMemo(() => sortTaskRecords(records.filter((record) => record.assignment?.category === "DAILY")), [records]);
  const dailyTodayRecords = useMemo(
    () => dailyRecords.filter((record) => record.recordDate === todayRecordDate),
    [dailyRecords, todayRecordDate]
  );
  const dailyOverdueRecords = useMemo(
    () => dailyRecords.filter((record) => record.recordDate === yesterdayRecordDate && record.status === "overdue"),
    [dailyRecords, yesterdayRecordDate]
  );
  const visibleDailyRecords = dailyRecordView === "overdue" ? dailyOverdueRecords : dailyTodayRecords;

  const hallDailyTodayRecords = useMemo(
    () => hallDailyRecords.filter((record) => record.recordDate === todayRecordDate),
    [hallDailyRecords, todayRecordDate]
  );
  const hallDailyOverdueRecords = useMemo(
    () => hallDailyRecords.filter((record) => record.recordDate === yesterdayRecordDate && record.status === "overdue"),
    [hallDailyRecords, yesterdayRecordDate]
  );
  const visibleHallDailyRecords = hallDailyRecordView === "overdue" ? hallDailyOverdueRecords : hallDailyTodayRecords;
  // 有厅管日常任务数据时就显示该模块（支持 ANCHOR+HALL_MANAGER 双重身份融通）
  const isHallManagerIdentity = currentIdentity?.roleCode === "HALL_MANAGER" || hallDailyRecords.length > 0;
  const temporaryByMode = useMemo(() => {

    const pick = (mode: TemporaryTaskMode) => sortTaskRecords(records.filter((record) => record.assignment?.category === "TEMPORARY" && record.assignment?.temporaryMode === mode));
    return {
      ACCOUNT: pick("ACCOUNT"),
      ANCHOR: pick("ANCHOR"),
      MANAGER: pick("MANAGER"),
    } satisfies Record<TemporaryTaskMode, TaskRecord[]>;
  }, [records]);
  const activeReminders = useMemo(() => sortReminders(reminders.filter((reminder) => reminder.status === "active")), [reminders]);
  const reminderQuadrants = useMemo(
    () => [
      {
        key: "important-urgent",
        title: "重要且紧急",
        hint: "优先处理",
        tone: "border-red-100 bg-red-50/60 text-red-600",
        items: activeReminders.filter((reminder) => Boolean(reminder.isImportant) && isReminderUrgent(reminder)),
      },
      {
        key: "important-not-urgent",
        title: "重要不紧急",
        hint: "计划推进",
        tone: "border-rose-100 bg-rose-50/60 text-rose-600",
        items: activeReminders.filter((reminder) => Boolean(reminder.isImportant) && !isReminderUrgent(reminder)),
      },
      {
        key: "not-important-urgent",
        title: "不重要但紧急",
        hint: "快速处理",
        tone: "border-amber-100 bg-amber-50/60 text-amber-600",
        items: activeReminders.filter((reminder) => !reminder.isImportant && isReminderUrgent(reminder)),
      },
      {
        key: "not-important-not-urgent",
        title: "不重要不紧急",
        hint: "空闲处理",
        tone: "border-slate-100 bg-slate-50/80 text-slate-500",
        items: activeReminders.filter((reminder) => !reminder.isImportant && !isReminderUrgent(reminder)),
      },
    ],
    [activeReminders]
  );

  function formatDeadline(record: TaskRecord) {
    if (record.assignment?.category === "DAILY" && record.recordDate) {
      if (record.status === "overdue") {
        return `${formatRecordDate(addDays(record.recordDate, 1))} 16:00 前可补录`;
      }
      return `${formatRecordDate(record.recordDate)} 23:59 截止`;
    }

    const diff = new Date(record.deadlineAt).getTime() - Date.now();
    if (diff < 0) return "已逾期";
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    if (hours >= 24) return `${Math.floor(hours / 24)}天后截止`;
    return `剩余 ${hours}h ${minutes}m`;
  }

  const reminderEndDate = reminderForm.remindEnd ? reminderForm.remindEnd.slice(0, 10) : "";
  const reminderEndTime = reminderForm.remindEnd ? reminderForm.remindEnd.slice(11, 16) : "";

  function setReminderField<K extends keyof ReminderFormState>(key: K, value: ReminderFormState[K]) {
    setReminderForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleReminderEndChange(date: string, time: string) {
    if (!date && !time) {
      setReminderField("remindEnd", "");
      return;
    }
    setReminderField("remindEnd", `${date || reminderEndDate}T${time || reminderEndTime || "23:59"}`);
  }

  function openReminderModal() {
    setReminderForm(defaultReminderForm());
    setShowReminderModal(true);
  }

  async function handleCreateReminder() {
    if (!reminderForm.title.trim() || !reminderForm.remindEnd) return;
    setSavingReminder(true);
    try {
      await reminderApi.create({
        title: reminderForm.title.trim(),
        note: reminderForm.note.trim() || undefined,
        remindEnd: reminderForm.remindEnd,
        isImportant: reminderForm.isImportant,
      });
      setShowReminderModal(false);
      setReminderForm(defaultReminderForm());
      await load();
    } catch {
      window.alert("保存失败，请稍后重试");
    } finally {
      setSavingReminder(false);
    }
  }

  async function handleReminderDone(id: string) {
    await reminderApi.done(id).catch(console.error);
    await load();
  }

  const temporaryRecords = useMemo(
    () => sortTaskRecords([...temporaryByMode.ACCOUNT, ...temporaryByMode.ANCHOR, ...temporaryByMode.MANAGER]),
    [temporaryByMode]
  );

  const temporarySubSections = [
    {
      key: "account",
      icon: <Send size={14} />,
      title: "触达式",
      description: "账号触达，多身份共享完成。",
      records: temporaryByMode.ACCOUNT,
      tone: "bg-sky-50 text-sky-600",
      emptyText: "暂无触达式任务",
    },
    {
      key: "anchor",
      icon: <UserRound size={14} />,
      title: "主播式",
      description: "按主播主体完成。",
      records: temporaryByMode.ANCHOR,
      tone: "bg-emerald-50 text-emerald-600",
      emptyText: "暂无主播式任务",
      currentIdentityId: currentIdentity?.id,
    },
    {
      key: "manager",
      icon: <Users2 size={14} />,
      title: "管理式",
      description: "团队 / 厅协同完成。",
      records: temporaryByMode.MANAGER,
      tone: "bg-violet-50 text-violet-600",
      emptyText: "暂无管理式任务",
    },
  ];

  return (
    <div className="space-y-2">
      <section className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 shadow-[0_4px_14px_rgba(15,23,42,0.035)]">
        <div className="flex min-w-0 items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-sm font-semibold text-blue-700"><Sparkles size={13} />我的待办</div>
          <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">按任务类型聚焦待处理事项</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-sm font-bold text-amber-700">
            今日待办 {countTodayFocusedDailyRecords(records)} 件
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={13} className={loading ? "animate-spin" : ""} />刷新</button>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400"><RefreshCw size={20} className="mr-2 animate-spin" />加载中...</div>
      ) : (
        <>
        <div className="grid items-start gap-3 xl:grid-cols-3">

          {/* 厅管日常任务 — 固定占位第一格 */}
          <TaskDashboardSection
              icon={<Building2 size={18} />}
              title="厅管日常任务"
              description={hallDailyRecordView === "today" ? "仅展示今天的厅管日常任务，未完成部分会在 23:59 后转入昨日补录。" : "仅展示昨天逾期未完成的任务，可在今天 16:00 前补录。"}
              count={visibleHallDailyRecords.length}
              pendingCount={visibleHallDailyRecords.filter((r) => r.status !== "submitted").length}
              urgentCount={0}
              overdueCount={hallDailyOverdueRecords.length}
              tone="bg-teal-50 text-teal-600"
              emptyText={hallDailyRecordView === "today" ? "今日暂无厅管日常任务" : "当前没有昨日逾期补录任务"}
              variant="column"
              hideDescription
              hideStats
              action={
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setHallDailyRecordView("today")}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm font-bold transition ${
                      hallDailyRecordView === "today" ? "border-teal-200 bg-teal-50 text-teal-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    当日任务
                    <span className={`rounded-full px-1.5 py-0.5 text-sm font-bold ${hallDailyRecordView === "today" ? "bg-white/90 text-teal-600" : "bg-slate-100 text-slate-500"}`}>{hallDailyTodayRecords.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setHallDailyRecordView("overdue")}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm font-bold transition ${
                      hallDailyRecordView === "overdue" ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    昨日逾期补录
                    <span className={`rounded-full px-1.5 py-0.5 text-sm font-bold ${hallDailyRecordView === "overdue" ? "bg-white/90 text-red-600" : hallDailyOverdueRecords.length > 0 ? "bg-red-50 text-red-500" : "bg-slate-100 text-slate-500"}`}>{hallDailyOverdueRecords.length}</span>
                  </button>
                </div>
              }
            >
              {hallDailyRecordView === "overdue" && visibleHallDailyRecords.length > 0 && (
                <div className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-600">
                  这里展示昨天未完成的厅管日常任务，最迟今天 16:00 停止收集；到点后将不可再补录。
                </div>
              )}
              {visibleHallDailyRecords.map((record) => (
                <HallDailyRecordCard
                  key={record.id}
                  record={record}
                  expanded={expandedHallDailyIds.has(record.id)}
                  onToggle={() =>
                    setExpandedHallDailyIds((prev) => {
                      const next = new Set(prev);
                      next.has(record.id) ? next.delete(record.id) : next.add(record.id);
                      return next;
                    })
                  }
                  onRefresh={refreshHallDailyOnly}
                />
              ))}
            </TaskDashboardSection>

          <TaskDashboardSection
            icon={<CheckCircle2 size={18} />}
            title="主播日常任务"
            description={dailyRecordView === "today" ? "仅展示今天的主播日常任务，未完成部分会在 23:59 后转入昨日补录。" : "仅展示昨天逾期未完成的任务，可在今天 16:00 前补录。"}
            count={visibleDailyRecords.length}
            pendingCount={countPendingRecords(visibleDailyRecords)}
            urgentCount={countUrgentRecords(visibleDailyRecords)}
            overdueCount={countOverdueRecords(visibleDailyRecords)}
            tone="bg-blue-50 text-blue-600"
            emptyText={dailyRecordView === "today" ? "今日暂无主播日常任务" : "当前没有昨日逾期补录任务"}
            variant="column"
            hideDescription
            hideStats
            action={
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDailyRecordView("today");
                    setActiveRecordId(null);
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm font-bold transition ${
                    dailyRecordView === "today" ? "border-blue-200 bg-blue-50 text-blue-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  当日任务
                  <span className={`rounded-full px-1.5 py-0.5 text-sm font-bold ${dailyRecordView === "today" ? "bg-white/90 text-blue-600" : "bg-slate-100 text-slate-500"}`}>{dailyTodayRecords.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDailyRecordView("overdue");
                    setActiveRecordId(null);
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm font-bold transition ${
                    dailyRecordView === "overdue" ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  昨日逾期补录
                  <span className={`rounded-full px-1.5 py-0.5 text-sm font-bold ${dailyRecordView === "overdue" ? "bg-white/90 text-red-600" : dailyOverdueRecords.length > 0 ? "bg-red-50 text-red-500" : "bg-slate-100 text-slate-500"}`}>{dailyOverdueRecords.length}</span>
                </button>
              </div>
            }
          >
            {dailyRecordView === "overdue" && visibleDailyRecords.length > 0 && (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-600">
                这里展示昨天未完成的主播日常任务，最迟今天 16:00 停止收集；到点后将不可再补录。
              </div>
            )}

            {visibleDailyRecords.map((record) => {
              const dailyStatus = record.status === "submitted" ? { text: "已完成", cls: "bg-emerald-50 text-emerald-600" } : record.status === "overdue" ? { text: "已逾期", cls: "bg-red-50 text-red-600" } : record.status === "in_progress" ? { text: "进行中", cls: "bg-blue-50 text-blue-600" } : { text: "待开始", cls: "bg-slate-100 text-slate-500" };
              return (
                <TaskRecordCard
                  key={record.id}
                  record={record}
                  expanded={activeRecordId === record.id}
                  onToggle={() => setActiveRecordId(activeRecordId === record.id ? null : record.id)}
                  onRefresh={load}
                  formatDeadline={formatDeadline}
                  urgent={isRecordUrgent(record) || isRecordOverdue(record)}
                  currentIdentityId={currentIdentity?.id}
                  compact
                  rightSlot={
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${dailyStatus.cls}`}>{dailyStatus.text}</span>
                      {record.totalItems > 0 && (
                        <span className="tabular-nums text-[10px] text-slate-400">{record.doneItems}/{record.totalItems}</span>
                      )}
                    </div>
                  }
                />
              );
            })}
          </TaskDashboardSection>


          <TaskDashboardSection
            icon={<Send size={18} />}
            title="临时任务"
            description="触达式、主播式、管理式临时任务融合展示。"
            count={temporaryRecords.length}
            pendingCount={countPendingRecords(temporaryRecords)}
            urgentCount={countUrgentRecords(temporaryRecords)}
            overdueCount={countOverdueRecords(temporaryRecords)}
            tone="bg-violet-50 text-violet-600"
            emptyText="暂无临时任务"
            variant="column"
            hideDescription
            hideStats
          >
            <div className="flex flex-col gap-2">
              {temporarySubSections.map((section) => (
                <SubSection
                  key={section.key}
                  tone={section.tone}
                  icon={section.icon}
                  title={section.title}
                  description={section.description}
                  records={section.records}
                  emptyText={section.emptyText}
                  activeRecordId={activeRecordId}
                  setActiveRecordId={setActiveRecordId}
                  load={load}
                  formatDeadline={formatDeadline}
                  isRecordUrgent={isRecordUrgent}
                  isRecordOverdue={isRecordOverdue}
                  currentIdentityId={"currentIdentityId" in section ? section.currentIdentityId : undefined}
                />
              ))}
            </div>
          </TaskDashboardSection>

          <TaskDashboardSection
            icon={<Bell size={18} />}
            title="个人提醒"
            description="仅自己可见的个人事项，不影响任务报表。"
            count={activeReminders.length}
            pendingCount={countPendingReminders(activeReminders)}
            urgentCount={countUrgentReminders(activeReminders)}
            overdueCount={countOverdueReminders(activeReminders)}
            tone="bg-amber-50 text-amber-600"
            emptyText="暂无未完成个人提醒"
            variant="column"
            hideDescription
            hideStats
            action={
              <div className="flex items-center gap-1.5">
                {countOverdueReminders(activeReminders) > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-sm font-bold text-red-600">
                    已逾期 {countOverdueReminders(activeReminders)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => navigate("/tasks/reminders")}
                  className="inline-flex items-center gap-0.5 rounded-lg border border-amber-300 px-2 py-1 text-sm font-semibold text-amber-600 transition hover:bg-amber-50"
                >
                  <ExternalLink size={13} />查看所有任务
                </button>
                <button
                  type="button"
                  onClick={openReminderModal}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-sm font-bold text-white transition hover:bg-amber-600"
                >
                  <Plus size={14} />新建
                </button>
              </div>
            }
          >
            <div className="grid min-h-full grid-cols-2 grid-rows-2 gap-2">
              {reminderQuadrants.map((quadrant) => (
                <div key={quadrant.key} className={`flex min-h-[150px] min-w-0 flex-col rounded-2xl border p-1 ${quadrant.tone}`}>
                  <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
                    <p className="truncate text-sm font-bold">{quadrant.title}</p>
                    <span className="shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-sm font-bold">{quadrant.items.length}</span>
                  </div>
                  {quadrant.items.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-current/20 bg-white/50 text-[11px] opacity-60">暂无</div>
                  ) : (
                    <div className="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
                      {quadrant.items.map((reminder) => (
                        <ReminderTodoCard key={reminder.id} reminder={reminder} onDone={handleReminderDone} minimal />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TaskDashboardSection>

          {/* 流转任务 — 第二行第二格 */}
          {(() => {
            const myPendingWorkflow = workflowTasks.filter((t) =>
              t.steps.some((s) => s.assigneeUserId === currentIdentity?.userId && s.status === "active")
            ).length;
            const myDoneWorkflow = workflowTasks.filter((t) =>
              t.steps.filter((s) => s.assigneeUserId === currentIdentity?.userId).length > 0 &&
              t.steps.filter((s) => s.assigneeUserId === currentIdentity?.userId).every((s) => s.status === "completed")
            ).length;
            const completedWorkflow = workflowTasks.filter((t) => t.status === "completed").length;
            const inProgressWorkflow = workflowTasks.filter((t) => t.status === "in_progress").length;
            return (
              <TaskDashboardSection
                icon={<GitBranch size={18} />}
                title="流转任务"
                description="展示进行中与已完成任务；到达截止时间后自动从此处移除"
                count={workflowTasks.length}
                pendingCount={myPendingWorkflow}
                urgentCount={0}
                overdueCount={0}
                tone="bg-indigo-50 text-indigo-600"
                emptyText="暂无流转任务，管理员发布后将在此显示"
                variant="column"
                hideDescription
                hideStats
                action={
                  <div className="flex flex-wrap items-center gap-1">
                    {myPendingWorkflow > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-white">
                        ● 待我填写 {myPendingWorkflow}
                      </span>
                    )}
                    {myDoneWorkflow > 0 && myPendingWorkflow === 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                        我已完成 {myDoneWorkflow}
                      </span>
                    )}
                    {inProgressWorkflow > 0 && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-500">
                        进行中 {inProgressWorkflow}
                      </span>
                    )}
                    {completedWorkflow > 0 && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                        全员完成 {completedWorkflow}
                      </span>
                    )}
                  </div>
                }
              >
                {workflowTasks.map((task) => (
                  <WorkflowTaskCard
                    key={task.id}
                    task={task}
                    currentUserId={currentIdentity?.userId ?? ""}
                    onRefresh={() => void load()}
                  />
                ))}
              </TaskDashboardSection>
            );
          })()}

          {/* 厅内直达任务 — 第二行第三格 */}
          {(() => {
            const pendingBroadcast = broadcastTasks.filter((t) => t.myRecord.status !== "submitted" && t.myRecord.status !== "overdue").length;
            const submittedBroadcast = broadcastTasks.filter((t) => t.myRecord.status === "submitted").length;
            const overdueBroadcast = broadcastTasks.filter((t) => t.myRecord.status === "overdue").length;
            return (
              <TaskDashboardSection
                icon={<Megaphone size={18} />}
                title="厅内直达任务"
                description="由厅管理员群发的直达任务，逐题填写后提交"
                count={broadcastTasks.length}
                pendingCount={pendingBroadcast}
                urgentCount={0}
                overdueCount={overdueBroadcast}
                tone="bg-orange-50 text-orange-600"
                emptyText="暂无厅内直达任务，厅管理员发布后将在此显示"
                variant="column"
                hideDescription
                hideStats
                action={
                  <div className="flex flex-wrap items-center gap-1">
                    {pendingBroadcast > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-white">
                        ● 待完成 {pendingBroadcast}
                      </span>
                    )}
                    {submittedBroadcast > 0 && pendingBroadcast === 0 && overdueBroadcast === 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                        已完成 {submittedBroadcast}
                      </span>
                    )}
                    {overdueBroadcast > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">
                        已逾期 {overdueBroadcast}
                      </span>
                    )}
                  </div>
                }
              >
                {broadcastTasks.map((task) => (
                  <BroadcastTaskCard
                    key={task.id}
                    task={task}
                    onRefresh={() => void load()}
                  />
                ))}
              </TaskDashboardSection>
            );
          })()}

        </div>
        </>
      )}

      {showReminderModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowReminderModal(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">新建提醒</h3>
              <button
                type="button"
                onClick={() => setShowReminderModal(false)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  提醒标题 <span className="text-red-400">*</span>
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                  placeholder="输入提醒内容..."
                  value={reminderForm.title}
                  onChange={(event) => setReminderField("title", event.target.value)}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">备注说明</label>
                <textarea
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                  rows={2}
                  placeholder="可选的备注说明..."
                  value={reminderForm.note}
                  onChange={(event) => setReminderField("note", event.target.value)}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  结束时间 <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-[1fr_9rem] gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">结束日期</span>
                    <MiniDatePicker value={reminderEndDate} onChange={(value) => handleReminderEndChange(value, reminderEndTime)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">结束时间</span>
                    <MiniTimePicker value={reminderEndTime} onChange={(value) => handleReminderEndChange(reminderEndDate, value)} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-400">请选择北京时间；只选日期时默认使用 23:59。</p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">重要？</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReminderField("isImportant", true)}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      reminderForm.isImportant ? "border-rose-300 bg-rose-50 text-rose-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    重要
                  </button>
                  <button
                    type="button"
                    onClick={() => setReminderField("isImportant", false)}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      !reminderForm.isImportant ? "border-slate-300 bg-slate-100 text-slate-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    不重要
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                提醒会显示在我的待办里，直到你手动标记完成。
              </div>

              <button
                type="button"
                onClick={handleCreateReminder}
                disabled={!reminderForm.title.trim() || !reminderForm.remindEnd || savingReminder}
                className="w-full rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-40"
              >
                {savingReminder ? "保存中..." : "创建提醒"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
