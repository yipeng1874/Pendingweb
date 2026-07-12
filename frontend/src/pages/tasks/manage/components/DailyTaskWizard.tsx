import { useEffect, useMemo, useState } from "react";
import { Bell, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Copy, Eye, Loader2, PowerOff, Trash2 } from "lucide-react";


import type { DailyPublishPreview, OrgUnit, TaskAssignment, TaskAssignmentExclusion, TaskEffectMode, TaskTemplate } from "../../../../types";

import { assignmentApi, notifyApi, templateApi } from "../../../../services/task";

import { DailyNotifyScheduleModal } from "../../components/DailyNotifyScheduleModal";
import { DailyExclusionSelector, type ExcludedAnchorMeta } from "./DailyExclusionSelector";

import { TaskTemplateDrawer } from "./TaskTemplateDrawer";

type Props = {
  templates: TaskTemplate[];
  draftTemplatesPage?: TaskTemplate[];
  orgs: OrgUnit[];
  currentOrgId?: string;
  currentScopePath?: string;
  canManageTemplates: boolean;
  initialAssignmentId?: string;
  scheduledAssignments?: TaskAssignment[];
  activeAssignments?: TaskAssignment[];
  endedAssignments?: TaskAssignment[];
  loadAssignmentsByStatus?: (scopeOrgId: string, status: "scheduled" | "active" | "ended", offset?: number, limit?: number) => Promise<TaskAssignment[]>;
  loadDraftTemplatesPage?: (scopeOrgId: string, offset?: number, limit?: number) => Promise<TaskTemplate[]>;
  onReload: () => Promise<void> | void;
  onIssued: () => void;
};

type ExcludedOrgSection = {
  title: string;
  items: OrgUnit[];
};

type ExcludedAnchorSummary = ExcludedAnchorMeta & {
  hallLabel: string;
};

type PageKey = "draft" | "scheduled" | "active" | "ended";

type PageState = {
  draft: number;
  scheduled: number;
  active: number;
  ended: number;
};

const PAGE_SIZE = 3;

function getPreviewRelationMeta(relation: DailyPublishPreview["overlappingAssignments"][number]["relation"]) {
  switch (relation) {
    case "same_scope":
      return { label: "同级任务", badge: "bg-red-50 text-red-600" };
    case "ancestor_scope":
      return { label: "上级任务", badge: "bg-amber-50 text-amber-700" };
    case "descendant_scope":
      return { label: "下级任务", badge: "bg-violet-50 text-violet-600" };
    default:
      return { label: "重叠任务", badge: "bg-slate-100 text-slate-600" };
  }
}



function extractKnownExcludedAnchors(exclusions?: TaskAssignmentExclusion[]) {

  const entries = (exclusions ?? [])
    .filter((item) => item.exclusionType === "ANCHOR" && item.anchorProfile)
    .map((item) => {
      const anchor = item.anchorProfile!;
      return [
        anchor.id,
        {
          id: anchor.id,
          nickname: anchor.nickname,
          douyinNo: anchor.douyinNo,
          douyinUid: anchor.douyinUid,
          phone: anchor.identities?.[0]?.user?.phone ?? undefined,
          hallOrgId: anchor.hallOrgId ?? undefined,
          hallOrgName: anchor.hallOrg?.name ?? undefined,
        } satisfies ExcludedAnchorMeta,
      ] as const;
    });

  return Object.fromEntries(entries) as Record<string, ExcludedAnchorMeta>;
}

function createExcludedOrgSections(excludedOrgIds: string[], orgMap: Map<string, OrgUnit>): ExcludedOrgSection[] {
  const rows = excludedOrgIds.map((orgId) => orgMap.get(orgId)).filter(Boolean) as OrgUnit[];
  const grouped: Record<OrgUnit["orgType"], OrgUnit[]> = { HQ: [], BASE: [], TEAM: [], HALL: [] };

  rows.forEach((row) => {
    grouped[row.orgType].push(row);
  });

  return [
    { title: "排除基地", items: grouped.BASE },
    { title: "排除团队", items: grouped.TEAM },
    { title: "排除厅", items: grouped.HALL },
  ]
    .map((section) => ({
      ...section,
      items: [...section.items].sort((left, right) => left.path.localeCompare(right.path)),
    }))
    .filter((section) => section.items.length > 0);
}

function createExcludedAnchorSummaries(
  excludedAnchorProfileIds: string[],
  knownExcludedAnchors: Record<string, ExcludedAnchorMeta>,
  orgMap: Map<string, OrgUnit>
): ExcludedAnchorSummary[] {
  return excludedAnchorProfileIds
    .map((anchorId) => {
      const anchor = knownExcludedAnchors[anchorId] ?? { id: anchorId, nickname: `主播 ${anchorId.slice(0, 6)}` };
      const fallbackHallName = anchor.hallOrgId ? orgMap.get(anchor.hallOrgId)?.name : undefined;
      return {
        ...anchor,
        hallLabel: anchor.hallOrgName || fallbackHallName || "未识别所属厅",
      };
    })
    .sort((left, right) => left.hallLabel.localeCompare(right.hallLabel) || left.nickname.localeCompare(right.nickname));
}

function BookPagination({
  page,
  hasNext,
  loading,
  onPrev,
  onNext,
}: {
  page: number;
  hasNext: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2 border-t border-slate-200 pt-4">
      <button
        type="button"
        onClick={onPrev}
        disabled={page <= 1 || loading}
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronLeft size={12} />上一页
      </button>
      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">第 {page} 页</span>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext || loading}
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        下一页<ChevronRight size={12} />
      </button>
    </div>
  );
}

