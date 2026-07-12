import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Copy, Eye, Loader2, PowerOff, RefreshCw, Trash2 } from "lucide-react";

import type { OrgUnit, TaskEffectMode } from "../../../../types";
import { hallDailyApi, type HallTaskAssignment, type HallTaskTemplate } from "../../../../services/task";
import { TaskTemplateDrawer } from "./TaskTemplateDrawer";

// ─── 类型定义 ─────────────────────────────────────────────────────────────

type Props = {
  templates: HallTaskTemplate[];
  draftTemplatesPage?: HallTaskTemplate[];
  orgs: OrgUnit[];
  currentOrgId?: string;
  managementOrgId: string;   // 当前团队管理员所属团队 orgId
  managementOrgName?: string;
  canManageTemplates: boolean;
  initialAssignmentId?: string;
  scheduledAssignments?: HallTaskAssignment[];
  activeAssignments?: HallTaskAssignment[];
  endedAssignments?: HallTaskAssignment[];
  loadAssignmentsByStatus?: (teamOrgId: string, status: "scheduled" | "active" | "ended", offset?: number, limit?: number) => Promise<HallTaskAssignment[]>;
  loadDraftTemplatesPage?: (teamOrgId: string, offset?: number, limit?: number) => Promise<HallTaskTemplate[]>;
  onReload: () => Promise<void> | void;
  onIssued: () => void;
};

type WizardStep = 1 | 2 | 3;

type PageKey = "draft" | "scheduled" | "active" | "ended";
type PageState = Record<PageKey, number>;
const PAGE_SIZE = 3;

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── 分页组件 ─────────────────────────────────────────────────────────────

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

// ─── 主组件 ───────────────────────────────────────────────────────────────

