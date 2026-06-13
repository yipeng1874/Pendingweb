import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Clock3, Loader2, Plus, RefreshCcw, Trash2, AlertTriangle, X } from "lucide-react";
import { taskApi } from "../services/task";
import type { PersonalReminder } from "../types";
import { MiniDatePicker, MiniTimePicker } from "../components/MiniDateTimePickers";

type ReminderTab = "active" | "overdue";

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

function sortReminders(reminders: PersonalReminder[]) {
  return [...reminders].sort((left, right) => {
    const statusCompare = Number(right.status === "done") - Number(left.status === "done");
    if (statusCompare !== 0) return statusCompare;

    const overdueCompare = Number(isReminderOverdue(right)) - Number(isReminderOverdue(left));
    if (overdueCompare !== 0) return overdueCompare;

    const urgentCompare = Number(isReminderUrgent(right)) - Number(isReminderUrgent(left));
    if (urgentCompare !== 0) return urgentCompare;

    const importantCompare = Number(Boolean(right.isImportant)) - Number(Boolean(left.isImportant));
    if (importantCompare !== 0) return importantCompare;

    const leftTime = parseReminderTime(left.remindEnd)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightTime = parseReminderTime(right.remindEnd)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) return leftTime - rightTime;

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function formatReminderTime(value?: string | null) {
  const date = parseReminderTime(value);
  if (!date) return "未设置";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function getReminderTone(reminder: PersonalReminder) {
  if (reminder.status === "done") return { cardCls: "reminder-card-done", tagCls: "tag-slate", text: "已完成" };
  if (isReminderOverdue(reminder)) return { cardCls: "reminder-card-overdue", tagCls: "tag-red", text: "已逾期" };
  if (isReminderUrgent(reminder)) return { cardCls: "reminder-card-urgent", tagCls: "tag-purple", text: "紧急" };
  return { cardCls: "", tagCls: "tag-blue", text: reminder.isImportant ? "进行中" : "待处理" };
}

function ReminderCard({ reminder, onDone, onDelete, busyId }: { reminder: PersonalReminder; onDone: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void>; busyId: string | null }) {
  const tone = getReminderTone(reminder);
  const busy = busyId === reminder.id;

  return (
    <div className={`card detail-block reminder-card ${tone.cardCls}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
            {reminder.isImportant ? <span className="tag tag-red">重要</span> : <span className="tag tag-slate">普通</span>}
            <span className={`tag ${tone.tagCls}`}>{tone.text}</span>
          </div>
          <div className="detail-item-title">{reminder.title}</div>
          {reminder.note?.trim() ? <div className="section-note" style={{ marginTop: 8 }}>{reminder.note.trim()}</div> : null}
          <div className="todo-meta todo-meta-inline" style={{ marginTop: 10 }}>
            <span className="meta-inline-item">截止时间：{formatReminderTime(reminder.remindEnd)}</span>
            <span className="meta-inline-item">创建时间：{formatReminderTime(reminder.createdAt)}</span>
          </div>
        </div>
      </div>
      <div className="action-row" style={{ marginTop: 14 }}>
        {reminder.status !== "done" ? (
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => void onDone(reminder.id)}>
            {busy ? "处理中..." : "标记完成"}
          </button>
        ) : null}
        <button className="btn btn-ghost" style={{ flex: reminder.status === "done" ? 1 : undefined }} disabled={busy} onClick={() => void onDelete(reminder.id)}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            删除
          </span>
        </button>
      </div>
    </div>
  );
}

export function ReminderPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ReminderTab>("active");
  const [reminders, setReminders] = useState<PersonalReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ReminderFormState>(defaultReminderForm());
  const [saving, setSaving] = useState(false);
  const [busyReminderId, setBusyReminderId] = useState<string | null>(null);

  async function load(targetTab: ReminderTab = tab) {
    setLoading(true);
    setError("");
    try {
      const data = await taskApi.getReminders(targetTab);
      setReminders(sortReminders(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载个人提醒失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(tab);
  }, [tab]);

  const remindDate = form.remindEnd ? form.remindEnd.slice(0, 10) : "";
  const remindTime = form.remindEnd ? form.remindEnd.slice(11, 16) : "";

  function setFormField<K extends keyof ReminderFormState>(key: K, value: ReminderFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateReminderEnd(date: string, time: string) {
    if (!date && !time) {
      setFormField("remindEnd", "");
      return;
    }
    setFormField("remindEnd", `${date || remindDate}T${time || remindTime || "23:59"}`);
  }

  function openCreateForm() {
    setForm(defaultReminderForm());
    setShowForm(true);
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.remindEnd) return;
    setSaving(true);
    try {
      await taskApi.createReminder({
        title: form.title.trim(),
        note: form.note.trim() || undefined,
        remindEnd: form.remindEnd,
        isImportant: form.isImportant,
      });
      setShowForm(false);
      setForm(defaultReminderForm());
      await load("active");
      setTab("active");
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建提醒失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDone(id: string) {
    setBusyReminderId(id);
    try {
      await taskApi.markReminderDone(id);
      await load(tab);
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyReminderId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("确定删除这条个人提醒吗？")) return;
    setBusyReminderId(id);
    try {
      await taskApi.deleteReminder(id);
      await load(tab);
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyReminderId(null);
    }
  }

  return (
    <div className="page-shell">
      <div className="mobile-page bottom-safe">
        <div className="section" style={{ paddingTop: 22, paddingBottom: 18 }}>
          <div className="topbar">
            <button className="btn btn-ghost icon-btn" onClick={() => navigate(-1)}><ChevronLeft size={18} /></button>
            <h1 className="topbar-title">个人提醒</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="btn btn-ghost icon-btn" onClick={() => void load()} title="刷新">
                <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
              </button>
              <button className="btn btn-primary icon-btn" onClick={openCreateForm} title="新建提醒">
                <Plus size={18} />
              </button>
            </div>
          </div>

          <div className="card card-strong" style={{ padding: 8, marginBottom: 12 }}>
            <div className="segmented" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <button className={`btn ${tab === "active" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("active")}>进行中</button>
              <button className={`btn ${tab === "overdue" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("overdue")}>已逾期</button>
            </div>
          </div>

          {loading ? <div className="card" style={{ padding: 18, display: "flex", alignItems: "center", gap: 8 }}><RefreshCcw size={16} className="animate-spin" />加载中...</div> : null}
          {error ? <div className="card error" style={{ padding: 18 }}>{error}</div> : null}

          {!loading && !error ? (
            <div className="list">
              {reminders.map((reminder) => (
                <ReminderCard key={reminder.id} reminder={reminder} onDone={handleDone} onDelete={handleDelete} busyId={busyReminderId} />
              ))}
              {reminders.length === 0 ? (
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {tab === "overdue" ? <AlertTriangle size={18} color="#dc2626" /> : <Clock3 size={18} color="#2563eb" />}
                    <div>
                      <div style={{ fontWeight: 700 }}>{tab === "overdue" ? "暂无逾期提醒" : "暂无进行中提醒"}</div>
                      <div className="section-note">可先新建一条提醒</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {showForm ? (
            <div className="modal-backdrop" onClick={() => setShowForm(false)}>
              <div className="modal-sheet" onClick={(event) => event.stopPropagation()}>
                <div className="section-title-row" style={{ marginBottom: 12 }}>
                  <p className="card-title" style={{ marginBottom: 0 }}>新建提醒</p>
                  <button className="btn btn-ghost icon-btn" onClick={() => setShowForm(false)} title="关闭">
                    <X size={18} />
                  </button>
                </div>

                <div className="list">
                  <div>
                    <div className="section-note" style={{ marginTop: 0, marginBottom: 8, color: "#334155" }}>提醒标题</div>
                    <input className="input" placeholder="例如：今晚 8 点前回访主播" value={form.title} onChange={(event) => setFormField("title", event.target.value)} />
                  </div>

                  <div>
                    <div className="section-note" style={{ marginTop: 0, marginBottom: 8, color: "#334155" }}>备注说明</div>
                    <textarea className="input" rows={3} placeholder="可选，补充说明内容" value={form.note} onChange={(event) => setFormField("note", event.target.value)} />
                  </div>

                  <div>
                    <div className="section-note" style={{ marginTop: 0, marginBottom: 8, color: "#334155" }}>结束时间</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 132px", gap: 10 }}>
                      <MiniDatePicker value={remindDate} onChange={(value) => updateReminderEnd(value, remindTime)} />
                      <MiniTimePicker value={remindTime} onChange={(value) => updateReminderEnd(remindDate, value)} />
                    </div>
                    <div className="section-note">请选择北京时间；只选日期时默认使用 23:59。</div>
                  </div>

                  <div>
                    <div className="section-note" style={{ marginTop: 0, marginBottom: 8, color: "#334155" }}>重要程度</div>
                    <div className="segmented" style={{ gridTemplateColumns: "1fr 1fr" }}>
                      <button className={`btn ${form.isImportant ? "btn-primary" : "btn-ghost"}`} onClick={() => setFormField("isImportant", true)}>重要</button>
                      <button className={`btn ${!form.isImportant ? "btn-primary" : "btn-ghost"}`} onClick={() => setFormField("isImportant", false)}>普通</button>
                    </div>
                  </div>

                  <div className="section-note">提醒会一直显示在列表中，直到你手动标记完成或删除。</div>

                  <button className="btn btn-primary" disabled={!form.title.trim() || !form.remindEnd || saving} onClick={() => void handleCreate()}>
                    {saving ? "创建中..." : "创建提醒"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
