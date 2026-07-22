import { useEffect, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from "recharts";
import { Upload, TrendingUp, X, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { retentionApi, type RetentionMonthEntry, type RetentionTeamRecord, type RetentionAggregated } from "../../../services/task";
import { fetchOrgTree } from "../../../services/organization";

type Props = {
  scopeOrgId?: string;
  baseOrgs?: any[];
  selectedBaseOrgId?: string;
  needsBaseSelect?: boolean;
};

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1;
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
function pad2(n: number) { return String(n).padStart(2, "0"); }

/** 配色对应截图：3天(蓝) / 15天(橙) / 30天(黄) / 在职(绿) / 留存率线(红 虚线) */
const COLORS = { loss3: "#3b82f6", loss15: "#f97316", loss30: "#eab308", active: "#22c55e", rate: "#ef4444" };

/** 计算留存率 = 在职 / (3天+15天+30天+在职) */
function calcRate(loss3: number, loss15: number, loss30: number, active: number): number {
  const total = loss3 + loss15 + loss30 + active;
  return total > 0 ? active / total : 0;
}

/** 自定义 Tooltip：同时显示人数和留存率 */
function ComboTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 text-[12px]">
      <div className="font-medium text-slate-700 mb-1.5">{label}</div>
      {payload.map((p: any) => {
        const isRate = p.dataKey === "rate";
        return (
          <div key={p.dataKey} className="flex items-center gap-1.5 py-0.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-slate-500">{p.name}：</span>
            <span className="font-semibold text-slate-700 tabular-nums">
              {isRate ? `${(Number(p.value) * 100).toFixed(0)}%` : `${Math.round(Number(p.value) || 0)} 人`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 自定义圆点 + 上方数值标签（在职 / 留存率用） */
function DotWithLabel(props: any) {
  const { cx, cy, value, dataKey, stroke } = props;
  if (value === undefined || value === null || value <= 0) return null;
  const isRate = dataKey === "rate";
  const label = isRate ? `${Math.round(value * 100)}%` : `${value}人`;
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r={4.5} fill="#fff" stroke={stroke} strokeWidth={1.5} />
      <text x={cx} y={cy - 10} textAnchor="middle" fontSize={10} fontWeight={700} fill={stroke}>
        {label}
      </text>
    </g>
  );
}

/** 柱内底部数值标签（>0 且柱高≥18px 时在柱子内部底部显示白色数字） */
function BarInnerLabel(props: any) {
  const { x, y, width, height, value } = props;
  if (value === undefined || value === null || value <= 0) return null;
  if (height < 18) return null;
  return (
    <text
      x={x + width / 2}
      y={y + height - 5}
      textAnchor="middle"
      fontSize={14}
      fontWeight={700}
      fill="#fff"
      style={{ pointerEvents: "none" }}
    >
      {value}
    </text>
  );
}

export function RetentionCard({ scopeOrgId, selectedBaseOrgId, needsBaseSelect }: Props) {
  const [monthEntries, setMonthEntries] = useState<RetentionMonthEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [viewTeamId, setViewTeamId] = useState<string>("");   // 切换查看的团队（空=全部汇总）
  const [dataTableOpen, setDataTableOpen] = useState(false);
  const [teamTableOpen, setTeamTableOpen] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [teams, setTeams] = useState<{ orgId: string; orgName: string }[]>([]);

  type FormRow = { teamOrgId: string; teamOrgName: string; loss3Days: string; loss15Days: string; loss30Days: string; activeCount: string };
  const [formYear, setFormYear] = useState<number>(CURRENT_YEAR);
  const [formMonth, setFormMonth] = useState<number>(CURRENT_MONTH);
  const [formRows, setFormRows] = useState<FormRow[]>([]);
  const [submitProgress, setSubmitProgress] = useState("");

  const formMonthStr = `${formYear}-${pad2(formMonth)}`;
  const sid = needsBaseSelect ? selectedBaseOrgId ?? scopeOrgId : scopeOrgId;

  const loadData = async () => {
    if (!sid) return;
    setLoading(true);
    try {
      const [orgTree, byMonthRes] = await Promise.all([fetchOrgTree(), retentionApi.getByMonth(sid)]);
      const baseOrg = orgTree.find((o) => o.id === sid);
      const basePath = baseOrg?.path ?? "";
      const teamList = orgTree
        .filter((o) => o.orgType === "TEAM" && o.status === "active" && o.path.startsWith(basePath + "/"))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((o) => ({ orgId: o.id, orgName: o.name }));
      if (baseOrg && baseOrg.orgType === "TEAM" && !teamList.find((t) => t.orgId === baseOrg.id))
        teamList.unshift({ orgId: baseOrg.id, orgName: baseOrg.name });
      setTeams(teamList);
      const entries = byMonthRes.monthEntries ?? [];
      setMonthEntries(entries);
      if (entries.length > 0) setSelectedMonth(entries[entries.length - 1].recordMonth);
    } catch { /* 静默 */ }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [sid]);

  useEffect(() => {
    if (!modalOpen) return;
    if (teams.length === 0) { setFormRows([]); return; }
    const entry = monthEntries.find((e) => e.recordMonth === formMonthStr);
    setFormRows(teams.map((t) => {
      const x = entry?.teams.find((v) => v.teamOrgId === t.orgId);
      return { teamOrgId: t.orgId, teamOrgName: t.orgName, loss3Days: x ? String(x.loss3Days) : "", loss15Days: x ? String(x.loss15Days) : "", loss30Days: x ? String(x.loss30Days) : "", activeCount: x ? String(x.activeCount) : "" };
    }));
  }, [modalOpen, formMonthStr, formYear, formMonth, teams, monthEntries]);

  const updateFormRow = (idx: number, field: keyof FormRow, value: string) =>
    setFormRows((prev) => { const n = [...prev]; n[idx] = { ...n[idx], [field]: value }; return n; });

  const clearAllFormRows = () => setFormRows((prev) => prev.map((r) => ({ ...r, loss3Days: "", loss15Days: "", loss30Days: "", activeCount: "" })));

  const currentEntry = monthEntries.find((e) => e.recordMonth === selectedMonth);
  const summary: RetentionAggregated = currentEntry?.aggregated ?? { loss3Days: 0, loss15Days: 0, loss30Days: 0, activeCount: 0 };
  const summaryRate = calcRate(summary.loss3Days, summary.loss15Days, summary.loss30Days, summary.activeCount);

  /** 当前查看的团队名（用于图表标题等） */
  const viewTeamName = viewTeamId
    ? teams.find((t) => t.orgId === viewTeamId)?.orgName ?? "未知团队"
    : "全部团队汇总";

  /** 图表数据：按 viewTeamId 切换汇总/单团队 */
  const chartData = monthEntries.map((e) => {
    let a: { loss3Days: number; loss15Days: number; loss30Days: number; activeCount: number };
    if (viewTeamId) {
      const t = e.teams.find((x) => x.teamOrgId === viewTeamId);
      a = t ? { loss3Days: t.loss3Days, loss15Days: t.loss15Days, loss30Days: t.loss30Days, activeCount: t.activeCount } : { loss3Days: 0, loss15Days: 0, loss30Days: 0, activeCount: 0 };
    } else {
      a = e.aggregated;
    }
    return {
      recordMonth: e.recordMonth,
      loss3Days: a.loss3Days,
      loss15Days: a.loss15Days,
      loss30Days: a.loss30Days,
      activeCount: a.activeCount,
      rate: calcRate(a.loss3Days, a.loss15Days, a.loss30Days, a.activeCount),
    };
  });

  const handleBatchSubmit = async () => {
    setSubmitError("");
    const validRows = formRows.filter((r) => r.loss3Days !== "" || r.loss15Days !== "" || r.loss30Days !== "" || r.activeCount !== "");
    if (validRows.length === 0) { setSubmitError("请至少填写一个团队的数据"); return; }
    setSubmitting(true); let s = 0, f = 0;
    try {
      for (let i = 0; i < validRows.length; i++) {
        const r = validRows[i]; setSubmitProgress(`正在提交 ${i + 1}/${validRows.length}`);
        try { await retentionApi.upsert({ teamOrgId: r.teamOrgId, teamOrgName: r.teamOrgName, recordMonth: formMonthStr, loss3Days: Number(r.loss3Days) || 0, loss15Days: Number(r.loss15Days) || 0, loss30Days: Number(r.loss30Days) || 0, activeCount: Number(r.activeCount) || 0 }, sid); s++; }
        catch { f++; }
      }
      setSubmitProgress("");
      if (f > 0) setSubmitError(`提交完成：成功 ${s} 条，失败 ${f} 条`);
      else { setModalOpen(false); setFormRows([]); loadData(); }
    } finally { setSubmitting(false); setSubmitProgress(""); }
  };

  const openModal = () => { setSubmitError(""); setFormYear(CURRENT_YEAR); setFormMonth(CURRENT_MONTH); setSubmitProgress(""); setModalOpen(true); };

  return (<>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-emerald-600" />
          <span className="text-[14px] font-semibold text-slate-700">留存率看板</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">查看团队</span>
          <select value={viewTeamId} onChange={(e) => setViewTeamId(e.target.value)} className="appearance-none rounded-md border border-slate-300 px-2 py-1 text-[12px] text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer min-w-[140px]">
            <option value="">全部团队汇总</option>
            {teams.map((t) => (<option key={t.orgId} value={t.orgId}>{t.orgName}</option>))}
          </select>
          {viewTeamId && <button onClick={() => setViewTeamId("")} className="text-[11px] text-emerald-500 hover:underline">查看全部</button>}
          <button onClick={openModal} className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-emerald-600 text-[12px] text-white hover:bg-emerald-700 transition-colors ml-1"><Upload size={13} />上传数据</button>
        </div>
      </div>

      {monthEntries.length > 0 ? (<>
        {/* ── 组合图：3条流失柱 + 在职/留存率两条线，双 Y 轴，最近 5 个月 ── */}
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-medium text-slate-700">
              流失明细 & 留存率
              <span className="ml-2 text-[12px] font-normal text-emerald-600">· {viewTeamName}</span>
            </div>
            <div className="text-[11px] text-slate-400">留存率 = 在职 / (3天+15天+30天流失+在职)</div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData.slice(-5)} margin={{ top: 20, right: 12, left: 0, bottom: 2 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="recordMonth" tick={{ fontSize: 11 }} padding={{ left: 10, right: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, width: 26 }} label={{ value: "人", position: "insideLeft", style: { fontSize: 11 }, offset: -8 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 1]} tick={{ fontSize: 11, width: 32 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
              <Tooltip content={<ComboTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 2 }} />
              {/* 3条流失柱（不堆叠，并列显示） */}
              <Bar yAxisId="left" dataKey="loss3Days" name="3天流失" fill={COLORS.loss3} barSize={20}>
                <LabelList dataKey="loss3Days" content={<BarInnerLabel />} />
              </Bar>
              <Bar yAxisId="left" dataKey="loss15Days" name="15天流失" fill={COLORS.loss15} barSize={20}>
                <LabelList dataKey="loss15Days" content={<BarInnerLabel />} />
              </Bar>
              <Bar yAxisId="left" dataKey="loss30Days" name="30天流失" fill={COLORS.loss30} barSize={20}>
                <LabelList dataKey="loss30Days" content={<BarInnerLabel />} />
              </Bar>
              {/* 在职折线 · 左轴 + 人数标签 */}
              <Line yAxisId="left" type="monotone" dataKey="activeCount" name="在职" stroke={COLORS.active} strokeWidth={2.5} dot={<DotWithLabel />} activeDot={{ r: 6, fill: COLORS.active, stroke: "#fff", strokeWidth: 2 }} connectNulls />
              {/* 留存率折线 · 右轴 + %标签（红色虚线） */}
              <Line yAxisId="right" type="monotone" dataKey="rate" name="留存率" stroke={COLORS.rate} strokeWidth={2.5} strokeDasharray="6 4" dot={<DotWithLabel />} activeDot={{ r: 6, fill: COLORS.rate, stroke: "#fff", strokeWidth: 2 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* 数据明细表 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setDataTableOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 hover:text-slate-900">
              {dataTableOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} 数据明细表（{viewTeamName}·点击行切换月份）
            </button>
            <span className="text-[11px] text-slate-400">跨度 {monthEntries.length} / 5 个月</span>
          </div>
          {dataTableOpen && <div className="overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 text-slate-500 font-medium">月份</th>
                <th className="text-center px-3 py-2 text-blue-500 font-medium">3天流失</th>
                <th className="text-center px-3 py-2 text-orange-500 font-medium">15天流失</th>
                <th className="text-center px-3 py-2 text-yellow-500 font-medium">30天流失</th>
                <th className="text-center px-3 py-2 text-green-500 font-medium">在职</th>
                <th className="text-center px-3 py-2 text-teal-500 font-medium">留存率</th>
              </tr></thead>
              <tbody>
                {chartData.map((d) => {
                  const isSel = d.recordMonth === selectedMonth;
                  return (<tr key={d.recordMonth} onClick={() => setSelectedMonth(d.recordMonth)} className={`cursor-pointer border-b border-slate-100 transition-colors ${isSel ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                    <td className={`px-3 py-2 font-medium ${isSel ? "text-emerald-700" : "text-slate-700"}`}>{d.recordMonth}</td>
                    <td className="text-center px-3 py-2 text-blue-600 font-semibold tabular-nums">{d.loss3Days || 0}</td>
                    <td className="text-center px-3 py-2 text-orange-600 font-semibold tabular-nums">{d.loss15Days || 0}</td>
                    <td className="text-center px-3 py-2 text-yellow-600 font-semibold tabular-nums">{d.loss30Days || 0}</td>
                    <td className="text-center px-3 py-2 text-green-600 font-semibold tabular-nums">{d.activeCount || 0}</td>
                    <td className="text-center px-3 py-2 text-teal-600 font-semibold tabular-nums">{(d.rate * 100).toFixed(0)}%</td>
                  </tr>);
                })}
              </tbody>
            </table>
          </div>}
        </div>

        {/* 选中月份的团队明细表（仅"全部团队汇总"视图下展示） */}
        {!viewTeamId && currentEntry && currentEntry.teams.length > 0 && <div className="space-y-2">
          <button onClick={() => setTeamTableOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 hover:text-slate-900">
            {teamTableOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {selectedMonth} 团队明细
          </button>
          {teamTableOpen && <div className="overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 text-slate-500 font-medium">团队</th>
                <th className="text-center px-3 py-2 text-blue-500 font-medium">3天流失</th>
                <th className="text-center px-3 py-2 text-orange-500 font-medium">15天流失</th>
                <th className="text-center px-3 py-2 text-yellow-500 font-medium">30天流失</th>
                <th className="text-center px-3 py-2 text-green-500 font-medium">在职</th>
                <th className="text-center px-3 py-2 text-teal-500 font-medium">留存率</th>
              </tr></thead>
              <tbody>
                {currentEntry.teams.map((t: RetentionTeamRecord, i: number) => {
                  const r = calcRate(t.loss3Days, t.loss15Days, t.loss30Days, t.activeCount);
                  return (<tr key={t.teamOrgId} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-3 py-2 text-slate-700 font-medium">{t.teamOrgName}</td>
                    <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{t.loss3Days}</td>
                    <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{t.loss15Days}</td>
                    <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{t.loss30Days}</td>
                    <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{t.activeCount}</td>
                    <td className="text-center px-3 py-2 text-teal-600 font-semibold tabular-nums">{(r * 100).toFixed(0)}%</td>
                  </tr>);
                })}
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-3 py-2 text-slate-700">合计</td>
                  <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{summary.loss3Days}</td>
                  <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{summary.loss15Days}</td>
                  <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{summary.loss30Days}</td>
                  <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{summary.activeCount}</td>
                  <td className="text-center px-3 py-2 text-teal-700 tabular-nums">{(summaryRate * 100).toFixed(0)}%</td>
                </tr>
              </tbody>
            </table>
          </div>}
        </div>}
      </>) : (!loading && <div className="text-center py-10 text-[12px] text-slate-400">暂无数据，请点击右上角"上传数据"录入</div>)}

      {loading && <div className="text-center py-10"><RefreshCw size={18} className="animate-spin text-slate-400 mx-auto" /></div>}
    </div>

    {modalOpen && <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }} onClick={() => { if (!submitting) setModalOpen(false); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 p-5 space-y-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between shrink-0">
          <span className="text-[14px] font-semibold text-slate-700">留存率看板 · 批量录入</span>
          <button onClick={() => { if (!submitting) setModalOpen(false); }} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        <div className="flex items-end gap-3 shrink-0">
          <div>
            <label className="text-[12px] text-slate-500 mb-1 block">统计月份</label>
            <div className="flex items-center gap-1.5">
              <select value={formYear} onChange={(e) => setFormYear(Number(e.target.value))} className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">{YEAR_OPTIONS.map((y) => (<option key={y} value={y}>{y} 年</option>))}</select>
              <select value={formMonth} onChange={(e) => setFormMonth(Number(e.target.value))} className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">{MONTH_OPTIONS.map((m) => (<option key={m} value={m}>{m} 月</option>))}</select>
            </div>
          </div>
          <div className="text-[12px] text-slate-500 pb-2">
            共 <span className="font-semibold text-slate-700">{teams.length}</span> 个团队 · 已填写 <span className="font-semibold text-emerald-600">{formRows.filter((r) => r.loss3Days !== "" || r.loss15Days !== "" || r.loss30Days !== "" || r.activeCount !== "").length}</span> 行
          </div>
          <button onClick={clearAllFormRows} disabled={submitting} className="ml-auto px-3 h-8 rounded-md border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">清空全部</button>
        </div>
        <div className="flex-1 overflow-auto border border-slate-200 rounded-lg min-h-0">
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 text-slate-500 font-medium sticky left-0 bg-slate-50 min-w-[140px] border-r border-slate-200">团队</th>
                <th className="text-center px-3 py-2 text-blue-500 font-medium min-w-[85px]">3天流失</th>
                <th className="text-center px-3 py-2 text-orange-500 font-medium min-w-[85px]">15天流失</th>
                <th className="text-center px-3 py-2 text-yellow-500 font-medium min-w-[85px]">30天流失</th>
                <th className="text-center px-3 py-2 text-green-500 font-medium min-w-[85px]">在职</th>
              </tr>
            </thead>
            <tbody>
              {formRows.map((r, idx) => (<tr key={r.teamOrgId} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                <td className={`px-3 py-1.5 text-slate-700 font-medium sticky left-0 border-r border-slate-100 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>{r.teamOrgName}</td>
                <td className="px-1 py-1"><input type="number" value={r.loss3Days} onChange={(e) => updateFormRow(idx, "loss3Days", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400" /></td>
                <td className="px-1 py-1"><input type="number" value={r.loss15Days} onChange={(e) => updateFormRow(idx, "loss15Days", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400" /></td>
                <td className="px-1 py-1"><input type="number" value={r.loss30Days} onChange={(e) => updateFormRow(idx, "loss30Days", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400" /></td>
                <td className="px-1 py-1"><input type="number" value={r.activeCount} onChange={(e) => updateFormRow(idx, "activeCount", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400" /></td>
              </tr>))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2 shrink-0">同团队同月份已存在数据时将覆盖更新；仅提交填写了数据的行（空行会被跳过）</div>
        {submitError && <div className="text-[12px] text-red-500 bg-red-50 rounded-lg px-3 py-2 shrink-0">{submitError}</div>}
        <div className="flex justify-end gap-2 pt-1 shrink-0">
          <button onClick={() => setModalOpen(false)} disabled={submitting} className="px-4 h-9 rounded-lg border border-slate-300 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">取消</button>
          <button onClick={handleBatchSubmit} disabled={submitting} className="flex items-center gap-1.5 px-4 h-9 rounded-lg bg-emerald-600 text-[12px] text-white hover:bg-emerald-700 disabled:opacity-40">{submitting ? <><RefreshCw size={12} className="animate-spin" />{submitProgress || "提交中…"}</> : "确认提交"}</button>
        </div>
      </div>
    </div>}
  </>);
}
