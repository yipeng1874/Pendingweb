import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, RefreshCcw, TrendingUp, Users } from "lucide-react";
import { MobileBottomNav } from "../components/MobileBottomNav";
import { taskApi } from "../services/task";
import { useAuthStore } from "../stores/auth";
import { canOpenDashboard } from "../utils/entry";
import type { AnchorOperatorStat, AnchorTrendResponse, DailyRangeStatsResponse, LiveRoomCapacity, OrgUnit, ProcessMetricByDateResponse, ProcessMetricDateEntry, RetentionByMonthResponse, RetentionMetrics, RoomTypeDetail, StaffTurnoverByDateResponse, StaffTurnoverDateEntry, StaffTurnoverMetrics } from "../types";

type RangeKey = "yesterday" | "last3" | "last7" | "thisMonth";
type HistoryMode = "anchor" | "hall";
type AnchorDetailMode = "total" | "within7" | "within20";
type TurnoverMetric = "activeCount" | "activeWave" | "lossCount" | "lossWave";
type ProcessPeriod = "daily" | "thisWeek" | "lastWeek" | "lastMonth";
type RangeMap = Record<RangeKey, DailyRangeStatsResponse | null>;

const emptyRanges = (): RangeMap => ({ yesterday: null, last3: null, last7: null, thisMonth: null });
const rangeLabels: Record<RangeKey, string> = { yesterday: "昨天", last3: "近3天", last7: "近7天", thisMonth: "本月" };
const rangeKeys: RangeKey[] = ["yesterday", "last3", "last7", "thisMonth"];
const probationOptions = [0, 5, 10, 15, 20, 25, 30];

function beijingDate(offsetDays = 0) {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 86400000);
  return now.toISOString().slice(0, 10);
}

function isOrgWithinScope(org: OrgUnit, scopePath?: string | null) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`);
}

function HistoryCard({ label, data, active, onToggle }: { label: string; data: DailyRangeStatsResponse | null; active: boolean; onToggle: () => void }) {
  const rate = data?.summary.completionRate ?? 0;
  return (
    <div className={`history-card ${active ? "active" : ""}`}>
      <button className="history-card-main" onClick={onToggle}>
        <div className="history-ring" style={{ background: `conic-gradient(#10b981 ${rate}%, #e2e8f0 0)` }}><div><strong>{rate.toFixed(1)}%</strong><span>{label}</span></div></div>
        <div className="history-card-copy"><strong>{data?.summary.completed ?? 0}/{data?.summary.total ?? 0}</strong><span>完成人次 / 投放人次</span>{(data?.summary.exemptions ?? 0) > 0 ? <small>豁免 {data?.summary.exemptions}</small> : null}</div>
        <ChevronDown className={active ? "history-chevron-open" : ""} size={16} />
      </button>
    </div>
  );
}

function HistoryDetail({ label, data }: { label: string; data: DailyRangeStatsResponse | null }) {
  return <div className="history-detail"><div className="history-detail-title"><strong>{label}团队完成明细</strong><span>{data?.teams.length ?? 0} 个团队</span></div><div className="history-team-list">{data?.teams.map((team) => <div key={team.orgId}><div><strong>{team.orgName}</strong><span>{team.completionRate.toFixed(1)}%</span></div><div className="dashboard-progress"><span style={{ width: `${team.completionRate}%` }} /></div><small>{team.completed}/{team.total} 人次{team.exemptions ? ` · 豁免 ${team.exemptions}` : ""}</small></div>)}{!data?.teams.length ? <div className="dashboard-empty">当前区间暂无团队数据</div> : null}</div></div>;
}

function roomAllocated(room: RoomTypeDetail) {
  return room.allocations?.length ? room.allocations.reduce((sum, item) => sum + (item.allocated || 0), 0) : room.allocated || 0;
}

function roomUsed(room: RoomTypeDetail) {
  return room.allocations?.length ? room.allocations.reduce((sum, item) => sum + (item.used || 0), 0) : room.used || 0;
}

function operatorValues(operator: AnchorOperatorStat, mode: AnchorDetailMode) {
  if (mode === "within7") return { total: operator.within7Days, online: operator.within7DaysOnline, offline: operator.within7DaysOffline };
  if (mode === "within20") return { total: operator.within20Days, online: operator.within20DaysOnline, offline: operator.within20DaysOffline };
  return { total: operator.totalCount, online: operator.onlineCount, offline: operator.offlineCount };
}

const turnoverMetricLabels: Record<TurnoverMetric, string> = { activeCount: "在职人数", activeWave: "在职音浪", lossCount: "离职人数", lossWave: "离职音浪" };
const processCompositePeriods: Array<{ key: Exclude<ProcessPeriod, "daily">; label: string }> = [{ key: "thisWeek", label: "本周" }, { key: "lastWeek", label: "上周" }, { key: "lastMonth", label: "上月" }];

