import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronRight, Copy, FolderClock, Loader2, Power, PowerOff, Send, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { Identity, OrgUnit, TaskAssignment } from "../../../types";
import { fetchOrgTree } from "../../../services/organization";
import { assignmentApi, templateApi } from "../../../services/task";
import { orgTypeMeta } from "../../../shared/constants/org";
import { temporaryModeMeta } from "../../../shared/constants/taskTemporary";
import { useIdentityStore } from "../../../stores/identityStore";

const dailyStatusMeta: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-amber-50 text-amber-600" },
  scheduled: { label: "待生效", cls: "bg-cyan-50 text-cyan-600" },
  active: { label: "正式任务", cls: "bg-emerald-50 text-emerald-600" },
  ended: { label: "已结束", cls: "bg-slate-100 text-slate-500" },
  deleted: { label: "已删除", cls: "bg-red-50 text-red-500" },
};

const publishedAssignmentStatus = "active,scheduled,ended,deleted";

function formatTime(value?: string) {
  if (!value) return "未设置";
  return new Date(value).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatPublisher(assignment: TaskAssignment) {
  if (!assignment.publisher) return "未记录";
  return assignment.publisher.label || assignment.publisher.nickname || "未记录";
}

function getExclusionSummary(assignment: TaskAssignment) {

  const orgCount = (assignment.exclusions ?? []).filter((item) => item.exclusionType === "ORG").length;
  const anchorCount = (assignment.exclusions ?? []).filter((item) => item.exclusionType === "ANCHOR").length;
  return { orgCount, anchorCount };
}

function isOrgWithinScope(org: OrgUnit, scopePath?: string) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`);
}

function getAvailableBaseOrgs(orgs: OrgUnit[], identity?: Identity) {
  return orgs
    .filter((org) => org.status === "active" && org.orgType === "BASE" && isOrgWithinScope(org, identity?.scopePath))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function findBaseByOrgId(orgs: OrgUnit[], orgId?: string) {
  if (!orgId) return null;
  let current: OrgUnit | null = orgs.find((org) => org.id === orgId) ?? null;
  while (current && current.orgType !== "BASE") {
    const parentId = current.parentId;
    current = parentId ? orgs.find((org) => org.id === parentId) ?? null : null;
  }
  return current;
}

export function TaskAssignmentManagePage({ initialTab = "DAILY" }: { initialTab?: "DAILY" | "TEMPORARY" }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const permissions = useIdentityStore((state) => state.permissions);
  const initialScopeOrgId = searchParams.get("scopeOrgId") ?? "";

  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [selectedScopeOrgId, setSelectedScopeOrgId] = useState(initialScopeOrgId);
  const [loading, setLoading] = useState(true);
  const [orgLoading, setOrgLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"DAILY" | "TEMPORARY">(initialTab);
  const [notice, setNotice] = useState("");

  const canManageAssignments = permissions.includes("*") || permissions.includes("task:assignment:manage");
  const canManageTemplates = permissions.includes("*") || permissions.includes("task:template:manage");
  const canManageDaily = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"].includes(currentIdentity?.roleCode ?? "");
  const availableBaseOrgs = useMemo(() => getAvailableBaseOrgs(orgs, currentIdentity), [orgs, currentIdentity]);
  const selectedScopeOrg = useMemo(() => orgs.find((org) => org.id === selectedScopeOrgId) ?? null, [orgs, selectedScopeOrgId]);
  const requiresBaseSelection = tab === "DAILY";

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let cancelled = false;
    setOrgLoading(true);
    fetchOrgTree()
      .then((rows) => {
        if (!cancelled) setOrgs(rows);
      })
      .catch(() => {
        if (!cancelled) setOrgs([]);
      })
      .finally(() => {
        if (!cancelled) setOrgLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const validIds = new Set(availableBaseOrgs.map((org) => org.id));
    if (selectedScopeOrgId && validIds.has(selectedScopeOrgId)) return;
    const fallbackCandidates = [
      initialScopeOrgId,
      findBaseByOrgId(orgs, currentIdentity?.orgId)?.id ?? "",
      availableBaseOrgs.length === 1 ? availableBaseOrgs[0].id : "",
    ].filter((value): value is string => Boolean(value));
    const nextScopeOrgId = fallbackCandidates.find((value) => validIds.has(value)) ?? "";
    if (nextScopeOrgId !== selectedScopeOrgId) setSelectedScopeOrgId(nextScopeOrgId);
  }, [availableBaseOrgs, currentIdentity?.orgId, initialScopeOrgId, orgs, selectedScopeOrgId]);

  async function loadData() {
    if (requiresBaseSelection && !selectedScopeOrgId) {
      setAssignments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const rows = await assignmentApi
      .list({ ...(selectedScopeOrgId ? { scopeOrgId: selectedScopeOrgId } : {}), status: publishedAssignmentStatus })
      .catch(() => [] as TaskAssignment[]);
    setAssignments(rows);
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [selectedScopeOrgId, requiresBaseSelection]);

  const dailyAssignments = useMemo(() => assignments.filter((assignment) => assignment.category === "DAILY"), [assignments]);
  const temporaryAssignments = useMemo(() => assignments.filter((assignment) => assignment.category === "TEMPORARY"), [assignments]);

  const dailyGroups = useMemo(
    () => ({
      scheduled: dailyAssignments.filter((assignment) => assignment.status === "scheduled"),
      active: dailyAssignments.filter((assignment) => assignment.status === "active"),
      history: dailyAssignments.filter((assignment) => assignment.status === "ended" || assignment.status === "deleted"),
    }),
    [dailyAssignments]
  );
  const temporaryGroups = useMemo(
    () => ({
      active: temporaryAssignments.filter((assignment) => assignment.status === "active"),
      history: temporaryAssignments.filter((assignment) => assignment.status === "ended" || assignment.status === "deleted"),
    }),
    [temporaryAssignments]
  );

  async function handleDelete(assignment: TaskAssignment) {
    if (!window.confirm(`确认删除任务「${assignment.template?.title ?? "未命名任务"}」吗？`)) return;
    setSaving(true);
    await assignmentApi.delete(assignment.id, selectedScopeOrgId ? { scopeOrgId: selectedScopeOrgId } : undefined).catch(console.error);
    setSaving(false);
    setNotice("任务删除操作已完成，历史数据会按策略保留。 ");
    await loadData();
  }

  async function handleCopyTemplate(assignment: TaskAssignment) {
    const templateId = assignment.templateId ?? assignment.template?.id;
    if (!templateId) {
      window.alert("该任务没有关联模板，无法复制");
      return;
    }
    setSaving(true);
    try {
      await templateApi.copy(templateId);
      setNotice("已复制为新草稿，可在模板库中查看和编辑。");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "复制失败");
    }
    setSaving(false);
  }

  async function toggleAssignmentActive(assignment: TaskAssignment) {
    const confirmText = assignment.isActive ? "确认结束该任务？结束后执行端不会再继续看到它。" : "确认重新开启该任务？";
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    if (assignment.isActive) await assignmentApi.close(assignment.id, selectedScopeOrgId).catch(console.error);
    else await assignmentApi.reopen(assignment.id, selectedScopeOrgId).catch(console.error);
    setSaving(false);
    await loadData();
  }

  function renderDailyCard(assignment: TaskAssignment, emphasize = false) {
    const statusMeta = dailyStatusMeta[assignment.status] ?? dailyStatusMeta.ended;
    const exclusion = getExclusionSummary(assignment);
    const targetOrgName = assignment.targets?.[0]?.org?.name ?? selectedScopeOrg?.name ?? "未识别基地";

    return (
      <div key={assignment.id} className={`rounded-3xl border bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${emphasize ? "border-emerald-200" : "border-slate-200"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta.cls}`}>{statusMeta.label}</span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">日常任务</span>
              <span className="text-xs text-slate-400">v{assignment.templateVersion ?? assignment.template?.version ?? 1}</span>
            </div>
            <p className="mt-2 text-lg font-semibold text-slate-900">{assignment.template?.title ?? "未命名任务"}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>管理基地：{targetOrgName}</span>
              <span>生效时间：{formatTime(assignment.effectiveAt ?? undefined)}</span>
              <span>排除组织：{exclusion.orgCount} 个</span>
              <span>排除主播：{exclusion.anchorCount} 人</span>
              <span>已提交记录：{assignment._count?.records ?? 0} 条</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/tasks/report?assignmentId=${assignment.id}`)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <span className="inline-flex items-center gap-1">
                <ChevronRight size={12} />进度报表
              </span>
            </button>
            {canManageTemplates && (
              <button
                type="button"
                onClick={() => void handleCopyTemplate(assignment)}
                disabled={saving}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1">
                  <Copy size={12} />复制为草稿
                </span>
              </button>
            )}
            {canManageAssignments && assignment.status !== "deleted" && (
              <button
                type="button"
                onClick={() => void toggleAssignmentActive(assignment)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${assignment.isActive ? "border-red-200 text-red-500 hover:bg-red-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}
              >
                <span className="inline-flex items-center gap-1">
                  {assignment.isActive ? <PowerOff size={12} /> : <Power size={12} />}
                  {assignment.isActive ? "结束任务" : "重新开启"}
                </span>
              </button>
            )}
            {canManageAssignments && assignment.status !== "deleted" && (
              <button
                type="button"
                onClick={() => void handleDelete(assignment)}
                disabled={saving}
                className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1">
                  <Trash2 size={12} />删除任务
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderTemporaryCard(assignment: TaskAssignment) {
    const exclusion = getExclusionSummary(assignment);
    const isOwner = assignment.createdByIdentityId ? assignment.createdByIdentityId === currentIdentity?.id : assignment.createdBy === currentIdentity?.userId;
    const modeMeta = assignment.temporaryMode ? temporaryModeMeta[assignment.temporaryMode] : temporaryModeMeta.ACCOUNT;
    const subjectLabel = assignment.temporaryMode === "MANAGER" ? `${orgTypeMeta[(assignment.temporarySubjectOrgType as "TEAM" | "HALL" | null) ?? "TEAM"].label}主体` : "账号主体";
    const targetOrgName = assignment.targets?.[0]?.org?.name ?? selectedScopeOrg?.name ?? "未识别基地";
    const selectedAccountCount = Array.isArray(assignment.targetUserIds) ? assignment.targetUserIds.length : 0;

    return (
      <div key={assignment.id} className={`rounded-3xl border bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${assignment.status === "active" ? "border-violet-200" : "border-slate-200 opacity-80"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${assignment.status === "active" ? "bg-emerald-50 text-emerald-600" : assignment.status === "deleted" ? "bg-red-50 text-red-500" : "bg-slate-100 text-slate-500"}`}>
                {assignment.status === "active" ? "进行中" : assignment.status === "deleted" ? "已删除" : "已关闭"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${modeMeta.badge}`}>{modeMeta.label}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{subjectLabel}</span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">{isOwner ? "我发起的" : "只读结果"}</span>
            </div>
            <p className="mt-2 text-lg font-semibold text-slate-900">{assignment.template?.title ?? "未命名任务"}</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">{modeMeta.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>发放基地：{targetOrgName}</span>
              <span>发布者：{formatPublisher(assignment)}</span>
              <span>发布时间：{formatTime(assignment.publishedAt ?? undefined)}</span>
              <span>截止时间：{formatTime(assignment.deadlineAt ?? undefined)}</span>
              {assignment.temporaryMode === "ACCOUNT" ? (

                <>
                  <span>明确账号：{selectedAccountCount} 个</span>
                  <span>范围补充：{assignment.targets?.length ?? 0} 个组织</span>
                </>
              ) : (
                <>
                  <span>目标组织：{assignment.targets?.length ?? 0} 个</span>
                  <span>排除组织：{exclusion.orgCount} 个</span>
                </>
              )}
              {assignment.temporaryMode === "ANCHOR" && <span>排除主播：{exclusion.anchorCount} 人</span>}
              <span>已生成记录：{assignment._count?.records ?? 0} 条</span>
            </div>
            {!isOwner && (
              <p className="mt-3 text-xs text-slate-400">这条临时任务当前仅保留结果查看；复制草稿、关闭、删除和重开仅对发起人生效。</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/tasks/report?assignmentId=${assignment.id}`)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <span className="inline-flex items-center gap-1">
                <ChevronRight size={12} />进度报表
              </span>
            </button>
            {isOwner && canManageTemplates && (
              <button
                type="button"
                onClick={() => void handleCopyTemplate(assignment)}
                disabled={saving}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1">
                  <Copy size={12} />复制为草稿
                </span>
              </button>
            )}
            {isOwner && canManageAssignments && assignment.status !== "deleted" && (
              <button
                type="button"
                onClick={() => void toggleAssignmentActive(assignment)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${assignment.isActive ? "border-red-200 text-red-500 hover:bg-red-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}
              >
                <span className="inline-flex items-center gap-1">
                  {assignment.isActive ? <PowerOff size={12} /> : <Power size={12} />}
                  {assignment.isActive ? "关闭任务" : "重新开启"}
                </span>
              </button>
            )}
            {isOwner && canManageAssignments && assignment.status !== "deleted" && (
              <button
                type="button"
                onClick={() => void handleDelete(assignment)}
                disabled={saving}
                className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1">
                  <Trash2 size={12} />删除任务
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderDailySection() {
    const hasDailyAssignments = dailyGroups.active.length > 0 || dailyGroups.scheduled.length > 0 || dailyGroups.history.length > 0;

    return (
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          {([
            { key: "scheduled", title: "待生效", desc: "次日凌晨自动接管" },
            { key: "active", title: "正式任务", desc: "当前生效中的日常任务" },
            { key: "history", title: "历史任务", desc: "已结束或已删除" },
          ] as const).map((item) => (
            <div key={item.key} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-lg font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-sm text-slate-500">{item.desc}</p>
              <p className="mt-3 text-2xl font-bold text-slate-900">{dailyGroups[item.key].length}</p>
            </div>
          ))}
        </div>

        {!hasDailyAssignments ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-400">
            当前没有已发布的日常任务，可从“日常任务”发布页创建或继续处理草稿。
          </div>
        ) : (
          <>
            {dailyGroups.active.length > 0 && <div className="space-y-4">{dailyGroups.active.map((assignment) => renderDailyCard(assignment, true))}</div>}
            {dailyGroups.scheduled.length > 0 && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-700">这些任务已经完成发放确认，但会等到指定时间再接管正式日常任务。</div>
                {dailyGroups.scheduled.map((assignment) => renderDailyCard(assignment))}
              </div>
            )}
            {dailyGroups.history.length > 0 && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">历史区只保留已发布后的任务痕迹；草稿请回发布页继续处理。</div>
                {dailyGroups.history.map((assignment) => renderDailyCard(assignment))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  function renderTemporarySection() {
    const hasTemporaryAssignments = temporaryGroups.active.length > 0 || temporaryGroups.history.length > 0;

    return (
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2">
          {([
            { key: "active", title: "进行中", desc: "已正式发放并生成主体记录" },
            { key: "history", title: "历史区", desc: "已关闭或已删除的临时任务" },
          ] as const).map((item) => (
            <div key={item.key} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-lg font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-sm text-slate-500">{item.desc}</p>
              <p className="mt-3 text-2xl font-bold text-slate-900">{temporaryGroups[item.key].length}</p>
            </div>
          ))}
        </div>

        {!hasTemporaryAssignments ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-400">
            当前没有已发布的临时任务，可从“临时任务”发布页创建或继续处理你的草稿。
          </div>
        ) : (
          <>
            {temporaryGroups.active.length > 0 && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-700">进行中的临时任务会区分账号主体与组织主体，并始终按发起人控制关闭、删除和重开。</div>
                {temporaryGroups.active.map(renderTemporaryCard)}
              </div>
            )}
            {temporaryGroups.history.length > 0 && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">历史区只保留已发布后的临时任务结果；草稿不再在这里展示。</div>
                {temporaryGroups.history.map(renderTemporaryCard)}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const issuePath = tab === "DAILY" ? "/tasks/issue/daily" : "/tasks/issue/temporary";
  const issueQuery = selectedScopeOrgId ? `?scopeOrgId=${selectedScopeOrgId}` : "";
  const scopeSelectorTitle = tab === "DAILY" ? "选择管理基地" : "按基地筛选（可选）";
  const scopeSelectorDesc = tab === "DAILY"
    ? "总部进入日常任务管理时先选基地，基地管理默认聚焦自己的基地；下面列表会按选中的基地视角汇总已发布任务。"
    : "临时任务默认按当前身份范围展示；如需聚焦某个基地，可在这里进一步筛选。";
  const scopeSelectorLabel = tab === "DAILY" ? "当前管理基地" : "筛选基地（不选则查看当前身份范围）";
  const currentScopeName = currentIdentity?.org?.name ?? "当前基地";
  const scopeSelectorPlaceholder = availableBaseOrgs.length
    ? (tab === "DAILY" ? "请选择基地" : "当前身份范围（不限定基地）")
    : (tab === "DAILY"
      ? "当前身份下暂无可管理基地"
      : currentIdentity?.org?.orgType === "BASE"
        ? `当前身份范围（${currentScopeName}）`
        : "当前身份范围（暂无下属基地）");


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">已发布任务管理</h1>
          <p className="mt-1 text-sm text-slate-500">这里只查看已发布的日常任务与临时任务；草稿请到对应发布页继续处理，模板草稿请到模板库维护。</p>
        </div>
        {canManageAssignments && (
          <button
            type="button"
            onClick={() => navigate(`${issuePath}${issueQuery}`)}
            disabled={tab === "DAILY" && (!canManageDaily || !selectedScopeOrgId)}
            className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={15} />进入发布页
          </button>
        )}
      </div>

      <section className="rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{scopeSelectorTitle}</h2>
            <p className="mt-1 text-sm text-slate-500">{scopeSelectorDesc}</p>
          </div>
          <div className="min-w-[280px]">
            <label className="text-xs font-medium text-slate-500">{scopeSelectorLabel}</label>
            <select
              value={selectedScopeOrgId}
              onChange={(event) => setSelectedScopeOrgId(event.target.value)}
              disabled={availableBaseOrgs.length <= 1 && Boolean(selectedScopeOrgId)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">{scopeSelectorPlaceholder}</option>
              {availableBaseOrgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}（{org.orgCode}）
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {selectedScopeOrg
            ? `当前列表已切换到“${selectedScopeOrg.name}”的已发布任务视角。`
            : tab === "DAILY"
              ? "选定基地后，列表会切到该基地的已发布任务范围。"
              : "当前按你的身份范围查看临时任务；如需聚焦某个基地，可在上方切换。"}
        </div>
      </section>

      {!canManageAssignments && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">当前身份为只读视角，仅可查看已发布任务与进度报表，不能执行关闭、删除或进入发布页。</div>
      )}

      {tab === "DAILY" && !canManageDaily && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">日常任务管理权限仅开放给总公司与基地管理身份；当前身份不可进入该业务。</div>
      )}

      {notice && <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        {([
          { key: "DAILY", title: "日常任务管理", desc: "重点查看待生效、正式执行中与历史日常任务。" },
          { key: "TEMPORARY", title: "临时任务管理", desc: "重点查看进行中与历史临时任务，草稿回发布页处理。" },
        ] as const).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-3xl border p-5 text-left transition ${tab === item.key ? "border-blue-300 bg-blue-50 shadow-[0_12px_30px_rgba(76,114,255,0.12)]" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
          >
            <div className="flex items-center gap-3">
              <div className={`rounded-2xl p-3 ${tab === item.key ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                {item.key === "DAILY" ? <FolderClock size={18} /> : <CalendarClock size={18} />}
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-900">{item.title}</p>
                <p className="mt-1 text-sm text-slate-500">{item.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {orgLoading || loading ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <span className="inline-flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />已发布任务列表加载中...
          </span>
        </div>
      ) : tab === "DAILY" && !canManageDaily ? (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 px-6 py-16 text-center text-sm text-amber-700">当前身份不能管理日常任务，请切换为总公司或基地管理身份后重试。</div>
      ) : requiresBaseSelection && !selectedScopeOrgId ? (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 px-6 py-16 text-center text-sm text-amber-700">请先选择一个基地，再查看该基地的日常任务列表。</div>
      ) : (
        <div className="space-y-6 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">{tab === "DAILY" ? renderDailySection() : renderTemporarySection()}</div>
      )}
    </div>
  );
}
