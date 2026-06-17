import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, AlertCircle, RefreshCw, TrendingUp, Users, CheckCircle2, Clock, Circle, ShieldOff, ChevronDown, ListTodo, Send, UserRound, Users2 } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { api } from "../../../services/http";
import { recordApi, reportApi } from "../../../services/task";
import { fetchOrgTree } from "../../../services/organization";
import { useIdentityStore } from "../../../stores/identityStore";
import type { User, OrgUnit, DailyDashboardResponse, TaskRecord } from "../../../types";

/** 判断组织是否在身份权限范围内 */
function isOrgWithinScope(org: OrgUnit, scopePath?: string | null) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`);
}

function calcDays(createdAt: string): number {
  const start = new Date(createdAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
}

/** 完成率颜色 */
function rateColor(rate: number) {
  if (rate >= 95) return "#10b981"; // emerald-500
  if (rate >= 80) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}

/** 自定义环形图中心标签 */
function DonutCenter({ cx, cy, rate }: { cx?: number; cy?: number; rate: number }) {
  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan
        x={cx}
        dy="-6"
        fontSize="26"
        fontWeight="700"
        fill={rateColor(rate)}
      >
        {rate.toFixed(1)}%
      </tspan>
      <tspan x={cx} dy="24" fontSize="12" fill="#94a3b8">
        今日完成率
      </tspan>
    </text>
  );
}

/** KPI 小卡片 */
function KpiCard({
  icon,
  label,
  value,
  colorClass,
  bgClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  colorClass: string;
  bgClass: string;
}) {
  return (
    <div className="flex flex-1 min-w-0 items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-4 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bgClass}`}>
        <span className={colorClass}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400 leading-none mb-1">{label}</p>
        <p className={`text-[22px] font-bold leading-none tabular-nums ${colorClass}`}>{value}</p>
      </div>
    </div>
  );
}