export function DailyTaskWizard({
  templates,
  draftTemplatesPage = [],
  orgs,
  currentOrgId,
  managementOrgId,
  managementScopePath,
  managementOrgName,
  canManageTemplates,
  initialAssignmentId,
  scheduledAssignments = [],
  activeAssignments = [],
  endedAssignments = [],
  loadAssignmentsByStatus,
  loadDraftTemplatesPage,
  onReload,
  onIssued,
}: Props & { managementOrgId?: string; managementScopePath?: string; managementOrgName?: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [draftAssignmentId, setDraftAssignmentId] = useState("");
  const [excludedOrgIds, setExcludedOrgIds] = useState<string[]>([]);
  const [excludedAnchorProfileIds, setExcludedAnchorProfileIds] = useState<string[]>([]);
  const [knownExcludedAnchors, setKnownExcludedAnchors] = useState<Record<string, ExcludedAnchorMeta>>({});
  const [effectMode, setEffectMode] = useState<TaskEffectMode>("next_midnight");
  const [publishPreview, setPublishPreview] = useState<DailyPublishPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCountdown, setConfirmCountdown] = useState(3);
  const [pendingPublishAssignmentId, setPendingPublishAssignmentId] = useState("");

  const [archivingTemplateId, setArchivingTemplateId] = useState("");
  const [notice, setNotice] = useState<string>("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const [viewingTemplateId, setViewingTemplateId] = useState("");
  const [notifyPrefix, setNotifyPrefix] = useState("");
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [notifyPreview, setNotifyPreview] = useState<null | { total: number; pendingCount: number; inProgressCount: number; unboundCount: number; prefixPlaceholder: string }>(null);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [draftPage, setDraftPage] = useState<TaskTemplate[]>([]);

  const [scheduledPage, setScheduledPage] = useState<TaskAssignment[]>([]);
  const [activePage, setActivePage] = useState<TaskAssignment[]>([]);
  const [endedPage, setEndedPage] = useState<TaskAssignment[]>([]);
  const [pageState, setPageState] = useState<PageState>({ draft: 1, scheduled: 1, active: 1, ended: 1 });
  const [pageHasMore, setPageHasMore] = useState<Record<PageKey, boolean>>({ draft: false, scheduled: false, active: false, ended: false });
  const [loadingPageKey, setLoadingPageKey] = useState<PageKey | null>(null);

  const currentOrg = orgs.find((org) => org.id === currentOrgId) ?? null;
  const scopeOrg = orgs.find((org) => org.id === managementOrgId) ?? orgs.find((org) => org.path === managementScopePath) ?? currentOrg;
  const orgMap = useMemo(() => new Map(orgs.map((org) => [org.id, org])), [orgs]);

  const visibleTemplates = useMemo(() => {
    if (!managementOrgId) return [];
    return templates.filter((template) => template.category === "DAILY" && template.status !== "archived" && template.orgId === managementOrgId);
  }, [managementOrgId, templates]);

  const selectedTemplate = visibleTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const scopeParams = managementOrgId ? { scopeOrgId: managementOrgId } : undefined;
  const draftTemplates = useMemo(() => visibleTemplates.filter((template) => template.status === "draft" && (template._count?.assignments ?? 0) === 0), [visibleTemplates]);
  const excludedOrgSections = useMemo(() => createExcludedOrgSections(excludedOrgIds, orgMap), [excludedOrgIds, orgMap]);
  const excludedAnchorSummaries = useMemo(
    () => createExcludedAnchorSummaries(excludedAnchorProfileIds, knownExcludedAnchors, orgMap),
    [excludedAnchorProfileIds, knownExcludedAnchors, orgMap]
  );

  useEffect(() => {
    if (selectedTemplateId && templates.some((t) => t.id === selectedTemplateId)) return;
    if (selectedTemplateId && visibleTemplates.some((template) => template.id === selectedTemplateId)) return;
    const preferDraft = draftTemplates[0] ?? visibleTemplates[0];
    setSelectedTemplateId(preferDraft?.id ?? "");
  }, [draftTemplates, selectedTemplateId, visibleTemplates, templates]);

  useEffect(() => {
    setPageState({ draft: 1, scheduled: 1, active: 1, ended: 1 });
  }, [managementOrgId]);

  useEffect(() => {
    setDraftPage(draftTemplatesPage);
    setPageHasMore((current) => ({ ...current, draft: draftTemplatesPage.length === PAGE_SIZE }));
  }, [draftTemplatesPage]);

  useEffect(() => {
    if (!initialAssignmentId) return;
    assignmentApi
      .getById(initialAssignmentId)
      .then((assignment) => {
        if (assignment.category !== "DAILY" || assignment.status !== "draft") return;
        setDraftAssignmentId(assignment.id);
        setSelectedTemplateId(assignment.templateId);
        setExcludedOrgIds((assignment.exclusions ?? []).filter((item) => item.exclusionType === "ORG" && item.orgId).map((item) => item.orgId!));
        setExcludedAnchorProfileIds((assignment.exclusions ?? []).filter((item) => item.exclusionType === "ANCHOR" && item.anchorProfileId).map((item) => item.anchorProfileId!));
        setKnownExcludedAnchors(extractKnownExcludedAnchors(assignment.exclusions));
        setEffectMode(assignment.effectMode ?? "next_midnight");
        setStep(1);
        setNotice("已恢复上次未发放的主播日常任务草稿，请确认或更改任务表单后继续。");
      })
      .catch(console.error);
  }, [initialAssignmentId]);

  useEffect(() => {
    if (!confirmOpen || confirmCountdown <= 0) return;
    const timer = window.setTimeout(() => setConfirmCountdown((value) => Math.max(value - 1, 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [confirmCountdown, confirmOpen]);

  useEffect(() => {
    setScheduledPage(scheduledAssignments);
    setPageHasMore((current) => ({ ...current, scheduled: scheduledAssignments.length === PAGE_SIZE }));
  }, [scheduledAssignments]);

  useEffect(() => {
    setActivePage(activeAssignments);
    setPageHasMore((current) => ({ ...current, active: activeAssignments.length === PAGE_SIZE }));
  }, [activeAssignments]);

  useEffect(() => {
    setEndedPage(endedAssignments);
    setPageHasMore((current) => ({ ...current, ended: endedAssignments.length === PAGE_SIZE }));
  }, [endedAssignments]);

  async function loadPublishPreview(assignmentId: string) {
    setPreviewing(true);
    const result = await assignmentApi.getDailyPublishPreview(assignmentId, scopeParams).catch(console.error);
    setPreviewing(false);
    if (!result) return null;
    setPublishPreview(result);
    return result;
  }

  async function loadPage(statusKey: PageKey, page: number) {
    if (!managementOrgId) return;
    setLoadingPageKey(statusKey);
    const offset = (page - 1) * PAGE_SIZE;

    try {
      if (statusKey === "draft") {
        const rows = loadDraftTemplatesPage
          ? await loadDraftTemplatesPage(managementOrgId, offset, PAGE_SIZE).catch(() => [] as TaskTemplate[])
          : [];
        setDraftPage(rows);
        setPageHasMore((current) => ({ ...current, draft: rows.length === PAGE_SIZE }));
        setPageState((current) => ({ ...current, draft: page }));
        return;
      }

      const rows = loadAssignmentsByStatus
        ? await loadAssignmentsByStatus(managementOrgId, statusKey as "scheduled" | "active" | "ended", offset, PAGE_SIZE).catch(() => [] as TaskAssignment[])
        : await assignmentApi.list({ category: "DAILY", scopeOrgId: managementOrgId, status: statusKey, limit: PAGE_SIZE, offset }).catch(() => [] as TaskAssignment[]);

      if (statusKey === "scheduled") setScheduledPage(rows);
      if (statusKey === "active") setActivePage(rows);
      if (statusKey === "ended") setEndedPage(rows);
      setPageHasMore((current) => ({ ...current, [statusKey]: rows.length === PAGE_SIZE }));
      setPageState((current) => ({ ...current, [statusKey]: page }));
    } finally {
      setLoadingPageKey(null);
    }
  }

  async function handlePageChange(statusKey: PageKey, nextPage: number) {
    if (nextPage < 1) return;
    await loadPage(statusKey, nextPage);
  }

  async function persistDailyDraft(overrideTemplate?: typeof selectedTemplate, overrideAssignmentId?: string) {
    const template = overrideTemplate ?? selectedTemplate;
    if (!template || !managementOrgId) return null;
    // overrideAssignmentId 为 "" 时代表强制新建，undefined 时使用 state 中的值
    const resolvedAssignmentId = overrideAssignmentId !== undefined ? overrideAssignmentId : draftAssignmentId;
    const isNewDraft = !resolvedAssignmentId;
    setSavingDraft(true);
    const result = await assignmentApi
      .saveDailyDraft({
        assignmentId: resolvedAssignmentId || undefined,
        templateId: template.id,
        orgIds: [managementOrgId],
        scopeOrgId: managementOrgId,
        excludedOrgIds,
        excludedAnchorProfileIds,
        effectMode,
      })
      .catch(console.error);
    setSavingDraft(false);
    if (!result) return null;
    setDraftAssignmentId(result.id);
    setKnownExcludedAnchors((current) => ({ ...current, ...extractKnownExcludedAnchors(result.exclusions) }));
    setNotice(isNewDraft ? "已创建当前主播日常任务发放草稿，后续保存都会持续更新这一份。" : "当前主播日常任务发放草稿已更新，未执行发放前都不会影响主播端。");

    if (step === 3) {
      void loadPublishPreview(result.id);
    }
    return result;
  }

  async function handleNext(nextStep: 2 | 3, overrideTemplate?: typeof selectedTemplate, overrideAssignmentId?: string) {
    const template = overrideTemplate ?? selectedTemplate;
    if (!template) return;
    const saved = await persistDailyDraft(template, overrideAssignmentId);
    if (!saved) return;
    if (nextStep === 3) {
      await loadPublishPreview(saved.id);
    } else {
      setPublishPreview(null);
    }
    setStep(nextStep);
  }

  async function handleIssue() {
    if (!selectedTemplate) return;

    const saved = await persistDailyDraft();
    if (!saved) return;
    await loadPublishPreview(saved.id);
    setPendingPublishAssignmentId(saved.id);
    setConfirmCountdown(3);
    setConfirmOpen(true);
  }

  async function executeConfirmedIssue() {
    if (!pendingPublishAssignmentId || confirmCountdown > 0) return;
    setIssuing(true);
    const published = await assignmentApi.publishDailyDraft(pendingPublishAssignmentId, effectMode, managementOrgId).catch((error) => {
      if (error instanceof Error && error.message.includes("DAILY_SCHEDULED_EXISTS")) {
        window.alert("当前基地已有待生效主播日常任务，请先删除待生效任务后再发布新的主播日常任务。");
        return null;
      }
      console.error(error);
      window.alert(error instanceof Error ? error.message : "主播日常任务发放失败");
      return null;
    });
    setIssuing(false);
    if (!published) return;
    setConfirmOpen(false);
    setPendingPublishAssignmentId("");
    setNotice(
      effectMode === "immediate"
        ? "新的主播日常任务已立即生效；同级旧任务已自动结束，重叠范围会按最后发布任务执行。"
        : "新的主播日常任务已排入次日凌晨生效队列；到时同级旧任务会自动结束，重叠范围会切换到这次发布。"
    );
    await onReload();
    onIssued();
  }


  async function handleDeleteDraft() {
    if (!draftAssignmentId || !window.confirm("确认删除当前主播日常任务草稿？删除后需要重新发起。")) return;
    await assignmentApi.delete(draftAssignmentId).catch(console.error);
    setDraftAssignmentId("");
    setExcludedOrgIds([]);
    setExcludedAnchorProfileIds([]);
    setKnownExcludedAnchors({});
    setPublishPreview(null);
    setStep(1);
    setNotice("当前日常任务草稿已删除。");

  }

  async function handleDailyFeishuNotify() {
    if (!managementOrgId) {
      setNotice("请先选择基地");
      return;
    }
    setNotifyLoading(true);
    try {
      const preview = await notifyApi.getDailyFeishuPreview(undefined, managementOrgId);
      const defaultPrefix = notifyPrefix.trim() || preview.prefixPlaceholder;
      setNotifyPrefix(defaultPrefix);
      setNotifyPreview({
        total: preview.total,
        pendingCount: preview.pendingCount,
        inProgressCount: preview.inProgressCount,
        unboundCount: preview.unboundCount,
        prefixPlaceholder: preview.prefixPlaceholder,
      });
      setNotifyDialogOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "飞书通知预览失败");
    } finally {
      setNotifyLoading(false);
    }
  }

  async function confirmDailyFeishuNotify() {
    if (!managementOrgId) {
      setNotice("请先选择基地");
      return;
    }
    setNotifyLoading(true);
    try {
      const prefix = notifyPrefix.trim() || notifyPreview?.prefixPlaceholder || "来自系统提醒";
      const result = await notifyApi.sendDailyFeishu({ scopeOrgId: managementOrgId, prefix });
      setNotifyPrefix(prefix);
      const successCount = result.results.reduce((sum, item) => sum + item.successCount, 0);
      setNotifyDialogOpen(false);
      setNotifyPreview(null);
      setNotice(`飞书通知已执行，成功 ${successCount} 人，未绑定 ${result.summary.unboundCount} 人。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "飞书通知发送失败");
    } finally {
      setNotifyLoading(false);
    }
  }

  async function handleEditTemplate(template: TaskTemplate) {
    if (!canManageTemplates) return;
    setEditingTemplate(template);
    setEditorReadOnly(false);
    setEditorOpen(true);
  }

  async function handleCopyTemplateById(templateId?: string) {
    if (!canManageTemplates || !templateId) return;
    const copied = await templateApi.copy(templateId, scopeParams).catch((error) => {
      window.alert(error instanceof Error ? error.message : "复制模板失败");
      return null;
    });
    if (!copied) return;
    await onReload();
    setSelectedTemplateId(copied.id);
    setEditingTemplate(copied);
    setEditorReadOnly(false);
    setEditorOpen(true);
    setNotice("已基于历史模板复制出新的草稿，可继续调整后再发放。");
  }

  async function handleViewTemplate(template: TaskTemplate, assignmentId?: string) {
    setEditorReadOnly(true);
    setViewingTemplateId(assignmentId || template.id);
    try {
      if (assignmentId) {
        const assignment = await assignmentApi.getById(assignmentId, scopeParams);
        setEditingTemplate((assignment.template as TaskTemplate) ?? template);
      } else {
        const detailedTemplate = await templateApi.getById(template.id, scopeParams);
        setEditingTemplate(detailedTemplate);
      }
      setEditorOpen(true);
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "加载表单内容失败");
    } finally {
      setViewingTemplateId("");
    }
  }

  async function handleAssignmentLifecycleAction(assignment: TaskAssignment) {
    if (!managementOrgId) return;
    const isScheduled = assignment.status === "scheduled";
    const actionLabel = isScheduled ? "删除待生效任务" : "结束任务";
    const confirmed = window.confirm(`确认${actionLabel}「${assignment.template?.title ?? "未命名主播日常任务"}」吗？`);
    if (!confirmed) return;
    const result = isScheduled
      ? await assignmentApi.delete(assignment.id, scopeParams).catch((error) => {
          window.alert(error instanceof Error ? error.message : `${actionLabel}失败`);
          return null;
        })
      : await assignmentApi.close(assignment.id, managementOrgId).catch((error) => {
          window.alert(error instanceof Error ? error.message : `${actionLabel}失败`);
          return null;
        });
    if (!result) return;
    if (isScheduled) {
      setDraftAssignmentId("");
      setExcludedOrgIds([]);
      setExcludedAnchorProfileIds([]);
      setKnownExcludedAnchors({});
      setPublishPreview(null);
      setStep(1);
      setSelectedTemplateId((result as { templateId?: string })?.templateId ?? "");
      setNotice("待生效任务已取消，并已退回一份模板草稿；覆盖范围、生效方式和排除设置已清除，可在第一步继续编辑后重新发布。");
    } else {
      setNotice("当前生效中的主播日常任务已结束。");
    }
    await onReload();
  }

  async function handleDeleteTemplate(template: TaskTemplate) {
    if (!canManageTemplates) return;
    if (template.status !== "draft") {
      window.alert("只有草稿模板可以删除，已发放使用过的模板不支持删除操作。");
      return;
    }
    const confirmed = window.confirm("确认删除这份模板草稿？未正式发放的关联草稿也会一并清理。");
    if (!confirmed) return;

    setArchivingTemplateId(template.id);
    try {
      const result = await templateApi.delete(template.id, scopeParams).catch((error) => {
        window.alert(error instanceof Error ? error.message : "删除表单草稿失败");
        return null;
      });
      if (!result) return;

      if (selectedTemplateId === template.id) {
        setSelectedTemplateId("");
        setDraftAssignmentId("");
        setExcludedOrgIds([]);
        setExcludedAnchorProfileIds([]);
        setKnownExcludedAnchors({});
        setEffectMode("next_midnight");
        setStep(1);
      }

      setNotice("表单草稿已删除，不会再出现在当前列表。");
      await onReload();
    } finally {
      setArchivingTemplateId("");
    }
  }

  const totalExcludedCount = excludedOrgIds.length + excludedAnchorProfileIds.length;

  return (
    <div className="space-y-6">
      {notice && <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</div>}

      {!managementOrgId && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">请先选择要维护的基地，系统会自动接管这个基地当前的草稿和发布状态。</div>}

      <DailyNotifyScheduleModal
        open={scheduleDialogOpen}
        scopeOrgId={managementOrgId}
        scopeOrgName={managementOrgName ?? scopeOrg?.name}
        onClose={() => setScheduleDialogOpen(false)}
        onSuccessMessage={setNotice}
      />

      {notifyDialogOpen && notifyPreview && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">确认发送主播日常任务通知</h3>
                <p className="mt-1 text-sm text-slate-500">发送前请确认本次待通知人数与文案前缀。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (notifyLoading) return;
                  setNotifyDialogOpen(false);
                  setNotifyPreview(null);
                }}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-xs text-slate-500">通知前缀</label>
                <input
                  type="text"
                  value={notifyPrefix}
                  onChange={(event) => setNotifyPrefix(event.target.value)}
                  placeholder={notifyPreview.prefixPlaceholder || "来自系统提醒"}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">待通知总数</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{notifyPreview.total}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">未绑定飞书</p>
                  <p className="mt-1 text-2xl font-bold text-amber-600">{notifyPreview.unboundCount}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">未完成</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{notifyPreview.pendingCount}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">进行中</p>
                  <p className="mt-1 text-2xl font-bold text-blue-600">{notifyPreview.inProgressCount}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-700">
                本次只会通知当前仍未完成的对象；未绑定飞书的账号不会收到消息。
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (notifyLoading) return;
                  setNotifyDialogOpen(false);
                  setNotifyPreview(null);
                }}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmDailyFeishuNotify()}
                disabled={notifyLoading}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {notifyLoading ? <><Loader2 size={15} className="animate-spin" />发送中...</> : <><Bell size={15} />确认发送</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <section className="space-y-5 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">第一步：选择主播日常任务</h3>
              <p className="mt-1 text-sm text-slate-500">主播日常任务严格区分为草稿、待生效、生效中、已结束四类；只有草稿可以继续进入发布流程。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDailyFeishuNotify()}
                disabled={!managementOrgId || notifyLoading}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {notifyLoading ? <><Loader2 size={15} className="animate-spin" />发送中...</> : <><Bell size={15} />发送飞书通知</>}
              </button>
              <button
                type="button"
                onClick={() => setScheduleDialogOpen(true)}
                disabled={!managementOrgId}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Clock3 size={15} />定时通知设置
              </button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
            <section className="flex h-[620px] flex-col rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h4 className="text-lg font-semibold text-slate-900">草稿</h4>
                  <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-700">{draftTemplates.length}</span>
                </div>
                {canManageTemplates && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!managementOrgId) return;
                      setEditingTemplate(null);
                      setEditorOpen(true);
                    }}
                    disabled={!managementOrgId}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ClipboardCheck size={14} />新建日常任务
                  </button>
                )}
              </div>
              <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                {draftTemplates.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-sm text-slate-400">{managementOrgName ? `${managementOrgName} 当前没有草稿任务。` : "请先选择基地，再查看或创建该基地专属的日常表单。"}</div>
                ) : (
                  <>
                    {draftPage.map((template) => (
                      <div
                        key={template.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedTemplateId(template.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedTemplateId(template.id);
                          }
                        }}
                        className={`w-full cursor-pointer rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-[0_2px_12px_rgba(15,23,42,0.04)] transition ${selectedTemplateId === template.id ? "border-blue-300 bg-blue-50 shadow-[0_12px_30px_rgba(76,114,255,0.10)]" : "hover:bg-slate-50"}`}
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-600">草稿</span>
                          <span className="text-xs text-slate-400">v{template.version}</span>
                          {selectedTemplateId === template.id && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">当前已选择</span>}
                        </div>
                        <p className="font-semibold text-slate-900 line-clamp-2">{template.title}</p>
                        {template.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{template.description}</p>}
                        <p className="mt-2 text-xs text-slate-400">{template.items?.length ?? 0} 个子任务</p>
                        <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1">
                          <button type="button" onClick={(event) => { event.stopPropagation(); void handleEditTemplate(template); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-white">编辑</button>
                          <button type="button" onClick={(event) => { event.stopPropagation(); void handleDeleteTemplate(template); }} disabled={archivingTemplateId === template.id} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">{archivingTemplateId === template.id ? "处理中..." : "删除"}</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
              {draftTemplates.length > 0 && (
                <BookPagination
                  page={pageState.draft}
                  hasNext={pageHasMore.draft}
                  loading={loadingPageKey === "draft"}
                  onPrev={() => void handlePageChange("draft", pageState.draft - 1)}
                  onNext={() => void handlePageChange("draft", pageState.draft + 1)}
                />
              )}
            </section>

            <section className="flex h-[620px] flex-col gap-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-cyan-100 bg-white/80 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h4 className="text-lg font-semibold text-slate-900">待生效</h4>
                  <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-700">{scheduledAssignments.length}</span>
                </div>
                <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                  {scheduledAssignments.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-sm text-slate-400">当前没有待生效任务。</div>
                  ) : (
                    <>
                      {scheduledPage.map((assignment) => (
                        <div key={assignment.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
                          <p className="font-semibold text-slate-900 line-clamp-2">{assignment.template?.title ?? "未命名主播日常任务"}</p>
                          <p className="mt-2 text-xs text-slate-400">生效时间：{assignment.effectiveAt ? new Date(assignment.effectiveAt).toLocaleString("zh-CN") : "未记录"}</p>
                          <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1">
                            {assignment.template && <button type="button" onClick={() => void handleViewTemplate(assignment.template as TaskTemplate, assignment.id)} disabled={viewingTemplateId === assignment.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{viewingTemplateId === assignment.id ? <><Loader2 size={12} className="animate-spin" />加载中...</> : <><Eye size={12} />查看内容</>}</button>}
                            <button type="button" onClick={() => void handleAssignmentLifecycleAction(assignment)} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50"><PowerOff size={12} />取消待生效</button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {scheduledAssignments.length > 0 && (
                  <BookPagination
                    page={pageState.scheduled}
                    hasNext={pageHasMore.scheduled}
                    loading={loadingPageKey === "scheduled"}
                    onPrev={() => void handlePageChange("scheduled", pageState.scheduled - 1)}
                    onNext={() => void handlePageChange("scheduled", pageState.scheduled + 1)}
                  />
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-emerald-100 bg-white/80 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h4 className="text-lg font-semibold text-slate-900">生效中</h4>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">{activeAssignments.length}</span>
                </div>
                <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                  {activeAssignments.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-sm text-slate-400">当前没有生效中任务。</div>
                  ) : (
                    <>
                      {activePage.map((assignment) => (
                        <div key={assignment.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
                          <p className="font-semibold text-slate-900 line-clamp-2">{assignment.template?.title ?? "未命名主播日常任务"}</p>
                          <p className="mt-2 text-xs text-slate-400">生效时间：{assignment.effectiveAt ? new Date(assignment.effectiveAt).toLocaleString("zh-CN") : "未记录"}</p>
                          <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1">
                            {assignment.template && <button type="button" onClick={() => void handleViewTemplate(assignment.template as TaskTemplate, assignment.id)} disabled={viewingTemplateId === assignment.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{viewingTemplateId === assignment.id ? <><Loader2 size={12} className="animate-spin" />加载中...</> : <><Eye size={12} />查看内容</>}</button>}
                            {canManageTemplates && assignment.templateId && <button type="button" onClick={() => void handleCopyTemplateById(assignment.templateId)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"><Copy size={12} />复制为草稿</button>}
                            <button type="button" onClick={() => void handleAssignmentLifecycleAction(assignment)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"><PowerOff size={12} />结束任务</button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {activeAssignments.length > 0 && (
                  <BookPagination
                    page={pageState.active}
                    hasNext={pageHasMore.active}
                    loading={loadingPageKey === "active"}
                    onPrev={() => void handlePageChange("active", pageState.active - 1)}
                    onNext={() => void handlePageChange("active", pageState.active + 1)}
                  />
                )}
              </div>
            </section>

            <section className="flex h-[620px] flex-col rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h4 className="text-lg font-semibold text-slate-900">已结束</h4>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{endedAssignments.length}</span>
              </div>
              <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                {endedAssignments.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-sm text-slate-400">当前没有已结束任务。</div>
                ) : (
                  <>
                    {endedPage.map((assignment) => (
                      <div key={assignment.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
                        <p className="font-semibold text-slate-900 line-clamp-2">{assignment.template?.title ?? "未命名主播日常任务"}</p>
                        <p className="mt-2 text-xs text-slate-400">结束时间：{assignment.endedAt ? new Date(assignment.endedAt).toLocaleString("zh-CN") : "未记录"}</p>
                        <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1">
                          {assignment.template && <button type="button" onClick={() => void handleViewTemplate(assignment.template as TaskTemplate, assignment.id)} disabled={viewingTemplateId === assignment.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{viewingTemplateId === assignment.id ? <><Loader2 size={12} className="animate-spin" />加载中...</> : <><Eye size={12} />查看内容</>}</button>}
                          {canManageTemplates && assignment.templateId && <button type="button" onClick={() => void handleCopyTemplateById(assignment.templateId)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"><Copy size={12} />复制为草稿</button>}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
              {endedAssignments.length > 0 && (
                <BookPagination
                  page={pageState.ended}
                  hasNext={pageHasMore.ended}
                  loading={loadingPageKey === "ended"}
                  onPrev={() => void handlePageChange("ended", pageState.ended - 1)}
                  onNext={() => void handlePageChange("ended", pageState.ended + 1)}
                />
              )}
            </section>
          </div>

          {scheduledAssignments.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              当前存在待生效任务，请先在“待生效”列中取消退回草稿后，再进入下一步，避免误操作。
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleNext(2)}
              disabled={!selectedTemplate || !managementOrgId || savingDraft || scheduledAssignments.length > 0}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingDraft ? (
                <><Loader2 size={15} className="animate-spin" />保存草稿中...</>
              ) : scheduledAssignments.length > 0 ? (
                <>请先处理待生效任务</>
              ) : (
                <>下一步：配置排除树 <ChevronRight size={15} /></>
              )}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-3 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">第二步：选择发放人群</h3>
          </div>
          <DailyExclusionSelector
            orgs={orgs}
            scopePath={managementScopePath}
            excludedOrgIds={excludedOrgIds}
            excludedAnchorProfileIds={excludedAnchorProfileIds}
            knownExcludedAnchors={knownExcludedAnchors}
            onExcludedOrgIdsChange={setExcludedOrgIds}
            onExcludedAnchorProfileIdsChange={setExcludedAnchorProfileIds}
          />

          <div className="flex flex-wrap justify-between gap-3">
            <button type="button" onClick={() => setStep(1)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
              返回上一步
            </button>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void persistDailyDraft()}
                disabled={savingDraft}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                保存当前修改
              </button>
              {draftAssignmentId && (
                <button type="button" onClick={() => void handleDeleteDraft()} className="rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50">
                  <span className="inline-flex items-center gap-1">
                    <Trash2 size={15} />删除草稿
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleNext(3)}
                disabled={savingDraft}
                className="rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
              >
                继续：执行发放
              </button>
            </div>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="grid gap-6 xl:grid-cols-[3fr_2fr] xl:items-start">
          <div className="space-y-5 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">第三步：执行发放</h3>
              <p className="mt-1 text-sm text-slate-500">发放后会形成正式主播日常任务；若与其他正式任务范围重叠，主播端会按最后发布的任务执行，同级旧任务会自动结束。</p>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              发布前请重点确认右侧排除名单和覆盖提醒；确认发放后，重叠主播会切换到这次发布的主播日常任务。
            </div>


            <div className="grid gap-4 md:grid-cols-1">
              {([
                { value: "next_midnight", title: "次日凌晨生效", desc: "当前任务先进入待生效状态，次日 00:00 自动接管重叠范围并结束同级旧任务。" },
                { value: "immediate", title: "立即生效", desc: "当前确认后立刻接管重叠范围；同级旧任务会自动结束，主播马上看到新工作手册。" },
              ] as const).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setEffectMode(item.value)}
                  className={`rounded-3xl border p-5 text-left transition ${effectMode === item.value ? "border-blue-300 bg-blue-50 shadow-[0_12px_30px_rgba(76,114,255,0.12)]" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                >
                  <p className="text-lg font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{item.desc}</p>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => setStep(2)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
                返回排除设置
              </button>
              <button
                type="button"
                onClick={() => void persistDailyDraft()}
                disabled={savingDraft}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                保存当前修改
              </button>
              {draftAssignmentId && (
                <button type="button" onClick={() => void handleDeleteDraft()} className="rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50">
                  <span className="inline-flex items-center gap-1">
                    <Trash2 size={15} />删除草稿
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleIssue()}
                disabled={issuing || savingDraft || !selectedTemplate}
                className="rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {issuing ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={15} className="animate-spin" />正在执行发放...
                  </span>
                ) : (
                  "确认发放为正式任务"
                )}
              </button>
            </div>

          </div>

          <aside className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div>
              <p className="text-sm font-semibold text-slate-900">发放摘要</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">右侧集中展示发放结果和排除名单，发布前快速核对。</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-3">
                <span>表单</span>
                <span className="max-w-[180px] truncate font-medium text-slate-900">{selectedTemplate?.title ?? "未选择"}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span>发放基线</span>
                <span className="max-w-[180px] truncate font-medium text-slate-900">{managementOrgName ?? scopeOrg?.name ?? "未选择基地"}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span>排除项总数</span>
                <span className="font-medium text-slate-900">{totalExcludedCount}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span>生效方式</span>
                <span className="font-medium text-slate-900">{effectMode === "immediate" ? "立即生效" : "次日凌晨生效"}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-slate-500">覆盖提醒</p>
                {previewing && <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Loader2 size={12} className="animate-spin" />计算中...</span>}
              </div>
              {publishPreview && publishPreview.affectedAssignmentCount > 0 ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-3 text-sm text-amber-700">
                    本次会影响 <span className="font-semibold">{publishPreview.affectedAssignmentCount}</span> 条现有正式任务，涉及 <span className="font-semibold">{publishPreview.affectedAnchorCount}</span> 名主播。
                    {publishPreview.autoEndedAssignmentCount > 0 && <p className="mt-1 text-xs text-amber-600">其中 {publishPreview.autoEndedAssignmentCount} 条同级任务会在新任务生效时自动结束。</p>}
                  </div>
                  <div className="space-y-2">
                    {publishPreview.overlappingAssignments.slice(0, 4).map((item) => {
                      const relation = getPreviewRelationMeta(item.relation);
                      return (
                        <div key={item.id} className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
                          <div className="flex items-center justify-between gap-3">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${relation.badge}`}>{relation.label}</span>
                            <span className="text-[11px] text-slate-400">影响 {item.affectedAnchorCount} 人</span>
                          </div>
                          <p className="mt-2 truncate font-medium text-slate-900">{item.templateTitle}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">范围：{item.targetOrgName}</p>
                          <p className="mt-1 text-xs text-slate-400">{item.willAutoEnd ? "同级旧任务会自动结束" : "重叠主播将改用这次新任务"}</p>
                        </div>
                      );
                    })}
                  </div>
                  {publishPreview.overlappingAssignments.length > 4 && (
                    <p className="text-xs text-slate-400">其余 {publishPreview.overlappingAssignments.length - 4} 条重叠任务将在确认发放后一起被覆盖。</p>
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                  {previewing ? "正在计算这次发布会覆盖哪些正式任务..." : "当前没有发现会被覆盖的正式主播日常任务。"}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">排除名单</p>
              <div className="mt-3 max-h-[480px] space-y-4 overflow-y-auto pr-1">

                {totalExcludedCount === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                    当前没有排除项，将覆盖当前范围内全部主播。
                  </div>
                ) : (
                  <>
                    {excludedOrgSections.map((section) => (
                      <div key={section.title} className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-xs font-medium text-slate-500">{section.title}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 2xl:grid-cols-3">
                          {section.items.map((org) => (
                            <span key={org.id} className="truncate rounded-xl bg-white px-3 py-2 text-sm text-slate-700" title={org.name}>{org.name}</span>
                          ))}
                        </div>
                      </div>
                    ))}

                    {excludedAnchorSummaries.length > 0 && (
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-xs font-medium text-slate-500">不参与任务主播</p>
                        <div className="mt-2 grid grid-cols-1 gap-2 2xl:grid-cols-2">
                          {excludedAnchorSummaries.map((anchor) => {
                            const douyinText = anchor.douyinNo || anchor.douyinUid || "未登记抖音号";
                            const phoneText = anchor.phone || "未绑定手机号";
                            return <span key={anchor.id} className="truncate rounded-xl bg-white px-3 py-2 text-sm text-slate-700" title={`${anchor.nickname}-${douyinText}-${phoneText}`}>{anchor.nickname}-{douyinText}-{phoneText}</span>;
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700">
              新的正式主播日常任务生效后，重叠主播会按最新发布任务执行；同级旧任务会自动结束，不需要人工收尾。
            </div>


          </aside>
        </section>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8">
          <div className="max-h-full w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
            <div className="border-b border-slate-100 px-6 py-5">
              <p className="text-lg font-semibold text-slate-900">二次确认：发放正式主播日常任务</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">请强制阅读以下内容，避免表单、生效方式或排除名单配置出错。倒计时结束后才能确认发放。</p>
            </div>
            <div className="max-h-[62vh] space-y-4 overflow-y-auto px-6 py-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">表单名称</p>
                  <p className="mt-2 truncate text-sm font-semibold text-slate-900" title={selectedTemplate?.title}>{selectedTemplate?.title ?? "未选择"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">生效方式</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{effectMode === "immediate" ? "立即生效" : "次日凌晨生效"}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-slate-500">排除名单</p>
                  <span className="text-xs font-medium text-slate-900">共 {totalExcludedCount} 项</span>
                </div>
                <div className="mt-3 max-h-56 space-y-3 overflow-y-auto pr-1">
                  {totalExcludedCount === 0 ? (
                    <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-700">当前没有排除名单，将覆盖当前基地范围内全部主播。</div>
                  ) : (
                    <>
                      {excludedOrgSections.map((section) => (
                        <div key={section.title}>
                          <p className="text-[11px] font-medium text-slate-400">{section.title}</p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {section.items.map((org) => (
                              <span key={org.id} className="truncate rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700" title={org.name}>{org.name}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                      {excludedAnchorSummaries.length > 0 && (
                        <div>
                          <p className="text-[11px] font-medium text-slate-400">不参与任务主播</p>
                          <div className="mt-2 space-y-2">
                            {excludedAnchorSummaries.map((anchor) => {
                              const douyinText = anchor.douyinNo || anchor.douyinUid || "未登记抖音号";
                              const phoneText = anchor.phone || "未绑定手机号";
                              return <p key={anchor.id} className="truncate rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700" title={`${anchor.nickname}-${douyinText}-${phoneText}`}>{anchor.nickname}-{douyinText}-{phoneText}</p>;
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                发布后会影响主播端待办生成；请确认表单名称、生效方式、排除名单完全正确后再继续。
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
              <span className="text-sm text-slate-500">{confirmCountdown > 0 ? `请继续阅读，${confirmCountdown}s 后可确认` : "已完成强制阅读，可以确认发放"}</span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmOpen(false);
                    setPendingPublishAssignmentId("");
                  }}
                  disabled={issuing}
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  返回修改
                </button>
                <button
                  type="button"
                  onClick={() => void executeConfirmedIssue()}
                  disabled={issuing || confirmCountdown > 0}
                  className="rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {issuing ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />正在发放...</span> : confirmCountdown > 0 ? `确认发放（${confirmCountdown}s）` : "我已核对，确认发放"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <TaskTemplateDrawer
        open={editorOpen}
        category="DAILY"
        currentOrgId={currentOrgId ?? ""}
        scopeOrgId={managementOrgId}
        template={editingTemplate}
        readOnly={editorReadOnly}
        onClose={() => setEditorOpen(false)}
        onSaved={async (template) => {
          setDraftAssignmentId("");
          setExcludedOrgIds([]);
          setExcludedAnchorProfileIds([]);
          setKnownExcludedAnchors({});
          setEditingTemplate(template);
          setEditorReadOnly(false);
          setEditorOpen(false);
          setNotice("表单草稿已保存，你可以继续完善排除名单再执行发放。");
          await onReload();
          setSelectedTemplateId(template.id);
        }}
        onSavedAndNext={async (template) => {
          // 与 Step1 主按钮保持一致：存在待生效任务时禁止进入下一步
          if (scheduledAssignments.length > 0) {
            window.alert("当前存在待生效任务，请先在「待生效」列中取消，再继续操作。");
            setEditorOpen(false);
            await onReload();
            setSelectedTemplateId(template.id);
            return;
          }
          setDraftAssignmentId("");
          setExcludedOrgIds([]);
          setExcludedAnchorProfileIds([]);
          setKnownExcludedAnchors({});
          setEditingTemplate(template);
          setEditorReadOnly(false);
          setEditorOpen(false);
          setNotice("表单草稿已创建，正在跳转到排除配置...");
          await onReload();
          setSelectedTemplateId(template.id);
          // 显式传入 "" 强制新建 assignment，避免 React state 异步未刷新导致复用旧 draftAssignmentId
          await handleNext(2, template, "");
        }}
      />
    </div>
  );
}