export function HallDailyTaskWizard({
  templates,
  draftTemplatesPage = [],
  orgs,
  currentOrgId,
  managementOrgId,
  managementOrgName,
  canManageTemplates,
  initialAssignmentId = "",
  scheduledAssignments = [],
  activeAssignments = [],
  endedAssignments = [],
  loadAssignmentsByStatus,
  loadDraftTemplatesPage,
  onReload,
  onIssued,
}: Props) {
  // ── 向导状态 ──
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);
  const [effectMode, setEffectMode] = useState<TaskEffectMode>("next_midnight");
  const [currentDraftId, setCurrentDraftId] = useState(initialAssignmentId);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [notice, setNotice] = useState("");
  const [scheduledWarnModal, setScheduledWarnModal] = useState(false);
  const [previewData, setPreviewData] = useState<{
    templateTitle: string;
    targetOrgs: { id: string; name: string }[];
    effectMode: TaskEffectMode;
  } | null>(null);
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [templateDrawerTemplate, setTemplateDrawerTemplate] = useState<HallTaskTemplate | null>(null);
  const [viewingAssignmentId, setViewingAssignmentId] = useState("");
  const [archivingTemplateId, setArchivingTemplateId] = useState("");

  // ── 列表分页 ──
  const [pageState, setPageState] = useState<PageState>({ draft: 1, scheduled: 1, active: 1, ended: 1 });
  const [pageHasMore, setPageHasMore] = useState<Record<PageKey, boolean>>({ draft: false, scheduled: false, active: false, ended: false });
  const [loadingPageKey, setLoadingPageKey] = useState<PageKey | null>(null);
  const [scheduledPage, setScheduledPage] = useState<HallTaskAssignment[]>(scheduledAssignments ?? []);
  const [activePage, setActivePage] = useState<HallTaskAssignment[]>(activeAssignments ?? []);
  const [endedPage, setEndedPage] = useState<HallTaskAssignment[]>(endedAssignments ?? []);
  const [draftPage, setDraftPage] = useState<HallTaskTemplate[]>(draftTemplatesPage ?? []);

  useEffect(() => {
    setScheduledPage(scheduledAssignments);
    setPageHasMore((cur) => ({ ...cur, scheduled: scheduledAssignments.length === PAGE_SIZE }));
  }, [scheduledAssignments]);
  useEffect(() => {
    setActivePage(activeAssignments);
    setPageHasMore((cur) => ({ ...cur, active: activeAssignments.length === PAGE_SIZE }));
  }, [activeAssignments]);
  useEffect(() => {
    setEndedPage(endedAssignments);
    setPageHasMore((cur) => ({ ...cur, ended: endedAssignments.length === PAGE_SIZE }));
  }, [endedAssignments]);
  useEffect(() => {
    setDraftPage(draftTemplatesPage);
    setPageHasMore((cur) => ({ ...cur, draft: draftTemplatesPage.length === PAGE_SIZE }));
  }, [draftTemplatesPage]);

  // ── 当前团队下属的厅列表 ──
  const teamOrg = useMemo(() => orgs.find((o) => o.id === managementOrgId), [orgs, managementOrgId]);
  const hallOrgs = useMemo(() => {
    if (!teamOrg) return [];
    return orgs
      .filter((o) => o.orgType === "HALL" && o.status === "active" && o.path.startsWith(`${teamOrg.path}/`))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [orgs, teamOrg]);

  // ── 草稿模板列表（仅 draft 状态） ──
  const draftTemplates = useMemo(
    () => templates.filter((t) => t.status === "draft"),
    [templates]
  );

  const selectedTemplate = useMemo(() => templates.find((t) => t.id === selectedTemplateId), [templates, selectedTemplateId]);

  // ── 初始化：若有 initialAssignmentId，恢复草稿状态 ──
  useEffect(() => {
    if (!initialAssignmentId) return;
    Promise.all([
      hallDailyApi.listAssignments({ teamOrgId: managementOrgId, status: "draft", limit: 10 }),
      hallDailyApi.listAssignments({ teamOrgId: managementOrgId, status: "scheduled", limit: 1 }),
    ]).then(([draftRows, scheduledRows]) => {
      const assignment = draftRows.find((a) => a.id === initialAssignmentId);
      if (!assignment) return;
      setCurrentDraftId(assignment.id);
      setSelectedTemplateId(assignment.template?.id ?? "");
      const orgIds = (assignment.targets ?? []).map((t) => t.hallOrgId);
      setSelectedOrgIds(orgIds);
      setEffectMode((assignment.effectMode as TaskEffectMode) ?? "next_midnight");
      // 若有待生效任务，强制停在 Step1（不自动弹窗，等用户主动点按钮时再提示）
      const hasScheduled = scheduledRows.length > 0;
      if (hasScheduled) {
        setStep(1);
      } else if (orgIds.length > 0) {
        setStep(3);
        setNotice("已恢复上次未发布的厅管日常任务草稿，请确认或更改任务表单后继续。");
      } else {
        // 无论是否已选模板，只要没选厅，都停留在第一步让用户重新确认
        setStep(1);
        if (assignment.template?.id) {
          setNotice("已恢复上次未发布的厅管日常任务草稿，请确认或更改任务表单后继续。");
        }
      }
    }).catch(() => undefined);
  }, [initialAssignmentId, managementOrgId]);

  // ─── 分页加载 ────────────────────────────────────────────────────────

  async function loadPage(statusKey: PageKey, page: number) {
    setLoadingPageKey(statusKey);
    const offset = (page - 1) * PAGE_SIZE;
    try {
      if (statusKey === "draft") {
        const rows = loadDraftTemplatesPage
          ? await loadDraftTemplatesPage(managementOrgId, offset, PAGE_SIZE).catch(() => [] as HallTaskTemplate[])
          : [];
        setDraftPage(rows);
        setPageHasMore((cur) => ({ ...cur, draft: rows.length === PAGE_SIZE }));
        setPageState((cur) => ({ ...cur, draft: page }));
        return;
      }
      if (!loadAssignmentsByStatus) return;
      const rows = await loadAssignmentsByStatus(managementOrgId, statusKey as "scheduled" | "active" | "ended", offset, PAGE_SIZE).catch(() => [] as HallTaskAssignment[]);
      if (statusKey === "scheduled") setScheduledPage(rows);
      if (statusKey === "active") setActivePage(rows);
      if (statusKey === "ended") setEndedPage(rows);
      setPageHasMore((cur) => ({ ...cur, [statusKey]: rows.length === PAGE_SIZE }));
      setPageState((cur) => ({ ...cur, [statusKey]: page }));
    } finally {
      setLoadingPageKey(null);
    }
  }

  async function handlePageChange(key: PageKey, nextPage: number) {
    if (nextPage < 1) return;
    await loadPage(key, nextPage);
  }

  // ─── Step 操作 ────────────────────────────────────────────────────────

  async function handleStep1Next() {
    if (!selectedTemplateId) return;
    setSaving(true);
    setPublishError("");
    try {
      const result = await hallDailyApi.saveDraft({
        assignmentId: currentDraftId || undefined,
        templateId: selectedTemplateId,
        teamOrgId: managementOrgId,
        hallOrgIds: selectedOrgIds.length ? selectedOrgIds : [],
        effectMode,
      });
      if (result?.id) setCurrentDraftId(result.id);
      setStep(2);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err?.message ?? "模板发布失败，请检查模板是否有检查项";
      setPublishError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleStep2Next() {
    if (!selectedOrgIds.length) return;
    setSaving(true);
    try {
      const result = await hallDailyApi.saveDraft({
        assignmentId: currentDraftId || undefined,
        templateId: selectedTemplateId,
        teamOrgId: managementOrgId,
        hallOrgIds: selectedOrgIds,
        effectMode,
      });
      if (result?.id) setCurrentDraftId(result.id);
      // 加载预览
      const id = result?.id ?? currentDraftId;
      if (id) {
        const preview = await hallDailyApi.getPublishPreview(id, managementOrgId);
        setPreviewData({
          templateTitle: preview.templateTitle,
          targetOrgs: preview.targetOrgs,
          effectMode: (preview.effectMode as TaskEffectMode) ?? effectMode,
        });
      }
      setStep(3);
    } catch {
      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!currentDraftId) return;
    setPublishing(true);
    setPublishError("");
    try {
      await hallDailyApi.publishDraft(currentDraftId, effectMode, managementOrgId);
      setNotice(
        effectMode === "immediate"
          ? "新的厅管日常任务已立即生效；同范围旧任务已自动结束。"
          : "新的厅管日常任务已排入次日零点生效队列。"
      );
      await onReload();
      // 发布成功后重置向导回第一步
      setStep(1);
      setSelectedTemplateId("");
      setSelectedOrgIds([]);
      setCurrentDraftId("");
      setPublishError("");
      onIssued();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err?.message ?? "发布失败，请稍后重试";
      setPublishError(msg);
    } finally {
      setPublishing(false);
    }
  }

  async function handleDeleteAssignment(id: string, isScheduled?: boolean) {
    const confirmMsg = isScheduled
      ? "确定要取消该「待生效」任务吗？取消后任务将被删除，当前仍生效的旧任务不受影响。"
      : "确定要删除该草稿任务吗？";
    if (!window.confirm(confirmMsg)) return;
    try {
      await hallDailyApi.deleteAssignment(id, managementOrgId);
      setNotice(isScheduled ? "待生效任务已取消。" : "任务已删除。");
      await onReload();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err?.message ?? "删除失败，请稍后重试";
      window.alert(msg);
    }
  }

  async function handleCloseAssignment(id: string) {
    if (!window.confirm("确定要结束该任务吗？")) return;
    try {
      await hallDailyApi.closeAssignment(id, managementOrgId);
      setNotice("当前生效中的厅管日常任务已结束。");
      await onReload();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err?.message ?? "操作失败，请稍后重试";
      window.alert(msg);
    }
  }

  async function handleCopyToDraft(assignment: HallTaskAssignment) {
    if (!canManageTemplates || !assignment.templateId) return;
    try {
      const copied = await hallDailyApi.copyTemplate(assignment.templateId, managementOrgId);
      await onReload();
      if (copied?.id) {
        setSelectedTemplateId(copied.id);
        setNotice("已基于历史任务复制出新的模板草稿，可继续调整后再发布。");
      }
    } catch (err: any) {
      window.alert(err?.message ?? "复制模板草稿失败");
    }
  }

  async function handleDeleteTemplate(template: HallTaskTemplate) {
    if (!canManageTemplates) return;
    if (template.status !== "draft") {
      window.alert("只有草稿模板可以删除。");
      return;
    }
    if (!window.confirm("确认删除这份模板草稿？")) return;
    setArchivingTemplateId(template.id);
    try {
      await hallDailyApi.deleteTemplate(template.id, managementOrgId).catch((err: any) => {
        window.alert(err?.message ?? "删除失败");
        return null;
      });
      if (selectedTemplateId === template.id) {
        setSelectedTemplateId("");
        setCurrentDraftId("");
      }
      setNotice("模板草稿已删除。");
      await onReload();
    } finally {
      setArchivingTemplateId("");
    }
  }

  async function handleViewAssignment(assignment: HallTaskAssignment) {
    if (!assignment.templateId) return;
    setViewingAssignmentId(assignment.id);
    try {
      const full = await hallDailyApi.getTemplateById(assignment.templateId, managementOrgId);
      setTemplateDrawerTemplate(full);
      setTemplateDrawerOpen(true);
    } catch {
      setTemplateDrawerTemplate(null);
    } finally {
      setViewingAssignmentId("");
    }
  }

  // ─── 向导步骤渲染 ─────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <section className="space-y-5 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        {/* 标题区 */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">第一步：选择厅管日常任务</h3>
            <p className="mt-1 text-sm text-slate-500">厅管日常任务严格区分为模板草稿、待生效、生效中、已结束四类；只有模板草稿可以继续进入发布流程。</p>
          </div>
        </div>

        {/* 三栏看板 */}
        <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
          {/* ── 左栏：草稿 ── */}
          <section className="flex h-[620px] flex-col rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h4 className="text-lg font-semibold text-slate-900">模板草稿</h4>
                <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-700">{draftPage.length}</span>
              </div>
              {canManageTemplates && (
                <button
                  type="button"
                  onClick={() => { setTemplateDrawerTemplate(null); setTemplateDrawerOpen(true); }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-600"
                >
                  <ClipboardCheck size={14} />新建日常任务
                </button>
              )}
            </div>
            <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
              {draftPage.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-sm text-slate-400">
                  {managementOrgName ? `${managementOrgName} 当前没有模板草稿。` : "请先选择团队，再查看或创建模板草稿。"}
                </div>
              ) : (
                <>
                  {draftPage.map((template) => (
                    <div
                      key={template.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => { setSelectedTemplateId(template.id); setPublishError(""); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedTemplateId(template.id);
                          setPublishError("");
                        }
                      }}
                      className={`w-full cursor-pointer rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-[0_2px_12px_rgba(15,23,42,0.04)] transition ${selectedTemplateId === template.id ? "border-blue-300 bg-blue-50 shadow-[0_12px_30px_rgba(76,114,255,0.10)]" : "hover:bg-slate-50"}`}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-600">草稿</span>
                        <span className="text-xs text-slate-400">v{template.version}</span>
                        {selectedTemplateId === template.id && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">当前已选择</span>
                        )}
                      </div>
                      <p className="font-semibold text-slate-900 line-clamp-2">{template.title}</p>
                      {template.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{template.description}</p>}
                      <p className="mt-2 text-xs text-slate-400">{template.items?.length ?? 0} 个检查项</p>
                      <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setTemplateDrawerTemplate(template); setTemplateDrawerOpen(true); }}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-white"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleDeleteTemplate(template); }}
                          disabled={archivingTemplateId === template.id}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {archivingTemplateId === template.id ? "处理中..." : "删除"}
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            {draftPage.length > 0 && (
              <BookPagination
                page={pageState.draft}
                hasNext={pageHasMore.draft}
                loading={loadingPageKey === "draft"}
                onPrev={() => void handlePageChange("draft", pageState.draft - 1)}
                onNext={() => void handlePageChange("draft", pageState.draft + 1)}
              />
            )}
          </section>

          {/* ── 中栏：待生效 + 生效中 ── */}
          <section className="flex h-[620px] flex-col gap-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
            {/* 待生效 */}
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
                        <p className="font-semibold text-slate-900 line-clamp-2">{assignment.template?.title ?? "未命名厅管日常任务"}</p>
                        <p className="mt-1 text-xs text-slate-400">覆盖 {assignment.targets?.length ?? 0} 个厅</p>
                        <p className="mt-1 text-xs text-slate-400">生效时间：{assignment.effectiveAt ? new Date(assignment.effectiveAt).toLocaleString("zh-CN") : "未记录"}</p>
                        <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1">
                          <button
                            type="button"
                            onClick={() => void handleViewAssignment(assignment)}
                            disabled={viewingAssignmentId === assignment.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                          >
                            {viewingAssignmentId === assignment.id ? <><Loader2 size={12} className="animate-spin" />加载中...</> : <><Eye size={12} />查看内容</>}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteAssignment(assignment.id, true)}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50"
                          >
                            <PowerOff size={12} />取消待生效
                          </button>
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

            {/* 生效中 */}
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
                        <p className="font-semibold text-slate-900 line-clamp-2">{assignment.template?.title ?? "未命名厅管日常任务"}</p>
                        <p className="mt-1 text-xs text-slate-400">覆盖 {assignment.targets?.length ?? 0} 个厅</p>
                        <p className="mt-1 text-xs text-slate-400">生效时间：{assignment.effectiveAt ? new Date(assignment.effectiveAt).toLocaleString("zh-CN") : "未记录"}</p>
                        <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1">
                          <button
                            type="button"
                            onClick={() => void handleViewAssignment(assignment)}
                            disabled={viewingAssignmentId === assignment.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                          >
                            {viewingAssignmentId === assignment.id ? <><Loader2 size={12} className="animate-spin" />加载中...</> : <><Eye size={12} />查看内容</>}
                          </button>
                          {canManageTemplates && assignment.templateId && (
                            <button
                              type="button"
                              onClick={() => void handleCopyToDraft(assignment)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                            >
                              <Copy size={12} />复制为草稿模板（只复制题目）
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleCloseAssignment(assignment.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                          >
                            <PowerOff size={12} />结束任务
                          </button>
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

          {/* ── 右栏：已结束 ── */}
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
                      <p className="font-semibold text-slate-900 line-clamp-2">{assignment.template?.title ?? "未命名厅管日常任务"}</p>
                      <p className="mt-1 text-xs text-slate-400">覆盖 {assignment.targets?.length ?? 0} 个厅</p>
                      <p className="mt-1 text-xs text-slate-400">结束时间：{assignment.endedAt ? new Date(assignment.endedAt).toLocaleString("zh-CN") : "未记录"}</p>
                      <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1">
                        <button
                          type="button"
                          onClick={() => void handleViewAssignment(assignment)}
                          disabled={viewingAssignmentId === assignment.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          {viewingAssignmentId === assignment.id ? <><Loader2 size={12} className="animate-spin" />加载中...</> : <><Eye size={12} />查看内容</>}
                        </button>
                        {canManageTemplates && assignment.templateId && (
                          <button
                            type="button"
                            onClick={() => void handleCopyToDraft(assignment)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            <Copy size={12} />复制为草稿模板（只复制题目）
                          </button>
                        )}
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

        {publishError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{publishError}</div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={!selectedTemplateId || saving}
            onClick={() => {
              if (scheduledAssignments.length > 0) { setScheduledWarnModal(true); return; }
              void handleStep1Next();
            }}
            className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <><Loader2 size={15} className="animate-spin" />保存草稿中...</>
            ) : (
              <>下一步：选择执行厅 <ChevronRight size={15} /></>
            )}
          </button>
        </div>
      </section>
    );
  }

  function renderStep2() {
    const allSelected = hallOrgs.length > 0 && hallOrgs.every((h) => selectedOrgIds.includes(h.id));
    const toggleAll = () => {
      if (allSelected) setSelectedOrgIds([]);
      else setSelectedOrgIds(hallOrgs.map((h) => h.id));
    };
    const toggleHall = (id: string) => {
      setSelectedOrgIds((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
    };

    return (
      <section className="space-y-4 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStep(1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <ChevronLeft size={16} />
          </button>
          <div>
            <h3 className="text-base font-semibold text-slate-800">第二步：选择执行范围（厅）</h3>
            <p className="text-xs text-slate-400">勾选需要每日执行该任务的厅，任务将下发给厅管负责人</p>
          </div>
        </div>

        {/* 选中模板信息 */}
        {selectedTemplate && (
          <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 border border-blue-100">
            <ClipboardCheck size={15} className="text-blue-500 shrink-0" />
            <span className="text-sm text-blue-700 font-medium">{selectedTemplate.title}</span>
            <button type="button" onClick={() => setStep(1)} className="ml-auto text-xs text-blue-400 hover:text-blue-600 transition">更换</button>
          </div>
        )}

        {/* 厅选择 */}
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 border-b border-slate-200">
            <span className="text-sm font-medium text-slate-700">
              {managementOrgName ? `${managementOrgName}` : "当前团队"} · 共 {hallOrgs.length} 个厅
            </span>
            <button type="button" onClick={toggleAll} className="text-xs text-blue-500 hover:text-blue-700 transition font-medium">
              {allSelected ? "取消全选" : "全选"}
            </button>
          </div>
          {hallOrgs.length > 0 ? (
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {hallOrgs.map((hall) => {
                const checked = selectedOrgIds.includes(hall.id);
                const activeTask = activeAssignments.find((a) =>
                  a.targets?.some((t) => t.hallOrgId === hall.id)
                );
                const scheduledTask = scheduledAssignments.find((a) =>
                  a.targets?.some((t) => t.hallOrgId === hall.id)
                );
                return (
                  <label key={hall.id} className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors select-none ${checked ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleHall(hall.id)}
                      className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                    />
                    <Building2 size={15} className={`shrink-0 ${checked ? "text-blue-500" : "text-slate-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${checked ? "text-blue-700" : "text-slate-700"}`}>{hall.name}</p>
                      <p className="text-xs text-slate-400">{hall.orgCode}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                      {activeTask && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] text-amber-600">
                          <AlertTriangle size={9} />
                          执行中：{activeTask.template?.title ?? "任务"}
                        </span>
                      )}
                      {!activeTask && scheduledTask && (
                        <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] text-blue-500">
                          待生效：{scheduledTask.template?.title ?? "任务"}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-400">当前团队下暂无有效厅，请先完善组织架构</div>
          )}
        </div>

        {selectedOrgIds.length > 0 && (
          <p className="text-xs text-slate-500">已选 <span className="font-semibold text-blue-600">{selectedOrgIds.length}</span> 个厅</p>
        )}

        {/* 覆盖逻辑说明 */}
        {selectedOrgIds.some((id) => activeAssignments.some((a) => a.targets?.some((t) => t.hallOrgId === id))) && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
            <p className="text-xs text-amber-700 leading-relaxed">
              所选厅中有正在执行的任务，发布后将自动替代同范围内的旧任务，旧任务将变为"已结束"状态。
            </p>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100">
            <ChevronLeft size={15} />上一步
          </button>
          <button
            type="button"
            disabled={!selectedOrgIds.length || saving}
            onClick={() => void handleStep2Next()}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_4px_12px_rgba(59,130,246,0.3)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            下一步：预览发布
            <ChevronRight size={15} />
          </button>
        </div>
      </section>
    );
  }

  function renderStep3() {
    const orgList = previewData?.targetOrgs ?? selectedOrgIds.map((id) => ({ id, name: orgs.find((o) => o.id === id)?.name ?? id }));
    return (
      <section className="space-y-4 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStep(2)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <ChevronLeft size={16} />
          </button>
          <div>
            <h3 className="text-base font-semibold text-slate-800">第三步：预览并发布</h3>
            <p className="text-xs text-slate-400">确认配置信息后正式发布，任务将按所选生效时间开始执行</p>
          </div>
        </div>

        {/* 配置摘要 */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 divide-y divide-slate-100 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="w-20 shrink-0 text-xs text-slate-400">任务模板</span>
            <span className="text-sm font-medium text-slate-800">{previewData?.templateTitle ?? selectedTemplate?.title ?? "—"}</span>
          </div>
          <div className="flex items-start gap-3 px-4 py-3">
            <span className="w-20 shrink-0 text-xs text-slate-400">执行厅</span>
            <div className="flex flex-wrap gap-1.5">
              {orgList.map((org) => (
                <span key={org.id} className="rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-xs text-slate-700">{org.name}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="w-20 shrink-0 text-xs text-slate-400">发布主体</span>
            <span className="text-sm text-slate-700">{managementOrgName ?? "当前团队"}</span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="w-20 shrink-0 text-xs text-slate-400">任务周期</span>
            <span className="text-sm text-slate-700">每日重复执行 · 次日 16:00 截止补录</span>
          </div>
        </div>

        {/* 每日循环规则说明 */}
        <div className="rounded-2xl bg-indigo-50/60 border border-indigo-100 p-4">
          <div className="flex items-center gap-2 text-indigo-700 font-semibold text-sm mb-2">
            <RefreshCw size={13} />
            <span>每日自动循环规则</span>
          </div>
          <ul className="text-xs text-indigo-600/80 space-y-1 ml-4 list-disc leading-relaxed">
            <li>任务发布后，系统将在每日 <span className="font-semibold">00:00</span> 为每个厅自动生成一份待办记录。</li>
            <li>负责人需在当日完成，最晚可补录至次日 <span className="font-semibold">16:00</span>。</li>
            <li>发布覆盖范围相同的新任务时，旧任务将自动归档为"已结束"。</li>
          </ul>
        </div>

        {/* 生效时间选择 */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <p className="px-4 pt-3 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">生效方式</p>
          <div className="divide-y divide-slate-100">
            {(["immediate", "next_midnight"] as TaskEffectMode[]).map((mode) => {
              const isMode = effectMode === mode;
              return (
                <label key={mode} className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors select-none ${isMode ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                  <input type="radio" name="effectMode" value={mode} checked={isMode} onChange={() => setEffectMode(mode)} className="accent-blue-600" />
                  <div className="flex items-center gap-2">
                    <Clock3 size={15} className={isMode ? "text-blue-500" : "text-slate-400"} />
                    <div>
                      <p className={`text-sm font-medium ${isMode ? "text-blue-700" : "text-slate-700"}`}>
                        {mode === "immediate" ? "立即生效" : "次日零点生效"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {mode === "immediate" ? "发布后立即成为进行中，同范围旧任务自动结束" : "发布后处于待生效状态，明日零点自动激活"}
                      </p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {publishError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{publishError}</div>
        )}

        <div className="flex justify-between pt-2">
          <button type="button" onClick={() => setStep(2)} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100">
            <ChevronLeft size={15} />上一步
          </button>
          <button
            type="button"
            disabled={publishing}
            onClick={() => {
              if (scheduledAssignments.length > 0) { setScheduledWarnModal(true); return; }
              void handlePublish();
            }}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(79,70,229,0.35)] transition hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {publishing ? <Loader2 size={15} className="animate-spin" /> : null}
            正式发布厅管日常任务
          </button>
        </div>
      </section>
    );
  }

  // ─── 整体布局 ─────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-6">
        {notice && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</div>
        )}

        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>

      {/* 模板预览/编辑抽屉 */}
      <TaskTemplateDrawer
        open={templateDrawerOpen}
        category="HALL_DAILY"
        currentOrgId={currentOrgId ?? managementOrgId}
        scopeOrgId={managementOrgId}
        template={templateDrawerTemplate}
        readOnly={!canManageTemplates}
        onClose={() => setTemplateDrawerOpen(false)}
        onSaved={async (savedTemplate) => {
          setTemplateDrawerOpen(false);
          await onReload();
          if (savedTemplate?.id) {
            setSelectedTemplateId(savedTemplate.id);
          }
        }}
        onSavedAndNext={async (savedTemplate) => {
          setTemplateDrawerOpen(false);
          await onReload();
          if (!savedTemplate?.id) return;
          // 有待生效任务时，禁止直接进入下一步，停留在 Step1 并给出提示
          if (scheduledAssignments.length > 0) {
            setStep(1);
            setScheduledWarnModal(true);
            return;
          }
          setSaving(true);
          setPublishError("");
          try {
            const result = await hallDailyApi.saveDraft({
              assignmentId: currentDraftId || undefined,
              templateId: savedTemplate.id,
              teamOrgId: managementOrgId,
              hallOrgIds: [],
              effectMode,
            });
            if (result?.id) setCurrentDraftId(result.id);
            setSelectedTemplateId(savedTemplate.id);
            setStep(2);
          } catch (err: any) {
            const msg = err?.response?.data?.error?.message ?? err?.message ?? "模板发布失败，请检查模板是否有检查项";
            setPublishError(msg);
          } finally {
            setSaving(false);
          }
        }}
      />

      {/* 待生效任务警告弹窗 */}
      {scheduledWarnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle size={22} className="text-amber-500" />
              </div>
              <h3 className="text-base font-semibold text-slate-800">存在待生效任务</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                当前团队已有一个待生效任务，请先在"待生效"列中点击<span className="font-medium text-slate-700">"取消待生效"</span>退回草稿后，再发布新任务。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScheduledWarnModal(false)}
              className="mt-5 w-full rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600"
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </>
  );
}
