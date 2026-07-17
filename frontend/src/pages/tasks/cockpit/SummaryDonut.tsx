import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { DailyRangeStatsResponse } from "../../../types";

/** 完成率颜色 */
export function rateColor(rate: number) {
  if (rate >= 95) return "#10b981";
  if (rate >= 80) return "#f59e0b";
  return "#ef4444";
}

/** 自定义环形图中心标签 */
function DonutCenter({ cx, cy, rate }: { cx?: number; cy?: number; rate: number }) {
  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan x={cx} dy="-6" fontSize="26" fontWeight="700" fill={rateColor(rate)}>
        {rate.toFixed(1)}%
      </tspan>
      <tspan x={cx} dy="24" fontSize="12" fill="#94a3b8">
        今日完成率
      </tspan>
    </text>
  );
}

/** 根据 size 计算缩放参数 */
function scaleParams(size: number) {
  return {
    innerRadius: Math.round(size * 0.32),
    outerRadius: Math.round(size * 0.433),
    percentFontSize: Math.round(size * 0.173),
    labelFontSize: Math.round(size * 0.087),
    dyPercent: -Math.round(size * 0.067),
    dyLabel: Math.round(size * 0.12),
    noDataBorder: Math.round(size * 0.053),
    noDataText: Math.round(size * 0.087),
    bottomText: Math.round(size * 0.087),
  };
}

/** 历史待办完成率 - 汇总环形图 */
export function SummaryDonut({
  data,
  label,
  size = 150,
  color: accent = "emerald",
  children,
}: {
  data: DailyRangeStatsResponse | null;
  label: string;
  size?: number;
  color?: "emerald" | "blue";
  children?: React.ReactNode;
}) {
  const s = scaleParams(size);
  const accentColor = accent === "emerald" ? "#10b981" : "#3b82f6";
  const accentTextClass = accent === "emerald" ? "text-emerald-500" : "text-blue-500";

  if (!data || data.summary.total === 0) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div
          className="flex items-center justify-center rounded-full border-slate-100 bg-slate-50"
          style={{ width: size, height: size, borderWidth: s.noDataBorder }}
        >
          <span style={{ fontSize: s.noDataText, color: "#94a3b8" }}>暂无数据</span>
        </div>
        <span style={{ fontSize: s.bottomText, color: "#94a3b8" }}>{label}</span>
      </div>
    );
  }

  const { completed, total, completionRate, exemptions } = data.summary;
  const pending = Math.max(total - completed, 0);
  const exemptRate = total > 0 ? Math.round((exemptions / total) * 1000) / 10 : 0;

  const pieData = [
    { name: "已完成", value: completed || 0, color: accentColor },
    { name: "未完成", value: pending || 1, color: "#e2e8f0" },
  ];

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={s.innerRadius}
              outerRadius={s.outerRadius}
              paddingAngle={2}
              dataKey="value"
              strokeWidth={0}
              isAnimationActive={true}
            >
              {pieData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
              <tspan x="50%" dy={s.dyPercent} fontSize={s.percentFontSize} fontWeight="800" fill={accentColor}>
                {completionRate}%
              </tspan>
              <tspan x="50%" dy={s.dyLabel} fontSize={s.labelFontSize} fill="#94a3b8">
                {label}
              </tspan>
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-row items-center justify-center gap-1 whitespace-nowrap" style={{ fontSize: s.bottomText }}>
        <span className="text-slate-500 tabular-nums">
          <span className={`font-bold ${accentTextClass}`}>{completed}</span>
          /{total} 人次
        </span>
        {exemptRate > 0 && (
          <>
            <span className="text-slate-300">·</span>
            <span className="text-violet-500 tabular-nums">豁免 {exemptRate}%</span>
          </>
        )}
      </div>

      {children}
    </div>
  );
}
