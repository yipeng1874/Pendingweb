import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Sparkles, AlertCircle, RefreshCw, TrendingUp, Users, CheckCircle2, Clock, Circle, ShieldOff, ChevronDown, Calendar, X, Building2, GraduationCap, UserMinus, Zap, Upload, FileSpreadsheet } from "lucide-react";
import { AnchorSummaryCard } from "./AnchorSummaryCard";
import { SummaryDonut, rateColor } from "./SummaryDonut";
import { KpiCard, AnchorLiveKpiCard } from "./KpiCards";
import { HallOperatorPopover } from "./HallOperatorPopover";
import { LossTrendPopover } from "./LossTrendPopover";
import { WaveTrendPopover } from "./WaveTrendPopover";
import { api } from "../../../services/http";
import { anchorLossSummaryApi, anchorAvgWaveApi, anchorSummaryApi, liveRoomCapacityApi, liveRoomSiteApi, dataOverviewApi, hallSummaryApi, reportApi } from "../../../services/task";
import type { AnchorLossTrendResponse, HallOperatorStat, HallTrendResponse, LiveRoomCapacity, LiveRoomSite, SiteDetail, AnchorAvgWaveTrendResponse } from "../../../services/task";
import { fetchOrgTree } from "../../../services/organization";
import { useIdentityStore } from "../../../stores/identityStore";
import type { User, OrgUnit, DailyDashboardResponse, DailyRangeStatsResponse } from "../../../types";

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

  // 厅个数趋势数据（正式厅 / 训练厅 KPI）
  const [hallTrend, setHallTrend] = useState<HallTrendResponse | null>(null);
  // 主播流失趋势数据
  const [lossTrend, setLossTrend] = useState<AnchorLossTrendResponse | null>(null);

  // 基地直播间空余数据
  const [roomCapacity, setRoomCapacity] = useState<LiveRoomCapacity | null>(null);
  // 人均音浪趋势数据
  const [avgWaveTrend, setAvgWaveTrend] = useState<AnchorAvgWaveTrendResponse | null>(null);

  // 厅个数上传弹窗状态
  const [hallUploadDate, setHallUploadDate] = useState("");
  const [hallUploadFile, setHallUploadFile] = useState<File | null>(null);
  const [hallUploading, setHallUploading] = useState(false);
  const [hallUploadError, setHallUploadError] = useState("");
  const hallFileInputRef = useRef<HTMLInputElement>(null);

  // 数据录入弹窗（直播间空余：场地+房间类型 / 人均音浪）
  const [dataInputDate, setDataInputDate] = useState(getBeijingDateStr(-1));
  const [dataInputAvgWave, setDataInputAvgWave] = useState("");
  const [dataInputOfflineAvgWave, setDataInputOfflineAvgWave] = useState("");
  const [dataInputTotalAvgWave, setDataInputTotalAvgWave] = useState("");
  const [dataInputLoading, setDataInputLoading] = useState(false);
  const [dataInputError, setDataInputError] = useState("");
  // 场地+房间输入
  const [liveRoomSites, setLiveRoomSites] = useState<LiveRoomSite[]>([]);
  // 录入表单：key = siteId, value = { siteName, rooms: [{ typeName, used, total }] }
  type RoomInputRow = { key: number; typeName: string; used: string; total: string; };
  type SiteInputData = { siteName: string; rooms: RoomInputRow[]; };
  const [siteInputs, setSiteInputs] = useState<Record<string, SiteInputData>>({});
  // 场地管理
  const [showNewSiteInput, setShowNewSiteInput] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editingSiteName, setEditingSiteName] = useState("");
  const roomRowRef = useRef(0);
  const nextRowKey = () => ++roomRowRef.current;

  // 统一上传弹窗
  const [dataUploadOpen, setDataUploadOpen] = useState(false);
  const [dataUploadTab, setDataUploadTab] = useState<"excel" | "anchor" | "manual">("excel");
  // 主播数据表上传 state
  const [anchorUploadDate, setAnchorUploadDate] = useState(getBeijingDateStr(-1));
  const [anchorUploadFile, setAnchorUploadFile] = useState<File | null>(null);
  const [anchorUploading, setAnchorUploading] = useState(false);
  const [anchorUploadError, setAnchorUploadError] = useState("");
  const anchorFileInputRef = useRef<HTMLInputElement>(null);

  // 厅个数 KPI 卡片悬停浮层
  const [hoveredHallKpi, setHoveredHallKpi] = useState<"formal" | "training" | null>(null);
  const formalKpiRef = useRef<HTMLDivElement>(null);
  const trainingKpiRef = useRef<HTMLDivElement>(null);
  // 流失卡片悬停浮层
  const [hoveredLossKpi, setHoveredLossKpi] = useState(false);
  const lossKpiRef = useRef<HTMLDivElement>(null);
  // 音浪卡片悬停浮层
  const [hoveredWaveKpi, setHoveredWaveKpi] = useState(false);
  const waveKpiRef = useRef<HTMLDivElement>(null);

  // 基地选择（给 DEV_ADMIN / HQ_ADMIN 使用）
  const [baseOrgs, setBaseOrgs] = useState<OrgUnit[]>([]);
  const [selectedBaseOrgId, setSelectedBaseOrgId] = useState<string>("");

  const canViewReport = permissions.includes("*") || permissions.includes("task:report:view");
  const isAdminLevel = currentIdentity &&
    ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(currentIdentity.roleCode);
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
  }, [showDashboard, currentIdentity?.id]);

  // DEV_ADMIN / HQ_ADMIN 选完基地后加载
  useEffect(() => {
    if (!needsBaseSelect || !selectedBaseOrgId) return;
    loadDashboard(selectedBaseOrgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBaseOrgId]);

  // ── 厅个数趋势数据（正式厅/训练厅 KPI） ──
  const loadHallTrend = (overrideScopeOrgId?: string) => {
    if (!showDashboard) return;
    const sid = overrideScopeOrgId ?? scopeOrgId;
    if (needsBaseSelect && !sid) return;
    hallSummaryApi.getTrend(sid, 7)
      .then(setHallTrend)
      .catch(() => setHallTrend(null));
  };

  useEffect(() => {
    if (needsBaseSelect) return;
    loadHallTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDashboard, currentIdentity?.id]);

  useEffect(() => {
    if (!needsBaseSelect || !selectedBaseOrgId) return;
    loadHallTrend(selectedBaseOrgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBaseOrgId]);

  // ── 主播流失趋势数据 ──
  const loadLossTrend = (sid?: string) => {
    if (!showDashboard) return;
    anchorLossSummaryApi.getTrend(sid ?? scopeOrgId, 7)
      .then(setLossTrend)
      .catch(() => setLossTrend(null));
  };
  useEffect(() => {
    if (needsBaseSelect) return;
    loadLossTrend();
  }, [showDashboard, currentIdentity?.id]);
  useEffect(() => {
    if (!needsBaseSelect || !selectedBaseOrgId) return;
    loadLossTrend(selectedBaseOrgId);
  }, [selectedBaseOrgId]);

  // ── 直播间空余数据 ──
  const loadRoomCapacity = (sid?: string) => {
    if (!showDashboard) return;
    liveRoomCapacityApi.getLatest(sid ?? scopeOrgId)
      .then(setRoomCapacity)
      .catch(() => setRoomCapacity(null));
  };
  useEffect(() => {
    if (needsBaseSelect) return;
    loadRoomCapacity();
  }, [showDashboard, currentIdentity?.id]);
  useEffect(() => {
    if (!needsBaseSelect || !selectedBaseOrgId) return;
    loadRoomCapacity(selectedBaseOrgId);
  }, [selectedBaseOrgId]);

  // ── 人均音浪趋势数据 ──
  const loadAvgWaveTrend = (sid?: string) => {
    if (!showDashboard) return;
    anchorAvgWaveApi.getTrend(sid ?? scopeOrgId, 7)
      .then(setAvgWaveTrend)
      .catch(() => setAvgWaveTrend(null));
  };
  useEffect(() => {
    if (needsBaseSelect) return;
    loadAvgWaveTrend();
  }, [showDashboard, currentIdentity?.id]);
  useEffect(() => {
    if (!needsBaseSelect || !selectedBaseOrgId) return;
    loadAvgWaveTrend(selectedBaseOrgId);
  }, [selectedBaseOrgId]);

  // ── 初始化录入表单（加载场地 + 已有容量） ──
  const initSiteInputs = async () => {
    try {
      const sites = await liveRoomSiteApi.list(scopeOrgId);
      setLiveRoomSites(sites);
      const cap = await liveRoomCapacityApi.getLatest(scopeOrgId);
      const map: Record<string, SiteInputData> = {};
      let globalKey = 0;
      sites.forEach((s) => {
        const detail = cap?.siteDetails?.find((d: SiteDetail) => d.siteId === s.id);
        map[s.id] = {
          siteName: s.name,
          rooms: detail?.rooms?.map((r) => {
            globalKey++;
            return {
              key: globalKey,
              typeName: r.typeName,
              used: String(r.used ?? ""),
              total: String(r.total ?? ""),
            };
          }) ?? [{ key: ++globalKey, typeName: "", used: "", total: "" }],
        };
      });
      setSiteInputs(map);
    } catch {
      // 加载失败则置空
      setSiteInputs({});
    }
  };

  // 监听：打开弹窗后加载场地列表
  useEffect(() => {
    if (dataUploadOpen) {
      initSiteInputs();
      setShowNewSiteInput(false);
      setNewSiteName("");
      setEditingSiteId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUploadOpen]);

  // ── 数据录入弹窗已合并到统一上传弹窗 ──
  const handleDataInputSubmit = async () => {
    setDataInputError("");
    const avgWave = parseFloat(dataInputAvgWave);
    const offlineAvgWave = parseFloat(dataInputOfflineAvgWave);
    const totalAvgWave = parseFloat(dataInputTotalAvgWave);

    // 构建 siteDetails
    const siteIds = Object.keys(siteInputs);
    const hasRoomData = siteIds.some((sid) => {
      const d = siteInputs[sid];
      return d.rooms.some((r) => r.typeName.trim() && (r.used || r.total));
    });
    const hasWave = !!dataInputAvgWave;
    const hasOfflineWave = !!dataInputOfflineAvgWave;
    const hasTotalWave = !!dataInputTotalAvgWave;

    if (!hasRoomData && !hasWave && !hasOfflineWave && !hasTotalWave) {
      setDataInputError("请至少填写一项数据");
      return;
    }

    // 校验房间数据
    if (hasRoomData) {
      for (const sid of siteIds) {
        const d = siteInputs[sid];
        for (const r of d.rooms) {
          if (!r.typeName.trim() && !r.used && !r.total) continue;
          if (!r.typeName.trim()) { setDataInputError(`场地 "${d.siteName}" 存在空的房间类型名称`); return; }
          const used = parseInt(r.used, 10);
          const total = parseInt(r.total, 10);
          if ((r.used && (isNaN(used) || used < 0))) { setDataInputError(`"${r.typeName}" 已使用需为有效非负整数`); return; }
          if ((r.total && (isNaN(total) || total < 0))) { setDataInputError(`"${r.typeName}" 总数需为有效非负整数`); return; }
        }
      }
    }
    if ((hasWave || hasOfflineWave || hasTotalWave) && !dataInputDate) {
      setDataInputError("请选择人均音浪的归属日期"); return;
    }
    if (hasWave && (isNaN(avgWave) || avgWave < 0)) { setDataInputError("线上人均音浪需为有效非负数"); return; }
    if (hasOfflineWave && (isNaN(offlineAvgWave) || offlineAvgWave < 0)) { setDataInputError("线下人均音浪需为有效非负数"); return; }
    if (hasTotalWave && (isNaN(totalAvgWave) || totalAvgWave < 0)) { setDataInputError("人均音浪需为有效非负数"); return; }

    setDataInputLoading(true);
    try {
      const tasks: Promise<any>[] = [];
      if (hasRoomData) {
        const siteDetails: SiteDetail[] = siteIds
          .filter((sid) => {
            const d = siteInputs[sid];
            return d.rooms.some((r) => r.typeName.trim() && (r.used || r.total));
          })
          .map((sid) => {
            const d = siteInputs[sid];
            const site = liveRoomSites.find((s) => s.id === sid);
            return {
              siteId: sid,
              siteName: site?.name ?? d.siteName,
              rooms: d.rooms
                .filter((r) => r.typeName.trim() && (r.used || r.total))
                .map((r) => ({
                  typeName: r.typeName.trim(),
                  used: parseInt(r.used, 10) || 0,
                  total: parseInt(r.total, 10) || 0,
                })),
            };
          });
        tasks.push(liveRoomCapacityApi.upsert({ siteDetails }, scopeOrgId));
      }
      if (hasWave) {
        tasks.push(anchorAvgWaveApi.upsert({ recordDate: dataInputDate, avgWaveValue: avgWave, waveType: "online" }, scopeOrgId));
      }
      if (hasOfflineWave) {
        tasks.push(anchorAvgWaveApi.upsert({ recordDate: dataInputDate, avgWaveValue: offlineAvgWave, waveType: "offline" }, scopeOrgId));
      }
      if (hasTotalWave) {
        tasks.push(anchorAvgWaveApi.upsert({ recordDate: dataInputDate, avgWaveValue: totalAvgWave, waveType: "total" }, scopeOrgId));
      }
      await Promise.all(tasks);
      if (hasRoomData) loadRoomCapacity();
      if (hasWave || hasOfflineWave || hasTotalWave) loadAvgWaveTrend();
      loadHallTrend();
      loadLossTrend();
      setDataUploadOpen(false);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || "录入失败";
      setDataInputError(msg);
    } finally {
      setDataInputLoading(false);
    }
  };

  // ── 厅个数上传 ──
  // 厅个数上传已合并到统一上传弹窗 ──
  const handleHallFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setHallUploadFile(file);
  };
  const handleHallConfirmUpload = async () => {
    if (!hallUploadFile) return;
    setHallUploading(true);
    setHallUploadError("");
    try {
      const res = await dataOverviewApi.upload(hallUploadFile, scopeOrgId, hallUploadDate);
      console.log("上传成功:", res);
      setDataUploadOpen(false);
      setHallUploadFile(null);
      if (hallFileInputRef.current) hallFileInputRef.current.value = "";
      loadHallTrend();
      loadLossTrend();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || "上传失败，请检查网络或重试";
      setHallUploadError(msg);
      console.error("上传失败:", e);
    } finally {
      setHallUploading(false);
    }
  };

  // ── 主播数据表上传（统一弹窗 anchor tab） ──
  const handleAnchorFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setAnchorUploadFile(file);
  };
  const handleAnchorConfirmUpload = async () => {
    if (!anchorUploadFile) return;
    setAnchorUploading(true);
    setAnchorUploadError("");
    try {
      await anchorSummaryApi.upload(anchorUploadFile, scopeOrgId, anchorUploadDate);
      setDataUploadOpen(false);
      setAnchorUploadFile(null);
      if (anchorFileInputRef.current) anchorFileInputRef.current.value = "";
      // 触发自定义事件，让 AnchorSummaryCard 刷新
      window.dispatchEvent(new CustomEvent("anchor-summary-refresh"));
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || "上传失败，请检查网络或重试";
      setAnchorUploadError(msg);
    } finally {
      setAnchorUploading(false);
    }
  };

  // ── 历史完成率：state ────────────────────────────────────────────
  type RangeKey = "yesterday" | "last3" | "last7" | "thisMonth";
  const [rangeStats, setRangeStats] = useState<Record<RangeKey, DailyRangeStatsResponse | null>>({
    yesterday: null,
    last3: null,
    last7: null,
    thisMonth: null,
  });
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  // 自定义时间（融合在"本月"行）
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customLabel, setCustomLabel] = useState<string | null>(null); // null = 本月模式
  const [customLoading, setCustomLoading] = useState(false);
  // 悬停的环形图（用于展开团队明细）
  const [hoveredRangeKey, setHoveredRangeKey] = useState<RangeKey | null>(null);

  function getBeijingDateStr(offsetDays = 0): string {
    const now = new Date();
    // UTC+8
    const bjMs = now.getTime() + 8 * 3600 * 1000;
    const bjDate = new Date(bjMs + offsetDays * 86400 * 1000);
    return bjDate.toISOString().slice(0, 10);
  }

  const loadRangeStats = (overrideScopeOrgId?: string) => {
    if (!showDashboard) return;
    const sid = overrideScopeOrgId ?? scopeOrgId;
    if (needsBaseSelect && !sid) return;

    const today = getBeijingDateStr(0);
    const yesterday = getBeijingDateStr(-1);
    const monthStart = `${today.slice(0, 8)}01`;

    // 本月：1号到昨天；若今天是1号则 start > end，直接用 yesterday 也等于 monthStart，返回空数据
    const ranges: Record<RangeKey, { start: string; end: string }> = {
      yesterday: { start: yesterday, end: yesterday },
      last3: { start: getBeijingDateStr(-3), end: yesterday },
      last7: { start: getBeijingDateStr(-7), end: yesterday },
      thisMonth: { start: monthStart, end: yesterday },
    };

    setRangeLoading(true);
    setRangeError(null);

    const keys = Object.keys(ranges) as RangeKey[];
    Promise.all(
      keys.map((key) =>
        reportApi.getDailyRangeStats(ranges[key].start, ranges[key].end, sid).catch(() => null)
      )
    )
      .then((results) => {
        const next = { ...rangeStats };
        keys.forEach((key, i) => { next[key] = results[i] ?? null; });
        setRangeStats(next);
      })
      .catch((e) => setRangeError(e?.message ?? "历史完成率加载失败"))
      .finally(() => setRangeLoading(false));
  };

  // 与今日看板联动：scopeOrgId / selectedBaseOrgId 变化时一起刷新
  useEffect(() => {
    if (needsBaseSelect) return;
    loadRangeStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDashboard, currentIdentity?.id]);

  useEffect(() => {
    if (!needsBaseSelect || !selectedBaseOrgId) return;
    loadRangeStats(selectedBaseOrgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBaseOrgId]);

  // ── 自定义日期查询 / 重置 ──
  const handleCustomQuery = () => {
    if (!customStart || !customEnd) return;
    if (customStart > customEnd) return;
    const sid = scopeOrgId ?? undefined;
    setCustomLoading(true);
    reportApi.getDailyRangeStats(customStart, customEnd, sid)
      .then((res) => {
        setRangeStats((prev) => ({ ...prev, thisMonth: res }));
        setCustomLabel("自定义日期");
        setCustomDateOpen(false);
      })
      .catch(() => {})
      .finally(() => setCustomLoading(false));
  };

  const handleResetToMonth = () => {
    setCustomLabel(null);
    setCustomDateOpen(false);
    const today = getBeijingDateStr(0);
    const yesterday = getBeijingDateStr(-1);
    const monthStart = `${today.slice(0, 8)}01`;
    const sid = scopeOrgId ?? undefined;
    reportApi.getDailyRangeStats(monthStart, yesterday, sid)
      .then((res) => setRangeStats((prev) => ({ ...prev, thisMonth: res })))
      .catch(() => {});
  };

  const RANGE_LABELS: Record<string, string> = {
    yesterday: "昨天",
    last3: "近3天",
    last7: "近7天",
    thisMonth: customLabel ?? "本月",
  };
  const RANGE_KEYS = ["yesterday", "last3", "last7", "thisMonth"] as const;

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
      <div className="relative z-20 overflow-hidden rounded-2xl bg-gradient-to-r from-feishu-blue to-[#7B9DFF] px-6 py-2.5 text-white shadow-[0_14px_40px_rgba(76,114,255,0.28)] isolate">
        <div className="relative z-10 flex items-center gap-2.5">
          {/* 星星按钮（双击打开上传弹窗，hover 呼吸 + tooltip） */}
          <div className="relative group">
            {/* 装饰圆点 */}
            <span className="pointer-events-none absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_0_8px_rgba(252,211,77,0.8)]" />
            {/* 呼吸光圈 */}
            <span className="pointer-events-none absolute inset-0 rounded-lg bg-white/20 animate-ping opacity-0 group-hover:opacity-30" />
            <button
              onDoubleClick={() => {
                const yesterday = getBeijingDateStr(-1);
                setHallUploadDate(yesterday);
                setHallUploadFile(null);
                setHallUploadError("");
                setDataInputDate(yesterday);
                setDataInputAvgWave(""); setDataInputOfflineAvgWave(""); setDataInputTotalAvgWave(""); setDataInputError("");
                setDataUploadTab("excel");
                setDataUploadOpen(true);
              }}
              title="双击打开上传"
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm border border-white/30 transition-all hover:bg-white/30 hover:scale-110 active:scale-95"
            >
              <Sparkles size={17} className="text-white transition-transform group-hover:rotate-12 group-hover:scale-110" />
            </button>
            {/* Tooltip */}
            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
              上传数据（双击）
            </span>
          </div>
          {/* 文字：单行 */}
          <p className="text-[14px] font-medium text-white/90 leading-none">
            您已陪伴千广成长系统
            {days !== null ? (
              <span className="mx-1 text-[20px] font-bold tabular-nums">{days}</span>
            ) : (
              <span className="mx-1 inline-block h-5 w-8 animate-pulse rounded-md bg-white/30 align-middle" />
            )}
            天
            <span className="text-white/50 text-[12px] font-normal ml-1 hidden sm:inline">· 成长协同</span>
          </p>
          {/* 基地切换器（挪到这里） */}
          {needsBaseSelect && baseOrgs.length > 0 && (
            <div className="ml-auto relative z-20">
              <select
                value={selectedBaseOrgId}
                onChange={(e) => setSelectedBaseOrgId(e.target.value)}
                className="appearance-none rounded-lg border border-white/30 bg-white/10 backdrop-blur-sm pl-3 pr-7 py-1.5 text-[12px] text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40 cursor-pointer"
              >
                {baseOrgs.map((b) => (
                  <option key={b.id} value={b.id} className="text-slate-700 bg-white">{b.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/80" />
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-8 right-32 h-24 w-24 rounded-full bg-white/10" />
      </div>

      {/* ── 没有权限时不展示图表 ── */}
      {!showDashboard && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center text-sm text-slate-400">
          更多模块敬请期待…
        </div>
      )}

      {/* ── 历史待办完成率 + 直播间空余 ── */}
      {showDashboard && (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 rounded-2xl border border-slate-100 bg-white shadow-sm">
          {/* 标题行 */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 h-14 border-b border-slate-100">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp size={16} className="text-feishu-blue shrink-0" />
              <span className="text-[14px] font-semibold text-slate-700 truncate">
                {rangeStats.yesterday?.baseOrg.name
                  ? `${rangeStats.yesterday.baseOrg.name} · 主播日常任务完成率（历史）`
                  : "基地看板 · 主播日常任务完成率（历史）"}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {rangeError && (
                <span className="text-[11px] text-red-500">{rangeError}</span>
              )}
              {/* 图例（已合并到标题行，节省高度） */}
              <span className="hidden lg:flex items-center gap-2 text-[11px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                  已完成
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-200" />
                  未完成
                </span>
              </span>
              {/* 进入看板（已合并到标题行，节省高度） */}
              <button
                onClick={() => navigate(`/tasks/dashboard/daily-board?taskDate=${getBeijingDateStr(-1)}&scopeOrgId=${scopeOrgId ?? ""}`)}
                className="flex items-center gap-1 rounded-lg border border-feishu-blue/30 bg-feishu-blue/5 px-2.5 py-1 text-[11px] font-medium text-feishu-blue hover:bg-feishu-blue/10 transition-colors"
              >
                进入看板 →
              </button>
              <button
                onClick={() => loadRangeStats()}
                disabled={rangeLoading}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={12} className={rangeLoading ? "animate-spin" : ""} />
                刷新
              </button>
            </div>
          </div>

          {/* 环形图区域 */}
          {rangeLoading && !rangeStats.yesterday ? (
            <div className="px-5 py-8">
              <div className="grid grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-3">
                    <div className="w-[120px] h-[120px] rounded-full animate-pulse bg-slate-100" />
                    <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
                    <div className="h-2 w-20 animate-pulse rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-5 pt-5 pb-3">
              <div className="grid grid-cols-4 gap-2">
                {RANGE_KEYS.map((key) => {
                  const data = rangeStats[key];
                  const label = RANGE_LABELS[key];
                  const isThisMonth = key === "thisMonth";
                  const isHovered = hoveredRangeKey === key;
                  const hasTeams = (data?.teams?.length ?? 0) > 0;
                  return (
                    <div
                      key={key}
                      className={`relative flex flex-col items-center rounded-xl py-3 px-1 transition-colors cursor-default ${
                        isHovered ? "bg-slate-100" : "bg-slate-50/50 hover:bg-slate-100/50"
                      }`}
                      onMouseEnter={() => setHoveredRangeKey(key)}
                      onMouseLeave={() => setHoveredRangeKey((prev) => (prev === key ? null : prev))}
                    >
                      <SummaryDonut data={data} label={label}>
                        {isThisMonth && (
                          <button
                            title={customLabel ? "重置为本月" : "自定义日期"}
                            onClick={() => {
                              if (customLabel) {
                                handleResetToMonth();
                              } else {
                                setCustomDateOpen((v) => !v);
                              }
                            }}
                            className={`mt-1 rounded-full px-2.5 py-0.5 text-[11px] leading-none transition-colors border ${
                              customLabel
                                ? "bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200"
                                : "bg-blue-50 text-blue-500 border-blue-300 hover:bg-blue-100"
                            }`}
                          >
                            {customLabel ? "重置" : "自定义日期"}
                          </button>
                        )}
                      </SummaryDonut>

                      {/* 悬浮浮层：团队明细（不推动布局） */}
                      {isHovered && hasTeams && data && (
                        <div className="absolute left-0 right-0 top-full mt-2 z-20 bg-white border border-slate-200 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-3 space-y-1.5 min-w-[260px]">
                          <p className="text-[11px] font-semibold text-slate-500 mb-2">{label} · 团队明细</p>
                          {data.teams.map((team) => {
                            const teamColor = rateColor(team.completionRate);
                            return (
                              <div key={team.orgId} className="flex items-center gap-2 text-[11px]">
                                <span className="w-[64px] shrink-0 text-slate-600 font-medium truncate" title={team.orgName}>
                                  {team.orgName}
                                </span>
                                <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{ width: `${team.completionRate}%`, backgroundColor: teamColor }}
                                  />
                                </div>
                                <span className="w-[34px] shrink-0 text-right font-bold tabular-nums" style={{ color: teamColor }}>
                                  {team.completionRate}%
                                </span>
                                <span className="w-[42px] shrink-0 text-right text-slate-400 tabular-nums">
                                  {team.completed}/{team.total}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 自定义日期面板 */}
              {customDateOpen && (
                <div className="mt-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 focus:outline-none focus:border-feishu-blue"
                  />
                  <span className="text-[12px] text-slate-400">至</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 focus:outline-none focus:border-feishu-blue"
                  />
                  <button
                    onClick={handleCustomQuery}
                    disabled={!customStart || !customEnd || customStart > customEnd || customLoading}
                    className="rounded-lg bg-feishu-blue px-3 py-1 text-[12px] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {customLoading ? "查询中…" : "查询"}
                  </button>
                  <button
                    onClick={() => setCustomDateOpen(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-[12px] text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    取消
                  </button>
                </div>
              )}

              {/* 底部图例 + 进入看板 已合并到标题行（节省高度） */}
            </div>
          )}
        </div>

          {/* 右侧：基地直播间空余 — 按场地分组 */}
          <div className="lg:col-span-2 flex flex-col gap-3 h-full min-h-0">
            <div className="flex items-center gap-2 shrink-0">
              <Building2 size={16} className="text-feishu-blue shrink-0" />
              <span className="text-[14px] font-semibold text-slate-700">基地直播间空余</span>
            </div>
            {(() => {
              const cap = roomCapacity;
              const details = cap?.siteDetails ?? [];
              if (!cap || details.length === 0) {
                return (
                  <div className="flex-1 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center gap-2 text-slate-400 text-[13px] py-10">
                    <Building2 size={28} className="text-slate-300" />
                    <span>暂无数据</span>
                    <span className="text-[11px]">点击左上角星星按钮「双击」录入数据</span>
                  </div>
                );
              }
              // 颜色池
              const typeColors = [
                "bg-emerald-500", "bg-blue-500", "bg-amber-500", "bg-violet-500",
                "bg-rose-500", "bg-cyan-500", "bg-orange-500", "bg-pink-500",
              ];
              return (
                <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory -mx-1 px-1 scrollbar-thin flex-1 min-h-0 items-stretch">
                  {details.map((sd, si) => {
                    const siteName = sd.siteName || "未命名";
                    const rooms = sd.rooms ?? [];
                    const grandTotal = rooms.reduce((s, r) => s + (r.total || 0), 0);
                    const grandUsed = rooms.reduce((s, r) => s + (r.used || 0), 0);
                    const grandSpare = Math.max(0, grandTotal - grandUsed);
                    return (
                      <div key={sd.siteId || si} className="shrink-0 snap-start rounded-2xl border border-slate-100 bg-gradient-to-br from-[#0a1a3a] to-[#102a5e] text-white px-5 py-4 shadow-sm" style={{ width: "calc(50% - 6px)" }}>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                            <span className="text-[13px] font-semibold truncate">{siteName}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 shrink-0 tabular-nums">
                            <span>总 <strong className="text-white text-[12px] ml-0.5">{grandTotal}</strong></span>
                            <span className="text-sky-300">已用 <strong className="text-sky-300 text-[12px] ml-0.5">{grandUsed}</strong></span>
                            <span className="text-emerald-300">空余 <strong className="text-emerald-300 text-[12px] ml-0.5">{grandSpare}</strong></span>
                          </div>
                        </div>
                        {/* 房间类型行 */}
                        <div className="space-y-2">
                          {rooms.map((r, ri) => {
                            const pct = r.total > 0 ? Math.round((r.used / r.total) * 100) : 0;
                            const colorIdx = ri % typeColors.length;
                            return (
                              <div key={ri}>
                                <div className="flex justify-between text-[12px] mb-0.5">
                                  <span className="text-slate-300">{r.typeName}</span>
                                  <span className="tabular-nums">
                                    <span className="text-white font-semibold">{r.used}</span>
                                    <span className="text-slate-500">/{r.total}</span>
                                    <span className="ml-1.5 text-[11px] text-slate-400">{pct}%</span>
                                  </span>
                                </div>
                                <div className="h-1.5 rounded-full bg-slate-700/40 overflow-hidden">
                                  <div className={`h-full rounded-full ${typeColors[colorIdx]}`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
        </>
      )}

      {/* ── 主播运营 KPI 概览 ── */}
      {showDashboard && (() => {
        const pts = hallTrend?.points ?? [];
        const latestItem = pts.length > 0 ? pts[pts.length - 1] : null;
        const prevItem = pts.length > 1 ? pts[pts.length - 2] : null;
        const formalCount = latestItem?.formalHallCount ?? 0;
        const trainingCount = latestItem?.trainingHallCount ?? 0;
        const formalChange = prevItem ? formalCount - prevItem.formalHallCount : 0;
        const trainingChange = prevItem ? trainingCount - prevItem.trainingHallCount : 0;

        // 厅运营明细
        const operatorStats: HallOperatorStat[] = (hallTrend?.latest?.operatorStats as HallOperatorStat[]) ?? [];
        const prevDayOperatorStats: HallOperatorStat[] = (hallTrend?.prevDay?.operatorStats as HallOperatorStat[]) ?? [];

        // 主播流失数据
        const lossLatest = lossTrend?.latest;
        const lossCount = lossLatest?.lossWithin30Days ?? 0;
        const lossYesterday = lossLatest?.lossYesterday ?? 0;

        return (
        <div className="space-y-3">
          {/* KPI 卡片 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 正式厅：悬停展示运营占比明细 */}
            <div
              ref={formalKpiRef}
              onMouseEnter={() => setHoveredHallKpi("formal")}
              onMouseLeave={() => setHoveredHallKpi(null)}
              className="flex-1 min-w-[180px] relative"
            >
              <AnchorLiveKpiCard
                icon={<Building2 size={18} />}
                label="正式厅"
                value={formalCount}
                unit="个"
                change={formalChange}
                iconColor="text-blue-600"
                iconBg="bg-blue-50"
              />
              {hoveredHallKpi === "formal" && operatorStats.length > 0 && (
                <HallOperatorPopover
                  field="formal"
                  recordDate={hallTrend?.latest?.recordDate ?? ""}
                  operators={operatorStats}
                  prevDayOperators={prevDayOperatorStats}
                  cardRef={formalKpiRef}
                />
              )}
              {hoveredHallKpi === "formal" && operatorStats.length === 0 && (() => {
                const r = formalKpiRef.current?.getBoundingClientRect();
                if (!r) return null;
                const VIEWPORT_W = window.innerWidth;
                const showOnRight = VIEWPORT_W - r.right >= 360 + 12;
                const emptyLeft = showOnRight ? r.right + 12 : Math.max(12, r.left - 360 - 12);
                return (
                  <div
                    className="fixed z-50 rounded-xl bg-white border-2 border-slate-300 overflow-hidden"
                    style={{
                      top: r.top,
                      left: emptyLeft,
                      width: 360,
                      boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
                    }}
                  >
                    <div className="flex items-center px-4 py-2 border-b border-slate-200 bg-slate-50">
                      <span className="text-[13px] font-semibold text-slate-700">正式厅 · 按运营占比排序</span>
                    </div>
                    <div className="px-4 py-8 text-center">
                      <p className="text-[12px] text-slate-400 mb-2">暂无运营明细</p>
                      <p className="text-[11px] text-slate-300">请点击右上角「上传数据看板」录入每日快照</p>
                    </div>
                  </div>
                );
              })()}
            </div>
            {/* 训练厅：悬停展示运营占比明细 */}
            <div
              ref={trainingKpiRef}
              onMouseEnter={() => setHoveredHallKpi("training")}
              onMouseLeave={() => setHoveredHallKpi(null)}
              className="flex-1 min-w-[180px] relative"
            >
              <AnchorLiveKpiCard
                icon={<GraduationCap size={18} />}
                label="训练厅"
                value={trainingCount}
                unit="个"
                change={trainingChange}
                iconColor="text-emerald-600"
                iconBg="bg-emerald-50"
              />
              {hoveredHallKpi === "training" && operatorStats.length > 0 && (
                <HallOperatorPopover
                  field="training"
                  recordDate={hallTrend?.latest?.recordDate ?? ""}
                  operators={operatorStats}
                  prevDayOperators={prevDayOperatorStats}
                  cardRef={trainingKpiRef}
                />
              )}
              {hoveredHallKpi === "training" && operatorStats.length === 0 && (() => {
                const r = trainingKpiRef.current?.getBoundingClientRect();
                if (!r) return null;
                const VIEWPORT_W = window.innerWidth;
                const showOnRight = VIEWPORT_W - r.right >= 360 + 12;
                const emptyLeft = showOnRight ? r.right + 12 : Math.max(12, r.left - 360 - 12);
                return (
                <div
                  className="fixed z-50 rounded-xl bg-white border-2 border-slate-300 overflow-hidden"
                  style={{
                    top: r.top,
                    left: emptyLeft,
                    width: 360,
                    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
                  }}
                >
                  <div className="flex items-center px-4 py-2 border-b border-slate-200 bg-slate-50">
                    <span className="text-[13px] font-semibold text-slate-700">训练厅 · 按运营占比排序</span>
                  </div>
                  <div className="px-4 py-8 text-center">
                    <p className="text-[12px] text-slate-400 mb-2">暂无运营明细</p>
                    <p className="text-[11px] text-slate-300">请点击右上角「上传数据看板」录入每日快照</p>
                  </div>
                </div>
                );
              })()}
            </div>
            <div
              ref={lossKpiRef}
              onMouseEnter={() => setHoveredLossKpi(true)}
              onMouseLeave={() => setHoveredLossKpi(false)}
              className="flex-1 min-w-[180px] relative"
            >
            <AnchorLiveKpiCard
              icon={<UserMinus size={18} />}
              label="近30天主播流失"
              value={lossCount || "--"}
              unit="人"
              change={lossYesterday}
              changeLabel="昨日流失"
              iconColor="text-red-500"
              iconBg="bg-red-50"
            />
              {hoveredLossKpi && (
                <LossTrendPopover
                  lossDetail={(lossLatest?.lossDetail as Record<string, number>) || {}}
                  lossOperatorDetail={(lossLatest?.lossOperatorDetail as Record<string, Record<string, number>>) || {}}
                  anchorDate={lossLatest?.recordDate ?? ""}
                  cardRef={lossKpiRef}
                />
              )}
            </div>
            <div
              ref={waveKpiRef}
              onMouseEnter={() => setHoveredWaveKpi(true)}
              onMouseLeave={() => setHoveredWaveKpi(false)}
              className="flex-1 min-w-[180px] relative"
            >
              <AnchorLiveKpiCard
                icon={<Zap size={18} />}
                label="线下人均音浪"
                value={(() => {
                  const off = avgWaveTrend?.offline?.latest;
                  return off ? off.avgWaveValue.toFixed(1) : "--";
                })()}
                unit="万"
                change={avgWaveTrend?.online?.latest ? Number(avgWaveTrend.online.latest.avgWaveValue.toFixed(1)) : 0}
                changeLabel="线上"
                secondaryChange={avgWaveTrend?.total?.latest ? Number(avgWaveTrend.total.latest.avgWaveValue.toFixed(1)) : 0}
                secondaryLabel="人均"
                trendChange={avgWaveTrend?.offline?.change}
                iconColor="text-amber-600"
                iconBg="bg-amber-50"
              />
              {hoveredWaveKpi && avgWaveTrend && (
                <WaveTrendPopover
                  online={avgWaveTrend.online}
                  offline={avgWaveTrend.offline}
                  total={avgWaveTrend.total}
                  cardRef={waveKpiRef}
                />
              )}
            </div>
          </div>

          {/* 统一上传弹窗（厅数据/流失表 / 主播数据表 / 数值录入） */}
          {dataUploadOpen && (() => {
            const isExcel = dataUploadTab === "excel";
            const isAnchor = dataUploadTab === "anchor";
            const isManual = dataUploadTab === "manual";
            const close = () => {
              if ((isExcel && hallUploading) || (isAnchor && anchorUploading) || (isManual && dataInputLoading)) return;
              setDataUploadOpen(false);
              setHallUploadFile(null);
              setAnchorUploadFile(null);
              if (hallFileInputRef.current) hallFileInputRef.current.value = "";
              if (anchorFileInputRef.current) anchorFileInputRef.current.value = "";
            };
            const tabCls = (active: boolean, color: "blue" | "violet" | "amber") => {
              if (!active) return "text-slate-500 hover:bg-slate-50";
              if (color === "blue") return "text-feishu-blue border-b-2 border-feishu-blue bg-feishu-blue/5";
              if (color === "violet") return "text-violet-600 border-b-2 border-violet-400 bg-violet-50/50";
              return "text-amber-600 border-b-2 border-amber-400 bg-amber-50/50";
            };
            return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
              onClick={close}
            >
              <div
                className="w-[480px] max-w-[90vw] rounded-2xl bg-white shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Tab 切换 */}
                <div className="flex border-b border-slate-200">
                  <button
                    onClick={() => setDataUploadTab("excel")}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-10 text-[12px] font-medium transition-colors ${tabCls(isExcel, "blue")}`}
                  >
                    <Upload size={13} />
                    厅数据 / 流失表
                  </button>
                  <button
                    onClick={() => setDataUploadTab("anchor")}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-10 text-[12px] font-medium transition-colors ${tabCls(isAnchor, "violet")}`}
                  >
                    <Users size={13} />
                    主播数据表
                  </button>
                  <button
                    onClick={() => setDataUploadTab("manual")}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-10 text-[12px] font-medium transition-colors ${tabCls(isManual, "amber")}`}
                  >
                    <FileSpreadsheet size={13} />
                    数值录入
                  </button>
                  <button
                    onClick={close}
                    disabled={isExcel ? hallUploading : isAnchor ? anchorUploading : dataInputLoading}
                    className="flex items-center justify-center w-10 h-10 text-slate-400 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <X size={16} />
                  </button>
                </div>

                {isExcel ? (
                  /* ── 厅数据 / 流失表 ── */
                  <>
                    <div className="px-6 py-5 space-y-4">
                      <div>
                        <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 mb-1.5">
                          <Calendar size={12} className="text-slate-400" />
                          数据归属日期 <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          value={hallUploadDate}
                          onChange={(e) => setHallUploadDate(e.target.value)}
                          max={getBeijingDateStr(0)}
                          className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/20"
                        />
                        <p className="mt-1 text-[11px] text-slate-400">
                          自动解析 <b>「厅个数」</b>和<b>「主播流失」</b>两个工作表
                        </p>
                      </div>

                      <div>
                        <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 mb-1.5">
                          <FileSpreadsheet size={12} className="text-slate-400" />
                          选择文件 <span className="text-red-500">*</span>
                        </label>
                        <input ref={hallFileInputRef} type="file" accept=".xlsx,.xls" onChange={handleHallFileChange} className="hidden" />
                        <button
                          onClick={() => hallFileInputRef.current?.click()}
                          className="w-full h-20 rounded-lg border-2 border-dashed border-slate-200 hover:border-feishu-blue hover:bg-feishu-blue/5 transition-colors flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-feishu-blue"
                        >
                          {hallUploadFile ? (
                            <>
                              <FileSpreadsheet size={20} className="text-feishu-blue" />
                              <span className="text-[12px] font-medium text-slate-700 truncate max-w-[300px]">{hallUploadFile.name}</span>
                              <span className="text-[10px] text-slate-400">{(hallUploadFile.size / 1024).toFixed(1)} KB · 点击重新选择</span>
                            </>
                          ) : (
                            <>
                              <Upload size={20} />
                              <span className="text-[12px]">点击选择 .xlsx / .xls 文件</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {hallUploadError && (
                      <div className="px-6 py-2 text-[12px] text-red-600 bg-red-50 border-b border-red-100">{hallUploadError}</div>
                    )}

                    <div className="flex items-center justify-end gap-2 px-6 py-3 bg-slate-50 border-t border-slate-100">
                      <button onClick={close} disabled={hallUploading} className="px-4 h-8 rounded-lg border border-slate-200 bg-white text-[12px] text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors">取消</button>
                      <button onClick={handleHallConfirmUpload} disabled={hallUploading || !hallUploadFile || !hallUploadDate}
                        className="flex items-center gap-1.5 px-4 h-8 rounded-lg bg-feishu-blue text-[12px] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                      >
                        {hallUploading ? <><RefreshCw size={12} className="animate-spin" />上传中…</> : <><Upload size={12} />确认上传</>}
                      </button>
                    </div>
                  </>
                ) : isAnchor ? (
                  /* ── 主播数据表 ── */
                  <>
                    <div className="px-6 py-5 space-y-4">
                      <div>
                        <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 mb-1.5">
                          <Calendar size={12} className="text-slate-400" />
                          数据归属日期 <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          value={anchorUploadDate}
                          onChange={(e) => setAnchorUploadDate(e.target.value)}
                          max={getBeijingDateStr(-1)}
                          className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
                        />
                        <p className="mt-1 text-[11px] text-slate-400">
                          上传的数据将归属到此日期，趋势图按此日期绘制
                        </p>
                      </div>

                      <div>
                        <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 mb-1.5">
                          <FileSpreadsheet size={12} className="text-slate-400" />
                          选择文件 <span className="text-red-500">*</span>
                        </label>
                        <input ref={anchorFileInputRef} type="file" accept=".xlsx,.xls" onChange={handleAnchorFileChange} className="hidden" />
                        <button
                          onClick={() => anchorFileInputRef.current?.click()}
                          className="w-full h-20 rounded-lg border-2 border-dashed border-slate-200 hover:border-violet-400 hover:bg-violet-50/50 transition-colors flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-violet-600"
                        >
                          {anchorUploadFile ? (
                            <>
                              <FileSpreadsheet size={20} className="text-violet-500" />
                              <span className="text-[12px] font-medium text-slate-700 truncate max-w-[300px]">{anchorUploadFile.name}</span>
                              <span className="text-[10px] text-slate-400">{(anchorUploadFile.size / 1024).toFixed(1)} KB · 点击重新选择</span>
                            </>
                          ) : (
                            <>
                              <Upload size={20} />
                              <span className="text-[12px]">点击选择 .xlsx / .xls 文件</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {anchorUploadError && (
                      <div className="px-6 py-2 text-[12px] text-red-600 bg-red-50 border-b border-red-100">{anchorUploadError}</div>
                    )}

                    <div className="flex items-center justify-end gap-2 px-6 py-3 bg-slate-50 border-t border-slate-100">
                      <button onClick={close} disabled={anchorUploading} className="px-4 h-8 rounded-lg border border-slate-200 bg-white text-[12px] text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors">取消</button>
                      <button onClick={handleAnchorConfirmUpload} disabled={anchorUploading || !anchorUploadFile || !anchorUploadDate}
                        className="flex items-center gap-1.5 px-4 h-8 rounded-lg bg-violet-500 text-[12px] text-white hover:bg-violet-600 disabled:opacity-40 transition-colors"
                      >
                        {anchorUploading ? <><RefreshCw size={12} className="animate-spin" />上传中…</> : <><Upload size={12} />确认上传</>}
                      </button>
                    </div>
                  </>
                ) : (
                  /* ── 数值录入 ── */
                  <>
                    <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
                      {/* 直播间空余 */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-3">
                          <Building2 size={14} className="text-sky-600" />
                          <span className="text-[13px] font-semibold text-slate-700">基地直播间空余 <span className="text-[10px] font-normal text-slate-400">(覆盖式)</span></span>
                        </div>

                        {liveRoomSites.length === 0 ? (
                          <div className="text-center text-[12px] text-slate-400 py-4">
                            暂无场地，请先添加场地
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {liveRoomSites.map((site) => {
                              const input = siteInputs[site.id];
                              if (!input) return null;
                              const isEditing = editingSiteId === site.id;
                              return (
                                <div key={site.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                                  {/* 场地名行 */}
                                  <div className="flex items-center gap-1.5">
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        value={editingSiteName}
                                        onChange={(e) => setEditingSiteName(e.target.value)}
                                        onBlur={async () => {
                                          if (editingSiteName.trim() && editingSiteName.trim() !== site.name) {
                                            try {
                                              await liveRoomSiteApi.update(site.id, { name: editingSiteName.trim() });
                                              setLiveRoomSites((prev) => prev.map((s) => s.id === site.id ? { ...s, name: editingSiteName.trim() } : s));
                                              setSiteInputs((prev) => ({ ...prev, [site.id]: { ...prev[site.id], siteName: editingSiteName.trim() } }));
                                            } catch (e: any) {
                                              setDataInputError(e?.response?.data?.message || "改名失败");
                                            }
                                          }
                                          setEditingSiteId(null);
                                        }}
                                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                        className="flex-1 h-7 rounded border border-slate-300 bg-white px-2 text-[12px] text-slate-700 focus:outline-none focus:border-sky-400"
                                        autoFocus
                                      />
                                    ) : (
                                      <>
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                                        <span className="flex-1 text-[12px] font-semibold text-slate-600 truncate">{site.name}</span>
                                        <button
                                          onClick={() => { setEditingSiteId(site.id); setEditingSiteName(site.name); }}
                                          title="重命名"
                                          className="text-slate-400 hover:text-sky-500 p-0.5"
                                        >✏</button>
                                        <button
                                          onClick={async () => {
                                            if (!confirm(`确定删除场地「${site.name}」？`)) return;
                                            try {
                                              await liveRoomSiteApi.delete(site.id);
                                              setLiveRoomSites((prev) => prev.filter((s) => s.id !== site.id));
                                              setSiteInputs((prev) => { const n = { ...prev }; delete n[site.id]; return n; });
                                            } catch (e: any) { setDataInputError(e?.response?.data?.message || "删除失败"); }
                                          }}
                                          title="删除"
                                          className="text-slate-400 hover:text-red-500 p-0.5"
                                        >🗑</button>
                                      </>
                                    )}
                                  </div>
                                  {/* 房间类型表头 */}
                                  <div className="grid grid-cols-[1fr_80px_80px_28px] gap-1.5 items-center text-[10px] text-slate-400">
                                    <span>类型名称</span>
                                    <span className="text-center">已使用</span>
                                    <span className="text-center">总数</span>
                                    <span />
                                  </div>
                                  {/* 房间类型行 */}
                                  {input.rooms.map((row, ri) => (
                                    <div key={row.key} className="grid grid-cols-[1fr_80px_80px_28px] gap-1.5 items-center">
                                      <input
                                        type="text"
                                        value={row.typeName}
                                        onChange={(e) => {
                                          const newRows = [...input.rooms];
                                          newRows[ri] = { ...newRows[ri], typeName: e.target.value };
                                          setSiteInputs((prev) => ({ ...prev, [site.id]: { ...prev[site.id], rooms: newRows } }));
                                        }}
                                        placeholder="如：直播间"
                                        className="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] text-slate-700 focus:outline-none focus:border-sky-400"
                                      />
                                      <input
                                        type="number" min="0"
                                        value={row.used}
                                        onChange={(e) => {
                                          const newRows = [...input.rooms];
                                          newRows[ri] = { ...newRows[ri], used: e.target.value };
                                          setSiteInputs((prev) => ({ ...prev, [site.id]: { ...prev[site.id], rooms: newRows } }));
                                        }}
                                        placeholder="0"
                                        className="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] text-slate-700 text-center focus:outline-none focus:border-sky-400"
                                      />
                                      <input
                                        type="number" min="0"
                                        value={row.total}
                                        onChange={(e) => {
                                          const newRows = [...input.rooms];
                                          newRows[ri] = { ...newRows[ri], total: e.target.value };
                                          setSiteInputs((prev) => ({ ...prev, [site.id]: { ...prev[site.id], rooms: newRows } }));
                                        }}
                                        placeholder="0"
                                        className="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] text-slate-700 text-center focus:outline-none focus:border-sky-400"
                                      />
                                      <button
                                        onClick={() => {
                                          const newRows = input.rooms.filter((_, i) => i !== ri);
                                          if (newRows.length === 0) newRows.push({ key: nextRowKey(), typeName: "", used: "", total: "" });
                                          setSiteInputs((prev) => ({ ...prev, [site.id]: { ...prev[site.id], rooms: newRows } }));
                                        }}
                                        className="text-[11px] text-slate-400 hover:text-red-500"
                                      >✕</button>
                                    </div>
                                  ))}
                                  <button
                                    onClick={() => {
                                      const newRows = [...input.rooms, { key: nextRowKey(), typeName: "", used: "", total: "" }];
                                      setSiteInputs((prev) => ({ ...prev, [site.id]: { ...prev[site.id], rooms: newRows } }));
                                    }}
                                    className="text-[11px] text-sky-600 hover:text-sky-700 font-medium"
                                  >
                                    + 添加类型
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* 新增场地 */}
                        {showNewSiteInput ? (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              type="text"
                              value={newSiteName}
                              onChange={(e) => setNewSiteName(e.target.value)}
                              placeholder="输入场地名称"
                              className="flex-1 h-8 rounded border border-slate-200 bg-white px-2 text-[12px] text-slate-700 focus:outline-none focus:border-sky-400"
                              onKeyDown={async (e) => {
                                if (e.key === "Enter") {
                                  if (!newSiteName.trim()) return;
                                  try {
                                    const site = await liveRoomSiteApi.create({ name: newSiteName.trim() }, scopeOrgId);
                                    setLiveRoomSites((prev) => [...prev, site]);
                                    setSiteInputs((prev) => ({ ...prev, [site.id]: { siteName: site.name, rooms: [{ key: nextRowKey(), typeName: "", used: "", total: "" }] } }));
                                    setShowNewSiteInput(false);
                                    setNewSiteName("");
                                  } catch (e: any) { setDataInputError(e?.response?.data?.message || "创建失败"); }
                                }
                              }}
                              autoFocus
                            />
                            <button
                              onClick={async () => {
                                if (!newSiteName.trim()) return;
                                try {
                                  const site = await liveRoomSiteApi.create({ name: newSiteName.trim() }, scopeOrgId);
                                  setLiveRoomSites((prev) => [...prev, site]);
                                  setSiteInputs((prev) => ({ ...prev, [site.id]: { siteName: site.name, rooms: [{ key: nextRowKey(), typeName: "", used: "", total: "" }] } }));
                                  setShowNewSiteInput(false);
                                  setNewSiteName("");
                                } catch (e: any) { setDataInputError(e?.response?.data?.message || "创建失败"); }
                              }}
                              className="h-8 px-3 rounded-lg bg-sky-500 text-[12px] text-white hover:bg-sky-600"
                            >
                              确定
                            </button>
                            <button onClick={() => { setShowNewSiteInput(false); setNewSiteName(""); }} className="h-8 px-2 rounded-lg text-[12px] text-slate-400 hover:text-slate-600">取消</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowNewSiteInput(true)}
                            className="mt-2 flex items-center gap-1 text-[12px] text-sky-600 hover:text-sky-700 font-medium"
                          >
                            + 新增场地
                          </button>
                        )}
                      </div>

                      <div className="border-t border-slate-100" />

                      {/* 人均音浪 */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Zap size={14} className="text-amber-500" />
                          <span className="text-[13px] font-semibold text-slate-700">人均音浪 <span className="text-[10px] font-normal text-slate-400">(每日记录)</span></span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div>
                            <label className="text-[11px] text-slate-500 mb-0.5 block"><Calendar size={10} className="inline mr-0.5 text-slate-400" />数据日期</label>
                            <input type="date" value={dataInputDate} onChange={(e) => setDataInputDate(e.target.value)} max={getBeijingDateStr(0)}
                              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500 mb-0.5 block">线下人均音浪（万）</label>
                            <input type="number" step="0.1" min="0" value={dataInputOfflineAvgWave} onChange={(e) => setDataInputOfflineAvgWave(e.target.value)} placeholder="8.3"
                              className="w-24 h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500 mb-0.5 block">线上人均音浪（万）</label>
                            <input type="number" step="0.1" min="0" value={dataInputAvgWave} onChange={(e) => setDataInputAvgWave(e.target.value)} placeholder="12.5"
                              className="w-24 h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500 mb-0.5 block">人均音浪（万）</label>
                            <input type="number" step="0.1" min="0" value={dataInputTotalAvgWave} onChange={(e) => setDataInputTotalAvgWave(e.target.value)} placeholder="10.4"
                              className="w-24 h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {dataInputError && (
                      <div className="px-6 py-2 text-[12px] text-red-600 bg-red-50 border-b border-red-100">{dataInputError}</div>
                    )}

                    <div className="flex items-center justify-end gap-2 px-6 py-3 bg-slate-50 border-t border-slate-100">
                      <button onClick={close} disabled={dataInputLoading} className="px-4 h-8 rounded-lg border border-slate-200 bg-white text-[12px] text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors">取消</button>
                      <button onClick={handleDataInputSubmit} disabled={dataInputLoading}
                        className="flex items-center gap-1.5 px-4 h-8 rounded-lg bg-amber-600 text-[12px] text-white hover:bg-amber-700 disabled:opacity-40 transition-colors"
                      >
                        {dataInputLoading ? <><RefreshCw size={12} className="animate-spin" />提交中…</> : "确认提交"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            );
          })()}

        </div>
        );
      })()}

      {/* ── 基地主播趋势图：独占一行 ── */}
      {showDashboard && (
        <AnchorSummaryCard scopeOrgId={scopeOrgId} />
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
