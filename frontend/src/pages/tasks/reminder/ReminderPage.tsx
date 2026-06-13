import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, CheckCircle2, Clock, Plus, Trash2, X } from "lucide-react";
import type { PersonalReminder } from "../../../types";
import { reminderApi } from "../../../services/task";
import { MiniDatePicker, MiniTimePicker } from "../../../shared/components/date-time/MiniDateTimePickers";
import { ReminderTodoCard, isReminderOverdue, sortReminders } from "./components/ReminderTodoCard";

type TabType = "active" | "overdue" | "done";

type FormState = {
  title: string;
  note: string;
  remindEnd: string;
  isImportant: boolean;
};

const defaultForm = (): FormState => ({
  title: "",
  note: "",
  remindEnd: "",
  isImportant: true,
});

const TAB_CONFIG: { value: TabType; label: string; apiStatus: string }[] = [
  { value: "active", label: "进行中", apiStatus: "active" },
  { value: "overdue", label: "已逾期", apiStatus: "overdue" },
  { value: "done", label: "已完成", apiStatus: "done" },
];

export function ReminderPage() {
  const navigate = useNavigate();
  const [reminders, setReminders] = useState<PersonalReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [tab, setTab] = useState<TabType>("active");
  const [form, setForm] = useState<FormState>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async (currentTab: TabType = tab) => {
    setLoading(true);
    const apiStatus = TAB_CONFIG.find((c) => c.value === currentTab)?.apiStatus ?? "active";
    const data = await reminderApi.list(apiStatus).catch(() => [] as PersonalReminder[]);
    setReminders(data);
    setLoading(false);
  };

  useEffect(() => {
    void load(tab);
  }, [tab]);

  function setF<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const remindEndDate = form.remindEnd ? form.remindEnd.slice(0, 10) : "";
  const remindEndTime = form.remindEnd ? form.remindEnd.slice(11, 16) : "";

  function handleRemindEndChange(date: string, time: string) {
    if (!date && !time) {
      setF("remindEnd", "");
      return;
    }
    setF("remindEnd", `${date || remindEndDate}T${time || remindEndTime || "23:59"}`);
  }

  function openCreateModal() {
    setForm(defaultForm());
    setShowModal(true);
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.remindEnd) return;
    setSaving(true);
    try {
      await reminderApi.create({
        title: form.title.trim(),
        note: form.note.trim() || undefined,
        remindEnd: form.remindEnd,
        isImportant: form.isImportant,
      });
      setShowModal(false);
      setForm(defaultForm());
      setTab("active");
      await load("active");
    } catch {
      window.alert("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleDone(id: string) {
    await reminderApi.done(id).catch(console.error);
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm("确认删除这条提醒？")) return;
    setDeletingId(id);
    await reminderApi.delete(id).catch(console.error);
    setDeletingId(null);
    await load();
  }

  const sortedReminders = useMemo(() => sortReminders(reminders), [reminders]);

  // 统计数字（全量拉取时用，这里只统计当前 tab 数量）
  const overdueCount = tab === "active" ? reminders.filter(isReminderOverdue).length : 0;

  return (
    <div className="space-y-5">
      {/* 顶部：返回 + 标题 + 新建 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <ArrowLeft size={15} />返回
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">个人提醒</h1>
            <p className="text-xs text-slate-400">仅自己可见 · 已完成/逾期超30天自动清理</p>
          </div>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-sm font-medium text-white shadow-md shadow-amber-100 transition hover:bg-amber-600"
        >
          <Plus size={14} />新建提醒
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2">
        {TAB_CONFIG.map(({ value, label }) => {
          const isActive = tab === value;
          const tabStyle =
            value === "active"
              ? "bg-blue-500 text-white"
              : value === "overdue"
                ? "bg-red-500 text-white"
                : "bg-emerald-500 text-white";
          return (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition ${
                isActive ? tabStyle : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {value === "active" && <Clock size={13} />}
              {value === "overdue" && <Bell size={13} />}
              {value === "done" && <CheckCircle2 size={13} />}
              {label}
              {value === "active" && overdueCount > 0 && (
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">{overdueCount}逾期</span>
              )}
            </button>
          );
        })}
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">加载中...</div>
      ) : sortedReminders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-16 text-slate-400">
          <Bell size={36} className="mb-3 text-slate-200" />
          <p className="text-sm">
            {tab === "active" ? "没有进行中的提醒" : tab === "overdue" ? "没有已逾期的提醒" : "没有已完成的提醒"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedReminders.map((reminder) => (
            <div key={reminder.id} className="group relative">
              <ReminderTodoCard reminder={reminder} onDone={tab !== "done" ? handleDone : undefined} />
              {/* 删除按钮，hover 时显示 */}
              <button
                type="button"
                onClick={() => handleDelete(reminder.id)}
                disabled={deletingId === reminder.id}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 disabled:opacity-40"
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 新建弹窗 */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">新建提醒</h3>
              <button
                onClick={() => setShowModal(false)}
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
                  value={form.title}
                  onChange={(event) => setF("title", event.target.value)}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">备注说明</label>
                <textarea
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                  rows={2}
                  placeholder="可选的备注说明..."
                  value={form.note}
                  onChange={(event) => setF("note", event.target.value)}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  结束时间 <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-[1fr_9rem] gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">结束日期</span>
                    <MiniDatePicker value={remindEndDate} onChange={(value) => handleRemindEndChange(value, remindEndTime)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">结束时间</span>
                    <MiniTimePicker value={remindEndTime} onChange={(value) => handleRemindEndChange(remindEndDate, value)} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-400">请选择北京时间；只选日期时默认使用 23:59。</p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">重要？</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setF("isImportant", true)}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      form.isImportant ? "border-rose-300 bg-rose-50 text-rose-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    重要
                  </button>
                  <button
                    type="button"
                    onClick={() => setF("isImportant", false)}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      !form.isImportant ? "border-slate-300 bg-slate-100 text-slate-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    不重要
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                已完成/已逾期超 30 天的提醒将自动清理。
              </div>

              <button
                onClick={handleCreate}
                disabled={!form.title.trim() || !form.remindEnd || saving}
                className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-40"
              >
                {saving ? "保存中..." : "创建提醒"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