export function CockpitPage() {
  const navigate = useNavigate();
  const { currentIdentity, permissions } = useIdentityStore();

  const [days, setDays] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<DailyDashboardResponse | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);
  const [pendingExemptions, setPendingExemptions] = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  // 我的待办
  const [myRecords, setMyRecords] = useState<TaskRecord[]>([]);
  const [myRecordsLoading, setMyRecordsLoading] = useState(true);

  // 基地选择（给 DEV_ADMIN / HQ_ADMIN 使用）
  const [baseOrgs, setBaseOrgs] = useState<OrgUnit[]>([]);
  const [selectedBaseOrgId, setSelectedBaseOrgId] = useState<string>("");

  const canViewReport = permissions.includes("*") || permissions.includes("task:report:view");
  const isAdminLevel = currentIdentity &&
    ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(currentIdentity.roleCode);
  const showDashboard = canViewReport && isAdminLevel;

  // DEV_ADMIN / HQ_ADMIN 需要选基地；其他角色直接用自己的 orgId 作为 scopeOrgId
  const needsBaseSelect = currentIdentity &&
    ["DEV_ADMIN", "HQ_ADMIN"].includes(currentIdentity.roleCode);

  // 最终传给接口的 scopeOrgId
  const scopeOrgId = needsBaseSelect
    ? (selectedBaseOrgId || undefined)
    : (currentIdentity?.orgId ?? undefined);

  // 加载用户信息（陪伴天数）
  useEffect(() => {
    api.get<User>("/me").then((user) => {
      if (user?.createdAt) setDays(calcDays(user.createdAt));
    }).catch(console.error);
  }, []);

  // 加载我的待办
  useEffect(() => {
    setMyRecordsLoading(true);
    recordApi.getMyRecords()
      .then(setMyRecords)
      .catch(console.error)
      .finally(() => setMyRecordsLoading(false));
  }, [currentIdentity?.id]);

  // DEV_ADMIN / HQ_ADMIN：加载基地列表
  useEffect(() => {
    if (!needsBaseSelect || !showDashboard) return;
    fetchOrgTree().then((orgs) => {
      const bases = orgs
        .filter((o) => o.status === "active" && o.orgType === "BASE" && isOrgWithinScope(o, currentIdentity?.scopePath))
        .sort((a, b) => a.path.localeCompare(b.path));
      setBaseOrgs(bases);
      if (bases.length > 0 && !selectedBaseOrgId) {
        setSelectedBaseOrgId(bases[0].id);
      }
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsBaseSelect, showDashboard]);

  // 加载日常看板数据
  const loadDashboard = (overrideScopeOrgId?: string) => {
    if (!showDashboard) return;
    // DEV_ADMIN / HQ_ADMIN 未选基地时不加载
    if (needsBaseSelect && !overrideScopeOrgId && !selectedBaseOrgId) return;
    setDashLoading(true);
    setDashError(null);
    const today = new Date().toISOString().slice(0, 10);
    const sid = overrideScopeOrgId ?? scopeOrgId;
    Promise.all([
      reportApi.getDailyDashboard(today, sid),
      reportApi.getSummary(),
    ])
      .then(([dash, summary]) => {
        setDashboard(dash);
        setPendingExemptions(summary.pendingExemptions ?? 0);
        setLastRefreshed(new Date());
      })
      .catch((e) => setDashError(e?.message ?? "加载失败"))
      .finally(() => setDashLoading(false));
  };

  // 身份或 scopeOrgId 变化时重新加载
  useEffect(() => {
    if (needsBaseSelect) {
      // 等基地选好后再加载（由 selectedBaseOrgId 变化触发）
      return;
    }
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDashboard, currentIdentity?.orgId]);

  // DEV_ADMIN / HQ_ADMIN 选完基地后加载
  useEffect(() => {
    if (!needsBaseSelect || !selectedBaseOrgId) return;
    loadDashboard(selectedBaseOrgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBaseOrgId]);

  // 环形图数据
  const donutData = dashboard
    ? [
        { name: "已完成", value: dashboard.summary.completed, color: "#10b981" },
        { name: "进行中", value: dashboard.summary.inProgress, color: "#3b82f6" },
        { name: "未开始", value: dashboard.summary.pending, color: "#e2e8f0" },
        { name: "豁免", value: dashboard.summary.exemptions, color: "#a78bfa" },
      ].filter((d) => d.value > 0)
    : [];

  const rate = dashboard?.summary.completionRate ?? 0;

  return (
    <div className="space-y-5">
      {/* ── 顶部 Banner ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-feishu-blue to-[#7B9DFF] px-8 py-7 text-white shadow-[0_14px_40px_rgba(76,114,255,0.28)]">
        <div className="relative z-10 flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-white/20 backdrop-blur-sm">
            <Sparkles size={24} className="text-white" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-white/70">成长协同</p>
            <p className="mt-0.5 text-[20px] font-semibold leading-snug tracking-tight">
              您已陪伴千广成长系统
              {days !== null ? (
                <span className="mx-1.5 text-[28px] font-bold tabular-nums">{days}</span>
              ) : (
                <span className="mx-1.5 inline-block h-7 w-10 animate-pulse rounded-md bg-white/30 align-middle" />
              )}
              天
            </p>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-8 right-24 h-32 w-32 rounded-full bg-white/10" />
      </div>

      {/* ── 没有权限时不展示图表 ── */}
      {/* ── 我的待办统计 ── */}
      {(() => {
        const pending = myRecords.filter((r) => r.status !== "submitted");
        const daily = pending.filter((r) => r.assignment?.category === "DAILY");
        const tmpAll = pending.filter((r) => r.assignment?.category === "TEMPORARY");
        const tmpAccount = tmpAll.filter((r) => r.assignment?.temporaryMode === "ACCOUNT");
        const tmpAnchor = tmpAll.filter((r) => r.assignment?.temporaryMode === "ANCHOR");
        const tmpManager = tmpAll.filter((r) => r.assignment?.temporaryMode === "MANAGER");

        function calcProgress(records: TaskRecord[]) {
          const total = records.reduce((s, r) => s + (r.totalItems ?? 0), 0);
          const done = records.reduce((s, r) => s + (r.doneItems ?? 0), 0);
          return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
        }

        const groups = [
          { key: "daily", label: "主播日常任务", icon: <CheckCircle2 size={15} />, records: daily, color: "#3b82f6", bg: "bg-blue-50", text: "text-blue-600", bar: "from-blue-400 to-blue-600" },
          { key: "account", label: "触达式", icon: <Send size={15} />, records: tmpAccount, color: "#06b6d4", bg: "bg-sky-50", text: "text-sky-600", bar: "from-sky-400 to-sky-600" },
          { key: "anchor", label: "主播式", icon: <UserRound size={15} />, records: tmpAnchor, color: "#10b981", bg: "bg-emerald-50", text: "text-emerald-600", bar: "from-emerald-400 to-emerald-500" },
          { key: "manager", label: "管理式", icon: <Users2 size={15} />, records: tmpManager, color: "#8b5cf6", bg: "bg-violet-50", text: "text-violet-600", bar: "from-violet-400 to-violet-600" },
        ];

        return (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ListTodo size={16} className="text-feishu-blue" />
                <span className="text-[14px] font-semibold text-slate-700">我的待办</span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 tabular-nums">
                  {myRecordsLoading ? "…" : `${pending.length} 项未完成`}
                </span>
              </div>
              <button
                onClick={() => navigate("/tasks/dashboard")}
                className="flex items-center gap-1 rounded-lg border border-feishu-blue/30 bg-feishu-blue/5 px-2.5 py-1 text-[11px] font-medium text-feishu-blue hover:bg-feishu-blue/10 transition-colors"
              >
                查看详情 →
              </button>
            </div>

            {myRecordsLoading ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {groups.map((g) => {
                  const prog = calcProgress(g.records);
                  return (
                    <div key={g.key} className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                      {/* 头部：图标 + 名称 + 数量 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${g.bg} ${g.text}`}>{g.icon}</span>
                          <span className="text-[13px] font-semibold text-slate-700">{g.label}</span>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${g.bg} ${g.text}`}>
                          {g.records.length}
                        </span>
                      </div>

                      {/* 子任务数量 */}
                      <div className="flex items-baseline gap-1">
                        <span className={`text-[22px] font-bold tabular-nums leading-none ${g.text}`}>{prog.done}</span>
                        <span className="text-[13px] text-slate-400">/ {prog.total} 子任务</span>
                      </div>

                      {/* 进度条 */}
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">完成进度</span>
                          <span className={`font-bold tabular-nums ${g.text}`}>{prog.pct}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r transition-all ${g.bar}`}
                            style={{ width: `${prog.pct}%` }}
                          />
                        </div>
                      </div>

                      {/* 空状态 */}
                      {g.records.length === 0 && (
                        <p className="text-[11px] text-slate-300">暂无待处理</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {!showDashboard && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center text-sm text-slate-400">
          更多模块敬请期待…
        </div>
      )}

      {showDashboard && (
        <>
          {/* ── 标题行 + 基地选择 + 刷新 ── */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-feishu-blue" />
              <span className="text-[14px] font-semibold text-slate-700">
                {dashboard ? `${dashboard.baseOrg.name}今日主播日常任务概览` : "今日主播日常任务概览"}
              </span>
              {dashboard && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 tabular-nums">
                  {dashboard.taskDate}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* DEV_ADMIN / HQ_ADMIN 基地切换器 */}
              {needsBaseSelect && baseOrgs.length > 0 && (
                <div className="relative">
                  <select
                    value={selectedBaseOrgId}
                    onChange={(e) => setSelectedBaseOrgId(e.target.value)}
                    className="appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-7 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-feishu-blue/30 cursor-pointer"
                  >
                    {baseOrgs.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              )}
              {lastRefreshed && (
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {lastRefreshed.getHours().toString().padStart(2, "0")}:
                  {lastRefreshed.getMinutes().toString().padStart(2, "0")} 更新
                </span>
              )}
              <button
                onClick={() => loadDashboard()}
                disabled={dashLoading}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={12} className={dashLoading ? "animate-spin" : ""} />
                刷新
              </button>
            </div>
          </div>

          {/* ── 错误提示 ── */}
          {dashError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              <AlertCircle size={16} className="shrink-0" />
              {dashError}
            </div>
          )}

          {/* ── KPI 卡片行 ── */}
          {dashLoading && !dashboard ? (
            <div className="flex gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex-1 h-[76px] animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : dashboard ? (
            <div className="flex flex-wrap gap-3">
              <KpiCard icon={<Users size={18} />} label="今日投放" value={dashboard.summary.total} colorClass="text-slate-600" bgClass="bg-slate-100" />
              <KpiCard icon={<CheckCircle2 size={18} />} label="已完成" value={dashboard.summary.completed} colorClass="text-emerald-600" bgClass="bg-emerald-50" />
              <KpiCard icon={<Clock size={18} />} label="进行中" value={dashboard.summary.inProgress} colorClass="text-blue-600" bgClass="bg-blue-50" />
              <KpiCard icon={<Circle size={18} />} label="未开始" value={dashboard.summary.pending} colorClass="text-slate-400" bgClass="bg-slate-50" />
              <KpiCard icon={<ShieldOff size={18} />} label="豁免" value={dashboard.summary.exemptions} colorClass="text-violet-500" bgClass="bg-violet-50" />
              <KpiCard
                icon={<TrendingUp size={18} />}
                label="完成率"
                value={`${rate.toFixed(1)}%`}
                colorClass={rate >= 95 ? "text-emerald-600" : rate >= 80 ? "text-amber-600" : "text-red-500"}
                bgClass={rate >= 95 ? "bg-emerald-50" : rate >= 80 ? "bg-amber-50" : "bg-red-50"}
              />
            </div>
          ) : null}

          {/* ── 图表行：完成率分布 + 各团队完成情况 + 子任务完成分布 ── */}
          {dashboard && (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* 第1列：完成率分布环形图 */}
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                  <p className="mb-1 text-[13px] font-semibold text-slate-700">完成率分布</p>
                  {(() => {
                    // 每个团队一个扇区，按团队总人数划分
                    const teamPalette = [
                      "#3b82f6","#10b981","#f59e0b","#8b5cf6","#06b6d4",
                      "#ec4899","#f97316","#84cc16","#14b8a6","#a855f7",
                    ];
                    const chartData = dashboard.tree.teams.length > 0
                      ? dashboard.tree.teams.map((team, ti) => {
                          const teamRate = team.total > 0 ? Math.round((team.completed / team.total) * 100) : 0;
                          return {
                            name: team.orgName,
                            value: team.total,
                            color: teamPalette[ti % teamPalette.length],
                            team,
                            teamRate,
                          };
                        })
                      : [{ name: "暂无", value: 1, color: "#e2e8f0", team: null as any, teamRate: 0 }];

                    // 扇区 label + 引导线：显示"团队名\n完成率X%"
                    const RADIAN = Math.PI / 180;
                    const renderLabel = ({
                      cx, cy, midAngle, innerRadius, outerRadius, name, teamRate,
                    }: any) => {
                      // 引导线起点（扇区外边缘）
                      const sinA = Math.sin(-midAngle * RADIAN);
                      const cosA = Math.cos(-midAngle * RADIAN);
                      const sx = cx + (outerRadius + 6) * cosA;
                      const sy = cy + (outerRadius + 6) * sinA;
                      // 引导线折点
                      const mx = cx + (outerRadius + 26) * cosA;
                      const my = cy + (outerRadius + 26) * sinA;
                      // 水平延伸终点
                      const isRight = mx > cx;
                      const ex = mx + (isRight ? 20 : -20);
                      const ey = my;
                      const anchor = isRight ? "start" : "end";
                      const tx = isRight ? ex + 5 : ex - 5;
                      return (
                        <g>
                          {/* 折线引导线 */}
                          <path d={`M${sx},${sy} L${mx},${my} L${ex},${ey}`} stroke="#cbd5e1" strokeWidth={1.2} fill="none" />
                          <circle cx={ex} cy={ey} r={2} fill="#cbd5e1" />
                          {/* 团队名 */}
                          <text x={tx} y={ey - 8} textAnchor={anchor} fontSize={12} fontWeight={600} fill="#334155">
                            {name}
                          </text>
                          {/* 完成率 */}
                          <text x={tx} y={ey + 8} textAnchor={anchor} fontSize={13} fontWeight={700} fill={rateColor(teamRate)}>
                            {teamRate}%
                          </text>
                        </g>
                      );
                    };

                    // 自定义 Tooltip：悬停显示"XX团队 完成率X%" + 详情
                    const CustomTooltip = ({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      if (!d.team) return null;
                      const t = d.team;
                      return (
                        <div style={{
                          background: "white", border: "1px solid #e2e8f0",
                          borderRadius: 10, padding: "10px 14px", fontSize: 13, lineHeight: "2",
                          boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                        }}>
                          <p style={{ fontWeight: 700, color: "#334155", marginBottom: 2 }}>
                            {d.name}
                            <span style={{ marginLeft: 8, color: rateColor(d.teamRate), fontSize: 14 }}>
                              完成率 {d.teamRate}%
                            </span>
                          </p>
                          <p style={{ color: "#10b981" }}>完成 <strong>{t.completed}</strong> 人</p>
                          <p style={{ color: "#3b82f6" }}>进行中 <strong>{t.inProgress}</strong> 人</p>
                          <p style={{ color: "#94a3b8" }}>未开始 <strong>{t.pending}</strong> 人</p>
                          {t.exemptions > 0 && (
                            <p style={{ color: "#8b5cf6" }}>豁免 <strong>{t.exemptions}</strong> 人</p>
                          )}
                        </div>
                      );
                    };

                    return (
                      <div className="h-[340px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart margin={{ top: 30, right: 80, bottom: 30, left: 80 }}>
                            <Pie
                              data={chartData}
                              cx="50%"
                              cy="50%"
                              innerRadius={68}
                              outerRadius={100}
                              paddingAngle={2}
                              dataKey="value"
                              strokeWidth={0}
                              isAnimationActive={true}
                              labelLine={false}
                              label={renderLabel}
                            >
                              {chartData.map((entry, index) => (
                                <Cell key={index} fill={entry.color} stroke="none" />
                              ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                            {/* 中心：整体完成率 */}
                            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                              <tspan x="50%" dy="-9" fontSize="26" fontWeight="700" fill={rateColor(rate)}>
                                {rate.toFixed(1)}%
                              </tspan>
                              <tspan x="50%" dy="22" fontSize="12" fill="#94a3b8">
                                今日完成率
                              </tspan>
                            </text>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}
                </div>

                {/* 第2列：各团队完成情况列表 */}
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-slate-700">各团队完成情况</p>
                    <button
                      onClick={() => navigate("/tasks/dashboard/daily-board")}
                      className="flex items-center gap-1 rounded-lg border border-feishu-blue/30 bg-feishu-blue/5 px-2.5 py-1 text-[11px] font-medium text-feishu-blue hover:bg-feishu-blue/10 transition-colors"
                    >
                      详情 →
                    </button>
                  </div>
                  {dashboard.tree.teams.length === 0 ? (
                    <div className="flex h-48 items-center justify-center text-sm text-slate-400">暂无团队数据</div>
                  ) : (
                    <div className="space-y-1.5 h-[340px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                      {dashboard.tree.teams.map((team) => {
                        const teamRate = team.total > 0 ? Math.round((team.completed / team.total) * 100) : 0;
                        const hasHalls = (team.halls?.length ?? 0) > 0;
                        const isExpanded = expandedTeams.has(team.orgId);
                        const toggleExpand = () => {
                          setExpandedTeams((prev) => {
                            const next = new Set(prev);
                            next.has(team.orgId) ? next.delete(team.orgId) : next.add(team.orgId);
                            return next;
                          });
                        };
                        return (
                          <div key={team.orgId} className="rounded-xl border border-slate-100 overflow-hidden">
                            {/* 团队行 */}
                            <div
                              className={`flex items-center gap-3 px-4 py-2.5 ${hasHalls ? "cursor-pointer hover:bg-slate-100 active:bg-slate-200" : ""} bg-slate-50 transition-colors`}
                              onClick={hasHalls ? toggleExpand : undefined}
                            >
                              {/* 展开箭头 */}
                              <span className={`shrink-0 text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                                style={{ fontSize: 10, width: 12, display: "inline-block", textAlign: "center" }}>
                                {hasHalls ? "▶" : ""}
                              </span>
                              {/* 团队名 */}
                              <span className="w-[80px] shrink-0 text-[12px] font-semibold text-slate-700 truncate" title={team.orgName}>
                                {team.orgName}
                              </span>
                              {/* 进度条 */}
                              <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                                <div className="h-full rounded-full transition-all"
                                  style={{ width: `${teamRate}%`, backgroundColor: rateColor(teamRate) }} />
                              </div>
                              {/* 完成率 */}
                              <span className="w-[36px] shrink-0 text-right text-[12px] font-bold tabular-nums" style={{ color: rateColor(teamRate) }}>
                                {teamRate}%
                              </span>
                              {/* 详细人数 */}
                              <div className="flex items-center gap-2.5 shrink-0">
                                <span className="flex items-center gap-1 text-[11px] text-emerald-600 whitespace-nowrap">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                  完成 <strong className="tabular-nums">{team.completed}</strong>
                                </span>
                                <span className="flex items-center gap-1 text-[11px] text-blue-500 whitespace-nowrap">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                                  进行中 <strong className="tabular-nums">{team.inProgress}</strong>
                                </span>
                                <span className="flex items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
                                  未开始 <strong className="tabular-nums">{team.pending}</strong>
                                </span>
                                {team.exemptions > 0 && (
                                  <span className="flex items-center gap-1 text-[11px] text-violet-500 whitespace-nowrap">
                                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-300" />
                                    豁免 <strong className="tabular-nums">{team.exemptions}</strong>
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* 厅级展开区 */}
                            {isExpanded && hasHalls && (
                              <div className="border-t border-slate-100 bg-white divide-y divide-slate-50">
                                {team.halls!.map((hall) => {
                                  const hallRate = hall.total > 0 ? Math.round((hall.completed / hall.total) * 100) : 0;
                                  return (
                                    <div key={hall.orgId} className="flex items-center gap-3 px-4 py-2 pl-10 hover:bg-slate-50 transition-colors">
                                      {/* 厅名 */}
                                      <div className="w-[80px] shrink-0 flex items-center gap-1.5" title={hall.orgName}>
                                        <span className="inline-flex items-center justify-center h-4 w-4 rounded bg-feishu-blue/10 text-feishu-blue shrink-0" style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0 }}>厅</span>
                                        <span className="text-[12px] text-slate-600 font-medium truncate">{hall.orgName}</span>
                                      </div>
                                      {/* 进度条 */}
                                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                        <div className="h-full rounded-full transition-all"
                                          style={{ width: `${hallRate}%`, backgroundColor: rateColor(hallRate) }} />
                                      </div>
                                      {/* 完成率 */}
                                      <span className="w-[36px] shrink-0 text-right text-[11px] font-semibold tabular-nums" style={{ color: rateColor(hallRate) }}>
                                        {hallRate}%
                                      </span>
                                      {/* 人数 */}
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] text-emerald-600 whitespace-nowrap tabular-nums">
                                          完成 <strong>{hall.completed}</strong>
                                        </span>
                                        <span className="text-[10px] text-blue-500 whitespace-nowrap tabular-nums">
                                          进行中 <strong>{hall.inProgress}</strong>
                                        </span>
                                        <span className="text-[10px] text-slate-400 whitespace-nowrap tabular-nums">
                                          未开始 <strong>{hall.pending}</strong>
                                        </span>
                                        {hall.exemptions > 0 && (
                                          <span className="text-[10px] text-violet-500 whitespace-nowrap tabular-nums">
                                            豁免 <strong>{hall.exemptions}</strong>
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 第3列：子任务完成分布（每子任务一个小环形图） */}
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-col">
                  <p className="mb-3 text-[13px] font-semibold text-slate-700 shrink-0">子任务完成分布</p>
                  {(() => {
                    const summaries = dashboard.subTaskSummaries ?? [];
                    if (summaries.length === 0) {
                      return (
                        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">暂无子任务数据</div>
                      );
                    }

                    type StItem = typeof summaries[number];

                    // 每个子任务小环
                    const SubTaskDonut = ({ st }: { st: StItem }) => {
                      const done = st.doneCount;
                      const inProg = st.teamBreakdown.reduce((s, t) => s + t.inProgress, 0);
                      const pend = Math.max(0, st.total - done - inProg);
                      const pieData = [
                        { name: "完成", value: done, color: "#10b981" },
                        { name: "进行中", value: inProg, color: "#3b82f6" },
                        { name: "未开始", value: pend, color: "#e2e8f0" },
                      ].filter((d) => d.value > 0);
                      if (pieData.length === 0) pieData.push({ name: "暂无", value: 1, color: "#e2e8f0" });
                      const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

                      return (
                        <div
                          className="relative flex flex-col items-center gap-1 rounded-xl p-2 hover:bg-slate-50 transition-colors"
                          onMouseMove={(e) => setTooltipPos({ x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setTooltipPos(null)}
                        >
                          <div style={{ width: 96, height: 96 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={pieData}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={30}
                                  outerRadius={44}
                                  paddingAngle={2}
                                  dataKey="value"
                                  strokeWidth={0}
                                  isAnimationActive={false}
                                  labelLine={false}
                                  label={false}
                                >
                                  {pieData.map((entry, i) => (
                                    <Cell key={i} fill={entry.color} stroke="none" />
                                  ))}
                                </Pie>
                                <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                                  <tspan x="50%" fontSize="13" fontWeight="800" fill={rateColor(st.completionRate)}>
                                    {st.completionRate}%
                                  </tspan>
                                </text>
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <p className="text-center text-[11px] font-medium text-slate-600 leading-tight w-full px-1 truncate" title={st.title}>
                            {st.title}
                          </p>
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-emerald-500 tabular-nums font-semibold">{done}</span>
                            <span className="text-slate-300">/</span>
                            <span className="text-slate-400 tabular-nums">{st.total}</span>
                          </div>
                          {/* 跟随鼠标的 tooltip，fixed 定位基于 clientX/Y 完全准确 */}
                          {tooltipPos && (
                            <div style={{
                              position: "fixed",
                              left: tooltipPos.x + 12,
                              top: tooltipPos.y - 10,
                              zIndex: 9999,
                              pointerEvents: "none",
                              background: "white",
                              border: "1px solid #e2e8f0",
                              borderRadius: 12,
                              padding: "12px 16px",
                              fontSize: 12,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                              minWidth: 240,
                              width: "max-content",
                            }}>
                              <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                                <span>{st.title}</span>
                                <span style={{ color: rateColor(st.completionRate), fontSize: 14 }}>{st.completionRate}%</span>
                              </div>
                              {st.teamBreakdown.length > 0 ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "minmax(60px,1fr) 42px 42px 52px", gap: 8, color: "#94a3b8", fontSize: 11, paddingBottom: 5, borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>
                                    <span>团队</span>
                                    <span style={{ textAlign: "right", color: "#10b981" }}>完成</span>
                                    <span style={{ textAlign: "right", color: "#3b82f6" }}>进行中</span>
                                    <span style={{ textAlign: "right", color: "#94a3b8" }}>未开始</span>
                                  </div>
                                  {st.teamBreakdown.map((t: StItem["teamBreakdown"][number]) => (
                                    <div key={t.teamOrgId} style={{ display: "grid", gridTemplateColumns: "minmax(60px,1fr) 42px 42px 52px", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
                                      <span style={{ color: "#334155", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.teamName}</span>
                                      <span style={{ textAlign: "right", color: "#10b981", fontWeight: 700 }}>{t.done}</span>
                                      <span style={{ textAlign: "right", color: "#3b82f6", fontWeight: 700 }}>{t.inProgress}</span>
                                      <span style={{ textAlign: "right", color: "#94a3b8", fontWeight: 700 }}>{t.pending}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ color: "#94a3b8" }}>已完成 {st.doneCount} / 共 {st.total} 人</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    };

                    return (
                      <div className="h-[340px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                        <div className="grid grid-cols-3 gap-1">
                          {summaries.map((st) => (
                            <SubTaskDonut key={st.taskItemId} st={st} />
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}


        </>
      )}
    </div>
  );
}
