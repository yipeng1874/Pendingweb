import { useEffect, useState } from "react";
import { BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from "recharts";
import { Upload, TrendingUp, X, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { staffTurnoverApi, type StaffTurnoverDateEntry, type StaffTurnoverTeamRecord, type StaffTurnoverAggregated } from "../../../services/task";
import { fetchOrgTree } from "../../../services/organization";

type Props = {
  scopeOrgId?: string;
  baseOrgs?: any[];
  selectedBaseOrgId?: string;
  needsBaseSelect?: boolean;
};

/** 日期选择器：年 / 月 / 日 三段式 */
const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1;
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAY_OPTIONS = [1, 5, 10, 15, 20, 25];

function pad2(n: number) { return String(n).padStart(2, "0"); }

/** 配色：聚合 4 色 + 团队 A 4 色（冷色系）+ 团队 B 4 色（中间色系） */
const COLORS = {
  // 聚合（基线，实色）
  loss: "#ef4444",     // 红
  online: "#3b82f6",   // 蓝
  offline: "#f59e0b",  // 琥珀
  total: "#7c3aed",    // 紫
  // 团队 A（冷色系）
  aLoss: "#14b8a6",    // 青绿
  aOnline: "#06b6d4",  // 青
  aOffline: "#10b981", // 翠绿
  aTotal: "#a855f7",   // 亮紫
  // 团队 B（中间色系，与 A 区分明显）
  bLoss: "#f97316",    // 橙
  bOnline: "#ec4899",  // 粉
  bOffline: "#84cc16", // 黄绿
  bTotal: "#0ea5e9",   // 天蓝
};
const fmt = (v: number) => (Number.isFinite(v) && v > 0 ? (v >= 10000 ? `${(v / 10000).toFixed(2)}万` : v.toFixed(2)) : "-");

/** 精简 tooltip：人数图表使用 */
function CountTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 text-[12px]">
      <div className="font-medium text-slate-700 mb-1.5">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-1.5 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}：</span>
          <span className="font-semibold text-slate-700 tabular-nums">
            {Math.round(Number(p.value) || 0)} 人
          </span>
        </div>
      ))}
    </div>
  );
}

/** 精简 tooltip：音浪图表使用 */
function WaveTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 text-[12px]">
      <div className="font-medium text-slate-700 mb-1.5">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-1.5 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}：</span>
          <span className="font-semibold text-slate-700 tabular-nums">
            {(Number(p.value) || 0).toFixed(2)} 万
          </span>
        </div>
      ))}
    </div>
  );
}

