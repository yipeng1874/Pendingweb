import { useEffect, useRef, useState } from "react";
import { Upload, TrendingUp, X, RefreshCw, ChevronDown, Plus, Trash2, ClipboardPaste, Check } from "lucide-react";
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

/** 计算团队均值 = sum(hall.percentage) / hall.count */
function teamAvg(team: { halls: { percentage: number }[] }): number {
  return team.halls.length > 0 ? team.halls.reduce((s, h) => s + h.percentage, 0) / team.halls.length : 0;
}

/** "2026-07-22" → "7月22日" */
function formatDateHeader(date: string) {
  return date.slice(5).replace(/^(\d{2})-(\d{2})$/, "$1月$2日");
}

/** 蓝色渐变进度条单元格 */
function ProgressCell({ percent, variant = "blue" }: { percent?: number; variant?: "blue" | "amber" | "green" | "purple" }) {
  const colorMap: Record<string, { bg: string; border: string; from: string; to: string }> = {
    blue:   { bg: "#eef2ff", border: "#dbeafe", from: "#93c5fd", to: "#3b82f6" },
    amber:  { bg: "#fff7ed", border: "#fed7aa", from: "#fdba74", to: "#f97316" },
    green:  { bg: "#f0fdf4", border: "#bbf7d0", from: "#86efac", to: "#22c55e" },
    purple: { bg: "#faf5ff", border: "#e9d5ff", from: "#c084fc", to: "#9333ea" },
  };
  const c = colorMap[variant];
  if (percent == null) return <span className="text-slate-300 text-[12px]">—</span>;
  const w = Math.max(2, Math.min(100, Math.round(percent)));
  return (
    <div className="relative w-full h-7 rounded overflow-hidden" style={{ backgroundColor: c.bg, border: `1px solid ${c.border}` }}>
      <div
        className="absolute inset-y-0 left-0 rounded-l"
        style={{ width: `${w}%`, background: `linear-gradient(to right, ${c.from}, ${c.to})` }}
      />
      <span className="absolute inset-0 flex items-center justify-end pr-2 text-slate-800 tabular-nums font-medium text-[12px]">
        {Math.round(percent)}%
      </span>
    </div>
  );
}

