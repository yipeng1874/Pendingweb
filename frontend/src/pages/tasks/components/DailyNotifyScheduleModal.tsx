import { useEffect, useMemo, useState } from "react";
import { Bell, Clock3, Loader2, X } from "lucide-react";

import {
  notifyApi,
  type DailyFeishuNotifySchedule,
  type DailyNotifyIntervalOption,
} from "../../../services/task";

const FALLBACK_OPTIONS: DailyNotifyIntervalOption[] = [
  { intervalHours: 12, label: "每天2次", description: "00:00、12:00" },
  { intervalHours: 6, label: "每天4次", description: "00:00、06:00、12:00、18:00" },
  { intervalHours: 3, label: "每天8次", description: "每3小时整点发送一次" },
  { intervalHours: 2, label: "每天12次", description: "每2小时整点发送一次" },
  { intervalHours: 1, label: "每天24次", description: "每小时整点发送一次" },
];

type Props = {
  open: boolean;
  scopeOrgId?: string;
  scopeOrgName?: string;
  taskDate?: string;
  onClose: () => void;
  onSuccessMessage?: (message: string) => void;
};

function formatLastTriggeredSlot(slot?: string | null) {
  if (!slot) return "未触发";
  return `${slot}:00`;
}

export function DailyNotifyScheduleModal({ open, scopeOrgId, scopeOrgName, taskDate, onClose, onSuccessMessage }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [schedule, setSchedule] = useState<DailyFeishuNotifySchedule | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState<DailyNotifyIntervalOption["intervalHours"]>(3);
  const [prefix, setPrefix] = useState("");

  const options = useMemo(() => (schedule?.options?.length ? schedule.options : FALLBACK_OPTIONS), [schedule]);
  const resolvedScopeName = scopeOrgName || schedule?.scopeOrg.name || "当前基地";
  const prefixPlaceholder = schedule?.prefixPlaceholder || `来自${resolvedScopeName}提醒`;
  const effectivePrefix = prefix.trim() || prefixPlaceholder;
  const busy = loading || saving || testing;

  useEffect(() => {
    if (!open) {
      setError("");
      setSuccess("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    setSuccess("");

    notifyApi
      .getDailyNotifySchedule(scopeOrgId)
      .then((payload) => {
        if (cancelled) return;
        setSchedule(payload);
        setEnabled(payload.enabled);
        setIntervalHours(payload.intervalHours);
        setPrefix(payload.prefix || payload.prefixPlaceholder);
      })
      .catch((err) => {
        if (cancelled) return;
        setSchedule(null);
        setError(err instanceof Error ? err.message : "自动通知配置加载失败");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, scopeOrgId]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = await notifyApi.saveDailyNotifySchedule({
        scopeOrgId,
        enabled,
        intervalHours,
        prefix: effectivePrefix,
      });
      setSchedule(payload);
      setEnabled(payload.enabled);
      setIntervalHours(payload.intervalHours);
      setPrefix(payload.prefix);
      const message = payload.enabled
        ? `已为${payload.scopeOrg.name}开启自动飞书通知，按${payload.options.find((item) => item.intervalHours === payload.intervalHours)?.label ?? `${payload.intervalHours}小时/次`}执行。`
        : `已关闭${payload.scopeOrg.name}的自动飞书通知。`;
      setSuccess(message);
      onSuccessMessage?.(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "自动通知配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSend() {
    setTesting(true);
    setError("");
    setSuccess("");
    try {
      const result = await notifyApi.testDailyNotifySchedule({
        taskDate,
        scopeOrgId,
        prefix: effectivePrefix,
      });
      const successCount = result.results.reduce((sum, item) => sum + item.successCount, 0);
      const message = `测试发送完成：成功 ${successCount} 人，未绑定 ${result.summary.unboundCount} 人。`;
      setSchedule(result.schedule);
      setPrefix(result.prefix);
      setSuccess(message);
      onSuccessMessage?.(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试发送失败");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/35 px-4 py-4 sm:py-6">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:max-h-[calc(100vh-3rem)]">

        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              <Clock3 size={14} />飞书定时通知配置
            </div>
            <h3 className="mt-3 text-xl font-semibold text-slate-900">{resolvedScopeName} · 日常任务自动通知</h3>
            <p className="mt-1 text-sm text-slate-500">配置后系统会按设定频率自动提醒仍未完成日常任务的人员。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">

          {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
          {success && <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">当前状态</p>
              <p className={`mt-2 text-lg font-semibold ${enabled ? "text-emerald-600" : "text-slate-500"}`}>{enabled ? "已开启" : "已关闭"}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">发送频率</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{options.find((item) => item.intervalHours === intervalHours)?.label ?? `每${intervalHours}小时`}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">上次触发</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{formatLastTriggeredSlot(schedule?.lastTriggeredSlot)}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">测试日期</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{taskDate || "今天"}</p>
            </div>
          </div>

          <label className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-slate-900">自动定时发送</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">开启后会按所选频率自动发送，不需要人工点击“发送飞书通知”。</p>
            </div>
            <span className="inline-flex items-center gap-3">
              <span className={`text-sm font-medium ${enabled ? "text-emerald-600" : "text-slate-500"}`}>{enabled ? "已开启" : "已关闭"}</span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
              />
            </span>
          </label>

          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">发送频率</p>
                <p className="mt-1 text-xs text-slate-500">频率越高，提醒越密集；建议按基地执行节奏选择。</p>
              </div>
              {loading && <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" />配置加载中...</span>}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {options.map((option) => {
                const active = option.intervalHours === intervalHours;
                return (
                  <button
                    key={option.intervalHours}
                    type="button"
                    onClick={() => setIntervalHours(option.intervalHours)}
                    className={`rounded-2xl border px-4 py-4 text-left transition ${active ? "border-blue-300 bg-blue-50 shadow-[0_10px_24px_rgba(76,114,255,0.10)]" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                      {active && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">当前选择</span>}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-900">通知前缀</label>
            <input
              type="text"
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              placeholder={prefixPlaceholder}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-blue-400"
            />
            <p className="mt-2 text-xs text-slate-500">为空时将自动使用“{prefixPlaceholder}”。</p>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
            “立即测试发送”会按当前输入的前缀和基地范围真实发送一轮飞书通知，但不会自动保存配置；如需长期生效，请先保存配置。
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-6 py-4">

          <div className="text-xs text-slate-400">共享范围：整个基地复用同一套自动通知配置</div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleTestSend()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testing ? <><Loader2 size={15} className="animate-spin" />测试中...</> : <><Bell size={15} />立即测试发送</>}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy || loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <><Loader2 size={15} className="animate-spin" />保存中...</> : <><Clock3 size={15} />保存配置</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