function turnoverValues(row: StaffTurnoverMetrics, metric: TurnoverMetric) {
  if (metric === "activeWave") return { online: row.activeOnlineAvgWave, offline: row.activeOfflineAvgWave, unit: "万" };
  if (metric === "lossCount") return { online: row.lossOnlineCount, offline: row.lossOfflineCount, unit: "人" };
  if (metric === "lossWave") return { online: row.lossOnlineAvgWave, offline: row.lossOfflineAvgWave, unit: "万" };
  return { online: row.activeOnlineCount, offline: row.activeOfflineCount, unit: "人" };
}

function retentionRate(row: RetentionMetrics) {
  const total = row.loss3Days + row.loss15Days + row.loss30Days + row.activeCount;
  return total ? row.activeCount / total * 100 : 0;
}

function processPeriodRange(period: ProcessPeriod, dailyDate: string) {
  if (period === "daily") return { start: dailyDate, end: dailyDate };
  const current = new Date(`${beijingDate()}T00:00:00Z`);
  const day = current.getUTCDay();
  const monday = new Date(current); monday.setUTCDate(current.getUTCDate() - (day === 0 ? 6 : day - 1));
  if (period === "thisWeek") return { start: monday.toISOString().slice(0, 10), end: beijingDate() };
  if (period === "lastWeek") { const start = new Date(monday); start.setUTCDate(start.getUTCDate() - 7); const end = new Date(monday); end.setUTCDate(end.getUTCDate() - 1); return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }; }
  const start = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function buildProcessRows(entries: ProcessMetricDateEntry[], participatingIds: string[], period: ProcessPeriod, dailyDate: string) {
  const range = processPeriodRange(period, dailyDate);
  const selected = entries.filter((entry) => entry.recordDate >= range.start && entry.recordDate <= range.end);
  const teams = new Map<string, { id: string; name: string; daySum: number; dayCount: number; halls: Map<string, { sum: number; count: number }> }>();
  selected.forEach((entry) => entry.teams.forEach((team) => {
    if (participatingIds.length && !participatingIds.includes(team.teamOrgId)) return;
    const current = teams.get(team.teamOrgId) ?? { id: team.teamOrgId, name: team.teamOrgName, daySum: 0, dayCount: 0, halls: new Map() };
    if (team.halls.length) { current.daySum += team.halls.reduce((sum, hall) => sum + hall.percentage, 0) / team.halls.length; current.dayCount += 1; }
    team.halls.forEach((hall) => { const value = current.halls.get(hall.hallName) ?? { sum: 0, count: 0 }; value.sum += hall.percentage; value.count += 1; current.halls.set(hall.hallName, value); });
    teams.set(team.teamOrgId, current);
  }));
  return [...teams.values()].map((team) => ({ id: team.id, name: team.name, percentage: team.dayCount ? team.daySum / team.dayCount : 0, halls: [...team.halls.entries()].map(([name, value]) => ({ name, percentage: value.count ? value.sum / value.count : 0 })) })).sort((a, b) => a.name.localeCompare(b.name));
}

function processTeamAverage(entry: ProcessMetricDateEntry | undefined, teamId: string) {
  const team = entry?.teams.find((item) => item.teamOrgId === teamId);
  return team?.halls.length ? team.halls.reduce((sum, hall) => sum + hall.percentage, 0) / team.halls.length : null;
}

function TurnoverChart({ entries, metric, teamId, selectedDate, onSelect }: { entries: StaffTurnoverDateEntry[]; metric: TurnoverMetric; teamId: string; selectedDate: string | null; onSelect: (date: string) => void }) {
  const rows = entries.map((entry) => ({ entry, values: turnoverValues(teamId ? entry.teams.find((team) => team.teamOrgId === teamId) ?? ({ activeOnlineCount: 0, activeOnlineAvgWave: 0, activeOfflineCount: 0, activeOfflineAvgWave: 0, activeTotalCount: 0, activeTotalAvgWave: 0, lossCount: 0, lossAvgWave: 0, lossOnlineCount: 0, lossOnlineAvgWave: 0, lossOfflineCount: 0, lossOfflineAvgWave: 0 } satisfies StaffTurnoverMetrics) : entry.aggregated, metric) }));
  const max = Math.max(1, ...rows.flatMap((row) => [row.values.online, row.values.offline]));
  const format = (value: number) => metric.endsWith("Wave") ? value.toFixed(2) : String(Math.round(value));
  return <div className="turnover-chart">{rows.map(({ entry, values }) => <button className={`turnover-date-row ${selectedDate === entry.recordDate ? "active" : ""}`} key={entry.recordDate} onClick={() => onSelect(entry.recordDate)}><span className="turnover-date">{entry.recordDate.slice(5)}</span><div className="turnover-bars"><div><i style={{ width: `${values.online / max * 100}%` }} /><b>{format(values.online)}{values.unit}</b></div><div><i style={{ width: `${values.offline / max * 100}%` }} /><b>{format(values.offline)}{values.unit}</b></div></div></button>)}</div>;
}