export function ProcessMetricCard({ scopeOrgId, selectedBaseOrgId, needsBaseSelect }: Props) {
  const [dateEntries, setDateEntries] = useState<ProcessMetricDateEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [baseOrgName, setBaseOrgName] = useState("");

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
  const deletingKeyRef = useRef(new Set<string>());
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());

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

  const loadData = async () => {
    if (!sid) return;
    setLoading(true);
    setLoadError("");
    // 计算查询天数：覆盖本月 + 上月（最坏情况 = 今天 1 号，上月 31 天）
    const _now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const _lastMonthStart = new Date(_now.getFullYear(), _now.getMonth() - 1, 1);
    const _daysNeeded = Math.ceil((_now.getTime() - _lastMonthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const queryDays = Math.min(_daysNeeded, 60);  // 后端上限 60
    try {
      const [orgTree, byDateRes, config] = await Promise.all([
        fetchOrgTree(),
        processMetricApi.getByDate(sid, queryDays),
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
  const getDeleteKey = (teamId: string, hallName: string, recordDate: string) => `${teamId}\u0000${hallName}\u0000${recordDate}`;
  const removeHall = (teamId: string, idx: number) => {
    // 用位置 idx 在 dateEntries 里找回原始厅名（用户可能改过名字，必须用原名才能从 DB 删掉）
    const entry = dateEntries.find((e) => e.recordDate === formDate);
    const existingTeam = entry?.teams.find((t) => t.teamOrgId === teamId);
    const originalHallName = existingTeam?.halls[idx]?.hallName;

    if (originalHallName) {
      const deleteKey = getDeleteKey(teamId, originalHallName, formDate);
      if (deletingKeyRef.current.has(deleteKey)) return;
      deletingKeyRef.current.add(deleteKey);
      setDeletingKeys((prev) => new Set(prev).add(deleteKey));
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
        console.warn("删除过程指标记录失败:", e);
        setSubmitError(e?.message ?? "删除失败，请刷新后重试");
      }).finally(() => {
        deletingKeyRef.current.delete(deleteKey);
        setDeletingKeys((prev) => {
          const next = new Set(prev);
          next.delete(deleteKey);
          return next;
        });
      });
    }
    setTeamHalls((prev) => { const n = new Map(prev); const rows = [...(n.get(teamId) ?? [])]; rows.splice(idx, 1); n.set(teamId, rows); return n; });
  };

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

  const handleTeamSubmit = async (teamId: string) => {
    setSubmitError("");
    const teamName = teams.find((t) => t.orgId === teamId)?.orgName ?? "";
    const rows = teamHalls.get(teamId) ?? [];
    const items: { teamOrgId: string; teamOrgName: string; hallName: string; percentage: number; recordDate: string }[] = [];
    let invalidPct = false;
    for (const r of rows) {
      let p = parseFloat(r.percentage);
      // 0 < p ≤ 1 视为比例（如 0.7 = 70%），自动 ×100
      if (!isNaN(p) && p > 0 && p <= 1) p = p * 100;
      if (r.hallName.trim() && !isNaN(p)) {
        if (p < 0 || p > 100) { invalidPct = true; continue; }
        items.push({ teamOrgId: teamId, teamOrgName: teamName, hallName: r.hallName.trim(), percentage: p, recordDate: formDate });
      }
    }
    if (items.length === 0) {
      setTeamSavedHint((p) => ({ ...p, [teamId]: invalidPct ? "百分比应在 0-100 之间" : "请至少填写一个厅" }));
      return;
    }

    setSubmitting(true); setSubmittingTeamId(teamId); let s = 0; const errors: string[] = [];
    try {
      for (let i = 0; i < items.length; i++) { setSubmitProgress(`正在提交 ${i + 1}/${items.length}`); try { await processMetricApi.upsert(items[i], sid); s++; } catch (e: any) { errors.push(e?.response?.data?.message || e?.message || "未知错误"); } }
      if (errors.length > 0) setTeamSavedHint((p) => ({ ...p, [teamId]: `失败：${errors[0]}` }));
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

      {dateEntries.length > 0 && teams.length > 0 ? (() => {
          const recentDates = dateEntries.slice(-7);

          // ── 本周/上周/上月综合计算 ──
          const beijingNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
          const beijingDay = beijingNow.getDay();
          const thisMonday = new Date(beijingNow);
          thisMonday.setDate(beijingNow.getDate() - (beijingDay === 0 ? 6 : beijingDay - 1));
          const toStr = (d: Date) => d.toISOString().slice(0, 10);
          const genRange = (s: Date, e: Date) => { const a: string[] = []; const c = new Date(s); while (c <= e) { a.push(toStr(c)); c.setDate(c.getDate() + 1); } return a; };
          const thisWeekDays = genRange(thisMonday, beijingNow);
          const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1);
          const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
          const lastWeekDays = genRange(lastMonday, lastSunday);
          const lastMonthStart = new Date(beijingNow.getFullYear(), beijingNow.getMonth() - 1, 1);
          const lastMonthEnd = new Date(beijingNow.getFullYear(), beijingNow.getMonth(), 0);  // 上月最后一天
          const lastMonthDays = genRange(lastMonthStart, lastMonthEnd);

          /** 计算综合：Σ每日完成率 / 完成率非0的天数（适用于周/月汇总） */
          function calcWeekAvg(orgId: string, days: string[]): number | undefined {
            let s = 0;
            let cnt = 0;
            for (const ds of days) {
              const de = dateEntries.find(x => x.recordDate === ds);
              if (!de) continue;
              const t = de.teams.find(x => x.teamOrgId === orgId);
              if (!t || t.halls.length === 0) continue;
              s += teamAvg(t);
              cnt++;
            }
            return cnt > 0 ? s / cnt : undefined;
          }
          return (<>
        {/* ── 团队完成率矩阵（日期 × 团队）── */}
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-medium text-slate-700">团队完成率</div>
            <span className="text-[11px] text-slate-400">均值 = Σ厅完成率 / 厅数</span>
          </div>
          <div className="flex">
            {/* ── 左侧：团队名（固定不滚动）── */}
            <div className="shrink-0 z-10 bg-white border-r border-slate-100">
              <div className="text-left px-2 py-2 text-slate-400 text-[12px] font-normal h-[44px] flex items-center border-b border-slate-100" style={{ minWidth: "56px" }}>团队</div>
              {participatingTeams.map((team) => (
                <div key={team.orgId} className="px-2 py-2 text-slate-700 font-medium text-[12px] h-[44px] flex items-center border-b border-slate-50">
                  {team.orgName}
                </div>
              ))}
              <div className="px-2 py-2 text-slate-500 font-medium text-[12px] h-[44px] flex items-center bg-slate-50/60">
                每日均值
              </div>
            </div>

            {/* ── 每日:综合 = 4:2 比例区域 ── */}
            <div className="flex-1 min-w-0 flex">
            {/* ── 中间：7 天数据（窄屏时横向滚动）── */}
            <div className={`flex-[4] min-w-0 overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400`}>
              <table className="w-full text-[12px] border-collapse table-fixed">
                <colgroup>
                  {recentDates.map((d) => (
                    <col key={d.recordDate} style={{ width: `${100 / recentDates.length}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-100">
                    {recentDates.map((d) => (
                      <th key={d.recordDate} className="text-center px-2 py-2 text-slate-400 font-normal">
                        {formatDateHeader(d.recordDate)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {participatingTeams.map((team) => {
                    return (
                      <tr key={team.orgId} className="border-b border-slate-50 hover:bg-slate-50/50">
                        {recentDates.map((d) => {
                          const t = d.teams.find((t2) => t2.teamOrgId === team.orgId);
                          const p = t && t.halls.length > 0 ? teamAvg(t) : undefined;
                          return (
                            <td key={d.recordDate} className="px-1.5 py-2">
                              <ProgressCell percent={p} />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {/* ── 每日均值行 ── */}
                  <tr className="border-t-2 border-slate-200 bg-slate-50/60">
                    {recentDates.map((d) => {
                      const vals = participatingTeams
                        .map((team) => {
                          const t = d.teams.find((t2) => t2.teamOrgId === team.orgId);
                          return t && t.halls.length > 0 ? teamAvg(t) : undefined;
                        })
                        .filter((v): v is number => v != null);
                      const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : undefined;
                      return (
                        <td key={d.recordDate} className="px-1.5 py-2">
                          <ProgressCell percent={avg} />
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── 右侧：本周综合 + 上周综合 + 上月综合 ── */}
            <div className="flex-[3] shrink-0 z-10 bg-white border-l border-slate-200">
              {/* 表头 */}
              <div className="flex border-b border-slate-100">
                <div className="flex-1 text-center px-2 py-2 text-amber-500 font-medium text-[12px] h-[44px] flex items-center justify-center">本周综合</div>
                <div className="flex-1 text-center px-2 py-2 text-emerald-500 font-medium text-[12px] h-[44px] flex items-center justify-center">上周综合</div>
                <div className="flex-1 text-center px-2 py-2 text-purple-500 font-medium text-[12px] h-[44px] flex items-center justify-center">上月综合</div>
              </div>
              {/* 团队数据行 */}
              {participatingTeams.map((team) => {
                const wAvg = calcWeekAvg(team.orgId, thisWeekDays);
                const lAvg = calcWeekAvg(team.orgId, lastWeekDays);
                const mAvg = calcWeekAvg(team.orgId, lastMonthDays);
                return (
                  <div key={team.orgId} className="flex border-b border-slate-50">
                    <div className="flex-1 px-1.5 py-2">
                      <ProgressCell percent={wAvg} variant="amber" />
                    </div>
                    <div className="flex-1 px-1.5 py-2">
                      <ProgressCell percent={lAvg} variant="green" />
                    </div>
                    <div className="flex-1 px-1.5 py-2">
                      <ProgressCell percent={mAvg} variant="purple" />
                    </div>
                  </div>
                );
              })}
              {/* 每日均值行 */}
              <div className="flex bg-slate-50/60">
                <div className="flex-1 px-1.5 py-2">
                  {(() => {
                    const vs = participatingTeams.map(t => calcWeekAvg(t.orgId, thisWeekDays)).filter((v): v is number => v != null);
                    const a = vs.length > 0 ? vs.reduce((s, v) => s + v, 0) / vs.length : undefined;
                    return <ProgressCell percent={a} variant="amber" />;
                  })()}
                </div>
                <div className="flex-1 px-1.5 py-2">
                  {(() => {
                    const vs = participatingTeams.map(t => calcWeekAvg(t.orgId, lastWeekDays)).filter((v): v is number => v != null);
                    const a = vs.length > 0 ? vs.reduce((s, v) => s + v, 0) / vs.length : undefined;
                    return <ProgressCell percent={a} variant="green" />;
                  })()}
                </div>
                <div className="flex-1 px-1.5 py-2">
                  {(() => {
                    const vs = participatingTeams.map(t => calcWeekAvg(t.orgId, lastMonthDays)).filter((v): v is number => v != null);
                    const a = vs.length > 0 ? vs.reduce((s, v) => s + v, 0) / vs.length : undefined;
                    return <ProgressCell percent={a} variant="purple" />;
                  })()}
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </>);
        })() : (!loading && <div className="text-center py-10 text-[12px] text-slate-400">暂无数据，请点击右上角"上传数据"录入</div>)}
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
                      <td className="px-1 py-1">{(() => {
                        const originalHallName = dateEntries.find((e) => e.recordDate === formDate)?.teams.find((t) => t.teamOrgId === team.orgId)?.halls[i]?.hallName;
                        const isDeleting = !!originalHallName && deletingKeys.has(getDeleteKey(team.orgId, originalHallName, formDate));
                        return <button disabled={isDeleting} aria-label={isDeleting ? "删除中" : "删除该厅"} onClick={() => removeHall(team.orgId, i)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-50 text-red-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40">{isDeleting ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}</button>;
                      })()}</td>
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
