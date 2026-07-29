import { useEffect, useState } from "react";
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
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        {/* ── 标题行 ── */}
        <div className="flex items-center gap-3 px-5 h-14 border-b border-slate-100">
          <div className="flex items-center gap-2 shrink-0">
            <TrendingUp size={16} className="text-feishu-blue shrink-0" />
            <span className="text-[14px] font-semibold text-slate-700">
              {trend?.baseOrgName
                ? `${trend.baseOrgName}${trend.teamOrgName ? `-${trend.teamOrgName}` : ""} · 主播数量统计`
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
              <div className="relative">
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
                      setHoveredField("total");
                    } else {
                      setHoveredField((prev) => (prev === "total" ? null : prev));
                    }
                  }}
                />
                {hoveredField === "total" && latest && (latest.operatorStats as OperatorStat[])?.length > 0 && (
                  <OperatorPopover
                    field="total"
                    recordDate={latest.recordDate}
                    operators={latest.operatorStats as OperatorStat[]}
                    probationDays={probationDays}
                  />
                )}
              </div>
              <div className="relative">
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
                      setHoveredField("within7");
                    } else {
                      setHoveredField((prev) => (prev === "within7" ? null : prev));
                    }
                  }}
                />
                {hoveredField === "within7" && latest && (latest.operatorStats as OperatorStat[])?.length > 0 && (
                  <OperatorPopover
                    field="within7"
                    recordDate={latest.recordDate}
                    operators={latest.operatorStats as OperatorStat[]}
                    probationDays={probationDays}
                  />
                )}
              </div>
              <div className="relative">
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
                      setHoveredField("within20");
                    } else {
                      setHoveredField((prev) => (prev === "within20" ? null : prev));
                    }
                  }}
                />
                {hoveredField === "within20" && latest && (latest.operatorStats as OperatorStat[])?.length > 0 && (
                  <OperatorPopover
                    field="within20"
                    recordDate={latest.recordDate}
                    operators={latest.operatorStats as OperatorStat[]}
                    probationDays={probationDays}
                  />
                )}
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



/** 运营行：根据 mode 选择展示的 3 列数据维度（合计/线上/线下） */
function OperatorRow({
  op,
  mode,
}: {
  op: OperatorStat;
  mode: "total" | "within7" | "within20";
}) {
  // 比例条始终展示该运营整体的线上/线下占比（作为背景参考，不随 mode 变化）
  const overallTotal = op.onlineCount + op.offlineCount;
  const onlinePct = overallTotal > 0 ? Math.round((op.onlineCount / overallTotal) * 100) : 0;
  const offlinePct = overallTotal > 0 ? 100 - onlinePct : 0;

  // 根据 mode 决定 3 列数字（合计 / 线上 / 线下）
  const labelMap = {
    total: { sum: "主播总数", sumVal: op.totalCount, onlineVal: op.onlineCount, offlineVal: op.offlineCount },
    within7: { sum: "7天新增", sumVal: op.within7Days, onlineVal: op.within7DaysOnline ?? 0, offlineVal: op.within7DaysOffline ?? 0 },
    within20: { sum: "20天新增", sumVal: op.within20Days, onlineVal: op.within20DaysOnline ?? 0, offlineVal: op.within20DaysOffline ?? 0 },
  } as const;
  const cur = labelMap[mode];

  return (
    <div className="flex items-center gap-3 px-5 h-10 hover:bg-slate-50 transition-colors overflow-hidden">
      <span className="w-16 shrink-0 text-[12px] font-medium text-slate-600 truncate" title={op.name}>
        {op.name}
      </span>

      {overallTotal > 0 ? (
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
          {cur.sum} <strong className="text-slate-700">{cur.sumVal}</strong>
        </span>
        <span className="text-emerald-600 tabular-nums">
          线上 <strong>{cur.onlineVal}</strong>
        </span>
        <span className="text-slate-400 tabular-nums">
          线下 <strong>{cur.offlineVal}</strong>
        </span>
      </div>
    </div>
  );
}

/** 运营明细浮层（悬停显示，与卡片宽度一致，紧贴卡片下方） */
function OperatorPopover({
  field,
  recordDate,
  operators,
  probationDays = 0,
}: {
  field: "total" | "within7" | "within20";
  recordDate: string;
  operators: OperatorStat[];
  probationDays?: number;
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

  return (
    <div
      className="absolute z-30 left-0 right-0 top-full mt-2 rounded-xl bg-white overflow-hidden border-2 border-slate-300"
      style={{ boxShadow: "0 12px 32px rgba(15, 23, 42, 0.18)" }}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-700">{titleMap[field]}</span>
          <span className="text-[11px] text-slate-500">
            归属日期 {recordDate} · 共 {operators.length} 人
            {field === "total" && probationDays > 0 && (
              <span className="ml-1 text-amber-600">（已剔除试用期 {probationDays} 天）</span>
            )}
          </span>
        </div>
      </div>
      <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
        {sorted.map((op) => (
          <OperatorRow key={op.name} op={op} mode={field} />
        ))}
      </div>
    </div>
  );
}
