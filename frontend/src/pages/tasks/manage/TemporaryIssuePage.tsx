import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bell } from "lucide-react";

import type { Identity, OrgUnit, TaskAssignment, TaskTemplate } from "../../../types";
import { TemporaryNotifyScheduleModal } from "../components/TemporaryNotifyScheduleModal";

type DraftTemplatePageState = {
  items: TaskTemplate[];
  hasMore: boolean;
};
import { fetchOrgTree } from "../../../services/organization";
import { assignmentApi, templateApi } from "../../../services/task";
import { useIdentityStore } from "../../../stores/identityStore";
import { TemporaryIssuePanel } from "./components/TemporaryIssuePanel";

type AssignmentStatusBucket = "draft" | "active" | "ended,deleted";
type AssignmentListState = {
  items: TaskAssignment[];
  hasMore: boolean;
};

const FIRST_PAGE_LIMIT = 3;

function isOrgWithinScope(org: OrgUnit, scopePath?: string) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`) || scopePath.startsWith(`${org.path}/`);
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

function findBaseIdForAssignment(orgs: OrgUnit[], assignment: TaskAssignment | null) {
  const targetOrgId = assignment?.targets?.[0]?.orgId || assignment?.createdByOrgId;
  return findBaseByOrgId(orgs, targetOrgId)?.id ?? "";
}

function resolveIdentityBaseId(orgs: OrgUnit[], identity?: Identity) {
  const directBaseId = findBaseByOrgId(orgs, identity?.orgId)?.id ?? "";
  if (directBaseId) return directBaseId;
  if (!identity?.scopePath) return "";
  const scopePath = identity.scopePath;
  const matchedBase = orgs
    .filter((org) => org.status === "active" && org.orgType === "BASE")
    .find((org) => scopePath === org.path || scopePath.startsWith(`${org.path}/`));
  return matchedBase?.id ?? "";
}

function getAvailableBaseOrgs(orgs: OrgUnit[], identity?: Identity) {
  return orgs
    .filter((org) => org.status === "active" && org.orgType === "BASE" && isOrgWithinScope(org, identity?.scopePath))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function TemporaryIssuePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const permissions = useIdentityStore((state) => state.permissions);
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const canManageTemplates = permissions.includes("*") || permissions.includes("task:template:manage");
  const canManageAssignments = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(currentIdentity?.roleCode ?? "") || permissions.includes("*") || permissions.includes("task:assignment:manage");
  const canManageTemporaryNotify = useMemo(() => ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(currentIdentity?.roleCode ?? ""), [currentIdentity]);
  const initialAssignmentId = searchParams.get("assignmentId") ?? "";
  const initialScopeOrgId = searchParams.get("scopeOrgId") ?? "";
  const requiresBaseSelection = ["DEV_ADMIN", "HQ_ADMIN"].includes(currentIdentity?.roleCode ?? "");

  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [draftTemplatePage, setDraftTemplatePage] = useState<DraftTemplatePageState>({ items: [], hasMore: false });
  const [activeAssignments, setActiveAssignments] = useState<AssignmentListState>({ items: [], hasMore: false });
  const [endedAssignments, setEndedAssignments] = useState<AssignmentListState>({ items: [], hasMore: false });
  const [selectedScopeOrgId, setSelectedScopeOrgId] = useState(initialScopeOrgId);
  const [draftScopeOrgId, setDraftScopeOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);

  const availableBaseOrgs = useMemo(() => getAvailableBaseOrgs(orgs, currentIdentity), [orgs, currentIdentity]);
  const resolvedIdentityBaseId = useMemo(() => resolveIdentityBaseId(orgs, currentIdentity), [orgs, currentIdentity]);
  const resolvedIdentityBase = useMemo(() => orgs.find((org) => org.id === resolvedIdentityBaseId) ?? null, [orgs, resolvedIdentityBaseId]);
  const selectedScopeOrg = useMemo(() => orgs.find((org) => org.id === selectedScopeOrgId) ?? null, [orgs, selectedScopeOrgId]);
  const scopeSummary = selectedScopeOrg?.name ?? resolvedIdentityBase?.name ?? "当前身份范围";
  const resolvedInitialAssignmentId = useMemo(() => {
    if (initialAssignmentId && selectedScopeOrgId && (!draftScopeOrgId || selectedScopeOrgId === draftScopeOrgId)) {
      return initialAssignmentId;
    }
    return "";
  }, [draftScopeOrgId, initialAssignmentId, selectedScopeOrgId]);

  const loadAssignmentsByStatus = useCallback(
    async (scopeOrgId: string, status: AssignmentStatusBucket, offset = 0, limit = FIRST_PAGE_LIMIT) => {
      return assignmentApi
        .list({ category: "TEMPORARY", scopeOrgId, status, offset, limit })
        .catch(() => [] as TaskAssignment[]);
    },
    []
  );

  const loadAssignmentPage = useCallback(
    async (scopeOrgId: string, status: AssignmentStatusBucket, offset = 0, limit = FIRST_PAGE_LIMIT) => {
      const rows = await loadAssignmentsByStatus(scopeOrgId, status, offset, limit);
      return { items: rows, hasMore: rows.length >= limit } satisfies AssignmentListState;
    },
    [loadAssignmentsByStatus]
  );

  const loadDraftTemplatePage = useCallback(
    async (scopeOrgId: string, offset = 0, limit = FIRST_PAGE_LIMIT) => {
      const rows = await templateApi
        .list({ category: "TEMPORARY", scopeOrgId, limit, offset })
        .catch(() => [] as TaskTemplate[]);
      const drafts = rows.filter((template) => template.status === "draft" && (template._count?.assignments ?? 0) === 0);
      return { items: drafts, hasMore: drafts.length >= limit } satisfies DraftTemplatePageState;
    },
    []
  );

  async function loadData(showLoading = true) {
    if (showLoading) setLoading(true);
    const shouldLoad = requiresBaseSelection ? Boolean(selectedScopeOrgId) : true;
    const [templateList, orgTree, draftAssignment, draftRows, activeRows, endedRows] = await Promise.all([
      shouldLoad
        ? templateApi
            .list({
              category: "TEMPORARY",
              ...(selectedScopeOrgId ? { scopeOrgId: selectedScopeOrgId } : {}),
              ...(canManageTemplates ? {} : { status: "published" }),
            })
            .catch(() => [] as TaskTemplate[])
        : Promise.resolve([] as TaskTemplate[]),
      fetchOrgTree().catch(() => [] as OrgUnit[]),
      initialAssignmentId && (!requiresBaseSelection || Boolean(initialScopeOrgId))
        ? assignmentApi.getById(initialAssignmentId, initialScopeOrgId ? { scopeOrgId: initialScopeOrgId } : undefined).catch(() => null)
        : Promise.resolve(null),
      shouldLoad && selectedScopeOrgId
        ? loadDraftTemplatePage(selectedScopeOrgId)
        : Promise.resolve({ items: [], hasMore: false } as DraftTemplatePageState),
      shouldLoad && selectedScopeOrgId
        ? loadAssignmentPage(selectedScopeOrgId, "active")
        : Promise.resolve({ items: [], hasMore: false } as AssignmentListState),
      shouldLoad && selectedScopeOrgId
        ? loadAssignmentPage(selectedScopeOrgId, "ended,deleted")
        : Promise.resolve({ items: [], hasMore: false } as AssignmentListState),
    ]);

    setTemplates(templateList);
    setOrgs(orgTree);
    setDraftTemplatePage(draftRows);
    setActiveAssignments(activeRows);
    setEndedAssignments(endedRows);
    setDraftScopeOrgId(findBaseIdForAssignment(orgTree, draftAssignment));
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [canManageTemplates, initialAssignmentId, initialScopeOrgId, selectedScopeOrgId, requiresBaseSelection, loadAssignmentsByStatus]);

  useEffect(() => {
    const validIds = new Set(availableBaseOrgs.map((org) => org.id));
    if (selectedScopeOrgId && validIds.has(selectedScopeOrgId)) return;

    const fallbackCandidates = [
      initialScopeOrgId,
      draftScopeOrgId,
      resolveIdentityBaseId(orgs, currentIdentity),
      availableBaseOrgs.length === 1 ? availableBaseOrgs[0].id : "",
    ].filter((value): value is string => Boolean(value));
    const nextScopeOrgId = fallbackCandidates.find((value) => validIds.has(value)) ?? "";
    if (nextScopeOrgId !== selectedScopeOrgId) setSelectedScopeOrgId(nextScopeOrgId);
  }, [availableBaseOrgs, currentIdentity?.orgId, draftScopeOrgId, initialScopeOrgId, orgs, selectedScopeOrgId]);


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
        <span className="whitespace-nowrap text-sm text-slate-500">当前权限定位基地：</span>
        <span className="flex-1 text-sm font-medium text-slate-800">
          {selectedScopeOrg ? selectedScopeOrg.name : <span className="text-amber-500">{availableBaseOrgs.length ? "未选择" : "暂无可管理基地"}</span>}
        </span>
        {availableBaseOrgs.length > 1 && requiresBaseSelection && (
          <select
            value={selectedScopeOrgId}
            onChange={(event) => setSelectedScopeOrgId(event.target.value)}
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
        {canManageTemporaryNotify && (
          <button
            type="button"
            onClick={() => setScheduleModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
          >
            <Bell size={14} />自动催办
          </button>
        )}
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">临时任务发放配置加载中...</div>
      ) : !canManageAssignments ? (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 px-6 py-16 text-center text-sm text-amber-700">
          当前身份缺少临时任务发布权限。
        </div>
      ) : !selectedScopeOrgId && availableBaseOrgs.length > 0 ? (
        <div className="relative overflow-hidden rounded-3xl bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-blue-50 opacity-60" />
          <div className="pointer-events-none absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-indigo-50 opacity-40" />
          <div className="relative flex flex-col items-center px-8 py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-[0_8px_24px_rgba(79,70,229,0.3)]" />
            <h3 className="mt-5 text-xl font-bold tracking-tight text-slate-900">临时任务协同中心</h3>
            <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-slate-400">
              请选择一个基地后，再进入临时任务的草稿整理、任务发放与结果复用流程。
            </p>
            <div className="mt-8 w-full max-w-md">
              <p className="mb-3 text-center text-xs font-medium uppercase tracking-widest text-slate-400">快速进入</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {availableBaseOrgs.slice(0, 6).map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => setSelectedScopeOrgId(org.id)}
                    className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-4 py-3 text-left transition-all duration-200 hover:border-blue-300 hover:shadow-[0_4px_16px_rgba(59,130,246,0.12)]"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 opacity-0 transition-opacity duration-200 group-hover:opacity-5" />
                    <p className="truncate text-sm font-medium text-slate-700 transition-colors group-hover:text-blue-700">{org.name}</p>
                    <p className="mt-0.5 text-xs text-slate-400 transition-colors group-hover:text-blue-400">{org.orgCode}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : selectedScopeOrgId ? (
        <TemporaryIssuePanel
          key={`${selectedScopeOrgId}:${resolvedInitialAssignmentId}`}
          templates={templates}
          orgs={orgs}
          currentOrgId={currentIdentity?.orgId}
          managementOrgId={selectedScopeOrgId}
          managementScopePath={selectedScopeOrg?.path ?? currentIdentity?.scopePath}
          managementOrgName={selectedScopeOrg?.name ?? currentIdentity?.org?.name ?? scopeSummary}
          canManageTemplates={canManageTemplates}
          canManageAssignments={canManageAssignments}
          initialAssignmentId={resolvedInitialAssignmentId}
          draftAssignments={draftTemplatePage.items}
          activeAssignments={activeAssignments.items}
          endedAssignments={endedAssignments.items}
          loadAssignmentsByStatus={loadAssignmentsByStatus}
          loadDraftTemplatesPage={async (scopeOrgId, offset, limit) => (await loadDraftTemplatePage(scopeOrgId, offset, limit)).items}
          initialHasMoreByStatus={{
            draft: draftTemplatePage.hasMore,
            active: activeAssignments.hasMore,
            ended: endedAssignments.hasMore,
          }}
          onReload={() => loadData(false)}
          onIssued={() => navigate(`/tasks/assignment-management/temporary?scopeOrgId=${selectedScopeOrgId}`)}
        />
      ) : (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 px-6 py-16 text-center text-sm text-amber-700">
          请先选择一个基地，再进入临时任务发布流程。
        </div>
      )}

      <TemporaryNotifyScheduleModal
        open={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
      />
    </div>
  );
}