/** 柱顶数值标签：人数（整数） */
function CountBarLabel(props: any) {
  const { x, y, width, value } = props;
  if (value === undefined || value === null || value <= 0) return null;
  return (
    <text x={x + width / 2} y={y - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#0f172a" style={{ pointerEvents: "none" }}>
      {Math.round(Number(value) || 0)}
    </text>
  );
}

/** 柱顶数值标签：音浪（X.XX万） */
function WaveBarLabel(props: any) {
  const { x, y, width, value } = props;
  if (value === undefined || value === null || value <= 0) return null;
  return (
    <text x={x + width / 2} y={y - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="#0f172a" style={{ pointerEvents: "none" }}>
      {(Number(value) || 0).toFixed(2)}万
    </text>
  );
}

export function StaffTurnoverCard({ scopeOrgId, selectedBaseOrgId, needsBaseSelect }: Props) {
  const [dateEntries, setDateEntries] = useState<StaffTurnoverDateEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [contrastTeamA, setContrastTeamA] = useState<string>(""); // 对比团队 A
  const [contrastTeamB, setContrastTeamB] = useState<string>(""); // 对比团队 B
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [dataTableOpen, setDataTableOpen] = useState(false);  // 数据明细表折叠（默认收起）
  const [teamTableOpen, setTeamTableOpen] = useState(false);  // 团队明细表折叠（默认收起）

  const toggleKey = (k: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  // 上传弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [teams, setTeams] = useState<{ orgId: string; orgName: string }[]>([]);

  type FormRow = {
    teamOrgId: string;
    teamOrgName: string;
    lossCount: string;
    lossAvgWave: string;
    onlineCount: string;
    onlineAvgWave: string;
    offlineCount: string;
    offlineAvgWave: string;
  };
  const [formYear, setFormYear] = useState<number>(CURRENT_YEAR);
  const [formMonth, setFormMonth] = useState<number>(CURRENT_MONTH);
  const [formDay, setFormDay] = useState<number | "">("");
  const [formRows, setFormRows] = useState<FormRow[]>([]);
  const [submitProgress, setSubmitProgress] = useState("");

  /** 由年/月/日组合成日期字符串（仅当日期都选齐时有效） */
  const formDate = formDay ? `${formYear}-${pad2(formMonth)}-${pad2(formDay)}` : "";

  const sid = needsBaseSelect ? selectedBaseOrgId ?? scopeOrgId : scopeOrgId;

  const loadData = async () => {
    if (!sid) return;
    setLoading(true);
    try {
      const [orgTree, byDateRes] = await Promise.all([
        fetchOrgTree(),
        staffTurnoverApi.getByDate(sid),
      ]);

      const baseOrg = orgTree.find((o) => o.id === sid);
      const basePath = baseOrg?.path ?? "";
      const teamList = orgTree
        .filter((o) => o.orgType === "TEAM" && o.status === "active" && o.path.startsWith(basePath + "/"))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((o) => ({ orgId: o.id, orgName: o.name }));
      if (baseOrg && baseOrg.orgType === "TEAM" && !teamList.find((t) => t.orgId === baseOrg.id)) {
        teamList.unshift({ orgId: baseOrg.id, orgName: baseOrg.name });
      }
      setTeams(teamList);

      const entries = byDateRes.dateEntries ?? [];
      setDateEntries(entries);
      if (entries.length > 0) {
        setSelectedDate(entries[entries.length - 1].recordDate);
      }
    } catch { /* 静默 */ }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [sid]);

  /** 日期变化时，从已有数据预填表单行（编辑场景）；新日期则空行 */
  useEffect(() => {
    if (!formDate || teams.length === 0) {
      setFormRows([]);
      return;
    }
    const entry = dateEntries.find((e) => e.recordDate === formDate);
    const rows: FormRow[] = teams.map((t) => {
      const existing = entry?.teams.find((x) => x.teamOrgId === t.orgId);
      return {
        teamOrgId: t.orgId,
        teamOrgName: t.orgName,
        lossCount: existing ? String(existing.lossCount) : "",
        lossAvgWave: existing ? String(existing.lossAvgWave) : "",
        onlineCount: existing ? String(existing.activeOnlineCount) : "",
        onlineAvgWave: existing ? String(existing.activeOnlineAvgWave) : "",
        offlineCount: existing ? String(existing.activeOfflineCount) : "",
        offlineAvgWave: existing ? String(existing.activeOfflineAvgWave) : "",
      };
    });
    setFormRows(rows);
  }, [formDate, formYear, formMonth, formDay, teams, dateEntries]);

  const updateFormRow = (idx: number, field: keyof FormRow, value: string) => {
    setFormRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const clearAllFormRows = () => {
    setFormRows((prev) => prev.map((r) => ({
      ...r,
      lossCount: "", lossAvgWave: "",
      onlineCount: "", onlineAvgWave: "",
      offlineCount: "", offlineAvgWave: "",
    })));
  };

  // 当前选中日期的聚合摘要 + 团队明细
  const currentEntry = dateEntries.find((e) => e.recordDate === selectedDate);
  const summary: StaffTurnoverAggregated = currentEntry?.aggregated ?? {
    lossCount: 0, lossAvgWave: 0,
    activeOnlineCount: 0, activeOnlineAvgWave: 0,
    activeOfflineCount: 0, activeOfflineAvgWave: 0,
    activeTotalCount: 0, activeTotalAvgWave: 0,
  };

  // 合并整体 + 最多两个对比团队数据（同一图表数据源）
  const combinedChartData = dateEntries.map((e) => {
    const tA = contrastTeamA ? e.teams.find((x) => x.teamOrgId === contrastTeamA) : null;
    const tB = contrastTeamB ? e.teams.find((x) => x.teamOrgId === contrastTeamB) : null;
    return {
      recordDate: e.recordDate,
      lossCount: e.aggregated.lossCount,
      lossAvgWave: e.aggregated.lossAvgWave,
      onlineCount: e.aggregated.activeOnlineCount,
      onlineAvgWave: e.aggregated.activeOnlineAvgWave,
      offlineCount: e.aggregated.activeOfflineCount,
      offlineAvgWave: e.aggregated.activeOfflineAvgWave,
      totalCount: e.aggregated.activeTotalCount,
      totalAvgWave: e.aggregated.activeTotalAvgWave,
      t1LossCount: tA?.lossCount ?? 0,
      t1LossAvgWave: tA?.lossAvgWave ?? 0,
      t1OnlineCount: tA?.activeOnlineCount ?? 0,
      t1OnlineAvgWave: tA?.activeOnlineAvgWave ?? 0,
      t1OfflineCount: tA?.activeOfflineCount ?? 0,
      t1OfflineAvgWave: tA?.activeOfflineAvgWave ?? 0,
      t1TotalCount: tA?.activeTotalCount ?? 0,
      t1TotalAvgWave: tA?.activeTotalAvgWave ?? 0,
      t2LossCount: tB?.lossCount ?? 0,
      t2LossAvgWave: tB?.lossAvgWave ?? 0,
      t2OnlineCount: tB?.activeOnlineCount ?? 0,
      t2OnlineAvgWave: tB?.activeOnlineAvgWave ?? 0,
      t2OfflineCount: tB?.activeOfflineCount ?? 0,
      t2OfflineAvgWave: tB?.activeOfflineAvgWave ?? 0,
      t2TotalCount: tB?.activeTotalCount ?? 0,
      t2TotalAvgWave: tB?.activeTotalAvgWave ?? 0,
    };
  });

  // 对比团队名（用于图例）
  const teamAName = teams.find((t) => t.orgId === contrastTeamA)?.orgName ?? "";
  const teamBName = teams.find((t) => t.orgId === contrastTeamB)?.orgName ?? "";

  // 团队 B 可选列表（排除已选的 A）
  const teamsForB = contrastTeamA ? teams.filter((t) => t.orgId !== contrastTeamA) : teams;

  // 是否处于双团队对比模式（选两个时隐藏聚合柱，只对比两团队）
  const isTwoTeamCompare = !!(contrastTeamA && contrastTeamB);

  // 批量提交
  const handleBatchSubmit = async () => {
    setSubmitError("");
    if (!formDate) { setSubmitError("请选择日期"); return; }
    const validRows = formRows.filter((r) =>
      r.lossCount !== "" || r.lossAvgWave !== "" ||
      r.onlineCount !== "" || r.onlineAvgWave !== "" ||
      r.offlineCount !== "" || r.offlineAvgWave !== ""
    );
    if (validRows.length === 0) { setSubmitError("请至少填写一个团队的数据"); return; }

    setSubmitting(true);
    let successCount = 0;
    let failedCount = 0;
    try {
      for (let i = 0; i < validRows.length; i++) {
        const r = validRows[i];
        setSubmitProgress(`正在提交 ${i + 1}/${validRows.length}`);
        try {
          await staffTurnoverApi.upsert({
            teamOrgId: r.teamOrgId,
            teamOrgName: r.teamOrgName,
            recordDate: formDate,
            lossCount: Number(r.lossCount) || 0,
            lossAvgWave: Number(r.lossAvgWave) || 0,
            activeOnlineCount: Number(r.onlineCount) || 0,
            activeOnlineAvgWave: Number(r.onlineAvgWave) || 0,
            activeOfflineCount: Number(r.offlineCount) || 0,
            activeOfflineAvgWave: Number(r.offlineAvgWave) || 0,
          }, sid);
          successCount++;
        } catch {
          failedCount++;
        }
      }
      setSubmitProgress("");
      if (failedCount > 0) {
        setSubmitError(`提交完成：成功 ${successCount} 条，失败 ${failedCount} 条`);
      } else {
        setModalOpen(false);
        setFormYear(CURRENT_YEAR);
        setFormMonth(CURRENT_MONTH);
        setFormDay("");
        setFormRows([]);
        loadData();
      }
    } finally {
      setSubmitting(false);
      setSubmitProgress("");
    }
  };

  const openModal = () => {
    setSubmitError("");
    setFormYear(CURRENT_YEAR);
    setFormMonth(CURRENT_MONTH);
    setFormDay("");
    setFormRows([]);
    setSubmitProgress("");
    setModalOpen(true);
  };

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
        {/* 标题行：标题 + 对比团队 + 上传数据 */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-indigo-600" />
            <span className="text-[14px] font-semibold text-slate-700">在职/离职人数音浪趋势</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">对比团队</span>
            <select
              value={contrastTeamA}
              onChange={(e) => {
                const v = e.target.value;
                setContrastTeamA(v);
                if (v && v === contrastTeamB) setContrastTeamB("");
              }}
              className="appearance-none rounded-md border border-slate-300 px-2 py-1 text-[12px] text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
            >
              <option value="">团队A · 不选</option>
              {teams.map((t) => (
                <option key={t.orgId} value={t.orgId}>{t.orgName}</option>
              ))}
            </select>
            <select
              value={contrastTeamB}
              onChange={(e) => setContrastTeamB(e.target.value)}
              disabled={!contrastTeamA}
              className="appearance-none rounded-md border border-slate-300 px-2 py-1 text-[12px] text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">团队B · 不选</option>
              {teamsForB.map((t) => (
                <option key={t.orgId} value={t.orgId}>{t.orgName}</option>
              ))}
            </select>
            {(contrastTeamA || contrastTeamB) && (
              <button
                onClick={() => { setContrastTeamA(""); setContrastTeamB(""); }}
                className="text-[11px] text-indigo-500 hover:underline"
              >
                清空对比
              </button>
            )}
            <button
              onClick={openModal}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-indigo-600 text-[12px] text-white hover:bg-indigo-700 transition-colors ml-1"
            >
              <Upload size={13} />
              上传数据
            </button>
          </div>
        </div>

        {dateEntries.length > 0 ? (
          <>
            {/* ── 2×2 网格：四象限独立单 Y 轴 ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* ── 图 1：离职 · 人数 ── */}
              <div className="rounded-xl border border-slate-100 bg-white p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[13px] font-medium text-slate-700">离职人数趋势</div>
                  <span className="text-[11px] text-slate-400">点击柱可切换日期</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={combinedChartData} margin={{ top: 24, right: 10, left: 0, bottom: 5 }} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="recordDate" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12, width: 30 }} label={{ value: "人", position: "insideLeft", style: { fontSize: 12 }, offset: -5 }} />
                    <Tooltip content={<CountTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={(o: any) => { if (o?.dataKey) toggleKey(String(o.dataKey)); }} />
                    {!isTwoTeamCompare && <Bar dataKey="lossCount" name="离职人数" hide={hiddenKeys.has("lossCount")} fill={COLORS.loss} radius={[4, 4, 0, 0]} barSize={24} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }}>
                      <LabelList dataKey="lossCount" position="top" content={<CountBarLabel />} />
                    </Bar>}
                    {contrastTeamA && (
                      <Bar dataKey="t1LossCount" name={`${teamAName} 离职人数`} hide={hiddenKeys.has("t1LossCount")} fill={COLORS.aLoss} fillOpacity={0.9} radius={[4, 4, 0, 0]} barSize={14} />
                    )}
                    {contrastTeamB && (
                      <Bar dataKey="t2LossCount" name={`${teamBName} 离职人数`} hide={hiddenKeys.has("t2LossCount")} fill={COLORS.bLoss} fillOpacity={0.85} radius={[4, 4, 0, 0]} barSize={10} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* ── 图 2：离职 · 人均音浪 ── */}
              <div className="rounded-xl border border-slate-100 bg-white p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[13px] font-medium text-slate-700">离职人均音浪趋势</div>
                  <span className="text-[11px] text-slate-400">点击图例可隐藏</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={combinedChartData} margin={{ top: 24, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="recordDate" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12, width: 30 }} label={{ value: "万", position: "insideLeft", style: { fontSize: 12 }, offset: -5 }} />
                    <Tooltip content={<WaveTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={(o: any) => { if (o?.dataKey) toggleKey(String(o.dataKey)); }} />
                    {!isTwoTeamCompare && <Bar dataKey="lossAvgWave" name="离职音浪" hide={hiddenKeys.has("lossAvgWave")} fill={COLORS.loss} fillOpacity={0.45} radius={[4, 4, 0, 0]} barSize={16}>
                      <LabelList dataKey="lossAvgWave" position="top" content={<WaveBarLabel />} />
                    </Bar>}
                    {contrastTeamA && (
                      <Bar dataKey="t1LossAvgWave" name={`${teamAName} 离职音浪`} hide={hiddenKeys.has("t1LossAvgWave")} fill={COLORS.aLoss} fillOpacity={0.85} radius={[4, 4, 0, 0]} barSize={12} />
                    )}
                    {contrastTeamB && (
                      <Bar dataKey="t2LossAvgWave" name={`${teamBName} 离职音浪`} hide={hiddenKeys.has("t2LossAvgWave")} fill={COLORS.bLoss} fillOpacity={0.75} radius={[4, 4, 0, 0]} barSize={8} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* ── 图 3：在职 · 人数 ── */}
              <div className="rounded-xl border border-slate-100 bg-white p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[13px] font-medium text-slate-700">在职人数趋势</div>
                  <span className="text-[11px] text-slate-400">点击柱可切换日期</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={combinedChartData} margin={{ top: 24, right: 10, left: 0, bottom: 5 }} barGap={1}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="recordDate" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12, width: 30 }} label={{ value: "人", position: "insideLeft", style: { fontSize: 12 }, offset: -5 }} />
                    <Tooltip content={<CountTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={(o: any) => { if (o?.dataKey) toggleKey(String(o.dataKey)); }} />
                    {!isTwoTeamCompare && <Bar dataKey="onlineCount" name="线上人数" hide={hiddenKeys.has("onlineCount")} fill={COLORS.online} radius={[4, 4, 0, 0]} barSize={14} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }}>
                      <LabelList dataKey="onlineCount" position="top" content={<CountBarLabel />} />
                    </Bar>}
                    {!isTwoTeamCompare && <Bar dataKey="offlineCount" name="线下人数" hide={hiddenKeys.has("offlineCount")} fill={COLORS.offline} radius={[4, 4, 0, 0]} barSize={14} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }}>
                      <LabelList dataKey="offlineCount" position="top" content={<CountBarLabel />} />
                    </Bar>}
                    {!isTwoTeamCompare && <Bar dataKey="totalCount" name="在职合计人数" hide={hiddenKeys.has("totalCount")} fill={COLORS.total} radius={[4, 4, 0, 0]} barSize={14} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }}>
                      <LabelList dataKey="totalCount" position="top" content={<CountBarLabel />} />
                    </Bar>}
                    {contrastTeamA && (
                      <>
                        <Bar dataKey="t1OnlineCount" name={`${teamAName} 线上人数`} hide={hiddenKeys.has("t1OnlineCount")} fill={COLORS.aOnline} fillOpacity={0.9} radius={[4, 4, 0, 0]} barSize={11} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }} />
                        <Bar dataKey="t1OfflineCount" name={`${teamAName} 线下人数`} hide={hiddenKeys.has("t1OfflineCount")} fill={COLORS.aOffline} fillOpacity={0.9} radius={[4, 4, 0, 0]} barSize={11} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }} />
                        <Bar dataKey="t1TotalCount" name={`${teamAName} 合计人数`} hide={hiddenKeys.has("t1TotalCount")} fill={COLORS.aTotal} fillOpacity={0.9} radius={[4, 4, 0, 0]} barSize={11} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }} />
                      </>
                    )}
                    {contrastTeamB && (
                      <>
                        <Bar dataKey="t2OnlineCount" name={`${teamBName} 线上人数`} hide={hiddenKeys.has("t2OnlineCount")} fill={COLORS.bOnline} fillOpacity={0.85} radius={[4, 4, 0, 0]} barSize={8} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }} />
                        <Bar dataKey="t2OfflineCount" name={`${teamBName} 线下人数`} hide={hiddenKeys.has("t2OfflineCount")} fill={COLORS.bOffline} fillOpacity={0.85} radius={[4, 4, 0, 0]} barSize={8} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }} />
                        <Bar dataKey="t2TotalCount" name={`${teamBName} 合计人数`} hide={hiddenKeys.has("t2TotalCount")} fill={COLORS.bTotal} fillOpacity={0.85} radius={[4, 4, 0, 0]} barSize={8} onClick={(d: any) => { const dt = d?.recordDate ?? d?.payload?.recordDate; if (dt) setSelectedDate(dt); }} />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* ── 图 4：在职 · 人均音浪 ── */}
              <div className="rounded-xl border border-slate-100 bg-white p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[13px] font-medium text-slate-700">在职人均音浪趋势</div>
                  <span className="text-[11px] text-slate-400">点击图例可隐藏</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={combinedChartData} margin={{ top: 24, right: 10, left: 0, bottom: 5 }} barGap={1}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="recordDate" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12, width: 30 }} label={{ value: "万", position: "insideLeft", style: { fontSize: 12 }, offset: -5 }} />
                    <Tooltip content={<WaveTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={(o: any) => { if (o?.dataKey) toggleKey(String(o.dataKey)); }} />
                    {!isTwoTeamCompare && <Bar dataKey="onlineAvgWave" name="线上音浪" hide={hiddenKeys.has("onlineAvgWave")} fill={COLORS.online} fillOpacity={0.5} radius={[4, 4, 0, 0]} barSize={14}>
                      <LabelList dataKey="onlineAvgWave" position="top" content={<WaveBarLabel />} />
                    </Bar>}
                    {!isTwoTeamCompare && <Bar dataKey="offlineAvgWave" name="线下音浪" hide={hiddenKeys.has("offlineAvgWave")} fill={COLORS.offline} fillOpacity={0.5} radius={[4, 4, 0, 0]} barSize={14}>
                      <LabelList dataKey="offlineAvgWave" position="top" content={<WaveBarLabel />} />
                    </Bar>}
                    {!isTwoTeamCompare && <Bar dataKey="totalAvgWave" name="在职音浪均值" hide={hiddenKeys.has("totalAvgWave")} fill={COLORS.total} fillOpacity={0.5} radius={[4, 4, 0, 0]} barSize={14}>
                      <LabelList dataKey="totalAvgWave" position="top" content={<WaveBarLabel />} />
                    </Bar>}
                    {contrastTeamA && (
                      <>
                        <Bar dataKey="t1OnlineAvgWave" name={`${teamAName} 线上音浪`} hide={hiddenKeys.has("t1OnlineAvgWave")} fill={COLORS.aOnline} fillOpacity={0.85} radius={[4, 4, 0, 0]} barSize={11} />
                        <Bar dataKey="t1OfflineAvgWave" name={`${teamAName} 线下音浪`} hide={hiddenKeys.has("t1OfflineAvgWave")} fill={COLORS.aOffline} fillOpacity={0.85} radius={[4, 4, 0, 0]} barSize={11} />
                        <Bar dataKey="t1TotalAvgWave" name={`${teamAName} 音浪均值`} hide={hiddenKeys.has("t1TotalAvgWave")} fill={COLORS.aTotal} fillOpacity={0.85} radius={[4, 4, 0, 0]} barSize={11} />
                      </>
                    )}
                    {contrastTeamB && (
                      <>
                        <Bar dataKey="t2OnlineAvgWave" name={`${teamBName} 线上音浪`} hide={hiddenKeys.has("t2OnlineAvgWave")} fill={COLORS.bOnline} fillOpacity={0.75} radius={[4, 4, 0, 0]} barSize={8} />
                        <Bar dataKey="t2OfflineAvgWave" name={`${teamBName} 线下音浪`} hide={hiddenKeys.has("t2OfflineAvgWave")} fill={COLORS.bOffline} fillOpacity={0.75} radius={[4, 4, 0, 0]} barSize={8} />
                        <Bar dataKey="t2TotalAvgWave" name={`${teamBName} 音浪均值`} hide={hiddenKeys.has("t2TotalAvgWave")} fill={COLORS.bTotal} fillOpacity={0.75} radius={[4, 4, 0, 0]} barSize={8} />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 统一趋势表（人数 + 音浪 合并） */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setDataTableOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 hover:text-slate-900"
                >
                  {dataTableOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  数据明细表（点击行切换日期查看团队）
                </button>
                <span className="text-[11px] text-slate-400">
                  跨度 {dateEntries.length} / 6 周期
                </span>
              </div>
              {dataTableOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-3 py-2 text-slate-500 font-medium" rowSpan={2}>日期</th>
                      <th colSpan={2} className="text-center px-3 py-2 text-red-500 font-medium border-l border-slate-100">离职</th>
                      <th colSpan={2} className="text-center px-3 py-2 text-blue-500 font-medium border-l border-slate-100">在职线上</th>
                      <th colSpan={2} className="text-center px-3 py-2 text-amber-500 font-medium border-l border-slate-100">在职线下</th>
                      <th colSpan={2} className="text-center px-3 py-2 text-indigo-500 font-medium border-l border-slate-100">在职合计</th>
                    </tr>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-center px-2 py-1 text-slate-400 font-normal border-l border-slate-100">人数</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal">人均音浪</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal border-l border-slate-100">人数</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal">人均音浪</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal border-l border-slate-100">人数</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal">人均音浪</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal border-l border-slate-100">人数</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal">人均音浪</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dateEntries.map((e) => {
                      const isSelected = e.recordDate === selectedDate;
                      return (
                        <tr
                          key={e.recordDate}
                          onClick={() => setSelectedDate(e.recordDate)}
                          className={`cursor-pointer border-b border-slate-100 transition-colors ${
                            isSelected
                              ? "bg-indigo-50/70"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <td className={`px-3 py-2 font-medium ${isSelected ? "text-indigo-700" : "text-slate-700"}`}>
                            {e.recordDate}
                          </td>
                          <td className="text-center px-3 py-2 text-red-600 font-semibold tabular-nums border-l border-slate-100">
                            {e.aggregated.lossCount || 0}
                          </td>
                          <td className="text-center px-3 py-2 text-red-500 tabular-nums">
                            {fmt(e.aggregated.lossAvgWave)}
                          </td>
                          <td className="text-center px-3 py-2 text-blue-600 font-semibold tabular-nums border-l border-slate-100">
                            {e.aggregated.activeOnlineCount || 0}
                          </td>
                          <td className="text-center px-3 py-2 text-blue-500 tabular-nums">
                            {fmt(e.aggregated.activeOnlineAvgWave)}
                          </td>
                          <td className="text-center px-3 py-2 text-amber-600 font-semibold tabular-nums border-l border-slate-100">
                            {e.aggregated.activeOfflineCount || 0}
                          </td>
                          <td className="text-center px-3 py-2 text-amber-500 tabular-nums">
                            {fmt(e.aggregated.activeOfflineAvgWave)}
                          </td>
                          <td className="text-center px-3 py-2 text-indigo-600 font-semibold tabular-nums border-l border-slate-100">
                            {e.aggregated.activeTotalCount || 0}
                          </td>
                          <td className="text-center px-3 py-2 text-indigo-500 tabular-nums">
                            {fmt(e.aggregated.activeTotalAvgWave)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </div>

            {/* 选中日期的团队明细表 */}
            {currentEntry && currentEntry.teams.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setTeamTableOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 hover:text-slate-900"
                >
                  {teamTableOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  {selectedDate} 团队明细
                </button>
                {teamTableOpen && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">团队</th>
                        <th className="text-center px-3 py-2 text-red-500 font-medium">离职人数</th>
                        <th className="text-center px-3 py-2 text-red-500 font-medium">离职音浪</th>
                        <th className="text-center px-3 py-2 text-blue-500 font-medium">线上人数</th>
                        <th className="text-center px-3 py-2 text-blue-500 font-medium">线上音浪</th>
                        <th className="text-center px-3 py-2 text-amber-500 font-medium">线下人数</th>
                        <th className="text-center px-3 py-2 text-amber-500 font-medium">线下音浪</th>
                        <th className="text-center px-3 py-2 text-indigo-500 font-medium">在职合计人数</th>
                        <th className="text-center px-3 py-2 text-indigo-500 font-medium">在职音浪均值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentEntry.teams.map((t: StaffTurnoverTeamRecord, i: number) => (
                        <tr key={t.teamOrgId} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                          <td className="px-3 py-2 text-slate-700 font-medium">{t.teamOrgName}</td>
                          <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{t.lossCount}</td>
                          <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{fmt(t.lossAvgWave)}</td>
                          <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{t.activeOnlineCount}</td>
                          <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{fmt(t.activeOnlineAvgWave)}</td>
                          <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{t.activeOfflineCount}</td>
                          <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{fmt(t.activeOfflineAvgWave)}</td>
                          <td className="text-center px-3 py-2 text-slate-600 font-semibold tabular-nums">{t.activeTotalCount}</td>
                          <td className="text-center px-3 py-2 text-slate-600 tabular-nums">{fmt(t.activeTotalAvgWave)}</td>
                        </tr>
                      ))}
                      {/* 汇总行 */}
                      <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                        <td className="px-3 py-2 text-slate-700">合计</td>
                        <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{summary.lossCount}</td>
                        <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{fmt(summary.lossAvgWave)}</td>
                        <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{summary.activeOnlineCount}</td>
                        <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{fmt(summary.activeOnlineAvgWave)}</td>
                        <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{summary.activeOfflineCount}</td>
                        <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{fmt(summary.activeOfflineAvgWave)}</td>
                        <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{summary.activeTotalCount}</td>
                        <td className="text-center px-3 py-2 text-slate-700 tabular-nums">{fmt(summary.activeTotalAvgWave)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                )}
              </div>
            )}
          </>
        ) : (
          !loading && (
            <div className="text-center py-10 text-[12px] text-slate-400">
              暂无数据，请点击右上角"上传数据"录入
            </div>
          )
        )}

        {loading && (
          <div className="text-center py-10">
            <RefreshCw size={18} className="animate-spin text-slate-400 mx-auto" />
          </div>
        )}
      </div>

      {/* 上传弹窗（批量录入） */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
          onClick={() => { if (!submitting) setModalOpen(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 p-5 space-y-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[14px] font-semibold text-slate-700">在职/离职人数音浪 · 批量录入</span>
              <button onClick={() => { if (!submitting) setModalOpen(false); }}
                className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-400">
                <X size={16} />
              </button>
            </div>

            {/* 日期选择（年/月/日 三段式）+ 统计 */}
            <div className="flex items-end gap-3 shrink-0">
              <div>
                <label className="text-[12px] text-slate-500 mb-1 block">数据日期</label>
                <div className="flex items-center gap-1.5">
                  <select value={formYear} onChange={(e) => setFormYear(Number(e.target.value))}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    {YEAR_OPTIONS.map((y) => (<option key={y} value={y}>{y} 年</option>))}
                  </select>
                  <select value={formMonth} onChange={(e) => setFormMonth(Number(e.target.value))}
                    className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    {MONTH_OPTIONS.map((m) => (<option key={m} value={m}>{m} 月</option>))}
                  </select>
                  <select value={formDay} onChange={(e) => setFormDay(e.target.value ? Number(e.target.value) : "")}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">日</option>
                    {DAY_OPTIONS.map((d) => (<option key={d} value={d}>{d} 日</option>))}
                  </select>
                </div>
              </div>
              {formDate && (
                <>
                  <div className="text-[12px] text-slate-500 pb-2">
                    共 <span className="font-semibold text-slate-700">{teams.length}</span> 个团队
                    {(() => {
                      const filledCount = formRows.filter((r) =>
                        r.lossCount !== "" || r.lossAvgWave !== "" ||
                        r.onlineCount !== "" || r.onlineAvgWave !== "" ||
                        r.offlineCount !== "" || r.offlineAvgWave !== ""
                      ).length;
                      return (
                        <span className="ml-2">
                          · 已填写 <span className="font-semibold text-indigo-600">{filledCount}</span> 行
                        </span>
                      );
                    })()}
                  </div>
                  <button onClick={clearAllFormRows} disabled={submitting}
                    className="ml-auto px-3 h-8 rounded-md border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                    清空全部
                  </button>
                </>
              )}
            </div>

            {/* 团队表格 */}
            {formDate ? (
              <div className="flex-1 overflow-auto border border-slate-200 rounded-lg min-h-0">
                <table className="w-full text-[12px] border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-3 py-2 text-slate-500 font-medium sticky left-0 bg-slate-50 min-w-[140px] border-r border-slate-200">团队</th>
                      <th colSpan={2} className="text-center px-3 py-2 text-red-500 font-medium border-l border-slate-200">离职</th>
                      <th colSpan={2} className="text-center px-3 py-2 text-blue-500 font-medium border-l border-slate-200">在职线上</th>
                      <th colSpan={2} className="text-center px-3 py-2 text-amber-500 font-medium border-l border-slate-200">在职线下</th>
                    </tr>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="sticky left-0 bg-slate-50 border-r border-slate-200"></th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal border-l border-slate-200 min-w-[80px]">人数</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal min-w-[80px]">人均音浪</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal border-l border-slate-200 min-w-[80px]">人数</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal min-w-[80px]">人均音浪</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal border-l border-slate-200 min-w-[80px]">人数</th>
                      <th className="text-center px-2 py-1 text-slate-400 font-normal min-w-[80px]">人均音浪</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formRows.map((r, idx) => (
                      <tr key={r.teamOrgId} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                        <td className={`px-3 py-1.5 text-slate-700 font-medium sticky left-0 border-r border-slate-100 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>{r.teamOrgName}</td>
                        <td className="px-1 py-1 border-l border-slate-100">
                          <input type="number" value={r.lossCount} onChange={(e) => updateFormRow(idx, "lossCount", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" step="0.01" value={r.lossAvgWave} onChange={(e) => updateFormRow(idx, "lossAvgWave", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                        </td>
                        <td className="px-1 py-1 border-l border-slate-100">
                          <input type="number" value={r.onlineCount} onChange={(e) => updateFormRow(idx, "onlineCount", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" step="0.01" value={r.onlineAvgWave} onChange={(e) => updateFormRow(idx, "onlineAvgWave", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                        </td>
                        <td className="px-1 py-1 border-l border-slate-100">
                          <input type="number" value={r.offlineCount} onChange={(e) => updateFormRow(idx, "offlineCount", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" step="0.01" value={r.offlineAvgWave} onChange={(e) => updateFormRow(idx, "offlineAvgWave", e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[12px] text-slate-400 border border-dashed border-slate-200 rounded-lg py-10 min-h-[200px]">
                请先选择数据日期
              </div>
            )}

            <div className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2 shrink-0">
              同团队同日期已存在数据时将覆盖更新；仅提交填写了数据的行（空行会被跳过）
            </div>
            {submitError && <div className="text-[12px] text-red-500 bg-red-50 rounded-lg px-3 py-2 shrink-0">{submitError}</div>}
            <div className="flex justify-end gap-2 pt-1 shrink-0">
              <button onClick={() => setModalOpen(false)} disabled={submitting} className="px-4 h-9 rounded-lg border border-slate-300 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">取消</button>
              <button onClick={handleBatchSubmit} disabled={submitting || !formDate} className="flex items-center gap-1.5 px-4 h-9 rounded-lg bg-indigo-600 text-[12px] text-white hover:bg-indigo-700 disabled:opacity-40">
                {submitting ? <><RefreshCw size={12} className="animate-spin" />{submitProgress || "提交中…"}</> : "确认提交"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
