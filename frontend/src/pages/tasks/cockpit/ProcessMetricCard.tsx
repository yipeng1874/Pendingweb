import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Upload, TrendingUp, X, RefreshCw, ChevronDown, ChevronRight, Plus, Trash2, ClipboardPaste, Check } from "lucide-react";
import { processMetricApi, type ProcessMetricDateEntry } from "../../../services/task";
import { fetchOrgTree } from "../../../services/organization";

type Props = { scopeOrgId?: string; selectedBaseOrgId?: string; needsBaseSelect?: boolean; };

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1;
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const ALL_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
function pad2(n: number) { return String(n).padStart(2, "0"); }

const LINE_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#eab308", "#e11d48", "#a855f7", "#06b6d4", "#ec4899", "#84cc16", "#f43f5e"];

function CountTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 text-[12px]">
      <div className="font-medium text-slate-700 mb-1.5">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-1.5 py-0.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}：</span>
          <span className="font-semibold text-slate-700 tabular-nums">{Number(p.value).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

/** 计算团队均值 = sum(hall.percentage) / hall.count */
function teamAvg(team: { halls: { percentage: number }[] }): number {
  return team.halls.length > 0 ? team.halls.reduce((s, h) => s + h.percentage, 0) / team.halls.length : 0;
}

export function ProcessMetricCard({ scopeOrgId, selectedBaseOrgId, needsBaseSelect }: Props) {
  const [dateEntries, setDateEntries] = useState<ProcessMetricDateEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [baseOrgName, setBaseOrgName] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [dataTableOpen, setDataTableOpen] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  const [teams, setTeams] = useState<{ orgId: string; orgName: string }[]>([]);

  /** 参与"过程指标"的团队 ID 列表（配置入口在上传弹窗内） */
  const [participatingTeamIds, setParticipatingTeamIds] = useState<string[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingTeamId, setSubmittingTeamId] = useState<string>("");  // 正在保存的团队
  const [submitError, setSubmitError] = useState("");
  const [submitProgress, setSubmitProgress] = useState("");
  const [teamSavedHint, setTeamSavedHint] = useState<Record<string, string>>({});  // 团队保存成功提示

  const [formYear, setFormYear] = useState<number>(CURRENT_YEAR);
  const [formMonth, setFormMonth] = useState<number>(CURRENT_MONTH);
  const [formDay, setFormDay] = useState<number>(NOW.getDate());
  const [formTeamId, setFormTeamId] = useState<string>("");
  const [showTeamConfig, setShowTeamConfig] = useState(false);  // 上传弹窗内"配置参与团队"展开状态

  type HallRow = { hallName: string; percentage: string };
  const [teamHalls, setTeamHalls] = useState<Map<string, HallRow[]>>(new Map());
  const [pasteTexts, setPasteTexts] = useState<Map<string, string>>(new Map());

  const formDate = `${formYear}-${pad2(formMonth)}-${pad2(formDay)}`;
  const sid = needsBaseSelect ? selectedBaseOrgId ?? scopeOrgId : scopeOrgId;

  const toggleKey = (k: string) => setHiddenKeys((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const loadData = async () => {
    if (!sid) return;
    setLoading(true);
    setLoadError("");
    try {
      const [orgTree, byDateRes, config] = await Promise.all([
        fetchOrgTree(),
        processMetricApi.getByDate(sid),
        processMetricApi.getConfig(sid).catch(() => null),
      ]);
      setBaseOrgName(byDateRes.baseOrgName ?? "");
      const baseOrg = orgTree.find((o) => o.id === sid);
      const basePath = baseOrg?.path ?? "";
      const teamList = orgTree
        .filter((o) => o.orgType === "TEAM" && o.status === "active" && o.path.startsWith(basePath + "/"))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((o) => ({ orgId: o.id, orgName: o.name }));
      if (baseOrg && baseOrg.orgType === "TEAM" && !teamList.find((t) => t.orgId === baseOrg.id))
        teamList.unshift({ orgId: baseOrg.id, orgName: baseOrg.name });
      setTeams(teamList);
      const entries = byDateRes.dateEntries ?? [];
      setDateEntries(entries);
      if (entries.length > 0) setSelectedDate(entries[entries.length - 1].recordDate);

      // 参与团队配置：优先使用服务端配置，首次空配置时自动检测保存到服务端
      if (config && config.teamIds.length > 0) {
        setParticipatingTeamIds(config.teamIds);
      } else {
        const dataTeamSet = new Set<string>();
        for (const e of entries) for (const t of e.teams) if (t.halls.length > 0) dataTeamSet.add(t.teamOrgId);
        const autoIds = teamList.filter((t) => dataTeamSet.has(t.orgId)).map((t) => t.orgId);
        if (autoIds.length > 0) {
          setParticipatingTeamIds(autoIds);
          processMetricApi.saveConfig(autoIds, sid).catch(() => {});
        }
      }
      setConfigLoaded(true);
    } catch (e: any) {
      setLoadError(e?.message ?? "加载失败");
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [sid]);

  useEffect(() => {
    if (!modalOpen || teams.length === 0) return;
    // 仅当该日期已存在数据时预填（编辑场景）；新日期保持空行
    const entry = dateEntries.find((e) => e.recordDate === formDate);
    const map = new Map<string, HallRow[]>();
    if (entry) {
      for (const t of entry.teams) map.set(t.teamOrgId, t.halls.map((h) => ({ hallName: h.hallName, percentage: String(Math.round(h.percentage)) })));
    }
    for (const t of teams) if (!map.has(t.orgId)) map.set(t.orgId, []);
    setTeamHalls(map);
  }, [modalOpen, formDate, teams.length, dateEntries]);

  const parsePaste = (teamId: string) => {
    const text = pasteTexts.get(teamId) ?? "";
    if (!text.trim()) return;
    const lines = text.split(/\n/).filter((l) => l.trim());
    const parsed: HallRow[] = [];
    for (const line of lines) {
      const m = line.match(/^(.+?)(\d+\.?\d*)\s*%?\s*$/);
      if (m) {
        const n = m[1].trim();
        let p = parseFloat(m[2]);
        // 0 < p ≤ 1 视为比例（如 0.7 = 70%），自动 ×100
        if (!isNaN(p) && p > 0 && p <= 1) p = p * 100;
        if (n && !isNaN(p) && p >= 0 && p <= 100) parsed.push({ hallName: n, percentage: String(Math.round(p)) });
      }
    }
    if (parsed.length > 0) setTeamHalls((prev) => { const n = new Map(prev); n.set(teamId, parsed); return n; });
  };

  const updateHall = (teamId: string, idx: number, field: keyof HallRow, value: string) =>
    setTeamHalls((prev) => { const n = new Map(prev); const rows = [...(n.get(teamId) ?? [])]; rows[idx] = { ...rows[idx], [field]: value }; n.set(teamId, rows); return n; });
  const addHall = (teamId: string) =>
    setTeamHalls((prev) => { const n = new Map(prev); n.set(teamId, [...(n.get(teamId) ?? []), { hallName: "", percentage: "" }]); return n; });
  const removeHall = (teamId: string, idx: number) => {
    // 用位置 idx 在 dateEntries 里找回原始厅名（用户可能改过名字，必须用原名才能从 DB 删掉）
    const entry = dateEntries.find((e) => e.recordDate === formDate);
    const existingTeam = entry?.teams.find((t) => t.teamOrgId === teamId);
    const originalHallName = existingTeam?.halls[idx]?.hallName;

    if (originalHallName) {
      processMetricApi.deleteRecord({
        teamOrgId: teamId,
        hallName: originalHallName,
        recordDate: formDate,
        scopeOrgId: sid,
      }).then(() => {
        setDateEntries((prev) => prev.map((e) => {
          if (e.recordDate !== formDate) return e;
          return {
            ...e,
            teams: e.teams.map((t) => {
              if (t.teamOrgId !== teamId) return t;
              return { ...t, halls: t.halls.filter((h) => h.hallName !== originalHallName) };
            }).filter((t) => t.halls.length > 0),
          };
        }));
      }).catch((e: any) => {
        if (e?.status !== 404) console.warn("删除过程指标记录失败:", e);
      });
    }
    setTeamHalls((prev) => { const n = new Map(prev); const rows = [...(n.get(teamId) ?? [])]; rows.splice(idx, 1); n.set(teamId, rows); return n; });
  };

  const currentEntry = dateEntries.find((e) => e.recordDate === selectedDate);

  /** 实际"参与过程指标"的团队（始终基于服务端共享配置） */
  const participatingTeams = teams.filter((t) => participatingTeamIds.includes(t.orgId));

  /** 切换单个团队的参与状态（同时保存到服务端，使所有用户同步） */
  const toggleParticipatingTeam = (orgId: string) => {
    setParticipatingTeamIds((prev) => {
      const next = prev.includes(orgId) ? prev.filter((id) => id !== orgId) : [...prev, orgId];
      processMetricApi.saveConfig(next, sid).catch(() => {});
      return next;
    });
  };

  /** 折线图数据：每日期 + 每团队一条线 */
  const chartData = dateEntries.map((e) => {
    const point: Record<string, any> = { recordDate: e.recordDate };
    for (const t of e.teams) point[t.teamOrgId] = Math.round(teamAvg(t));
    return point;
  });

  const handleTeamSubmit = async (teamId: string) => {
    setSubmitError("");
    const teamName = teams.find((t) => t.orgId === teamId)?.orgName ?? "";
    const rows = teamHalls.get(teamId) ?? [];
    const items: { teamOrgId: string; teamOrgName: string; hallName: string; percentage: number; recordDate: string }[] = [];
    for (const r of rows) {
      let p = parseFloat(r.percentage);
      // 0 < p ≤ 1 视为比例（如 0.7 = 70%），自动 ×100
      if (!isNaN(p) && p > 0 && p <= 1) p = p * 100;
      if (r.hallName.trim() && !isNaN(p)) items.push({ teamOrgId: teamId, teamOrgName: teamName, hallName: r.hallName.trim(), percentage: p, recordDate: formDate });
    }
    if (items.length === 0) { setTeamSavedHint((p) => ({ ...p, [teamId]: "请至少填写一个厅" })); return; }

    setSubmitting(true); setSubmittingTeamId(teamId); let s = 0, f = 0;
    try {
      for (let i = 0; i < items.length; i++) { setSubmitProgress(`正在提交 ${i + 1}/${items.length}`); try { await processMetricApi.upsert(items[i], sid); s++; } catch { f++; } }
      if (f > 0) setTeamSavedHint((p) => ({ ...p, [teamId]: `保存完成：成功 ${s}，失败 ${f}` }));
      else {
        setTeamSavedHint((p) => ({ ...p, [teamId]: `✓ 已保存 ${s} 条` }));
        // 清空该团队已保存的厅行（保留其他团队）
        setTeamHalls((prev) => { const n = new Map(prev); n.set(teamId, []); return n; });
        setPasteTexts((prev) => { const n = new Map(prev); n.set(teamId, ""); return n; });
        loadData();
      }
    } finally { setSubmitting(false); setSubmittingTeamId(""); setSubmitProgress(""); }
  };

  const openModal = () => {
    setSubmitError("");
    setFormYear(CURRENT_YEAR);
    setFormMonth(CURRENT_MONTH);
    setFormDay(NOW.getDate());
    // 默认选中第一个"参与团队"；如未配置则用全部团队兜底
    const pool = participatingTeams.length > 0 ? participatingTeams : teams;
    setFormTeamId(pool[0]?.orgId ?? "");
    setTeamHalls(new Map());
    setPasteTexts(new Map());
    setSubmitProgress("");
    setTeamSavedHint({});
    setModalOpen(true);
  };

  return (<>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-cyan-600" />
          <span className="text-[14px] font-semibold text-slate-700">过程指标</span>
          {baseOrgName && (
            <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{baseOrgName}</span>
          )}
        </div>
        <button onClick={openModal} className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-cyan-600 text-[12px] text-white hover:bg-cyan-700 transition-colors"><Upload size={13} />上传数据</button>
      </div>
      {loadError && (
        <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</div>
      )}

      {dateEntries.length > 0 && teams.length > 0 ? (<>
        {/* ── 多线折线图 ── */}
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-medium text-slate-700">团队完成率趋势</div>
            <span className="text-[11px] text-slate-400">点击图例隐藏/显示 · 均值 = Σ厅完成率 / 厅数</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="recordDate" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12, width: 30 }} label={{ value: "%", position: "insideLeft", style: { fontSize: 12 }, offset: -5 }} />
              <Tooltip content={<CountTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={(o: any) => { if (o?.dataKey) toggleKey(String(o.dataKey)); }} />
              {participatingTeams.map((t, i) => (
                <Line key={t.orgId} type="monotone" dataKey={t.orgId} name={t.orgName} hide={hiddenKeys.has(t.orgId)} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 4, fill: LINE_COLORS[i % LINE_COLORS.length], strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, onClick: (_: any, p: any) => { if (p?.payload?.recordDate) setSelectedDate(p.payload.recordDate); } }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 日期切换 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {dateEntries.map((e) => (
            <button key={e.recordDate} onClick={() => setSelectedDate(e.recordDate)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${e.recordDate === selectedDate ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {e.recordDate}
            </button>
          ))}
        </div>

        {/* 数据明细表 */}
        <div>
          <button onClick={() => setDataTableOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 hover:text-slate-900">
            {dataTableOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {selectedDate} 数据明细
          </button>
          {dataTableOpen && currentEntry && <div className="overflow-x-auto mt-2">
            <table className="w-full text-[13px] border-collapse">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 text-slate-500 font-medium">团队</th>
                <th className="text-center px-3 py-2 text-slate-500 font-medium">厅数</th>
                <th className="text-center px-3 py-2 text-slate-500 font-medium">团队均值</th>
              </tr></thead>
              <tbody>
                {currentEntry.teams
                  .filter((t) => participatingTeamIds.includes(t.teamOrgId))
                  .map((t) => {
                    const avg = teamAvg(t);
                    const colorClass = avg >= 80 ? "text-green-700" : avg >= 60 ? "text-blue-700" : avg >= 40 ? "text-yellow-700" : "text-red-700";
                    return (<tr key={t.teamOrgId} className="border-b border-slate-50">
                      <td className="px-3 py-2 text-slate-700 font-medium">{t.teamOrgName}</td>
                      <td className="px-3 py-2 text-center text-slate-600 tabular-nums">{t.halls.length}</td>
                      <td className={`px-3 py-2 text-center font-bold tabular-nums ${colorClass}`}>{avg.toFixed(0)}%</td>
                    </tr>);
                  })}
              </tbody>
            </table>
          </div>}
        </div>
      </>) : (!loading && <div className="text-center py-10 text-[12px] text-slate-400">暂无数据，请点击右上角"上传数据"录入</div>)}
      {loading && <div className="text-center py-10"><RefreshCw size={18} className="animate-spin text-slate-400 mx-auto" /></div>}
    </div>

    {/* 上传弹窗 */}
    {modalOpen && <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }} onClick={() => { if (!submitting) setModalOpen(false); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 p-5 space-y-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between shrink-0">
          <span className="text-[14px] font-semibold text-slate-700">过程指标 · 批量录入</span>
          <button onClick={() => { if (!submitting) setModalOpen(false); }} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        <div className="flex items-end gap-3 shrink-0">
          <div>
            <label className="text-[12px] text-slate-500 mb-1 block">数据日期</label>
            <div className="flex items-center gap-1.5">
              <select value={formYear} onChange={(e) => setFormYear(Number(e.target.value))} className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400">{YEAR_OPTIONS.map((y) => (<option key={y} value={y}>{y} 年</option>))}</select>
              <select value={formMonth} onChange={(e) => setFormMonth(Number(e.target.value))} className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400">{MONTH_OPTIONS.map((m) => (<option key={m} value={m}>{m} 月</option>))}</select>
              <select value={formDay} onChange={(e) => setFormDay(Number(e.target.value))} className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400">{ALL_DAYS.map((d) => (<option key={d} value={d}>{d} 日</option>))}</select>
            </div>
          </div>
          <button
            onClick={() => setShowTeamConfig((v) => !v)}
            className="flex items-center gap-1.5 px-3 h-[42px] rounded-lg border border-cyan-300 text-[12px] text-cyan-700 bg-cyan-50 hover:bg-cyan-100 transition-colors"
          >
            <ChevronDown size={14} className={`text-cyan-600 transition-transform shrink-0 ${showTeamConfig ? "rotate-0" : "-rotate-90"}`} />
            <span className="font-medium">配置参与团队</span>
            <span className="text-[11px] text-cyan-600/70">（{participatingTeamIds.length}/{teams.length}）</span>
          </button>
        </div>

        {/* ── 配置参与团队（展开）── */}
        {showTeamConfig && (
          <div className="shrink-0 border border-slate-200 rounded-lg px-3 py-2 space-y-2 bg-slate-50/40">
            <div className="flex items-center gap-3 text-[11px]">
              <button onClick={() => { const all = teams.map((t) => t.orgId); setParticipatingTeamIds(all); processMetricApi.saveConfig(all, sid).catch(() => {}); }} className="text-cyan-600 hover:underline">全选</button>
              <button onClick={() => { setParticipatingTeamIds([]); processMetricApi.saveConfig([], sid).catch(() => {}); }} className="text-slate-500 hover:underline">全不选</button>
              <span className="text-slate-400">点击团队切换参与状态（仅参与团队可上传 & 展示）</span>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto">
              {teams.length === 0 && <span className="text-[12px] text-slate-400 py-2">暂无团队</span>}
              {teams.map((t) => {
                const checked = participatingTeamIds.includes(t.orgId);
                return (
                  <label
                    key={t.orgId}
                    onClick={() => toggleParticipatingTeam(t.orgId)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] cursor-pointer transition-colors select-none ${
                      checked
                        ? "bg-cyan-50 border-cyan-400 text-cyan-700"
                        : "bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                    }`}
                  >
                    <span className={`shrink-0 h-3 w-3 rounded-sm border flex items-center justify-center ${checked ? "bg-cyan-600 border-cyan-600" : "bg-white border-slate-300"}`}>
                      {checked && <Check size={8} className="text-white" strokeWidth={3} />}
                    </span>
                    {t.orgName}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 选择团队（被"参与团队"配置筛选）── */}
        <div className="shrink-0 flex items-end gap-3">
          <div>
            <label className="text-[12px] text-slate-500 mb-1 block">选择团队</label>
            <select value={formTeamId} onChange={(e) => setFormTeamId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400 cursor-pointer min-w-[160px]">
              {(participatingTeams.length > 0 ? participatingTeams : teams).map((t) => (
                <option key={t.orgId} value={t.orgId}>{t.orgName}</option>
              ))}
            </select>
          </div>
        </div>
        {formTeamId && (() => {
          const team = teams.find((t) => t.orgId === formTeamId)!;
          const halls = teamHalls.get(team.orgId) ?? [];
          const isSaving = submittingTeamId === team.orgId;
          return (<div className="flex-1 overflow-auto min-h-0">
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-slate-700">{team.orgName}</span>
                {halls.length > 0 && <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">编辑中 · {halls.length} 厅</span>}
              </div>
              <div className="mb-2">
                <textarea value={pasteTexts.get(team.orgId) ?? ""} onChange={(e) => setPasteTexts((prev) => { const n = new Map(prev); n.set(team.orgId, e.target.value); return n; })} placeholder="粘贴：厅名 百分比&#10;Review 0&#10;誓约海 62%&#10;（0~1 的小数会自动 ×100，如 0.7 = 70%）" rows={4}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-cyan-400 resize-none" />
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-2">
                    <button onClick={() => parsePaste(team.orgId)} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-cyan-600 bg-cyan-50 hover:bg-cyan-100"><ClipboardPaste size={11} />解析填充</button>
                    {halls.length === 0 && <button onClick={() => addHall(team.orgId)} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-cyan-600 hover:bg-cyan-50"><Plus size={12} />逐行添加</button>}
                  </div>
                  {teamSavedHint[team.orgId] && <span className="text-[11px] text-cyan-600">{teamSavedHint[team.orgId]}</span>}
                </div>
              </div>
              {halls.length > 0 && <div>
                <table className="w-full text-[12px] border-collapse">
                  <thead><tr className="border-b border-slate-100"><th className="text-left px-2 py-1 text-slate-400 font-normal">厅名</th><th className="text-left px-2 py-1 text-slate-400 font-normal w-28">完成率 (%)</th><th className="w-8"></th></tr></thead>
                  <tbody>
                    {halls.map((h, i) => (<tr key={i}>
                      <td className="px-1 py-1"><input type="text" value={h.hallName} onChange={(e) => updateHall(team.orgId, i, "hallName", e.target.value)} placeholder="输入厅名" className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-cyan-400" /></td>
                      <td className="px-1 py-1"><input type="number" min="0" max="100" step="1" value={h.percentage} onChange={(e) => updateHall(team.orgId, i, "percentage", e.target.value)} placeholder="0-100" className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-cyan-400" /></td>
                      <td className="px-1 py-1"><button onClick={() => removeHall(team.orgId, i)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-50 text-red-400 hover:text-red-500"><Trash2 size={12} /></button></td>
                    </tr>))}
                  </tbody>
                </table>
                <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
                  <span className="text-[11px] text-slate-500">共 {halls.length} 厅 · 团队均值预估 <span className="font-semibold text-cyan-700">{(halls.reduce((s, h) => s + (parseFloat(h.percentage) || 0), 0) / halls.length).toFixed(0)}%</span></span>
                  <button onClick={() => addHall(team.orgId)} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-cyan-600 hover:bg-cyan-50"><Plus size={12} />再加一行</button>
                  <button onClick={() => handleTeamSubmit(team.orgId)} disabled={isSaving} className="flex items-center gap-1.5 px-3 h-7 rounded-md bg-cyan-600 text-[12px] text-white hover:bg-cyan-700 disabled:opacity-40">{isSaving ? <><RefreshCw size={11} className="animate-spin" />{submitProgress || "保存中…"}</> : "保存此团队"}</button>
                </div>
              </div>}
            </div>
          </div>);
        })()}
        <div className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2 shrink-0">每团队独立保存；同团队同厅同日期将覆盖更新</div>
        <div className="flex justify-end gap-2 pt-1 shrink-0">
          <button onClick={() => setModalOpen(false)} disabled={submitting} className="px-4 h-9 rounded-lg border border-slate-300 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">关闭</button>
        </div>
      </div>
    </div>}
  </>);
}
