import { useEffect, useRef, useState } from "react";
import { Users, RefreshCw, TrendingUp, Filter } from "lucide-react";
import { anchorSummaryApi, type AnchorTrendResponse, type AnchorDailySummary, type OperatorStat } from "../../../services/task";
import { useIdentityStore } from "../../../stores/identityStore";

interface Props {
  scopeOrgId?: string;
}

const PROBATION_OPTIONS = [
  { label: "无试用期", value: 0 },
  { label: "5 天", value: 5 },
  { label: "10 天", value: 10 },
  { label: "15 天", value: 15 },
  { label: "20 天", value: 20 },
  { label: "25 天", value: 25 },
  { label: "30 天", value: 30 },
];

export function AnchorSummaryCard({ scopeOrgId }: Props) {
  const { currentIdentity } = useIdentityStore();
  const [trend, setTrend] = useState<AnchorTrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probationDays, setProbationDays] = useState(0);

  // 运营明细弹窗状态
  const [operatorDialogOpen, setOperatorDialogOpen] = useState(false);

  // 运营明细悬停状态：当前悬停的字段（null = 无）
  const [hoveredField, setHoveredField] = useState<"total" | "within7" | "within20" | null>(null);

  // 三张卡片的 DOM 引用，用于浮层定位
  const totalCardRef = useRef<HTMLDivElement>(null);
  const within7CardRef = useRef<HTMLDivElement>(null);
  const within20CardRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; height: number } | null>(null);

  /** 计算浮层位置（出现在悬停卡片左侧） */
  const updatePopoverPos = (field: "total" | "within7" | "within20") => {
    const refMap = {
      total: totalCardRef,
      within7: within7CardRef,
      within20: within20CardRef,
    };
    const el = refMap[field].current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPopoverPos({
      top: rect.top,
      left: rect.left,
      height: rect.height,
    });
  };

  const loadTrend = (sid?: string, pd?: number) => {
    setLoading(true);
    setError(null);
    const pdv = pd ?? probationDays;
    anchorSummaryApi
      .getTrend(sid ?? scopeOrgId, 7, pdv)
      .then((data) => setTrend(data))
      .catch((e) => setError(e?.message ?? "加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeOrgId]);

  // 试用期切换时重新加载
  useEffect(() => {
    if (trend) loadTrend(undefined, probationDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probationDays]);

  // 监听全局事件，从统一上传弹窗上传后刷新
  useEffect(() => {
    const handler = () => loadTrend();
    window.addEventListener("anchor-summary-refresh", handler);
    return () => window.removeEventListener("anchor-summary-refresh", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latest: AnchorDailySummary | null = trend?.latest ?? null;

  // 最新日期的试用期排除人数
  const latestProbationExcluded = trend?.latest?.probationExcluded ?? 0;

  return (
    <>
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        {/* ── 标题行 ── */}
        <div className="flex items-center gap-3 px-5 h-14 border-b border-slate-100">
          <div className="flex items-center gap-2 shrink-0">
            <TrendingUp size={16} className="text-feishu-blue shrink-0" />
            <span className="text-[14px] font-semibold text-slate-700">
              {trend?.baseOrgName
                ? `${trend.baseOrgName} · 主播数量统计`
                : "基地主播数量统计"}
            </span>
            {latest && latest.operatorStats && (latest.operatorStats as OperatorStat[]).length > 0 && (
              <span className="text-[12px] font-medium text-slate-500 hidden sm:inline">
                · 运营明细：共 {(latest.operatorStats as OperatorStat[]).length} 人
                <span className="text-slate-300 font-normal ml-1">（鼠标悬停右侧卡片查看）</span>
              </span>
            )}
          </div>

          {/* 试用期选择器 */}
          {latest && (
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              <Filter size={13} className="text-slate-400" />
              <select
                value={probationDays}
                onChange={(e) => setProbationDays(Number(e.target.value))}
                className="text-[12px] border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-600 outline-none focus:border-feishu-blue focus:ring-1 focus:ring-feishu-blue/20 cursor-pointer"
              >
                {PROBATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 右侧操作区 */}
          <div className="flex items-center gap-2 shrink-0">
            {error && <span className="text-[11px] text-red-500 mr-1">{error}</span>}

            {latest && (
              <span className="text-[10px] text-slate-300 mr-1 hidden sm:inline">
                上传者：{latest.uploaderName} · {latest.rawRowCount} 行
              </span>
            )}

            {latest && (
              <div className="flex items-center gap-1.5 mr-1">
                <span className="text-[11px] text-slate-400">最新数据</span>
                <span className="text-[12px] font-medium text-slate-600 tabular-nums">
                  {latest.recordDate}
                </span>
              </div>
            )}

            <button
              onClick={() => loadTrend()}
              disabled={loading}
              title="刷新"
              className="flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* ── 内容区：仅展示最新日期统计（图表已移除） ── */}
        {loading && !trend ? (
          <div className="flex items-center justify-center py-12">
            <div className="space-y-3 w-full max-w-2xl px-4">
              <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
            </div>
          </div>
        ) : !latest ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
            <Users size={32} className="text-slate-200" />
            <p className="text-[13px]">暂无数据，请通过「上传数据 → 主播数据表」录入</p>
          </div>
        ) : (
            <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div ref={totalCardRef}>
                <BigStatCard
                  label="主播总数"
                  value={latest.totalCount}
                  sub={`线上 ${latest.onlineCount} · 线下 ${latest.offlineCount}`}
                  color="text-feishu-blue"
                  bg="bg-blue-50"
                  interactive
                  active={hoveredField === "total"}
                  onHoverChange={(active) => {
                    if (active) {
                      updatePopoverPos("total");
                      setHoveredField("total");
                    } else {
                      setHoveredField((prev) => (prev === "total" ? null : prev));
                    }
                  }}
                />
              </div>
              <div ref={within7CardRef}>
                <BigStatCard
                  label="7天内新增"
                  value={latest.within7Days}
                  sub={`占总人数 ${latest.totalCount > 0 ? ((latest.within7Days / latest.totalCount) * 100).toFixed(1) : 0}%`}
                  color="text-amber-600"
                  bg="bg-orange-50"
                  interactive
                  active={hoveredField === "within7"}
                  onHoverChange={(active) => {
                    if (active) {
                      updatePopoverPos("within7");
                      setHoveredField("within7");
                    } else {
                      setHoveredField((prev) => (prev === "within7" ? null : prev));
                    }
                  }}
                />
              </div>
              <div ref={within20CardRef}>
                <BigStatCard
                  label="20天内新增"
                  value={latest.within20Days}
                  sub={`占总人数 ${latest.totalCount > 0 ? ((latest.within20Days / latest.totalCount) * 100).toFixed(1) : 0}%`}
                  color="text-blue-500"
                  bg="bg-sky-50"
                  interactive
                  active={hoveredField === "within20"}
                  onHoverChange={(active) => {
                    if (active) {
                      updatePopoverPos("within20");
                      setHoveredField("within20");
                    } else {
                      setHoveredField((prev) => (prev === "within20" ? null : prev));
                    }
                  }}
                />
              </div>
            </div>
        )}

        {/* ── 底部：运营明细已移至标题旁（节省高度） ── */}

        {/* ── 试用期排除提示 ── */}
        {probationDays > 0 && latestProbationExcluded > 0 && (
          <div className="px-5 py-2 border-t border-amber-100 bg-amber-50/50 flex items-center gap-2">
            <span className="text-[11px] text-amber-700">
              试用期 {probationDays} 天内入职的{" "}
              <strong className="text-amber-800">{latestProbationExcluded}</strong>{" "}
              人未计入主播总数/线上/线下
            </span>
          </div>
        )}
      </div>

      {/* ── 运营明细浮层（悬停显示，贴在悬停卡片左侧） ── */}
      {hoveredField && popoverPos && latest && (latest.operatorStats as OperatorStat[])?.length > 0 && (
        <OperatorPopover
          field={hoveredField}
          recordDate={latest.recordDate}
          operators={latest.operatorStats as OperatorStat[]}
          pos={popoverPos}
        />
      )}
    </>
  );
}

/** 大号统计卡片 */
function BigStatCard({
  label,
  value,
  sub,
  color,
  bg,
  interactive = false,
  active = false,
  onHoverChange,
}: {
  label: string;
  value: number;
  sub: string;
  color: string;
  bg: string;
  interactive?: boolean;
  active?: boolean;
  onHoverChange?: (active: boolean) => void;
}) {
  return (
    <div
      className={`rounded-xl ${bg} px-3 py-2 transition-all ${
        interactive ? "cursor-pointer" : ""
      } ${active ? "ring-2 ring-feishu-blue shadow-md scale-[1.01]" : ""}`}
      onMouseEnter={interactive ? () => onHoverChange?.(true) : undefined}
      onMouseLeave={interactive ? () => onHoverChange?.(false) : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-600">{label}</p>
        <p className="text-[13px] font-semibold text-slate-700 tabular-nums">{sub}</p>
      </div>
      <p className={`text-[30px] font-extrabold leading-none tabular-nums ${color} mt-1`}>{value}</p>
    </div>
  );
}

/** 迷你统计标签（已弃用：与右侧大卡片重复，删除） */
// function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
//   return (
//     <div className="flex items-baseline gap-1">
//       <span className="text-[11px] text-slate-400">{label}</span>
//       <span className={`text-[15px] font-bold tabular-nums leading-none ${color}`}>{value}</span>
//     </div>
//   );
// }



/** 运营行 */
function OperatorRow({ op }: { op: OperatorStat }) {
  const total = op.onlineCount + op.offlineCount;
  const onlinePct = total > 0 ? Math.round((op.onlineCount / total) * 100) : 0;
  const offlinePct = total > 0 ? 100 - onlinePct : 0;

  return (
    <div className="flex items-center gap-3 px-5 h-10 hover:bg-slate-50 transition-colors overflow-hidden">
      <span className="w-16 shrink-0 text-[12px] font-medium text-slate-600 truncate" title={op.name}>
        {op.name}
      </span>

      {total > 0 ? (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[10px] text-red-400 tabular-nums shrink-0 whitespace-nowrap">线下 {offlinePct}%</span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden flex min-w-0">
            <div
              className="h-full bg-gradient-to-r from-red-400 to-red-300 transition-all duration-500"
              style={{ width: `${offlinePct}%` }}
            />
            <div
              className="h-full bg-gradient-to-r from-blue-300 to-blue-400 transition-all duration-500"
              style={{ width: `${onlinePct}%` }}
            />
          </div>
          <span className="text-[10px] text-blue-400 tabular-nums shrink-0 whitespace-nowrap">线上 {onlinePct}%</span>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="flex items-center gap-2 shrink-0 whitespace-nowrap text-[11px]">
        <span className="text-slate-500 tabular-nums">
          合计 <strong className="text-slate-700">{op.totalCount}</strong>
        </span>
        <span className="text-emerald-600 tabular-nums">
          线上 <strong>{op.onlineCount}</strong>
        </span>
        <span className="text-slate-400 tabular-nums">
          线下 <strong>{op.offlineCount}</strong>
        </span>
        <span className="text-amber-600 tabular-nums">
          7天 <strong>{op.within7Days}</strong>
        </span>
        <span className="text-blue-400 tabular-nums">
          20天 <strong>{op.within20Days}</strong>
        </span>
      </div>
    </div>
  );
}

/** 运营明细浮层（悬停显示，固定在悬停卡片左侧） */
function OperatorPopover({
  field,
  recordDate,
  operators,
  pos,
}: {
  field: "total" | "within7" | "within20";
  recordDate: string;
  operators: OperatorStat[];
  pos: { top: number; left: number; height: number };
}) {
  // 根据悬停字段选择排序键
  const sorted = [...operators].sort((a, b) => {
    if (field === "total") return b.totalCount - a.totalCount;
    if (field === "within7") return b.within7Days - a.within7Days;
    return b.within20Days - a.within20Days;
  });

  const titleMap = {
    total: "运营明细 · 按总数排序",
    within7: "7天内新增 · 按新增数排序",
    within20: "20天内新增 · 按新增数排序",
  };

  // 浮层宽度
  const POPOVER_WIDTH = 560;
  // 浮层与卡片右边缘的间距
  const GAP = 12;
  // 浮层顶部与卡片顶部对齐
  const top = pos.top;
  // 浮层左侧 = 卡片左侧 - 浮层宽度 - 间距
  const left = pos.left - POPOVER_WIDTH - GAP;

  return (
    <div
      className="fixed z-50 rounded-xl bg-white overflow-hidden border-2 border-slate-300"
      style={{
        top,
        left: Math.max(12, left),
        width: POPOVER_WIDTH,
        boxShadow: "0 12px 32px rgba(15, 23, 42, 0.18)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-700">{titleMap[field]}</span>
          <span className="text-[11px] text-slate-500">
            归属日期 {recordDate} · 共 {operators.length} 人
          </span>
        </div>
      </div>
      <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
        {sorted.map((op) => (
          <OperatorRow key={op.name} op={op} />
        ))}
      </div>
    </div>
  );
}
