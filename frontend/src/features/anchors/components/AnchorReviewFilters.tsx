import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { ReviewStatus } from "../types";

// ─── 日期工具函数 ───────────────────────────────────────────────
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getToday(): string {
  return fmt(new Date());
}

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // 调整到周一
  d.setDate(d.getDate() + diff);
  return fmt(d);
}

function getMonthStart(): string {
  const d = new Date();
  d.setDate(1);
  return fmt(d);
}

function addDays(date: string, n: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

function diffDays(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

const MAX_DAYS = 30;

type QuickRange = "today" | "week" | "month" | "custom" | "";

// ─── Props ──────────────────────────────────────────────────────
interface AnchorReviewFiltersProps {
  keyword: string;
  setKeyword: (val: string) => void;
  dateFrom: string;
  setDateFrom: (val: string) => void;
  dateTo: string;
  setDateTo: (val: string) => void;
  reviewStatus: ReviewStatus;
  setReviewStatus: (val: ReviewStatus) => void;
  onReset: () => void;
  onRefresh: () => void;
}

export function AnchorReviewFilters({
  keyword,
  setKeyword,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  reviewStatus,
  setReviewStatus,
  onReset,
  onRefresh,
}: AnchorReviewFiltersProps) {
  const [quickRange, setQuickRange] = useState<QuickRange>("");
  const [rangeWarning, setRangeWarning] = useState("");
  const [spinning, setSpinning] = useState(false);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 显示截断提示，3 秒后自动消失
  function showWarning(text: string) {
    setRangeWarning(text);
    if (warningTimer.current) clearTimeout(warningTimer.current);
    warningTimer.current = setTimeout(() => setRangeWarning(""), 3000);
  }

  useEffect(() => () => { if (warningTimer.current) clearTimeout(warningTimer.current); }, []);

  // ─── 快捷按钮点击 ────────────────────────────────────────────
  function selectToday() {
    const today = getToday();
    setDateFrom(today);
    setDateTo(today);
    setQuickRange("today");
    setRangeWarning("");
  }

  function selectWeek() {
    setDateFrom(getWeekStart());
    setDateTo(getToday());
    setQuickRange("week");
    setRangeWarning("");
  }

  function selectMonth() {
    setDateFrom(getMonthStart());
    setDateTo(getToday());
    setQuickRange("month");
    setRangeWarning("");
  }

  function selectCustom() {
    setQuickRange("custom");
    setDateFrom("");
    setDateTo("");
    setRangeWarning("");
  }

  // ─── 自定义日期变化处理 ──────────────────────────────────────
  function handleFromChange(val: string) {
    setQuickRange("custom");
    setDateFrom(val);
    if (val && dateTo && diffDays(val, dateTo) > MAX_DAYS) {
      const truncated = addDays(val, MAX_DAYS);
      setDateTo(truncated);
      showWarning(`日期范围超过 ${MAX_DAYS} 天，结束日期已自动调整为 ${truncated}`);
    } else {
      setRangeWarning("");
    }
  }

  function handleToChange(val: string) {
    setQuickRange("custom");
    if (dateFrom && val && diffDays(dateFrom, val) > MAX_DAYS) {
      const truncated = addDays(dateFrom, MAX_DAYS);
      setDateTo(truncated);
      showWarning(`日期范围超过 ${MAX_DAYS} 天，结束日期已自动调整为 ${truncated}`);
    } else {
      setDateTo(val);
      setRangeWarning("");
    }
  }

  // ─── 重置 ────────────────────────────────────────────────────
  function handleReset() {
    setQuickRange("");
    setRangeWarning("");
    onReset();
  }

  // ─── 刷新 ────────────────────────────────────────────────────
  function handleRefresh() {
    setSpinning(true);
    onRefresh();
    setTimeout(() => setSpinning(false), 600);
  }

  // ─── 快捷按钮样式 ────────────────────────────────────────────
  const quickBtnClass = (key: QuickRange) =>
    `rounded-2xl border px-3 py-2 text-sm transition ${
      quickRange === key
        ? "border-feishu-blue bg-feishu-pale text-feishu-blue font-medium"
        : "border-slate-200 text-slate-600 hover:border-feishu-blue hover:text-feishu-blue"
    }`;

  return (
    <div className="flex flex-col gap-2 items-end">
      {/* 第一行：搜索框 + 审核状态 + 操作按钮 */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            className="w-64 rounded-2xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-feishu-blue"
            placeholder="搜手机号/基地/团队/厅/编码/抖音号"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <select
          className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-feishu-blue"
          value={reviewStatus}
          onChange={(event) => setReviewStatus(event.target.value as ReviewStatus)}
        >
          <option value="pending">待审核</option>
          <option value="rejected">已驳回</option>
          <option value="approved">已通过</option>
        </select>
        {/* 重置 */}
        <button
          className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:border-red-300 hover:text-red-500 transition"
          title="清空所有筛选条件并重新加载"
          onClick={handleReset}
        >
          重置
        </button>
        {/* 刷新 */}
        <button
          className="flex items-center gap-1.5 rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:border-feishu-blue hover:text-feishu-blue transition"
          title="保留当前筛选条件，重新拉取最新数据"
          onClick={handleRefresh}
        >
          <RefreshCw size={14} className={spinning ? "animate-spin" : ""} />
          刷新
        </button>
      </div>

      {/* 第二行：快捷日期 + 自定义日期 input */}
      <div className="flex flex-wrap gap-2 items-center">
        <button className={quickBtnClass("today")} onClick={selectToday}>今日</button>
        <button className={quickBtnClass("week")} onClick={selectWeek}>本周</button>
        <button className={quickBtnClass("month")} onClick={selectMonth}>本月</button>
        <button className={quickBtnClass("custom")} onClick={selectCustom}>自定义</button>

        {/* 自定义模式才展示日期输入框 */}
        {quickRange === "custom" && (
          <>
            <input
              type="date"
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-feishu-blue"
              value={dateFrom}
              onChange={(event) => handleFromChange(event.target.value)}
            />
            <span className="text-xs text-slate-400">至</span>
            <input
              type="date"
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-feishu-blue"
              value={dateTo}
              min={dateFrom || undefined}
              max={dateFrom ? addDays(dateFrom, MAX_DAYS) : undefined}
              onChange={(event) => handleToChange(event.target.value)}
            />
            {rangeWarning && (
              <span className="text-xs text-red-500">{rangeWarning}</span>
            )}
          </>
        )}

        {/* 非自定义：显示已选日期范围 */}
        {quickRange && quickRange !== "custom" && (
          <span className="text-xs text-slate-400">
            {dateFrom} ~ {dateTo}
          </span>
        )}
      </div>
    </div>
  );
}
