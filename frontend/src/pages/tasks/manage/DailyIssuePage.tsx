import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { Identity, OrgUnit, TaskAssignment, TaskTemplate } from "../../../types";
import { fetchOrgTree } from "../../../services/organization";
import { assignmentApi, templateApi } from "../../../services/task";
import { useIdentityStore } from "../../../stores/identityStore";
import { DailyTaskWizard } from "./components/DailyTaskWizard";

function isOrgWithinScope(org: OrgUnit, scopePath?: string) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`);
}

function findBaseByOrgId(orgs: OrgUnit[], orgId?: string) {
  if (!orgId) return null;
  let current = orgs.find((org) => org.id === orgId) ?? null;
  while (current && current.orgType !== "BASE") {
    current = current.parentId ? orgs.find((org) => org.id === current?.parentId) ?? null : null;
  }
  return current;
}

function findBaseIdForAssignment(orgs: OrgUnit[], assignment: TaskAssignment | null) {
  const targetOrgId = assignment?.targets?.[0]?.orgId;
  return findBaseByOrgId(orgs, targetOrgId)?.id ?? "";
}

function getAvailableBaseOrgs(orgs: OrgUnit[], identity?: Identity) {
  return orgs
    .filter((org) => org.status === "active" && org.orgType === "BASE" && isOrgWithinScope(org, identity?.scopePath))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function DailyIssuePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const permissions = useIdentityStore((state) => state.permissions);
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const canManageTemplates = permissions.includes("*") || permissions.includes("task:template:manage");
  const initialAssignmentId = searchParams.get("assignmentId") ?? "";
  const initialScopeOrgId = searchParams.get("scopeOrgId") ?? "";

  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [scheduledAssignments, setScheduledAssignments] = useState<TaskAssignment[]>([]);
  const [activeAssignments, setActiveAssignments] = useState<TaskAssignment[]>([]);
  const [endedAssignments, setEndedAssignments] = useState<TaskAssignment[]>([]);
  const [draftTemplatesPage, setDraftTemplatesPage] = useState<TaskTemplate[]>([]);
  const [selectedScopeOrgId, setSelectedScopeOrgId] = useState(initialScopeOrgId);
  const requiresBaseSelection = true;
  const canManageDaily = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"].includes(currentIdentity?.roleCode ?? "");

  const [draftScopeOrgId, setDraftScopeOrgId] = useState("");
  const [autoResumeDraftId, setAutoResumeDraftId] = useState("");
  const [loading, setLoading] = useState(true);

  const availableBaseOrgs = useMemo(() => getAvailableBaseOrgs(orgs, currentIdentity), [orgs, currentIdentity]);
  const selectedScopeOrg = useMemo(() => orgs.find((org) => org.id === selectedScopeOrgId) ?? null, [orgs, selectedScopeOrgId]);
  const resolvedInitialAssignmentId = useMemo(() => {
    if (initialAssignmentId && selectedScopeOrgId && draftScopeOrgId && selectedScopeOrgId === draftScopeOrgId) {
      return initialAssignmentId;
    }
    return autoResumeDraftId;
  }, [autoResumeDraftId, draftScopeOrgId, initialAssignmentId, selectedScopeOrgId]);

  const loadAssignmentsByStatus = useCallback(async (scopeOrgId: string, status: "scheduled" | "active" | "ended", offset = 0, limit = 3) => {
    return assignmentApi
      .list({ category: "DAILY", scopeOrgId, status, offset, limit })
      .catch(() => [] as TaskAssignment[]);
  }, []);

  const loadDraftTemplatesPage = useCallback(async (scopeOrgId: string, offset = 0, limit = 3) => {
    const rows = await templateApi
      .list({
        category: "DAILY",
        orgId: scopeOrgId,
        scopeOrgId,
        limit,
        offset,
      })
      .catch(() => [] as TaskTemplate[]);
    return rows.filter((template) => template.status === "draft" && (template._count?.assignments ?? 0) === 0);
  }, []);

  async function loadData(showLoading = true) {
    if (showLoading) setLoading(true);
    const shouldLoad = Boolean(selectedScopeOrgId);
    const [templateList, orgTree, draftAssignment, scheduledRows, activeRows, endedRows, draftRows] = await Promise.all([
      shouldLoad
        ? templateApi
            .list({
              category: "DAILY",
              orgId: selectedScopeOrgId,
              scopeOrgId: selectedScopeOrgId,
              ...(canManageTemplates ? {} : { status: "published" }),
            })
            .catch(() => [] as TaskTemplate[])
        : Promise.resolve([] as TaskTemplate[]),
      fetchOrgTree().catch(() => [] as OrgUnit[]),
      initialAssignmentId && (!requiresBaseSelection || Boolean(initialScopeOrgId))
        ? assignmentApi.getById(initialAssignmentId, initialScopeOrgId ? { scopeOrgId: initialScopeOrgId } : undefined).catch(() => null)
        : Promise.resolve(null),
      shouldLoad ? loadAssignmentsByStatus(selectedScopeOrgId, "scheduled") : Promise.resolve([] as TaskAssignment[]),
      shouldLoad ? loadAssignmentsByStatus(selectedScopeOrgId, "active") : Promise.resolve([] as TaskAssignment[]),
      shouldLoad ? loadAssignmentsByStatus(selectedScopeOrgId, "ended") : Promise.resolve([] as TaskAssignment[]),
      shouldLoad ? loadDraftTemplatesPage(selectedScopeOrgId) : Promise.resolve([] as TaskTemplate[]),
    ]);
    setTemplates(templateList);
    setOrgs(orgTree);
    setScheduledAssignments(scheduledRows);
    setActiveAssignments(activeRows);
    setEndedAssignments(endedRows);
    setDraftTemplatesPage(draftRows);
    setDraftScopeOrgId(findBaseIdForAssignment(orgTree, draftAssignment));
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [canManageTemplates, initialAssignmentId, selectedScopeOrgId]);

  useEffect(() => {
    const validIds = new Set(availableBaseOrgs.map((org) => org.id));
    if (selectedScopeOrgId && validIds.has(selectedScopeOrgId)) return;

    const fallbackCandidates = [
      initialScopeOrgId,
      draftScopeOrgId,
      findBaseByOrgId(orgs, currentIdentity?.orgId)?.id ?? "",
      availableBaseOrgs.length === 1 ? availableBaseOrgs[0].id : "",
    ].filter((v): v is string => Boolean(v));
    const next = fallbackCandidates.find((v) => validIds.has(v)) ?? "";
    if (next !== selectedScopeOrgId) setSelectedScopeOrgId(next);
  }, [availableBaseOrgs, currentIdentity?.orgId, draftScopeOrgId, initialScopeOrgId, orgs, selectedScopeOrgId]);

  useEffect(() => {
    if (!selectedScopeOrgId) {
      setAutoResumeDraftId("");
      return;
    }
    let cancelled = false;
    assignmentApi
      .list({ category: "DAILY", scopeOrgId: selectedScopeOrgId })
      .then((rows) => {
        if (!cancelled) setAutoResumeDraftId(rows.find((a) => a.status === "draft")?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) setAutoResumeDraftId("");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedScopeOrgId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
        <span className="text-sm text-slate-500 whitespace-nowrap">当前权限定位基地：</span>
        <span className="text-sm font-medium text-slate-800 flex-1">
          {selectedScopeOrg ? selectedScopeOrg.name : <span className="text-amber-500">{availableBaseOrgs.length ? "未选择" : "暂无可管理基地"}</span>}
        </span>
        {availableBaseOrgs.length > 1 && (
          <select
            value={selectedScopeOrgId}
            onChange={(e) => setSelectedScopeOrgId(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none transition focus:border-blue-400"
          >
            <option value="">请选择基地</option>
            {availableBaseOrgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">任务发放配置加载中...</div>
      ) : !canManageDaily ? (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 px-6 py-16 text-center text-sm text-amber-700">主播日常任务仅允许总公司与基地管理身份维护，请先切换身份。</div>
      ) : selectedScopeOrgId ? (
        <DailyTaskWizard
          key={selectedScopeOrgId}
          templates={templates}
          draftTemplatesPage={draftTemplatesPage}
          orgs={orgs}
          currentOrgId={currentIdentity?.orgId}
          managementOrgId={selectedScopeOrgId}
          managementScopePath={selectedScopeOrg?.path}
          managementOrgName={selectedScopeOrg?.name}
          canManageTemplates={canManageTemplates}
          initialAssignmentId={resolvedInitialAssignmentId}
          scheduledAssignments={scheduledAssignments}
          activeAssignments={activeAssignments}
          endedAssignments={endedAssignments}
          loadAssignmentsByStatus={loadAssignmentsByStatus}
          onReload={() => loadData(false)}
          loadDraftTemplatesPage={loadDraftTemplatesPage}
          onIssued={() => navigate(`/tasks/issue/daily?scopeOrgId=${selectedScopeOrgId}`)}
        />
      ) : (
        <div className="relative overflow-hidden rounded-3xl bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          {/* 背景装饰 */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-blue-50 opacity-60" />
          <div className="pointer-events-none absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-indigo-50 opacity-40" />

          <div className="relative flex flex-col items-center px-8 py-16">
            {/* 品牌标识 */}
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-[0_8px_24px_rgba(79,70,229,0.3)] select-none">
              <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="M9 12h6M9 16h4" />
              </svg>
            </div>

            {/* 标题 */}
            <h3 className="mt-5 text-xl font-bold text-slate-900 tracking-tight">主播日常任务协同中心</h3>

            {/* 激励语 */}
            <p className="mt-2 text-sm text-slate-400 text-center max-w-sm leading-relaxed">
              赋能每一个基地，协同每一次发放，见证主播的持续成长
            </p>

            {/* 三个价值点 */}
            <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-md">
              {[
                { label: "精准赋能", desc: "任务直达基地一线" },
                { label: "高效协同", desc: "多端同步实时响应" },
                { label: "驱动成长", desc: "数据积累沉淀价值" },
              ].map((item) => (
                <div key={item.label} className="flex flex-col items-center rounded-2xl bg-slate-50 px-3 py-4">
                  <span className="text-sm font-semibold text-slate-700">{item.label}</span>
                  <span className="mt-1 text-xs text-slate-400 text-center leading-snug">{item.desc}</span>
                </div>
              ))}
            </div>

            {/* 快速选择 */}
            {availableBaseOrgs.length > 0 && (
              <div className="mt-8 w-full max-w-md">
                <p className="text-xs font-medium text-slate-400 text-center mb-3 tracking-widest uppercase">快速进入</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {availableBaseOrgs.slice(0, 6).map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => setSelectedScopeOrgId(org.id)}
                      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-4 py-3 text-left transition-all duration-200 hover:border-blue-300 hover:shadow-[0_4px_16px_rgba(59,130,246,0.12)]"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 opacity-0 transition-opacity duration-200 group-hover:opacity-5" />
                      <p className="text-sm font-medium text-slate-700 group-hover:text-blue-700 transition-colors truncate">{org.name}</p>
                      <p className="mt-0.5 text-xs text-slate-400 group-hover:text-blue-400 transition-colors">{org.orgCode}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