export function DashboardPage() {
  const identity = useAuthStore((state) => state.currentIdentity);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [anchorRanges, setAnchorRanges] = useState<RangeMap>(emptyRanges);
  const [hallRanges, setHallRanges] = useState<RangeMap>(emptyRanges);
  const [roomCapacity, setRoomCapacity] = useState<LiveRoomCapacity | null>(null);
  const [anchorTrend, setAnchorTrend] = useState<AnchorTrendResponse | null>(null);
  const [probationDays, setProbationDays] = useState(0);
  const [anchorLoading, setAnchorLoading] = useState(false);
  const [anchorError, setAnchorError] = useState("");
  const [anchorDetailMode, setAnchorDetailMode] = useState<AnchorDetailMode | null>(null);
  const [turnover, setTurnover] = useState<StaffTurnoverByDateResponse | null>(null);
  const [turnoverMetric, setTurnoverMetric] = useState<TurnoverMetric>("activeCount");
  const [turnoverTeamId, setTurnoverTeamId] = useState("");
  const [turnoverDate, setTurnoverDate] = useState<string | null>(null);
  const [turnoverLoading, setTurnoverLoading] = useState(false);
  const [turnoverError, setTurnoverError] = useState("");
  const [retention, setRetention] = useState<RetentionByMonthResponse | null>(null);
  const [retentionTeamId, setRetentionTeamId] = useState("");
  const [retentionMonth, setRetentionMonth] = useState<string | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionError, setRetentionError] = useState("");
  const [processMetrics, setProcessMetrics] = useState<ProcessMetricByDateResponse | null>(null);
  const [processTeamIds, setProcessTeamIds] = useState<string[]>([]);
  const [processPeriod, setProcessPeriod] = useState<ProcessPeriod>("daily");
  const [processDate, setProcessDate] = useState("");
  const [processTeamId, setProcessTeamId] = useState<string | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processError, setProcessError] = useState("");
  const [historyMode, setHistoryMode] = useState<HistoryMode>("anchor");
  const [expandedRange, setExpandedRange] = useState<RangeKey | null>(null);
  const [openAllocation, setOpenAllocation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const roleAllowed = canOpenDashboard(identity);
  const permissionAllowed = permissions.includes("*") || permissions.includes("task:report:view");
  const showDashboard = roleAllowed && permissionAllowed;
  const needsBaseSelect = identity?.roleCode === "DEV_ADMIN" || identity?.roleCode === "HQ_ADMIN";
  const baseOrgs = useMemo(() => orgs.filter((org) => org.status === "active" && org.orgType === "BASE" && isOrgWithinScope(org, identity?.scopePath)), [identity?.scopePath, orgs]);
  const scopeOrgId = needsBaseSelect ? selectedBaseId : identity?.org?.id;
  const visibleRanges = historyMode === "anchor" ? anchorRanges : hallRanges;
  const selectedRoomDetail = useMemo(() => {
    if (!openAllocation || !roomCapacity) return null;
    for (const site of roomCapacity.siteDetails) {
      const roomIndex = site.rooms.findIndex((_, index) => `${site.siteId}:${index}` === openAllocation);
      if (roomIndex >= 0) return { siteName: site.siteName, room: site.rooms[roomIndex] };
    }
    return null;
  }, [openAllocation, roomCapacity]);
  const turnoverTeams = useMemo(() => {
    const teams = new Map<string, string>();
    turnover?.dateEntries.forEach((entry) => entry.teams.forEach((team) => teams.set(team.teamOrgId, team.teamOrgName)));
    return [...teams.entries()].map(([id, name]) => ({ id, name }));
  }, [turnover]);
  const selectedTurnoverEntry = turnover?.dateEntries.find((entry) => entry.recordDate === turnoverDate) ?? null;
  const retentionTeams = useMemo(() => {
    const teams = new Map<string, string>();
    retention?.monthEntries.forEach((entry) => entry.teams.forEach((team) => teams.set(team.teamOrgId, team.teamOrgName)));
    return [...teams.entries()].map(([id, name]) => ({ id, name }));
  }, [retention]);
  const selectedRetentionEntry = retention?.monthEntries.find((entry) => entry.recordMonth === retentionMonth) ?? null;
  const processRows = useMemo(() => buildProcessRows(processMetrics?.dateEntries ?? [], processTeamIds, processPeriod, processDate), [processDate, processMetrics, processPeriod, processTeamIds]);
  const selectedProcessTeam = processRows.find((team) => team.id === processTeamId) ?? null;
  const processMatrixTeams = useMemo(() => {
    const teams = new Map<string, string>();
    processMetrics?.dateEntries.forEach((entry) => entry.teams.forEach((team) => { if (!processTeamIds.length || processTeamIds.includes(team.teamOrgId)) teams.set(team.teamOrgId, team.teamOrgName); }));
    return [...teams.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [processMetrics, processTeamIds]);
  const processRecentDates = processMetrics?.dateEntries.slice(-7) ?? [];
  const processCompositeRows = useMemo(() => ({
    thisWeek: buildProcessRows(processMetrics?.dateEntries ?? [], processTeamIds, "thisWeek", processDate),
    lastWeek: buildProcessRows(processMetrics?.dateEntries ?? [], processTeamIds, "lastWeek", processDate),
    lastMonth: buildProcessRows(processMetrics?.dateEntries ?? [], processTeamIds, "lastMonth", processDate),
  }), [processDate, processMetrics, processTeamIds]);

  useEffect(() => {
    setPermissionsLoaded(false);
    taskApi.getPermissions().then(setPermissions).catch(() => setPermissions([])).finally(() => setPermissionsLoaded(true));
  }, [identity?.id]);

  useEffect(() => {
    if (!needsBaseSelect || !permissionAllowed) return;
    taskApi.getOrgTree().then((rows) => {
      setOrgs(rows);
      const first = rows.find((org) => org.status === "active" && org.orgType === "BASE" && isOrgWithinScope(org, identity?.scopePath));
      if (first) setSelectedBaseId((current) => current || first.id);
    }).catch((err) => setError(err instanceof Error ? err.message : "基地列表加载失败"));
  }, [identity?.scopePath, needsBaseSelect, permissionAllowed]);

  async function load(scopeOverride?: string) {
    const sid = scopeOverride ?? scopeOrgId;
    if (!showDashboard || (needsBaseSelect && !sid)) { setLoading(false); return; }
    const today = beijingDate();
    const yesterday = beijingDate(-1);
    const monthStart = `${today.slice(0, 8)}01`;
    const ranges: Record<RangeKey, { start: string; end: string }> = {
      yesterday: { start: yesterday, end: yesterday },
      last3: { start: beijingDate(-3), end: yesterday },
      last7: { start: beijingDate(-7), end: yesterday },
      thisMonth: { start: monthStart, end: yesterday },
    };
    setLoading(true); setError("");
    try {
      const [anchorResults, hallResults, capacity] = await Promise.all([
        Promise.all(rangeKeys.map((key) => taskApi.getDailyRangeStats(ranges[key].start, ranges[key].end, sid).catch(() => null))),
        Promise.all(rangeKeys.map((key) => taskApi.getHallDailyRangeStats(ranges[key].start, ranges[key].end, sid).catch(() => null))),
        taskApi.getLiveRoomCapacity(sid).catch(() => null),
      ]);
      const nextAnchor = emptyRanges(); const nextHall = emptyRanges();
      rangeKeys.forEach((key, index) => { nextAnchor[key] = anchorResults[index]; nextHall[key] = hallResults[index]; });
      setAnchorRanges(nextAnchor); setHallRanges(nextHall);
      if (capacity && identity?.roleCode === "TEAM_ADMIN" && identity.org?.id) {
        const teamId = identity.org.id;
        setRoomCapacity({ ...capacity, siteDetails: capacity.siteDetails.map((site) => ({ ...site, rooms: site.rooms.map((room) => ({ ...room, allocations: room.allocations?.filter((allocation) => allocation.orgId === teamId) })) })) });
      } else setRoomCapacity(capacity);
    } catch (err) { setError(err instanceof Error ? err.message : "仪表台加载失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (permissionsLoaded) void load(); }, [permissionsLoaded, identity?.id, scopeOrgId]);
  useEffect(() => { setOpenAllocation(null); }, [scopeOrgId]);

  async function loadAnchorSummary() {
    if (!showDashboard || (needsBaseSelect && !scopeOrgId)) return;
    setAnchorLoading(true); setAnchorError("");
    try { setAnchorTrend(await taskApi.getAnchorTrend(scopeOrgId, probationDays)); }
    catch (err) { setAnchorError(err instanceof Error ? err.message : "主播数量统计加载失败"); }
    finally { setAnchorLoading(false); }
  }

  useEffect(() => { if (permissionsLoaded) void loadAnchorSummary(); }, [permissionsLoaded, identity?.id, scopeOrgId, probationDays]);

  async function loadTurnover() {
    if (!showDashboard || (needsBaseSelect && !scopeOrgId)) return;
    setTurnoverLoading(true); setTurnoverError("");
    try { setTurnover(await taskApi.getStaffTurnoverByDate(scopeOrgId, 6)); }
    catch (err) { setTurnoverError(err instanceof Error ? err.message : "人员趋势加载失败"); }
    finally { setTurnoverLoading(false); }
  }

  useEffect(() => { setTurnoverTeamId(""); setTurnoverDate(null); if (permissionsLoaded) void loadTurnover(); }, [permissionsLoaded, identity?.id, scopeOrgId]);

  async function loadRetention() {
    if (!showDashboard || (needsBaseSelect && !scopeOrgId)) return;
    setRetentionLoading(true); setRetentionError("");
    try { setRetention(await taskApi.getRetentionByMonth(scopeOrgId, 6)); }
    catch (err) { setRetentionError(err instanceof Error ? err.message : "留存率数据加载失败"); }
    finally { setRetentionLoading(false); }
  }

  useEffect(() => { setRetentionTeamId(""); setRetentionMonth(null); if (permissionsLoaded) void loadRetention(); }, [permissionsLoaded, identity?.id, scopeOrgId]);

  async function loadProcessMetrics() {
    if (!showDashboard || (needsBaseSelect && !scopeOrgId)) return;
    setProcessLoading(true); setProcessError("");
    try {
      const [data, config] = await Promise.all([taskApi.getProcessMetrics(scopeOrgId, 60), taskApi.getProcessMetricConfig(scopeOrgId).catch(() => null)]);
      setProcessMetrics(data); setProcessTeamIds(config?.teamIds ?? []);
      setProcessDate((current) => current || data.dateEntries.at(-1)?.recordDate || beijingDate());
    } catch (err) { setProcessError(err instanceof Error ? err.message : "过程指标加载失败"); }
    finally { setProcessLoading(false); }
  }

  useEffect(() => { setProcessDate(""); setProcessTeamId(null); setProcessPeriod("daily"); if (permissionsLoaded) void loadProcessMetrics(); }, [permissionsLoaded, identity?.id, scopeOrgId]);

  if (permissionsLoaded && !showDashboard) return <div className="page-shell"><div className="mobile-page"><div className="dashboard-state">当前身份没有全局仪表台权限。</div><MobileBottomNav /></div></div>;

  return (
    <div className="page-shell"><div className="mobile-page dashboard-page cockpit-mobile-page">
      <header className="cockpit-header compact-cockpit-header"><div className="mobile-page-brand"><span><TrendingUp size={19} /></span><h1>全局仪表台</h1></div><div className="cockpit-header-actions">{needsBaseSelect ? <label className="cockpit-header-base"><Building2 size={15} /><select value={selectedBaseId} onChange={(event) => setSelectedBaseId(event.target.value)} aria-label="选择基地"><option value="">选择基地</option>{baseOrgs.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label> : null}<button className="btn btn-ghost icon-btn" onClick={() => { void load(); void loadAnchorSummary(); void loadTurnover(); void loadRetention(); void loadProcessMetrics(); }} disabled={loading || anchorLoading || turnoverLoading || retentionLoading || processLoading} aria-label="刷新"><RefreshCcw size={17} className={loading || anchorLoading || turnoverLoading || retentionLoading || processLoading ? "spin" : ""} /></button></div></header>
      <main className="section simple-cockpit-content">
        {error ? <div className="card error dashboard-state">{error}</div> : null}

        <section className="card simple-module">
          <div className="simple-module-title"><div><TrendingUp size={17} /><div><h2><span>日常任务完成率</span><small>历史区间统计</small></h2></div></div></div>
          <div className="history-mode-tabs"><button className={historyMode === "anchor" ? "active" : ""} onClick={() => { setHistoryMode("anchor"); setExpandedRange(null); }}>主播日常</button><button className={historyMode === "hall" ? "active" : ""} onClick={() => { setHistoryMode("hall"); setExpandedRange(null); }}>厅管日常</button></div>
          <div className="history-grid">{rangeKeys.map((key) => <HistoryCard key={`${historyMode}-${key}`} label={rangeLabels[key]} data={visibleRanges[key]} active={expandedRange === key} onToggle={() => setExpandedRange((current) => current === key ? null : key)} />)}</div>
          {expandedRange ? <HistoryDetail label={rangeLabels[expandedRange]} data={visibleRanges[expandedRange]} /> : null}
        </section>

        <section className="card simple-module room-module">
          <div className="simple-module-title"><div><Building2 size={17} /><div><h2><span>基地直播间空余</span><small>{roomCapacity ? `更新于 ${new Date(roomCapacity.updatedAt).toLocaleString("zh-CN", { hour12: false })}` : "实时容量概览"}</small></h2></div></div></div>
          {!roomCapacity?.siteDetails.length ? <div className="dashboard-empty">当前基地暂无直播间容量数据</div> : <div className="room-sites">{roomCapacity.siteDetails.map((site) => {
            const total = site.rooms.reduce((sum, room) => sum + (room.total || 0), 0);
            const allocated = site.rooms.reduce((sum, room) => sum + roomAllocated(room), 0);
            const used = site.rooms.reduce((sum, room) => sum + roomUsed(room), 0);
            return <article className="room-site-card" key={site.siteId}><h3>• {site.siteName || "未命名场地"}</h3><div className="room-type-list">{site.rooms.map((room, index) => { const usedCount = roomUsed(room); const roomKey = `${site.siteId}:${index}`; const hasAllocations = Boolean(room.allocations?.length); return <div className={`room-type-entry ${openAllocation === roomKey ? "active" : ""}`} key={`${room.typeName}-${index}`}><button className="room-type-title" type="button" disabled={!hasAllocations} onClick={() => setOpenAllocation((current) => current === roomKey ? null : roomKey)}><strong>{room.typeName || "未命名类型"}</strong><span>{usedCount}/{room.total}{hasAllocations ? <ChevronDown className={openAllocation === roomKey ? "room-chevron-open" : ""} size={12} /> : null}</span></button><div className="room-progress"><span style={{ width: `${room.total ? Math.min(100, usedCount / room.total * 100) : 0}%` }} /></div></div>; })}</div><footer><span>总 {total}</span><span>已分配 {allocated}</span><span>已使用 {used}</span><b>空余 {Math.max(0, total - used)}</b></footer></article>;
          })}</div>}
          {selectedRoomDetail ? <div className="room-allocation-detail"><div className="history-detail-title"><strong>{selectedRoomDetail.siteName} · {selectedRoomDetail.room.typeName}分配明细</strong><span>{selectedRoomDetail.room.allocations?.length ?? 0} 个团队</span></div><div className="room-allocation-detail-grid">{selectedRoomDetail.room.allocations?.map((allocation) => { const rate = allocation.allocated ? Math.min(100, allocation.used / allocation.allocated * 100) : 0; return <div key={allocation.orgId}><div><strong>{allocation.orgName}</strong><span>{allocation.used}/{allocation.allocated}</span></div><div className="dashboard-progress dashboard-progress-teal"><span style={{ width: `${rate}%` }} /></div><small>使用率 {Math.round(rate)}%</small></div>; })}</div></div> : null}
        </section>

        <section className="card simple-module anchor-summary-module">
          <div className="simple-module-title anchor-summary-title"><div><Users size={17} /><div><h2><span>{anchorTrend?.baseOrgName ? `${anchorTrend.baseOrgName}${anchorTrend.teamOrgName ? `-${anchorTrend.teamOrgName}` : ""} · 主播数量统计` : "基地主播数量统计"}</span><small>{anchorTrend?.latest ? `数据 ${anchorTrend.latest.recordDate}` : "主播规模概览"}</small></h2></div></div><select value={probationDays} onChange={(event) => { setProbationDays(Number(event.target.value)); setAnchorDetailMode(null); }} aria-label="选择试用期">{probationOptions.map((days) => <option key={days} value={days}>{days ? `${days} 天试用期` : "无试用期"}</option>)}</select></div>
          {anchorError ? <div className="dashboard-empty anchor-summary-empty">{anchorError}</div> : anchorLoading && !anchorTrend ? <div className="dashboard-empty anchor-summary-empty">主播数据加载中…</div> : !anchorTrend?.latest ? <div className="dashboard-empty anchor-summary-empty">当前基地暂无主播数量数据</div> : <div className="anchor-stat-grid">
            <button className={`anchor-stat-card anchor-stat-total ${anchorDetailMode === "total" ? "active" : ""}`} onClick={() => setAnchorDetailMode((current) => current === "total" ? null : "total")}><span>主播总数</span><strong>{anchorTrend.latest.totalCount}</strong><small>线上{anchorTrend.latest.onlineCount} / 线下{anchorTrend.latest.offlineCount}</small><ChevronDown size={13} /></button>
            <button className={`anchor-stat-card anchor-stat-seven ${anchorDetailMode === "within7" ? "active" : ""}`} onClick={() => setAnchorDetailMode((current) => current === "within7" ? null : "within7")}><span>7天内新增</span><strong>{anchorTrend.latest.within7Days}</strong><small>占比 {anchorTrend.latest.totalCount ? (anchorTrend.latest.within7Days / anchorTrend.latest.totalCount * 100).toFixed(1) : "0.0"}%</small><ChevronDown size={13} /></button>
            <button className={`anchor-stat-card anchor-stat-twenty ${anchorDetailMode === "within20" ? "active" : ""}`} onClick={() => setAnchorDetailMode((current) => current === "within20" ? null : "within20")}><span>20天内新增</span><strong>{anchorTrend.latest.within20Days}</strong><small>占比 {anchorTrend.latest.totalCount ? (anchorTrend.latest.within20Days / anchorTrend.latest.totalCount * 100).toFixed(1) : "0.0"}%</small><ChevronDown size={13} /></button>
          </div>}
          {anchorTrend?.latest && anchorDetailMode ? <div className="anchor-operator-detail"><div className="history-detail-title"><strong>{anchorDetailMode === "total" ? "运营主播总数明细" : anchorDetailMode === "within7" ? "7天内新增运营明细" : "20天内新增运营明细"}</strong><span>{anchorTrend.latest.operatorStats.length} 个运营</span></div><div className="anchor-operator-grid">{[...anchorTrend.latest.operatorStats].sort((a, b) => operatorValues(b, anchorDetailMode).total - operatorValues(a, anchorDetailMode).total).map((operator) => { const values = operatorValues(operator, anchorDetailMode); const overall = operator.onlineCount + operator.offlineCount; const onlineRate = overall ? operator.onlineCount / overall * 100 : 0; return <div key={operator.name}><div className="anchor-operator-row"><strong>{operator.name}</strong><b>{values.total}</b></div><div className="anchor-channel-bar"><span style={{ width: `${100 - onlineRate}%` }} /><i style={{ width: `${onlineRate}%` }} /></div><small>线上 {values.online} · 线下 {values.offline}</small></div>; })}{!anchorTrend.latest.operatorStats.length ? <div className="dashboard-empty">暂无运营明细</div> : null}</div></div> : null}
          {anchorTrend?.latest && probationDays > 0 && (anchorTrend.latest.probationExcluded ?? 0) > 0 ? <div className="anchor-probation-note">试用期 {probationDays} 天内入职的 {anchorTrend.latest.probationExcluded} 人未计入统计</div> : null}
        </section>

        <section className="card simple-module turnover-module">
          <div className="simple-module-title turnover-title"><div><TrendingUp size={17} /><div><h2><span>在职/离职人数音浪趋势</span><small>{turnover?.baseOrgName ?? "最近 6 期"}</small></h2></div></div><select value={turnoverTeamId} onChange={(event) => { setTurnoverTeamId(event.target.value); setTurnoverDate(null); }} aria-label="选择团队"><option value="">基地汇总</option>{turnoverTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>
          <div className="turnover-tabs">{(Object.keys(turnoverMetricLabels) as TurnoverMetric[]).map((metric) => <button className={turnoverMetric === metric ? "active" : ""} key={metric} onClick={() => { setTurnoverMetric(metric); setTurnoverDate(null); }}>{turnoverMetricLabels[metric]}</button>)}</div>
          <div className="turnover-legend"><span><i />线上{turnoverMetric.endsWith("Wave") ? "人均音浪" : "人数"}</span><span><i />线下{turnoverMetric.endsWith("Wave") ? "人均音浪" : "人数"}</span></div>
          {turnoverError ? <div className="dashboard-empty turnover-empty">{turnoverError}</div> : turnoverLoading && !turnover ? <div className="dashboard-empty turnover-empty">趋势数据加载中…</div> : !turnover?.dateEntries.length ? <div className="dashboard-empty turnover-empty">当前基地暂无人员趋势数据</div> : <TurnoverChart entries={turnover.dateEntries} metric={turnoverMetric} teamId={turnoverTeamId} selectedDate={turnoverDate} onSelect={(date) => setTurnoverDate((current) => current === date ? null : date)} />}
          {selectedTurnoverEntry ? <div className="turnover-detail"><div className="history-detail-title"><strong>{selectedTurnoverEntry.recordDate} · {turnoverMetricLabels[turnoverMetric]}团队明细</strong><span>{selectedTurnoverEntry.teams.length} 个团队</span></div><div className="turnover-team-grid">{selectedTurnoverEntry.teams.map((team) => { const values = turnoverValues(team, turnoverMetric); return <div key={team.teamOrgId}><strong>{team.teamOrgName}</strong><span>线上 {turnoverMetric.endsWith("Wave") ? values.online.toFixed(2) : Math.round(values.online)}{values.unit}</span><span>线下 {turnoverMetric.endsWith("Wave") ? values.offline.toFixed(2) : Math.round(values.offline)}{values.unit}</span></div>; })}</div></div> : null}
        </section>

        <section className="card simple-module retention-module">
          <div className="simple-module-title retention-title"><div><TrendingUp size={17} /><div><h2><span>留存率看板</span><small>{retention?.baseOrgName ?? "最近 6 个月"}</small></h2></div></div><select value={retentionTeamId} onChange={(event) => { setRetentionTeamId(event.target.value); setRetentionMonth(null); }} aria-label="选择留存团队"><option value="">全部团队</option>{retentionTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>
          {retentionError ? <div className="dashboard-empty retention-empty">{retentionError}</div> : retentionLoading && !retention ? <div className="dashboard-empty retention-empty">留存率数据加载中…</div> : !retention?.monthEntries.length ? <div className="dashboard-empty retention-empty">当前基地暂无留存率数据</div> : <div className="retention-month-track">{retention.monthEntries.map((entry) => { const row = retentionTeamId ? entry.teams.find((team) => team.teamOrgId === retentionTeamId) ?? { loss3Days: 0, loss15Days: 0, loss30Days: 0, activeCount: 0 } : entry.aggregated; const rate = retentionRate(row); const expandable = !retentionTeamId; return <button className={`retention-month-card ${expandable && retentionMonth === entry.recordMonth ? "active" : ""}`} key={entry.recordMonth} onClick={() => { if (expandable) setRetentionMonth((current) => current === entry.recordMonth ? null : entry.recordMonth); }}><div><strong>{entry.recordMonth}</strong><b>{rate.toFixed(0)}%</b></div><div className="retention-rate-bar"><span style={{ width: `${rate}%` }} /></div><div className="retention-metrics"><span><i />3天 <b>{row.loss3Days}</b></span><span><i />15天 <b>{row.loss15Days}</b></span><span><i />30天 <b>{row.loss30Days}</b></span><span><i />在职 <b>{row.activeCount}</b></span></div>{expandable ? <ChevronDown size={13} /> : null}</button>; })}</div>}
          {!retentionTeamId && selectedRetentionEntry ? <div className="retention-detail"><div className="history-detail-title"><strong>{selectedRetentionEntry.recordMonth} · 团队留存明细</strong><span>{selectedRetentionEntry.teams.length} 个团队</span></div><div className="retention-team-table"><div className="retention-team-head"><span>团队</span><span>3天</span><span>15天</span><span>30天</span><span>在职</span><span>留存</span></div>{selectedRetentionEntry.teams.map((team) => <div className="retention-team-row" key={team.teamOrgId}><strong>{team.teamOrgName}</strong><span>{team.loss3Days}</span><span>{team.loss15Days}</span><span>{team.loss30Days}</span><span>{team.activeCount}</span><b>{retentionRate(team).toFixed(0)}%</b></div>)}</div></div> : null}
        </section>

        <section className="card simple-module process-module">
          <div className="simple-module-title process-title"><div><TrendingUp size={17} /><div><h2><span>过程指标</span><small>{processMetrics?.baseOrgName ?? "团队完成率"}</small></h2></div></div><span className="process-swipe-hint">左右滑动查看</span></div>
          {processError ? <div className="dashboard-empty process-empty">{processError}</div> : processLoading && !processMetrics ? <div className="dashboard-empty process-empty">过程指标加载中…</div> : !processMatrixTeams.length ? <div className="dashboard-empty process-empty">当前区间暂无过程指标数据</div> : <div className="process-matrix-scroll"><table className="process-matrix"><thead><tr><th>团队</th>{processRecentDates.map((entry) => <th key={entry.recordDate}>{entry.recordDate.slice(5)}</th>)}{processCompositePeriods.map((period) => <th className={`summary-${period.key}`} key={period.key}>{period.label}</th>)}</tr></thead><tbody>{processMatrixTeams.map((team) => <tr key={team.id}><th>{team.name}</th>{processRecentDates.map((entry) => { const value = processTeamAverage(entry, team.id); const active = processPeriod === "daily" && processDate === entry.recordDate && processTeamId === team.id; return <td key={entry.recordDate}><button className={active ? "active" : ""} disabled={value == null} onClick={() => { setProcessPeriod("daily"); setProcessDate(entry.recordDate); setProcessTeamId((current) => active ? null : team.id); }}>{value == null ? <span className="process-dash">—</span> : <b>{value.toFixed(0)}%</b>}</button></td>; })}{processCompositePeriods.map((period) => { const row = processCompositeRows[period.key].find((item) => item.id === team.id); const active = processPeriod === period.key && processTeamId === team.id; return <td key={period.key}><button className={`${active ? "active" : ""} summary-cell summary-${period.key}`} disabled={!row} onClick={() => { setProcessPeriod(period.key); setProcessTeamId((current) => active ? null : team.id); }}>{row ? <b>{row.percentage.toFixed(0)}%</b> : <span className="process-dash">—</span>}</button></td>; })}</tr>)}<tr className="process-average-row"><th>均值</th>{processRecentDates.map((entry) => { const values = processMatrixTeams.map((team) => processTeamAverage(entry, team.id)).filter((value): value is number => value != null); const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; return <td key={entry.recordDate}><div>{average == null ? "—" : `${average.toFixed(0)}%`}</div></td>; })}{processCompositePeriods.map((period) => { const rows = processCompositeRows[period.key]; const average = rows.length ? rows.reduce((sum, row) => sum + row.percentage, 0) / rows.length : null; return <td key={period.key}><div>{average == null ? "—" : `${average.toFixed(0)}%`}</div></td>; })}</tr></tbody></table></div>}
          {selectedProcessTeam ? <div className="process-detail"><div className="history-detail-title"><strong>{selectedProcessTeam.name} · 厅完成率明细</strong><span>{selectedProcessTeam.halls.length} 个厅</span></div><div className="process-hall-grid">{selectedProcessTeam.halls.map((hall) => <div key={hall.name}><strong>{hall.name}</strong><b>{hall.percentage.toFixed(0)}%</b></div>)}</div></div> : null}
        </section>
      </main>
      <MobileBottomNav />
    </div></div>
  );
}
