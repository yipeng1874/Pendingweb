import { useEffect, useState } from "react";
import { Bell, Clock3, Loader2, X } from "lucide-react";
import { notifyApi, type TemporaryNotifySchedule } from "../../../services/task";

const TIER_LABELS = ["≤1天", "2-3天", "4-7天", "8-15天", ">15天"];

/** 每档每日次数选项及标签 */
const DAILY_COUNT_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "不通知" },
  { value: 1, label: "每天1次" },
  { value: 2, label: "每天2次" },
  { value: 4, label: "每天4次" },
  { value: 8, label: "每天8次" },
  { value: 12, label: "每天12次" },
  { value: 24, label: "每天24次" },
];

const DEFAULT_SCHEDULE: TemporaryNotifySchedule = {
  enabled: false,
  prefix: "来自系统提醒",
  tier1DailyCount: 2,
  tier2DailyCount: 1,
  tier3DailyCount: 1,
  tier4DailyCount: 0,
  tier5DailyCount: 0,
};

type TierKey = "tier1DailyCount" | "tier2DailyCount" | "tier3DailyCount" | "tier4DailyCount" | "tier5DailyCount";
const TIER_KEYS: TierKey[] = ["tier1DailyCount", "tier2DailyCount", "tier3DailyCount", "tier4DailyCount", "tier5DailyCount"];

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccessMessage?: (message: string) => void;
};

export function TemporaryNotifyScheduleModal({ open, onClose, onSuccessMessage }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [enabled, setEnabled] = useState(DEFAULT_SCHEDULE.enabled);
  const [prefix, setPrefix] = useState(DEFAULT_SCHEDULE.prefix);
  const [tierCounts, setTierCounts] = useState<Record<TierKey, number>>({
    tier1DailyCount: DEFAULT_SCHEDULE.tier1DailyCount,
    tier2DailyCount: DEFAULT_SCHEDULE.tier2DailyCount,
    tier3DailyCount: DEFAULT_SCHEDULE.tier3DailyCount,
    tier4DailyCount: DEFAULT_SCHEDULE.tier4DailyCount,
    tier5DailyCount: DEFAULT_SCHEDULE.tier5DailyCount,
  });

  const busy = loading || saving;

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
      .getTemporaryNotifySchedule()
      .then((payload) => {
        if (cancelled) return;
        setEnabled(payload.enabled);
        setPrefix(payload.prefix || "来自系统提醒");
        setTierCounts({
          tier1DailyCount: payload.tier1DailyCount,
          tier2DailyCount: payload.tier2DailyCount,
          tier3DailyCount: payload.tier3DailyCount,
          tier4DailyCount: payload.tier4DailyCount,
          tier5DailyCount: payload.tier5DailyCount,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "自动催办配置加载失败");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = await notifyApi.saveTemporaryNotifySchedule({
        enabled,
        prefix: prefix.trim() || "来自系统提醒",
        ...tierCounts,
      });
      setEnabled(payload.enabled);
      setPrefix(payload.prefix);
      setTierCounts({
        tier1DailyCount: payload.tier1DailyCount,
        tier2DailyCount: payload.tier2DailyCount,
        tier3DailyCount: payload.tier3DailyCount,
        tier4DailyCount: payload.tier4DailyCount,
        tier5DailyCount: payload.tier5DailyCount,
      });
      const message = payload.enabled
        ? "自动催办已开启，系统将按设定频率推送临时任务未完成提醒。"
        : "自动催办已关闭。";
      setSuccess(message);
      onSuccessMessage?.(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "自动催办配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/35 px-4 py-4 sm:py-6">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:max-h-[calc(100vh-3rem)]">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
              <Bell size={14} />自动催办配置
            </div>
            <h3 className="mt-3 text-xl font-semibold text-slate-900">临时任务 · 自动定时催办</h3>
            <p className="mt-1 text-sm text-slate-500">系统会根据截止时间倒计时，自动按设定频率提醒名下所有进行中的临时任务。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">

          {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
          {success && <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

          {/* 开关 */}
          <label className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-slate-900">自动定时催办</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                开启后，系统每小时自动检测您名下所有进行中的临时任务，按截止天数区间自动发送飞书提醒。
              </p>
            </div>
            <span className="inline-flex items-center gap-3">
              <span className={`text-sm font-medium ${enabled ? "text-emerald-600" : "text-slate-400"}`}>
                {enabled ? "已开启" : "已关闭"}
              </span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
              />
            </span>
          </label>

          {/* 分档频率配置 */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">各档通知频率</p>
                <p className="mt-1 text-xs text-slate-500">距离截止时间越近，建议设置越高频次。</p>
              </div>
              {loading && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                  <Loader2 size={13} className="animate-spin" />配置加载中...
                </span>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {TIER_KEYS.map((key, index) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      距截止 <span className="text-indigo-600">{TIER_LABELS[index]}</span>
                    </p>
                  </div>
                  <select
                    value={tierCounts[key]}
                    onChange={(event) =>
                      setTierCounts((prev) => ({ ...prev, [key]: Number(event.target.value) }))
                    }
                    className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  >
                    {DAILY_COUNT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* 通知前缀 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-900">通知前缀</label>
            <input
              type="text"
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              placeholder="来自系统提醒"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-indigo-400"
            />
            <p className="mt-2 text-xs text-slate-500">为空时将自动使用"来自系统提醒"。</p>
          </div>

          {/* 说明 */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-700">
            适用于您名下所有进行中的临时任务，任务完成或截止后自动停止。手动通知随时可用，作为兜底补发手段。
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-6 py-4">
          <div className="text-xs text-slate-400">所有名下临时任务共用同一套催办配置</div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <><Loader2 size={15} className="animate-spin" />保存中...</> : <><Clock3 size={15} />保存配置</>}
          </button>
        </div>
      </div>
    </div>
  );
}
