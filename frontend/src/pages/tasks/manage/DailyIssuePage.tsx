import { DailyIssueBaseWelcome } from "./components/DailyIssueBaseWelcome";
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
        <DailyIssueBaseWelcome title="主播日常任务协同中心" description="赋能每一个基地，协同每一次发放，见证主播的持续成长" availableBaseOrgs={availableBaseOrgs} onSelect={setSelectedScopeOrgId} />
      )}
    </div>
  );
}
