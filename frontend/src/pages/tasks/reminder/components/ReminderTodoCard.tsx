import { useState } from "react";
import { CheckCircle2, Circle, Clock, ChevronUp, Trash2 } from "lucide-react";

import type { PersonalReminder } from "../../../../types";

export function formatReminderDateTime(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getReminderEndTime(reminder: PersonalReminder) {
  return reminder.remindEnd || reminder.remindStart || reminder.remindAt || null;
}

export function getReminderEndMs(reminder: PersonalReminder) {
  const target = getReminderEndTime(reminder);
  if (!target) return null;
  const timestamp = new Date(target).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function isReminderUrgent(reminder: PersonalReminder) {
  const target = getReminderEndMs(reminder);
  if (target === null || reminder.status === "done") return false;
  const diff = target - Date.now();
  return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000;
}

export function isReminderOverdue(reminder: PersonalReminder) {
  const target = getReminderEndMs(reminder);
  if (target === null || reminder.status === "done") return false;
  return target < Date.now();
}

export function sortReminders(reminders: PersonalReminder[]) {
  return [...reminders].sort((a, b) => {
    const doneCompare = Number(a.status === "done") - Number(b.status === "done");
    if (doneCompare !== 0) return doneCompare;

    const overdueCompare = Number(isReminderOverdue(b)) - Number(isReminderOverdue(a));
    if (overdueCompare !== 0) return overdueCompare;

    const urgentCompare = Number(isReminderUrgent(b)) - Number(isReminderUrgent(a));
    if (urgentCompare !== 0) return urgentCompare;

    const importantCompare = Number(Boolean(b.isImportant)) - Number(Boolean(a.isImportant));
    if (importantCompare !== 0) return importantCompare;

    const endCompare = (getReminderEndMs(a) ?? Number.MAX_SAFE_INTEGER) - (getReminderEndMs(b) ?? Number.MAX_SAFE_INTEGER);
    if (endCompare !== 0) return endCompare;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

type Props = {
  reminder: PersonalReminder;
  onDone?: (id: string) => void | Promise<void>;
  onDelete?: (id: string) => void | Promise<void>;
  compact?: boolean;
  minimal?: boolean;
};

export function ReminderTodoCard({ reminder, onDone, onDelete, compact = false, minimal = false }: Props) {
  const urgent = isReminderUrgent(reminder);
  const overdue = isReminderOverdue(reminder);
  const done = reminder.status === "done";
  const important = Boolean(reminder.isImportant);
  const endTime = getReminderEndTime(reminder);
  const cardClassName = done
    ? "border-slate-200 opacity-60"
    : overdue
      ? "border-red-200 bg-red-50/40"
      : urgent
        ? "border-amber-200 bg-amber-50/30"
        : important
          ? "border-rose-200 bg-rose-50/20"
          : "border-slate-200";
  const [expanded, setExpanded] = useState(false);

  if (minimal) {
    // 根据状态决定详情按钮气泡颜色
    const detailBadgeCls = done
      ? "bg-slate-100 text-slate-400"
      : overdue
        ? "bg-red-100 text-red-600 font-semibold"
        : urgent
          ? "bg-amber-100 text-amber-700 font-semibold"
          : "bg-blue-50 text-blue-600";

    // 卡片边框：加深，逾期/紧急用彩色边框强调
    const cardBorderCls = done
      ? "border-slate-300 opacity-60"
      : overdue
        ? "border-red-300 bg-red-50/40"
        : urgent
          ? "border-amber-300 bg-amber-50/30"
          : "border-slate-300 bg-white";

    return (
      <div className={`rounded-lg border shadow-[0_1px_4px_rgba(15,23,42,0.08)] ${cardBorderCls}`}>
        {/* 主行：勾选 + 标题 + 详情气泡 */}
        <div className="flex items-center gap-1.5 px-2 py-1">
          <button
            type="button"
            onClick={() => !done && onDone?.(reminder.id)}
            disabled={done || !onDone}
            className="shrink-0 text-slate-400 transition hover:text-emerald-500 disabled:cursor-default"
          >
            {done ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Circle size={12} />}
          </button>
          <p className={`min-w-0 flex-1 truncate text-[11px] font-medium leading-[1.3] ${done ? "text-slate-400 line-through" : overdue ? "text-red-600" : "text-slate-900"}`}>
            {reminder.title}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] transition hover:opacity-80 ${detailBadgeCls}`}
          >
            {expanded ? <ChevronUp size={10} className="inline" /> : "详情"}
          </button>
        </div>
        {/* 展开详情 */}
        {expanded && (
          <div className="border-t border-slate-200 px-2 pb-1.5 pt-1 space-y-0.5">
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Clock size={10} className={overdue && !done ? "text-red-400" : "text-blue-400"} />
              <span className={overdue && !done ? "text-red-500 font-medium" : ""}>
                {endTime ? formatReminderDateTime(endTime) : "未设置结束时间"}
                {overdue && !done && " · 已逾期"}
                {urgent && !done && !overdue && " · 即将到期"}
              </span>
            </div>
            {reminder.note ? (
              <p className="text-[10px] leading-4 text-slate-500 break-all">{reminder.note}</p>
            ) : (
              <p className="text-[10px] text-slate-300 italic">暂无备注</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-start bg-white transition ${compact ? "gap-2.5 rounded-2xl border p-3 shadow-[0_2px_10px_rgba(15,23,42,0.04)]" : "gap-4 rounded-2xl border p-4 shadow-[0_1px_8px_rgba(15,23,42,0.04)]"} ${cardClassName}`}>
      <button
        type="button"
        onClick={() => !done && onDone?.(reminder.id)}
        disabled={done || !onDone}
        className="mt-0.5 shrink-0 text-slate-400 transition hover:text-emerald-500 disabled:cursor-default"
      >
        {done ? <CheckCircle2 size={compact ? 16 : 18} className="text-emerald-500" /> : <Circle size={compact ? 16 : 18} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={`${compact ? "line-clamp-2 text-sm leading-5" : "font-medium"} text-slate-900 ${done ? "text-slate-400 line-through" : ""}`}>{reminder.title}</p>
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${important ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-500"}`}>
            {important ? "重要" : "不重要"}
          </span>
          {overdue && !done && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-500">已逾期</span>}
          {urgent && !done && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">紧急</span>}
        </div>

        {reminder.note && <p className={`${compact ? "line-clamp-2 text-xs leading-5" : "text-sm"} mt-1 text-slate-500`}>{reminder.note}</p>}

        <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-slate-400">
          <span className={`flex items-center gap-1 ${overdue && !done ? "text-red-500" : "text-blue-500"}`}>
            <Clock size={11} />
            {endTime ? formatReminderDateTime(endTime) : "未设置"}
          </span>
        </div>
      </div>

      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(reminder.id)}
          className="shrink-0 rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
