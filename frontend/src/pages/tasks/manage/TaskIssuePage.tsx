import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Clock3 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { Identity, OrgUnit, TaskAssignment, TaskTemplate } from "../../../types";
import { fetchOrgTree } from "../../../services/organization";
import { assignmentApi, templateApi } from "../../../services/task";
import { useIdentityStore } from "../../../stores/identityStore";
import { DailyTaskWizard } from "./components/DailyTaskWizard";
import { TemporaryIssuePanel } from "./components/TemporaryIssuePanel";

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

export function TaskIssuePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const permissions = useIdentityStore((state) => state.permissions);
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const canManageTemplates = permissions.includes("*") || permissions.includes("task:template:manage");
  const initialCategory = searchParams.get("category") === "TEMPORARY" ? "TEMPORARY" : "DAILY";
  const initialAssignmentId = searchParams.get("assignmentId") ?? "";
  const initialScopeOrgId = searchParams.get("scopeOrgId") ?? "";

  const [category, setCategory] = useState<"DAILY" | "TEMPORARY">(initialCategory);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [recentPublished, setRecentPublished] = useState<TaskAssignment[]>([]);
  const [selectedScopeOrgId, setSelectedScopeOrgId] = useState(initialScopeOrgId);
  const [draftScopeOrgId, setDraftScopeOrgId] = useState("");
  const [autoResumeDraftId, setAutoResumeDraftId] = useState("");
  const [loading, setLoading] = useState(true);

  const availableBaseOrgs = useMemo(() => getAvailableBaseOrgs(orgs, currentIdentity), [orgs, currentIdentity]);
  const selectedScopeOrg = useMemo(() => orgs.find((org) => org.id === selectedScopeOrgId) ?? null, [orgs, selectedScopeOrgId]);
  const requiresBaseSelection = category === "DAILY" && ["HQ_ADMIN", "DEV_ADMIN"].includes(currentIdentity?.roleCode ?? "");
  const resolvedInitialAssignmentId = useMemo(() => {
    if (initialAssignmentId && selectedScopeOrgId && draftScopeOrgId && selectedScopeOrgId === draftScopeOrgId) {
      return initialAssignmentId;
    }
    return autoResumeDraftId;
  }, [autoResumeDraftId, draftScopeOrgId, initialAssignmentId, selectedScopeOrgId]);

  async function loadData() {
    setLoading(true);
    const shouldLoadDailyTemplates = category !== "DAILY" || Boolean(selectedScopeOrgId);
    const templatePromise =
      category === "DAILY"
        ? shouldLoadDailyTemplates
          ? templateApi
              .list({
                category: "DAILY",
                orgId: selectedScopeOrgId,
                scopeOrgId: selectedScopeOrgId,
                ...(canManageTemplates ? {} : { status: "published" }),
              })
              .catch(() => [] as TaskTemplate[])
          : Promise.resolve([] as TaskTemplate[])
        : templateApi.list({ category: "TEMPORARY", ...(canManageTemplates ? {} : { status: "published" }) }).catch(() => [] as TaskTemplate[]);
    const shouldLoadInitialDraft = Boolean(initialAssignmentId) && (!requiresBaseSelection || Boolean(initialScopeOrgId));
    const shouldLoadRecentPublished = category === "DAILY" && Boolean(selectedScopeOrgId);
    const [templateList, orgTree, draftAssignment, publishedList] = await Promise.all([
      templatePromise,
      fetchOrgTree().catch(() => [] as OrgUnit[]),
      shouldLoadInitialDraft
        ? assignmentApi.getById(initialAssignmentId, initialScopeOrgId ? { scopeOrgId: initialScopeOrgId } : undefined).catch(() => null)
        : Promise.resolve(null),
      shouldLoadRecentPublished
        ? assignmentApi
            .list({ category: "DAILY", scopeOrgId: selectedScopeOrgId, status: "active,scheduled,ended,deleted", limit: 5 })
            .catch(() => [] as TaskAssignment[])
        : Promise.resolve([] as TaskAssignment[]),
    ]);
    setTemplates(templateList);
    setOrgs(orgTree);
    setRecentPublished(publishedList.slice(0, 5));
    setDraftScopeOrgId(findBaseIdForAssignment(orgTree, draftAssignment));
    setLoading(false);
  }

  useEffect(() => {
    setCategory(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    void loadData();
  }, [canManageTemplates, category, initialAssignmentId, selectedScopeOrgId]);

  useEffect(() => {
    const validIds = new Set(availableBaseOrgs.map((org) => org.id));
    if (selectedScopeOrgId && validIds.has(selectedScopeOrgId)) return;

    const fallbackCandidates = [
      initialScopeOrgId,
      draftScopeOrgId,
      findBaseByOrgId(orgs, currentIdentity?.orgId)?.id ?? "",
      availableBaseOrgs.length === 1 ? availableBaseOrgs[0].id : "",
    ].filter((value): value is string => Boolean(value));
    const nextScopeOrgId = fallbackCandidates.find((value) => validIds.has(value)) ?? "";
    if (nextScopeOrgId !== selectedScopeOrgId) setSelectedScopeOrgId(nextScopeOrgId);
  }, [availableBaseOrgs, currentIdentity?.orgId, draftScopeOrgId, initialScopeOrgId, orgs, selectedScopeOrgId]);

  useEffect(() => {
    if (category !== "DAILY" || !selectedScopeOrgId) {
      setAutoResumeDraftId("");
      return;
    }

    let cancelled = false;
    assignmentApi
      .list({ category: "DAILY", scopeOrgId: selectedScopeOrgId })
      .then((rows) => {
        if (!cancelled) {
          setAutoResumeDraftId(rows.find((assignment) => assignment.status === "draft")?.id ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAutoResumeDraftId("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [category, selectedScopeOrgId]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2">
        {([
          { key: "DAILY", title: "日常任务", desc: "切到哪个基地，就维护哪个基地当前这套日常任务与草稿。", icon: <ClipboardCheck size={18} /> },
          { key: "TEMPORARY", title: "临时任务", desc: "适合临时通知或活动安排，继续按组织范围和截止时间发放。", icon: <Clock3 size={18} /> },
        ] as const).map((item) => {
          const active = category === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setCategory(item.key)}
              className={`rounded-3xl border p-5 text-left transition ${active ? "border-blue-300 bg-blue-50 shadow-[0_12px_30px_rgba(76,114,255,0.12)]" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-2xl p-3 ${active ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"}`}>{item.icon}</div>
                <div>
                  <p className="text-xl font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-base text-slate-500">{item.desc}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {category === "DAILY" && (
        <section className="space-y-4 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">选择管理基地</h2>
              <p className="mt-1 text-sm text-slate-500">切到哪个基地，下面的日常任务向导就会直接在该基地范围内保存草稿并执行发放。</p>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/tasks/assignment-management/daily?scopeOrgId=${selectedScopeOrgId}`)}
              disabled={!selectedScopeOrgId}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              进入完整管理页
            </button>
          </div>

          <div className="min-w-[280px] max-w-xl">
            <label className="text-xs font-medium text-slate-500">当前管理基地</label>
            <select
              value={selectedScopeOrgId}
              onChange={(event) => setSelectedScopeOrgId(event.target.value)}
              disabled={availableBaseOrgs.length <= 1 && Boolean(selectedScopeOrgId)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">{availableBaseOrgs.length ? "请选择基地" : "当前身份下暂无可管理基地"}</option>
              {availableBaseOrgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}（{org.orgCode}）
                </option>
              ))}
            </select>
          </div>

          <div className={`rounded-2xl px-4 py-3 text-sm ${selectedScopeOrg ? "border border-blue-100 bg-blue-50 text-blue-700" : "border border-amber-100 bg-amber-50 text-amber-700"}`}>
            {selectedScopeOrg
              ? `当前已切换到“${selectedScopeOrg.name}”基地，下面的向导会直接按这个基地范围处理日常任务。`
              : requiresBaseSelection
                ? "请先选择一个基地，再继续制作和发布该基地的日常任务。"
                : "当前身份暂未落到具体基地，选定后再继续发放。"}
          </div>
        </section>
      )}

      {loading ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">任务发放配置加载中...</div>
      ) : category === "DAILY" ? (
        selectedScopeOrgId ? (
          <DailyTaskWizard
            key={selectedScopeOrgId || "daily-empty-scope"}
            templates={templates}
            orgs={orgs}
            currentOrgId={currentIdentity?.orgId}
            managementOrgId={selectedScopeOrgId}
            managementScopePath={selectedScopeOrg?.path}
            managementOrgName={selectedScopeOrg?.name}
            canManageTemplates={canManageTemplates}
            initialAssignmentId={resolvedInitialAssignmentId}
            onReload={loadData}
            onIssued={() => navigate(`/tasks/assignment-management/daily?scopeOrgId=${selectedScopeOrgId}`)}
          />
        ) : null
      ) : (
        <TemporaryIssuePanel
          templates={templates}
          orgs={orgs}
          currentOrgId={currentIdentity?.orgId}
          canManageTemplates={canManageTemplates}
          onReload={loadData}
          onIssued={() => navigate("/tasks/assignment-management/temporary")}
        />
      )}
    </div>
  );
}
