import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, ClipboardPlus, Loader2, PencilLine, Send, Trash2, Users, X } from "lucide-react";

import { MiniDatePicker, MiniTimePicker } from "../../../../shared/components/date-time/MiniDateTimePickers";
import { accountApi } from "../../../../features/accounts/api";
import type { Account, SearchAccount } from "../../../../features/accounts/types";
import type { OrgUnit, RoleCode, TaskAssignmentExclusion, TaskTemplate, TemporaryPublishPreview, TemporaryTaskMode } from "../../../../types";
import { assignmentApi, notifyApi, templateApi } from "../../../../services/task";
import { orgTypeMeta } from "../../../../shared/constants/org";
import { temporaryModeMeta } from "../../../../shared/constants/taskTemporary";
import { collectDescendantIds } from "../../../../shared/utils/orgTree";
import { DailyExclusionSelector, type ExcludedAnchorMeta } from "./DailyExclusionSelector";
import { AccountTargetSelector } from "./AccountTargetSelector";
import { TaskTemplateDrawer } from "./TaskTemplateDrawer";

type NotifyDialogState = {
  open: boolean;
  assignmentId: string;
  total: number;
  pendingCount: number;
  inProgressCount: number;
  distinctUserCount: number;
};

type NotifyResultDialogState = {
  open: boolean;
  title: string;
  message: string;
  tone: "success" | "error";
};

type Props = {
  templates: TaskTemplate[];
  orgs: OrgUnit[];
  currentOrgId?: string;
  managementOrgId?: string;
  managementScopePath?: string;
  managementOrgName?: string;
  canManageTemplates: boolean;
  canManageAssignments?: boolean;
  initialAssignmentId?: string;
  initialTemplateId?: string;
  draftAssignments?: TaskTemplate[];
  activeAssignments?: import("../../../../types").TaskAssignment[];
  endedAssignments?: import("../../../../types").TaskAssignment[];
  loadAssignmentsByStatus?: (scopeOrgId: string, status: "draft" | "active" | "ended,deleted", offset?: number, limit?: number) => Promise<import("../../../../types").TaskAssignment[]>;
  loadDraftTemplatesPage?: (scopeOrgId: string, offset?: number, limit?: number) => Promise<TaskTemplate[]>;
  initialHasMoreByStatus?: Partial<Record<"draft" | "active" | "ended", boolean>>;
  recentPublished?: import("../../../../types").TaskAssignment[];
  onReload: () => Promise<void> | void;
  onIssued: () => void;
};

const directManagerRoleByOrgType: Record<"BASE" | "TEAM" | "HALL", RoleCode> = {
  BASE: "BASE_ADMIN",
  TEAM: "TEAM_ADMIN",
  HALL: "HALL_MANAGER",
};

const managerSubjectTypeMeta: Record<"BASE" | "TEAM" | "HALL", { levelLabel: string; badge: string }> = {
  BASE: { levelLabel: "基地级", badge: "bg-sky-100 text-sky-700" },
  TEAM: { levelLabel: "团队级", badge: "bg-violet-100 text-violet-700" },
  HALL: { levelLabel: "厅级", badge: "bg-amber-100 text-amber-700" },
};


function getAncestorIds(orgId: string, orgMap: Map<string, OrgUnit>) {
  const result: string[] = [];
  let current = orgMap.get(orgId);
  while (current?.parentId) {
    result.push(current.parentId);
    current = orgMap.get(current.parentId);
  }
  return result;
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

type ExcludedOrgSection = {
  title: string;
  items: OrgUnit[];
};

type ExcludedAnchorSummary = ExcludedAnchorMeta & {
  hallLabel: string;
};

function createExcludedOrgSections(excludedOrgIds: string[], orgMap: Map<string, OrgUnit>): ExcludedOrgSection[] {
  const rows = excludedOrgIds.map((orgId) => orgMap.get(orgId)).filter(Boolean) as OrgUnit[];
  const grouped: Record<OrgUnit["orgType"], OrgUnit[]> = { HQ: [], BASE: [], TEAM: [], HALL: [] };
  rows.forEach((row) => { grouped[row.orgType].push(row); });
  return [
    { title: "排除团队", items: grouped.TEAM },
    { title: "排除厅", items: grouped.HALL },
  ]
    .map((section) => ({ ...section, items: [...section.items].sort((l, r) => l.path.localeCompare(r.path)) }))
    .filter((section) => section.items.length > 0);
}

function createExcludedAnchorSummaries(
  excludedAnchorProfileIds: string[],
  knownExcludedAnchors: Record<string, ExcludedAnchorMeta>,
  orgMap: Map<string, OrgUnit>
): ExcludedAnchorSummary[] {
  return excludedAnchorProfileIds.map((anchorId) => {
    const anchor = knownExcludedAnchors[anchorId] ?? { id: anchorId, nickname: `主播 ${anchorId.slice(0, 6)}` };
    const fallbackHallName = anchor.hallOrgId ? orgMap.get(anchor.hallOrgId)?.name : undefined;
    return { ...anchor, hallLabel: anchor.hallOrgName || fallbackHallName || "未识别所属厅" };
  });
}

function createPreviewLines(preview: TemporaryPublishPreview | null) {
  if (!preview) return [] as string[];
  const lines = [
    `完成主体：${preview.subjectCount} 个`,
    `账号主体：${preview.userSubjectCount} 个`,
    `组织主体：${preview.orgSubjectCount} 个`,
    `可见身份：${preview.visibleIdentityCount} 个`,
  ];
  preview.subjectSummaries.slice(0, 3).forEach((item) => {
    lines.push(`- ${item.subjectName}｜${item.subjectType === "ORG" ? "组织主体" : "账号主体"}｜${item.visibleIdentityCount} 个身份可见`);
  });
  return lines;
}

function mergeAccounts(accounts: SearchAccount[]) {
  return Array.from(new Map(accounts.map((account) => [account.id, account])).values());
}

function padDateTimePart(value: number) {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = padDateTimePart(date.getMonth() + 1);
  const day = padDateTimePart(date.getDate());
  const hours = padDateTimePart(date.getHours());
  const minutes = padDateTimePart(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatLocalDateTimeLabel(value?: string | null) {
  const localValue = toLocalDateTimeInputValue(value);
  return localValue ? localValue.replace("T", " ") : "";
}

/** 通用汇总分组：超出 previewLimit 时截断并显示"展开"按钮 */
/** 厅级按归属团队分组行 */
type PageKey = "draft" | "active" | "ended";

type PageState = {
  draft: number;
  active: number;
  ended: number;
};

type PageMeta = {
  total: number | null;
  hasNext: boolean;
};

const PAGE_SIZE = 3;

function BookPagination({
  page,
  totalPages,
  hasNext,
  loading,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages?: number | null;
  hasNext: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const resolvedTotalPages = totalPages && totalPages > 0 ? totalPages : hasNext ? page + 1 : page;
  return (
    <div className="mt-4 flex items-center justify-center gap-2 border-t border-slate-200 pt-4">
      <button
        type="button"
        onClick={onPrev}
        disabled={page <= 1 || loading}
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        上一页
      </button>
      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">{page}/{resolvedTotalPages} 页</span>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext || loading}
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        下一页
      </button>
    </div>
  );
}

function SummaryGroup({
  label,
  badge,
  count,
  emptyText,
  previewLimit,
  children,
}: {
  label: string;
  badge: string;
  count: number;
  emptyText: string;
  previewLimit: number;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children).map((child, index) => (
    <React.Fragment key={`summary-item-${index}`}>{child}</React.Fragment>
  ));
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, previewLimit);
  const hiddenCount = items.length - previewLimit;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${badge}`}>{label}</span>
          {label}
        </span>
        <span className="text-xs text-slate-400">{count} 个</span>
      </div>
      <div className="px-3 py-3">
        {items.length === 0 ? (
          <p className="text-xs text-slate-400">{emptyText}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">{visibleItems}</div>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="mt-3 text-xs font-medium text-blue-600 transition hover:text-blue-700"
              >
                {expanded ? "收起" : `展开剩余 ${hiddenCount} 项`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function HallGroupRow({
  team, halls, previewLimit,
}: {
  team: OrgUnit | null;
  halls: OrgUnit[];
  previewLimit: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? halls : halls.slice(0, previewLimit);
  const hiddenCount = halls.length - previewLimit;
  return (
    <div className="px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">团队</span>
        <span className="text-xs font-semibold text-slate-700">{team?.name ?? "其他"}</span>
        <span className="ml-auto text-[11px] text-slate-400">{halls.length} 厅</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((hall) => (
          <span key={hall.id} className="inline-flex items-center gap-1 rounded-lg border border-amber-100 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
            {hall.name}
          </span>
        ))}
      </div>
      {!expanded && hiddenCount > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className="mt-1.5 text-[11px] text-blue-500 hover:underline">
          展开全部（还有 {hiddenCount} 个）
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button type="button" onClick={() => setExpanded(false)} className="mt-1.5 text-[11px] text-slate-400 hover:underline">
          收起
        </button>
      )}
    </div>
  );
}

export function TemporaryIssuePanel({
  templates,
  orgs,
  currentOrgId,
  managementOrgId,
  managementScopePath,
  managementOrgName,
  canManageTemplates,
  canManageAssignments = true,
  initialAssignmentId,
  initialTemplateId,
  draftAssignments = [],
  activeAssignments = [],
  endedAssignments = [],
  loadAssignmentsByStatus,
  loadDraftTemplatesPage,
  initialHasMoreByStatus,
  recentPublished = [],
  onReload,
  onIssued,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [libraryTab, setLibraryTab] = useState<"draft" | "active" | "ended">("draft");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [detailAssignment, setDetailAssignment] = useState<import("../../../../types").TaskAssignment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewingTemplateId, setViewingTemplateId] = useState("");
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const [draftAssignmentId, setDraftAssignmentId] = useState("");
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<SearchAccount[]>([]);
  const [mode, setMode] = useState<TemporaryTaskMode>("ACCOUNT");
  const [subjectOrgType, setSubjectOrgType] = useState<"BASE" | "TEAM" | "HALL">("TEAM");
  const [targetRoleCodes, setTargetRoleCodes] = useState<RoleCode[]>([]);
  const [excludedOrgIds, setExcludedOrgIds] = useState<string[]>([]);
  const [excludedAnchorProfileIds, setExcludedAnchorProfileIds] = useState<string[]>([]);
  const [knownExcludedAnchors, setKnownExcludedAnchors] = useState<Record<string, ExcludedAnchorMeta>>({});
  const [orgAdminsCache, setOrgAdminsCache] = useState<Record<string, Account[]>>({});
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());
  const loadingTeamIds = useRef<Set<string>>(new Set());
  const [deadlineAt, setDeadlineAt] = useState("");
  const deadlineDate = deadlineAt ? deadlineAt.slice(0, 10) : "";
  const deadlineTime = deadlineAt ? deadlineAt.slice(11, 16) : "";
  function handleDeadlineChange(date: string, time: string) {
    if (!date && !time) { setDeadlineAt(""); return; }
    setDeadlineAt(`${date || deadlineDate}T${time || deadlineTime || "23:59"}`);
  }
  const [publishPreview, setPublishPreview] = useState<TemporaryPublishPreview | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [notifyPrefix, setNotifyPrefix] = useState("");
  const [notifyPreviewingId, setNotifyPreviewingId] = useState("");
  const [notifyingId, setNotifyingId] = useState("");
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);
  const [notifyPreview, setNotifyPreview] = useState<null | { assignmentId: string; total: number; pendingCount: number; inProgressCount: number; distinctUserCount: number; prefixPlaceholder: string }>(null);
  const [notifyDialog, setNotifyDialog] = useState<NotifyDialogState>({ open: false, assignmentId: "", total: 0, pendingCount: 0, inProgressCount: 0, distinctUserCount: 0 });
  const [notifyResultDialog, setNotifyResultDialog] = useState<NotifyResultDialogState>({ open: false, title: "", message: "", tone: "success" });
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmCountdown, setConfirmCountdown] = useState(3);
  const [delayModalAssignment, setDelayModalAssignment] = useState<import("../../../../types").TaskAssignment | null>(null);
  const [delayDeadlineAt, setDelayDeadlineAt] = useState("");
  const [draftHistoryRows, setDraftHistoryRows] = useState(draftAssignments);
  const [activeHistoryRows, setActiveHistoryRows] = useState(activeAssignments);
  const [endedHistoryRows, setEndedHistoryRows] = useState(endedAssignments);
  const [pageState, setPageState] = useState<PageState>({ draft: 1, active: 1, ended: 1 });
  const [pageMeta, setPageMeta] = useState<Record<PageKey, PageMeta>>({
    draft: { total: null, hasNext: initialHasMoreByStatus?.draft ?? false },
    active: { total: null, hasNext: initialHasMoreByStatus?.active ?? false },
    ended: { total: null, hasNext: initialHasMoreByStatus?.ended ?? false },
  });
  const [loadingPageKey, setLoadingPageKey] = useState<PageKey | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (confirmModalOpen && confirmCountdown > 0) {
      timer = setTimeout(() => setConfirmCountdown((c) => c - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [confirmModalOpen, confirmCountdown]);

  useEffect(() => {
    setPageState({ draft: 1, active: 1, ended: 1 });
  }, [managementOrgId]);

  useEffect(() => {
    setDraftHistoryRows(draftAssignments);
    setPageState((current) => ({ ...current, draft: 1 }));
    setPageMeta((current) => ({ ...current, draft: { total: null, hasNext: initialHasMoreByStatus?.draft ?? false } }));
  }, [draftAssignments, initialHasMoreByStatus?.draft]);

  useEffect(() => {
    setActiveHistoryRows(activeAssignments);
    setPageState((current) => ({ ...current, active: 1 }));
    setPageMeta((current) => ({ ...current, active: { total: null, hasNext: initialHasMoreByStatus?.active ?? false } }));
  }, [activeAssignments, initialHasMoreByStatus?.active]);

  useEffect(() => {
    setEndedHistoryRows(endedAssignments);
    setPageState((current) => ({ ...current, ended: 1 }));
    setPageMeta((current) => ({ ...current, ended: { total: null, hasNext: initialHasMoreByStatus?.ended ?? false } }));
  }, [endedAssignments, initialHasMoreByStatus?.ended]);

  const orgMap = useMemo(() => new Map(orgs.map((org) => [org.id, org])), [orgs]);
  const scopeOrg = useMemo(
    () => orgs.find((org) => org.id === managementOrgId) ?? orgs.find((org) => org.path === managementScopePath) ?? null,
    [managementOrgId, managementScopePath, orgs]
  );
  const visibleTemplates = useMemo(() => {
    const rows = templates.filter((template) => template.category === "TEMPORARY" && template.status !== "archived");
    return canManageTemplates ? rows : rows.filter((template) => template.status === "published");
  }, [canManageTemplates, templates]);
  const selectedTemplate = visibleTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const selectionSet = new Set(selectedOrgIds);
  const selectedAccountIds = selectedAccounts.map((account) => account.id);
  const targetOrgRows = useMemo(
    () => orgs
      .filter((org) => org.status === "active" && (!managementScopePath || org.path.startsWith(managementScopePath)))
      .sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path)),
    [managementScopePath, orgs]
  );
  const scopeParams = managementOrgId ? { scopeOrgId: managementOrgId } : undefined;
  const canConfigurePreview = Boolean(
    selectedTemplate
    && (mode === "ANCHOR"
      ? Boolean(managementOrgId)
      : mode === "ACCOUNT"
        ? (selectedOrgIds.length > 0 || selectedAccounts.length > 0)
        : selectedOrgIds.length > 0)
  );

  // 切换 subjectOrgType 时重置展开状态
  useEffect(() => {
    setExpandedTeamIds(new Set());
    loadingTeamIds.current = new Set();
  }, [subjectOrgType, mode]);

  // 展开团队时懒加载该团队下所有厅的管理账号
  function loadTeamHalls(team: { id: string }, halls: { id: string }[]) {
    const missing = halls.filter((h) => !(h.id in orgAdminsCache) && !loadingTeamIds.current.has(h.id));
    if (missing.length === 0) return;
    missing.forEach((hall) => loadingTeamIds.current.add(hall.id));
    missing.forEach((hall) => {
      const params = new URLSearchParams();
      params.set("orgId", hall.id);
      accountApi.getAccounts(params)
        .then((accounts) => {
          const admins = accounts
            .map((acc) => ({
              ...acc,
              identities: acc.identities.filter((id) => id.roleCode === "HALL_MANAGER" && id.orgId === hall.id && id.status === "active"),
            }))
            .filter((acc) => acc.identities.length > 0);
          setOrgAdminsCache((prev) => ({ ...prev, [hall.id]: admins }));
        })
        .catch(() => {
          setOrgAdminsCache((prev) => ({ ...prev, [hall.id]: [] }));
        });
    });
  }

  // 基地级 / 团队级模式：进入第三步时一次性加载对应层级的管理账号
  useEffect(() => {
    if (step !== 3 || mode !== "MANAGER" || subjectOrgType === "HALL") return;
    const targetRoleCode = directManagerRoleByOrgType[subjectOrgType];
    const managedOrgs = targetOrgRows.filter((org) => org.orgType === subjectOrgType);
    const missing = managedOrgs.filter((org) => !(org.id in orgAdminsCache) && !loadingTeamIds.current.has(org.id));
    if (missing.length === 0) return;
    missing.forEach((org) => loadingTeamIds.current.add(org.id));
    missing.forEach((org) => {
      const params = new URLSearchParams();
      params.set("orgId", org.id);
      accountApi.getAccounts(params)
        .then((accounts) => {
          const admins = accounts
            .map((acc) => ({
              ...acc,
              identities: acc.identities.filter((id) => id.roleCode === targetRoleCode && id.orgId === org.id && id.status === "active"),
            }))
            .filter((acc) => acc.identities.length > 0);
          setOrgAdminsCache((prev) => ({ ...prev, [org.id]: admins }));
        })
        .catch(() => {
          setOrgAdminsCache((prev) => ({ ...prev, [org.id]: [] }));
        });
    });
  }, [mode, orgAdminsCache, step, subjectOrgType, targetOrgRows]);
  const excludedOrgSections = useMemo(
    () => createExcludedOrgSections(excludedOrgIds, orgMap),
    [excludedOrgIds, orgMap]
  );
  const excludedAnchorSummaries = useMemo(
    () => createExcludedAnchorSummaries(excludedAnchorProfileIds, knownExcludedAnchors, orgMap),
    [excludedAnchorProfileIds, knownExcludedAnchors, orgMap]
  );
  const totalExcludedCount = excludedOrgIds.length + excludedAnchorProfileIds.length;
  const draftTemplateRows = visibleTemplates.filter((template) => template.status === "draft" && (template._count?.assignments ?? 0) === 0);
  const libraryAssignments = libraryTab === "draft" ? draftHistoryRows : libraryTab === "active" ? activeHistoryRows : endedHistoryRows;

  useEffect(() => {
    if (selectedTemplateId && visibleTemplates.some((template) => template.id === selectedTemplateId)) return;
    if (initialTemplateId && visibleTemplates.some((template) => template.id === initialTemplateId)) {
      setSelectedTemplateId(initialTemplateId);
      return;
    }
    const preferDraft = visibleTemplates.find((template) => template.status === "draft") ?? visibleTemplates[0];
    setSelectedTemplateId(preferDraft?.id ?? "");
  }, [initialTemplateId, selectedTemplateId, visibleTemplates]);

  useEffect(() => {
    if (!initialAssignmentId) return;
    assignmentApi
      .getById(initialAssignmentId, scopeParams)
      .then(async (assignment) => {
        if (assignment.category !== "TEMPORARY" || assignment.status !== "draft") return;
        resetDraftConfiguration(assignment.templateId);
        setDraftAssignmentId(assignment.id);
        setSelectedTemplateId(assignment.templateId);
        setSelectedOrgIds((assignment.targets ?? []).map((item) => item.orgId));
        setMode(assignment.temporaryMode ?? "ACCOUNT");
        setSubjectOrgType((assignment.temporarySubjectOrgType as "BASE" | "TEAM" | "HALL" | null) ?? "TEAM");
        setTargetRoleCodes((assignment.targetRoleCodes as RoleCode[] | undefined) ?? []);
        setExcludedOrgIds((assignment.exclusions ?? []).filter((item) => item.exclusionType === "ORG" && item.orgId).map((item) => item.orgId!));
        setExcludedAnchorProfileIds((assignment.exclusions ?? []).filter((item) => item.exclusionType === "ANCHOR" && item.anchorProfileId).map((item) => item.anchorProfileId!));
        setKnownExcludedAnchors(extractKnownExcludedAnchors(assignment.exclusions));
        setDeadlineAt(toLocalDateTimeInputValue(assignment.deadlineAt));
        const nextTargetUserIds = Array.isArray(assignment.targetUserIds) ? assignment.targetUserIds : [];
        if (nextTargetUserIds.length) {
          const accounts = await accountApi.getAccountsByIds(nextTargetUserIds, { scopeOrgId: managementOrgId }).catch(() => [] as SearchAccount[]);
          setSelectedAccounts(mergeAccounts(accounts));
        } else {
          setSelectedAccounts([]);
        }
        setLibraryTab("draft");
        setStep(2);
        setNotice("已恢复你上次未发布的临时任务草稿，请继续从任务类型开始完成发布配置。");
      })
      .catch(console.error);
  }, [initialAssignmentId, managementOrgId, scopeParams]);

  useEffect(() => {
    if (mode === "ANCHOR") {
      setTargetRoleCodes(["ANCHOR"]);
      return;
    }
    if (mode === "ACCOUNT") {
      setTargetRoleCodes([]);
      setExcludedOrgIds([]);
      setExcludedAnchorProfileIds([]);
      return;
    }
    // MANAGER 模式：targetRoleCodes 完全由 subjectOrgType 决定，自动固定，切换时清空已选组织
    setTargetRoleCodes([directManagerRoleByOrgType[subjectOrgType]]);
    setSelectedOrgIds([]);
    setExcludedAnchorProfileIds([]);
  }, [mode, subjectOrgType]);

  function resetDraftConfiguration(templateId?: string) {
    setSelectedTemplateId(templateId ?? "");
    setSelectedOrgIds([]);
    setSelectedAccounts([]);
    setMode("ACCOUNT");
    setSubjectOrgType("TEAM");
    setTargetRoleCodes([]);
    setExcludedOrgIds([]);
    setExcludedAnchorProfileIds([]);
    setKnownExcludedAnchors({});
    setDeadlineAt("");
    setPublishPreview(null);
  }

  async function copyAssignmentAsDraft(assignment: import("../../../../types").TaskAssignment) {
    if (!assignment.templateId) return;
    const copied = await templateApi.copy(assignment.templateId, scopeParams).catch((error) => {
      window.alert(error instanceof Error ? error.message : "复制模板失败");
      return null;
    });
    if (!copied) return;
    setDetailAssignment(null);
    resetDraftConfiguration(copied.id);
    setDraftAssignmentId("");
    setLibraryTab("draft");
    setStep(1);
    setSelectedTemplateId(copied.id);
    setEditingTemplate(copied);
    setEditorReadOnly(false);
    setEditorOpen(true);
    setNotice("已基于历史表单复制出新的草稿，请确认表单后继续配置任务类型、目标人群和截止时间。");
    await onReload();
  }

  async function closeActiveAssignment(assignmentId: string) {
    const confirmed = window.confirm("确认立即终止这条临时任务吗？终止后执行端会立刻停止继续填写。 ");
    if (!confirmed) return;
    await assignmentApi.close(assignmentId, managementOrgId).catch(console.error);
    setDetailAssignment((current) => (current?.id === assignmentId ? null : current));
    setNotice("临时任务已提前终止，后续将停止继续收集。 ");
    await onReload();
  }

  function openDelayDeadlineModal(assignment: import("../../../../types").TaskAssignment) {
    setDelayModalAssignment(assignment);
    setDelayDeadlineAt(toLocalDateTimeInputValue(assignment.deadlineAt));
  }

  async function submitDelayDeadline() {
    if (!delayModalAssignment || !delayDeadlineAt) return;
    await assignmentApi.update(delayModalAssignment.id, { deadlineAt: delayDeadlineAt, scopeOrgId: managementOrgId }).catch(console.error);
    if (detailAssignment?.id === delayModalAssignment.id) {
      const latest = await assignmentApi.getById(delayModalAssignment.id, scopeParams).catch(() => null);
      setDetailAssignment(latest);
    }
    setDelayModalAssignment(null);
    setDelayDeadlineAt("");
    setNotice("截止时间已更新，任务会按新的时间继续收集。 ");
    await onReload();
  }

  async function openAssignmentDetail(assignmentId: string) {
    setDetailLoading(true);
    const result = await assignmentApi.getById(assignmentId, scopeParams).catch(() => null);
    setDetailAssignment(result);
    setDetailLoading(false);
  }

  async function loadAssignmentPage(statusKey: PageKey, page: number) {
    if (!managementOrgId || !loadAssignmentsByStatus) return;
    setLoadingPageKey(statusKey);
    const requestStatus = statusKey === "ended" ? "ended,deleted" : statusKey;
    const offset = (page - 1) * PAGE_SIZE;

    try {
      if (statusKey === "draft") {
        const rows = loadDraftTemplatesPage
          ? await loadDraftTemplatesPage(managementOrgId, offset, PAGE_SIZE).catch(() => [] as TaskTemplate[])
          : [];
        if (page > 1 && rows.length === 0) {
          setPageMeta((current) => ({
            ...current,
            draft: { hasNext: false, total: page - 1 },
          }));
          return;
        }
        setDraftHistoryRows(rows);
        setPageMeta((current) => ({
          ...current,
          draft: {
            hasNext: rows.length === PAGE_SIZE,
            total: rows.length < PAGE_SIZE ? page : current.draft.total,
          },
        }));
        setPageState((current) => ({ ...current, draft: page }));
        return;
      }

      const rows = await loadAssignmentsByStatus(managementOrgId, requestStatus, offset, PAGE_SIZE).catch(() => []);
      if (page > 1 && rows.length === 0) {
        setPageMeta((current) => ({
          ...current,
          [statusKey]: { hasNext: false, total: page - 1 },
        }));
        return;
      }
      if (statusKey === "active") setActiveHistoryRows(rows);
      if (statusKey === "ended") setEndedHistoryRows(rows);
      setPageMeta((current) => ({
        ...current,
        [statusKey]: {
          hasNext: rows.length === PAGE_SIZE,
          total: rows.length < PAGE_SIZE ? page : current[statusKey].total,
        },
      }));
      setPageState((current) => ({ ...current, [statusKey]: page }));
    } finally {
      setLoadingPageKey(null);
    }
  }

  async function handlePageChange(statusKey: PageKey, nextPage: number) {
    if (nextPage < 1) return;
    await loadAssignmentPage(statusKey, nextPage);
  }

  async function handleSendTemporaryNotify(assignmentId: string) {
    if (!managementOrgId) {
      setNotice("请先选择管理基地后再发送通知。");
      return;
    }
    setNotifyPreviewingId(assignmentId);
    try {
      const preview = await notifyApi.getTemporaryFeishuPreview(assignmentId, managementOrgId);
      const suggestedPrefix = notifyPrefix || preview.prefixPlaceholder || "来自系统提醒";
      setNotifyPrefix(suggestedPrefix);
      setNotifyPreview({
        assignmentId,
        total: preview.total,
        pendingCount: preview.pendingCount,
        inProgressCount: preview.inProgressCount,
        distinctUserCount: preview.distinctUserCount,
        prefixPlaceholder: preview.prefixPlaceholder,
      });
      setNotifyDialogOpen(true);
    } catch (error: any) {
      setNotice(error?.message ?? "临时任务飞书通知预览失败，请稍后重试。");
    } finally {
      setNotifyPreviewingId("");
    }
  }

  async function confirmSendTemporaryNotify() {
    if (!managementOrgId || !notifyPreview?.assignmentId) return;
    setNotifyingId(notifyPreview.assignmentId);
    try {
      const prefix = notifyPrefix || notifyPreview.prefixPlaceholder || "来自系统提醒";
      const result = await notifyApi.sendTemporaryFeishu({ assignmentId: notifyPreview.assignmentId, scopeOrgId: managementOrgId, prefix });
      const successCount = result.results.reduce((sum, item) => sum + item.successCount, 0);
      setNotice(`临时任务飞书通知已发送，成功触达 ${successCount} 人，未绑定 ${result.summary.unboundCount} 人。`);
      setNotifyDialogOpen(false);
      setNotifyPreview(null);
    } catch (error: any) {
      setNotice(error?.message ?? "临时任务飞书通知发送失败，请稍后重试。");
    } finally {
      setNotifyingId("");
    }
  }

  async function handleViewTemplate(template?: TaskTemplate | null, assignmentId?: string) {
    if (!template?.id && !assignmentId) return;
    setEditorReadOnly(true);
    setViewingTemplateId(assignmentId || template?.id || "");
    try {
      if (assignmentId) {
        const assignment = await assignmentApi.getById(assignmentId, scopeParams);
        setEditingTemplate((assignment.template as TaskTemplate) ?? template ?? null);
      } else if (template?.id) {
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

  function toggleOrg(orgId: string) {
    const ancestorIds = getAncestorIds(orgId, orgMap);
    const descendantIds = Array.from(collectDescendantIds(orgId, orgs)).filter((id) => id !== orgId);
    setSelectedOrgIds((current) => {
      const next = new Set(current);
      if (next.has(orgId)) {
        next.delete(orgId);
        return Array.from(next);
      }
      ancestorIds.forEach((id) => next.delete(id));
      descendantIds.forEach((id) => next.delete(id));
      next.add(orgId);
      return Array.from(next);
    });
  }


  async function persistDraft(overrideTemplate?: typeof selectedTemplate) {
    const template = overrideTemplate ?? selectedTemplate;
    if (!template) return null;
    setSavingDraft(true);
    // ANCHOR 模式不让用户手动圈定组织，自动用管理范围 org 作为发放基线
    const effectiveOrgIds = mode === "ANCHOR"
      ? (managementOrgId ? [managementOrgId] : [])
      : selectedOrgIds;
    const result = await assignmentApi
      .saveTemporaryDraft({
        assignmentId: draftAssignmentId || undefined,
        templateId: template.id,
        orgIds: effectiveOrgIds,
        excludedOrgIds: mode === "ACCOUNT" ? [] : excludedOrgIds,
        excludedAnchorProfileIds: mode === "ANCHOR" ? excludedAnchorProfileIds : [],
        deadlineAt: deadlineAt || undefined,
        scopeOrgId: managementOrgId,
        mode,
        targetRoleCodes: mode === "ACCOUNT" ? undefined : targetRoleCodes,
        targetUserIds: mode === "ACCOUNT" ? selectedAccountIds : undefined,
        subjectOrgType: mode === "MANAGER" ? subjectOrgType : undefined,
      })
      .catch(console.error);
    setSavingDraft(false);
    if (!result) return null;
    setDraftAssignmentId(result.id);
    setKnownExcludedAnchors((current) => ({ ...current, ...extractKnownExcludedAnchors(result.exclusions) }));
    setNotice(draftAssignmentId ? "临时任务草稿已更新。" : "已创建临时任务草稿。");
    if (step === 4) {
      void loadPreview(result.id);
    }
    return result;
  }

  async function loadPreview(assignmentId: string) {
    setPreviewing(true);
    const result = await assignmentApi.getTemporaryPublishPreview(assignmentId, scopeParams).catch(console.error);
    setPreviewing(false);
    if (!result) return null;
    setPublishPreview(result);
    return result;
  }

  async function handleNext(nextStep: 2 | 3 | 4, overrideTemplate?: typeof selectedTemplate) {
    const template = overrideTemplate ?? selectedTemplate;
    if (!template) return;
    if (nextStep === 4 && !canConfigurePreview) return;
    const saved = await persistDraft(template);
    if (!saved) return;
    if (nextStep === 4) {
      await loadPreview(saved.id);
    } else {
      setPublishPreview(null);
    }
    setStep(nextStep);
  }

  async function handleDeleteDraft() {
    if (!draftAssignmentId || !window.confirm("确认删除当前临时任务草稿？删除后需要重新发起。")) return;
    await assignmentApi.delete(draftAssignmentId, scopeParams).catch(console.error);
    setDraftAssignmentId("");
    setSelectedOrgIds([]);
    setSelectedAccounts([]);
    setExcludedOrgIds([]);
    setExcludedAnchorProfileIds([]);
    setKnownExcludedAnchors({});
    setDeadlineAt("");
    setPublishPreview(null);
    setStep(1);
    setNotice("当前临时任务草稿已删除。 ");
    await onReload();
  }

  async function handleDeleteTemplate(template: TaskTemplate) {
    if (!canManageTemplates || deletingTemplateId) return;
    if (template.status !== "draft") {
      alert("只有草稿模板可以删除，已发布模板请保留用于历史任务查看。");
      return;
    }
    const actionText = "删除";
    if (!window.confirm(`确认${actionText}临时任务表单「${template.title}」？未发布草稿表单会被直接删除。`)) return;

    setDeletingTemplateId(template.id);
    try {
      await templateApi.delete(template.id, scopeParams);
      if (selectedTemplateId === template.id) setSelectedTemplateId("");
      setNotice(`临时任务表单已${actionText}。`);
      await onReload();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : `${actionText}失败`);
    } finally {
      setDeletingTemplateId("");
    }
  }

  async function handlePublishClick() {
    if (!selectedTemplate || !canConfigurePreview || !deadlineAt) return;
    const saved = await persistDraft();
    if (!saved) return;
    await loadPreview(saved.id);
    setConfirmCountdown(3);
    setConfirmModalOpen(true);
  }

  async function handleConfirmPublish() {
    if (!draftAssignmentId) return;
    setConfirmModalOpen(false);
    setIssuing(true);
    const published = await assignmentApi.publishTemporaryDraft(draftAssignmentId, managementOrgId).catch((e: Error) => {
      console.error(e);
      alert(e.message || "发布失败");
      return null;
    });
    setIssuing(false);
    if (!published) return;
    setNotice("临时任务已正式发布，后续由发起人继续跟进进度、关闭状态和结果回收。 ");
    await onReload();
    onIssued();
  }

  return (
    <div className="space-y-6">
      {notice && <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</div>}
      {step === 1 && (
        <section className="space-y-5 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">第一步：选择临时任务</h3>
            <p className="mt-1 text-sm text-slate-500">草稿统一承接所有未发布任务；进行中任务会持续收集到截止时间，已结束任务可查看内容或复制为新的草稿。</p>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <section className="flex min-h-[560px] flex-col rounded-3xl border border-amber-100 bg-amber-50/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900">草稿</h4>
                </div>
                <div className="flex items-center gap-2">
                  {canManageTemplates && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTemplate(null);
                        setEditorReadOnly(false);
                        setEditorOpen(true);
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-600 whitespace-nowrap"
                    >
                      <ClipboardPlus size={14} />新建临时表单
                    </button>
                  )}
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-amber-700">{draftTemplateRows.length}</span>
                </div>
              </div>
              <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                {draftHistoryRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-sm text-slate-400">
                    当前没有临时任务表单草稿。请先新建临时表单，或从进行中 / 已结束任务复制表单后再继续配置。
                  </div>
                ) : (
                  draftHistoryRows.map((template) => (
                    <div
                      key={template.id}
                      className={`rounded-2xl border p-4 transition ${selectedTemplateId === template.id ? "border-blue-300 bg-blue-50 shadow-[0_8px_24px_rgba(76,114,255,0.10)]" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                    >
                      <div className="flex flex-col gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            resetDraftConfiguration(template.id);
                            setDraftAssignmentId("");
                          }}
                          className="min-w-0 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-600">模板草稿</span>
                            {selectedTemplateId === template.id && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">当前选择</span>}
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900">{template.title ?? "未命名表单"}</p>
                          <p className="mt-1 text-xs text-slate-400">{template.items?.length ?? 0} 个表单项</p>
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              resetDraftConfiguration(template.id);
                              setDraftAssignmentId("");
                            }}
                            className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
                          >
                            作为起点
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTemplate(template);
                              setEditorReadOnly(false);
                              setEditorOpen(true);
                            }}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            编辑表单
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const confirmed = window.confirm("确认删除这份临时表单草稿？删除后需要重新新建或复制。 ");
                              if (!confirmed) return;
                              await templateApi.delete(template.id, scopeParams).catch(console.error);
                              if (selectedTemplateId === template.id) {
                                resetDraftConfiguration("");
                                setDraftAssignmentId("");
                              }
                              setNotice("临时任务表单草稿已删除。");
                              await onReload();
                            }}
                            className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                          >
                            删除草稿
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {draftHistoryRows.length > 0 && (
                <BookPagination
                  page={pageState.draft}
                  totalPages={pageMeta.draft.total}
                  hasNext={pageMeta.draft.hasNext}
                  loading={loadingPageKey === "draft"}
                  onPrev={() => void handlePageChange("draft", pageState.draft - 1)}
                  onNext={() => void handlePageChange("draft", pageState.draft + 1)}
                />
              )}
            </section>

            <section className="flex min-h-[560px] flex-col rounded-3xl border border-emerald-100 bg-emerald-50/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900">进行中</h4>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-700">{activeHistoryRows.length}</span>
              </div>
              <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                {activeHistoryRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-sm text-slate-400">当前没有进行中的临时任务。</div>
                ) : (
                  activeHistoryRows.map((assignment) => {
                    const assignmentMode = (assignment.temporaryMode ?? "ACCOUNT") as import("../../../../types").TemporaryTaskMode;
                    return (
                      <div key={assignment.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${temporaryModeMeta[assignmentMode].badge}`}>{temporaryModeMeta[assignmentMode].label}</span>
                          </div>
                          <p className="line-clamp-2 text-sm font-semibold text-slate-900">{assignment.template?.title ?? "（表单已归档）"}</p>
                          <div className="flex flex-col gap-1 text-xs text-slate-400">
                            <span>{assignment.publishedAt ? `发布时间 ${formatLocalDateTimeLabel(assignment.publishedAt)}` : "未记录发布时间"}</span>
                            <span>{assignment.deadlineAt ? `截止 ${formatLocalDateTimeLabel(assignment.deadlineAt)}` : "未设置截止时间"}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleSendTemporaryNotify(assignment.id)}
                              disabled={notifyPreviewingId === assignment.id || notifyingId === assignment.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {notifyPreviewingId === assignment.id || notifyingId === assignment.id ? <><Loader2 size={12} className="animate-spin" />通知中</> : <><Send size={12} />通知未完成</>}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleViewTemplate(assignment.template as TaskTemplate | null, assignment.id)}
                              disabled={viewingTemplateId === assignment.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {viewingTemplateId === assignment.id ? <><Loader2 size={12} className="animate-spin" />加载中</> : <><ChevronRight size={12} />查看</>}
                            </button>
                            <button
                              type="button"
                              onClick={() => void copyAssignmentAsDraft(assignment)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                            >
                              <PencilLine size={12} />复制表单
                            </button>
                            <button
                              type="button"
                              onClick={() => openDelayDeadlineModal(assignment)}
                              className="rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
                            >
                              延迟
                            </button>
                            <button
                              type="button"
                              onClick={() => void closeActiveAssignment(assignment.id)}
                              className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50"
                            >
                              终止
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {activeHistoryRows.length > 0 && (
                <BookPagination
                  page={pageState.active}
                  totalPages={pageMeta.active.total}
                  hasNext={pageMeta.active.hasNext}
                  loading={loadingPageKey === "active"}
                  onPrev={() => void handlePageChange("active", pageState.active - 1)}
                  onNext={() => void handlePageChange("active", pageState.active + 1)}
                />
              )}
            </section>

            <section className="flex min-h-[560px] flex-col rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900">已结束</h4>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700">{endedHistoryRows.length}</span>
              </div>
              <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                {endedHistoryRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-sm text-slate-400">当前没有已结束的临时任务。</div>
                ) : (
                  endedHistoryRows.map((assignment) => {
                    const assignmentMode = (assignment.temporaryMode ?? "ACCOUNT") as import("../../../../types").TemporaryTaskMode;
                    return (
                      <div key={assignment.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${temporaryModeMeta[assignmentMode].badge}`}>{temporaryModeMeta[assignmentMode].label}</span>
                          </div>
                          <p className="line-clamp-2 text-sm font-semibold text-slate-900">{assignment.template?.title ?? "（表单已归档）"}</p>
                          <div className="flex flex-col gap-1 text-xs text-slate-400">
                            <span>{assignment.publishedAt ? `发布时间 ${formatLocalDateTimeLabel(assignment.publishedAt)}` : "未记录发布时间"}</span>
                            <span>{assignment.deadlineAt ? `截止 ${formatLocalDateTimeLabel(assignment.deadlineAt)}` : "未设置截止时间"}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleViewTemplate(assignment.template as TaskTemplate | null, assignment.id)}
                              disabled={viewingTemplateId === assignment.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {viewingTemplateId === assignment.id ? <><Loader2 size={12} className="animate-spin" />加载中</> : <><ChevronRight size={12} />查看</>}
                            </button>
                            <button
                              type="button"
                              onClick={() => void copyAssignmentAsDraft(assignment)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                            >
                              <PencilLine size={12} />新建草稿
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {endedHistoryRows.length > 0 && (
                <BookPagination
                  page={pageState.ended}
                  totalPages={pageMeta.ended.total}
                  hasNext={pageMeta.ended.hasNext}
                  loading={loadingPageKey === "ended"}
                  onPrev={() => void handlePageChange("ended", pageState.ended - 1)}
                  onNext={() => void handlePageChange("ended", pageState.ended + 1)}
                />
              )}
            </section>
          </div>

          {!selectedTemplateId && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              请先从草稿栏选择一份模板草稿作为发布起点；如当前还没有草稿，可先新建临时表单，或从进行中 / 已结束任务复制表单。
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!selectedTemplateId || savingDraft}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingDraft ? <><Loader2 size={15} className="animate-spin" />处理中...</> : <>下一步：选择任务类型 <ChevronRight size={15} /></>}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-6 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">第二步：选择任务类型</h3>
            <p className="mt-1 text-sm text-slate-500">确定任务面向哪类主体完成——按账号触达、按主播执行，还是按团队/厅协同。</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {(["ACCOUNT", "ANCHOR", "MANAGER"] as TemporaryTaskMode[]).map((item) => (
              <button key={item} type="button" onClick={() => setMode(item)} className={`rounded-3xl border p-5 text-left transition ${mode === item ? "border-blue-300 bg-blue-50 shadow-[0_12px_30px_rgba(76,114,255,0.12)]" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${temporaryModeMeta[item].badge}`}>{temporaryModeMeta[item].label}</span>
                <p className="mt-3 text-lg font-semibold text-slate-900">{temporaryModeMeta[item].title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{temporaryModeMeta[item].desc}</p>
                <p className="mt-3 text-xs font-medium text-slate-600">{temporaryModeMeta[item].summary}</p>
              </button>
            ))}
          </div>

          {mode === "MANAGER" && (
            <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-4 text-sm leading-6 text-violet-700">
              管理式任务固定只触达管理账号，主播账号均不推送；如果一账号属于多组织管理，则会按多个组织视角分别推送。
            </div>
          )}

          {mode === "MANAGER" && (
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {(["BASE", "TEAM", "HALL"] as const).map((item) => (
                <button key={item} type="button" onClick={() => setSubjectOrgType(item)} className={`rounded-2xl border px-4 py-4 text-left transition ${subjectOrgType === item ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${managerSubjectTypeMeta[item].badge}`}>{managerSubjectTypeMeta[item].levelLabel}</span>
                    <span className="text-xs text-slate-400">{directManagerRoleByOrgType[item]}</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-900">投放{orgTypeMeta[item].label}级管理</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">任一可见管理账号提交，即当前{orgTypeMeta[item].label}完成；其他账号仍可补充备注或附件。</p>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-3">
            <button type="button" onClick={() => setStep(1)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">返回上一步</button>
            <button type="button" onClick={() => void handleNext(3)} disabled={savingDraft || !selectedTemplate} className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
              {savingDraft ? <><Loader2 size={15} className="animate-spin" />保存草稿中...</> : <>下一步：组织圈定 <ChevronRight size={15} /></>}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-6 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">第三步：{mode === "ANCHOR" ? "排除设置" : "组织圈定"}</h3>
            {mode === "ANCHOR" && (
              <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                主播式任务将自动覆盖 <span className="font-semibold">{managementOrgName ?? "当前管理范围"}</span> 内所有主播，无需手动圈定组织。可在下方按需排除特定组织或主播。
              </div>
            )}
          </div>

          <div className="space-y-6">
            {mode === "ACCOUNT" ? (
              <AccountTargetSelector
                scopeOrgId={managementOrgId}
                currentOrgId={currentOrgId}
                orgs={orgs}
                managementScopePath={managementScopePath}
                selectedAccounts={selectedAccounts}
                selectedOrgIds={selectedOrgIds}
                onSelectedAccountsChange={setSelectedAccounts}
                onSelectedOrgIdsChange={setSelectedOrgIds}
              />
            ) : mode === "ANCHOR" ? null : (
              (() => {
                const targetType = subjectOrgType; // "TEAM" | "HALL"
                const candidateOrgs = targetOrgRows.filter((org) => org.orgType === targetType);
                const allIds = candidateOrgs.map((org) => org.id);
                const allSelected = allIds.length > 0 && allIds.every((id) => selectionSet.has(id));
                const typeLabel = orgTypeMeta[targetType].label;

                // 厅级模式：按所属团队分组
                const teamRows = targetOrgRows.filter((org) => org.orgType === "TEAM");
                const hallsByTeam: { team: typeof teamRows[0]; halls: typeof candidateOrgs }[] = targetType === "HALL"
                  ? teamRows
                      .map((team) => ({ team, halls: candidateOrgs.filter((hall) => hall.parentId === team.id) }))
                      .filter((group) => group.halls.length > 0)
                  : [];
                const groupedHallIds = new Set(hallsByTeam.flatMap((g) => g.halls.map((h) => h.id)));
                const orphanHalls = targetType === "HALL" ? candidateOrgs.filter((h) => !groupedHallIds.has(h.id)) : [];

                // 单个卡片组件
                function OrgCard({ org, isHall }: { org: typeof candidateOrgs[0]; isHall?: boolean }) {
                  const checked = selectionSet.has(org.id);
                  const admins = orgAdminsCache[org.id];
                  const adminsLoaded = org.id in orgAdminsCache;
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedOrgIds((current) =>
                          checked ? current.filter((id) => id !== org.id) : [...current, org.id]
                        )
                      }
                      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                        checked ? "border-blue-200 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                          checked ? "border-blue-500 bg-blue-500" : "border-slate-300 bg-white"
                        }`}
                      >
                        {checked && (
                          <svg viewBox="0 0 10 8" fill="none" className="h-2.5 w-2.5">
                            <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isHall && (
                            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">厅</span>
                          )}
                          <p className={`truncate text-sm font-medium ${checked ? "text-blue-800" : "text-slate-900"}`}>{org.name}</p>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400">{org.orgCode}</p>
                        <div className="mt-1.5 space-y-0.5">
                          {!adminsLoaded ? (
                            <p className="text-[11px] text-slate-300">加载中...</p>
                          ) : admins.length === 0 ? (
                            <p className="text-[11px] text-slate-300">暂无管理员</p>
                          ) : (
                            <>
                              {admins.slice(0, 3).map((admin) => (
                                <p key={admin.id} className={`truncate text-[11px] leading-4 ${checked ? "text-blue-600" : "text-slate-500"}`}>
                                  {admin.nickname}
                                  {admin.phone ? <span className="ml-1 text-slate-400">· {admin.phone}</span> : null}
                                </p>
                              ))}
                              {admins.length > 3 && (
                                <p className="text-[11px] text-slate-400">+{admins.length - 3} 人</p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                }

                return (
                  <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                    {/* 层级醒目标记 */}
                    <div className="mb-4 flex items-center gap-2">
                      <span className={`rounded-lg px-2.5 py-1 text-xs font-bold tracking-wide ${
                        targetType === "TEAM"
                          ? "bg-violet-100 text-violet-700"
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {targetType === "TEAM" ? "▶ 团队级" : "▶ 厅级"}
                      </span>
                      <span className="text-xs text-slate-500">
                        当前投放层级：<span className="font-semibold text-slate-700">{typeLabel}管理</span>，推送给{typeLabel}下对应管理账号
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">
                        选择要投放的{typeLabel}
                        <span className="ml-2 text-xs font-normal text-slate-400">（已选 <span className="font-semibold text-blue-600">{allIds.filter((id) => selectionSet.has(id)).length}</span> / {allIds.length} 个）</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setSelectedOrgIds(allSelected ? [] : allIds)}
                        className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                          allSelected
                            ? "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {allSelected ? "取消全选" : "全选"}
                      </button>
                    </div>
                    {candidateOrgs.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
                        当前管理范围内没有{typeLabel}
                      </div>
                    ) : targetType !== "HALL" ? (
                      <div className="mt-4 grid max-h-[520px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                        {candidateOrgs.map((org) => <OrgCard key={org.id} org={org} />)}
                      </div>
                    ) : (
                      // 厅级模式：按团队折叠分组 + 懒加载
                      <div className="mt-4 max-h-[640px] space-y-3 overflow-y-auto pr-1">
                        {hallsByTeam.map(({ team, halls }) => {
                          const teamHallIds = halls.map((h) => h.id);
                          const teamAllChecked = teamHallIds.every((id) => selectionSet.has(id));
                          const teamSomeChecked = teamHallIds.some((id) => selectionSet.has(id));
                          const isExpanded = expandedTeamIds.has(team.id);
                          const selectedCount = teamHallIds.filter((id) => selectionSet.has(id)).length;
                          return (
                            <div key={team.id} className={`rounded-2xl border bg-white transition ${
                              isExpanded ? "border-slate-300 shadow-sm" : "border-slate-200"
                            }`}>
                              {/* 团队分组头：左侧三态复选框+展开箭头，右侧计数 */}
                              <div className="flex items-center gap-0 rounded-2xl">
                                {/* 复选区：全选/取消该团队所有厅 */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedOrgIds((current) => {
                                      const without = current.filter((id) => !teamHallIds.includes(id));
                                      return teamAllChecked ? without : [...without, ...teamHallIds];
                                    })
                                  }
                                  className="flex items-center gap-2 px-3 py-3"
                                >
                                  <span
                                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                                      teamAllChecked
                                        ? "border-blue-500 bg-blue-500"
                                        : teamSomeChecked
                                          ? "border-blue-400 bg-blue-100"
                                          : "border-slate-300 bg-white"
                                    }`}
                                  >
                                    {teamAllChecked ? (
                                      <svg viewBox="0 0 10 8" fill="none" className="h-2.5 w-2.5">
                                        <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    ) : teamSomeChecked ? (
                                      <span className="block h-1.5 w-1.5 rounded-sm bg-blue-500" />
                                    ) : null}
                                  </span>
                                </button>
                                {/* 展开/折叠区 */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedTeamIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(team.id)) {
                                        next.delete(team.id);
                                      } else {
                                        next.add(team.id);
                                        loadTeamHalls(team, halls);
                                      }
                                      return next;
                                    });
                                  }}
                                  className="flex flex-1 items-center gap-2 py-3 pr-3 text-left"
                                >
                                  <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">团队</span>
                                  <span className="text-sm font-semibold text-slate-800">{team.name}</span>
                                  <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
                                    {selectedCount > 0 && (
                                      <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] font-semibold text-blue-600">
                                        已选 {selectedCount}
                                      </span>
                                    )}
                                    <span>{teamHallIds.length} 厅</span>
                                    <svg
                                      viewBox="0 0 10 6" fill="none"
                                      className={`h-2.5 w-2.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                    >
                                      <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </span>
                                </button>
                              </div>
                              {/* 厅列表：展开时显示，一行三列 */}
                              {isExpanded && (
                                <div className="grid grid-cols-1 gap-1.5 border-t border-slate-100 p-3 sm:grid-cols-2 xl:grid-cols-3">
                                  {halls.map((org) => <OrgCard key={org.id} org={org} isHall />)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {orphanHalls.length > 0 && (
                          <div className="rounded-2xl border border-slate-200 bg-white p-3">
                            <p className="mb-2 text-xs font-medium text-slate-400">其他厅</p>
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                              {orphanHalls.map((org) => <OrgCard key={org.id} org={org} isHall />)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })()
            )}
          </div>

          {mode === "ANCHOR" && (
            <DailyExclusionSelector
              orgs={orgs}
              scopePath={managementScopePath}
              excludedOrgIds={excludedOrgIds}
              excludedAnchorProfileIds={excludedAnchorProfileIds}
              knownExcludedAnchors={knownExcludedAnchors}
              onExcludedOrgIdsChange={setExcludedOrgIds}
              onExcludedAnchorProfileIdsChange={setExcludedAnchorProfileIds}
              enableAnchorExclusion={true}
              title="排除组织与主播"
              description="主播式任务只保留必要的组织排除能力，便于精确缩小范围。"
            />
          )}

          <div className="flex flex-wrap justify-between gap-3">
            <button type="button" onClick={() => setStep(2)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
              返回上一步
            </button>
            <div className="flex flex-wrap gap-3">
              {draftAssignmentId && (
                <button type="button" onClick={() => void handleDeleteDraft()} className="rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50">
                  <span className="inline-flex items-center gap-1">
                    <Trash2 size={15} />删除草稿
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void persistDraft()}
                disabled={savingDraft || !selectedTemplate}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                保存当前修改
              </button>
              <button
                type="button"
                onClick={() => void handleNext(4)}
                disabled={savingDraft || !canConfigurePreview}
                className="rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                继续：预览并发布
              </button>
            </div>
          </div>
        </section>
      )}

      {notifyDialogOpen && notifyPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">确认发送临时任务通知</h3>
                <p className="mt-1 text-sm text-slate-500">发送前请确认本次待通知主体数量与文案前缀。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (notifyingId) return;
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
                  <p className="text-xs text-slate-500">待通知主体</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{notifyPreview.total}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">涉及账号</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{notifyPreview.distinctUserCount}</p>
                </div>
                <div className="rounded-2xl bg-blue-50 px-4 py-3">
                  <p className="text-xs text-blue-600">未开始</p>
                  <p className="mt-1 text-2xl font-bold text-blue-700">{notifyPreview.pendingCount}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                  <p className="text-xs text-emerald-600">进行中</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-700">{notifyPreview.inProgressCount}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                同一账号如果命中多条主体，本次仍按主体口径参与通知统计。
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (notifyingId) return;
                  setNotifyDialogOpen(false);
                  setNotifyPreview(null);
                }}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmSendTemporaryNotify()}
                disabled={Boolean(notifyingId)}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {notifyingId ? <><Loader2 size={15} className="animate-spin" />发送中...</> : <><Send size={15} />确认发送</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">第四步：预览完成主体并正式发布</h3>
              <p className="mt-1 text-sm text-slate-500">正式发布前，请确认任务主体、截止时间与发布范围是否正确；到达截止时间后任务会自动终止并停止继续收集。</p>
            </div>
            <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">完成截止时间</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">请选择北京时间，系统会持续收集到该时间点，并在到时后自动终止。</p>
                </div>
                <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">北京时间 UTC+8</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">截止日期</label>
                  <MiniDatePicker 
                    value={deadlineDate} 
                    onChange={(val) => handleDeadlineChange(val, deadlineTime)} 
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">截止时间</label>
                  <MiniTimePicker
                    value={deadlineTime}
                    onChange={(val) => handleDeadlineChange(deadlineDate, val)}
                  />
                </div>
              </div>
            </section>
            {mode === "ANCHOR" ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">排除名单</p>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                    {totalExcludedCount === 0 ? "无排除项" : `共排除 ${totalExcludedCount} 项`}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 divide-x divide-slate-100 rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  {/* 排除团队列 */}
                  {(() => {
                    const teamSection = excludedOrgSections.find((s) => s.title === "排除团队");
                    const items = teamSection?.items ?? [];
                    return (
                      <div className="flex flex-col gap-2 p-4">
                        <p className="text-xs font-semibold text-emerald-700">
                          排除团队 <span className="ml-1 font-normal text-slate-400">{items.length} 个</span>
                        </p>
                        {items.length === 0 ? (
                          <p className="text-xs text-slate-300 py-1">—</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-[280px] overflow-y-auto pr-1">
                            {items.map((org) => (
                              <span key={org.id} className="inline-flex rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700" title={org.name}>{org.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* 排除厅列 */}
                  {(() => {
                    const hallSection = excludedOrgSections.find((s) => s.title === "排除厅");
                    const items = hallSection?.items ?? [];
                    return (
                      <div className="flex flex-col gap-2 p-4">
                        <p className="text-xs font-semibold text-amber-700">
                          排除厅 <span className="ml-1 font-normal text-slate-400">{items.length} 个</span>
                        </p>
                        {items.length === 0 ? (
                          <p className="text-xs text-slate-300 py-1">—</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-[280px] overflow-y-auto pr-1">
                            {items.map((org) => (
                              <span key={org.id} className="inline-flex rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700" title={org.name}>{org.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* 不参与任务主播列 */}
                  <div className="flex flex-col gap-2 p-4">
                    <p className="text-xs font-semibold text-violet-700">
                      不参与主播 <span className="ml-1 font-normal text-slate-400">{excludedAnchorSummaries.length} 个</span>
                    </p>
                    {excludedAnchorSummaries.length === 0 ? (
                      <p className="text-xs text-slate-300 py-1">—</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 max-h-[280px] overflow-y-auto pr-1">
                        {excludedAnchorSummaries.map((anchor) => {
                          const douyinText = anchor.douyinNo || anchor.douyinUid || "未登记抖音号";
                          return (
                            <span key={anchor.id} className="inline-flex items-center gap-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700" title={`${anchor.nickname}-${douyinText} — ${anchor.hallLabel}`}>
                              <span className="font-medium">{anchor.nickname}</span>
                              <span className="text-slate-400">-{douyinText}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                {totalExcludedCount === 0 && (
                  <p className="mt-3 text-center text-xs text-slate-400">
                    当前没有排除项，将覆盖 <span className="font-medium text-slate-600">{managementOrgName ?? "当前管理范围"}</span> 内全部主播。
                  </p>
                )}
              </div>
            ) : (
              (() => {
                const PREVIEW_LIMIT = 12;
                const selectedBases = selectedOrgIds.map(id => orgMap.get(id)).filter(o => o?.orgType === "BASE") as OrgUnit[];
                const selectedTeams = selectedOrgIds.map(id => orgMap.get(id)).filter(o => o?.orgType === "TEAM") as OrgUnit[];
                const selectedHalls = selectedOrgIds.map(id => orgMap.get(id)).filter(o => o?.orgType === "HALL") as OrgUnit[];
                const totalOrgCount = mode === "ACCOUNT" ? selectedAccounts.length + selectedOrgIds.length : selectedOrgIds.length;

                // 厅按归属团队分组，并判断是否全选该团队所有厅
                const allHallsInScope = targetOrgRows.filter(o => o.orgType === "HALL");
                const selHallSet = new Set(selectedHalls.map(h => h.id));
                type HallGroup = { team: OrgUnit; halls: OrgUnit[]; allSelected: boolean };
                const hallGroupMap = new Map<string, HallGroup>();
                const orphanHallsPreview: OrgUnit[] = [];
                for (const hall of selectedHalls) {
                  const parentTeam = hall.parentId ? orgMap.get(hall.parentId) : undefined;
                  if (parentTeam?.orgType === "TEAM") {
                    if (!hallGroupMap.has(parentTeam.id)) {
                      const totalTeamHalls = allHallsInScope.filter(h => h.parentId === parentTeam.id);
                      const allSel = totalTeamHalls.length > 0 && totalTeamHalls.every(h => selHallSet.has(h.id));
                      hallGroupMap.set(parentTeam.id, { team: parentTeam, halls: [], allSelected: allSel });
                    }
                    hallGroupMap.get(parentTeam.id)!.halls.push(hall);
                  } else {
                    orphanHallsPreview.push(hall);
                  }
                }
                const fullTeamHallGroups = [...hallGroupMap.values()].filter(g => g.allSelected);
                const partialHallGroups = [...hallGroupMap.values()].filter(g => !g.allSelected);
                const allTeamItems: { org: OrgUnit; hallCount?: number }[] = [
                  ...selectedTeams.map(org => ({ org })),
                  ...fullTeamHallGroups.map(g => ({ org: g.team, hallCount: g.halls.length })),
                ];

                return (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">已选发布范围汇总</p>
                      <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">共 {totalOrgCount} 项</span>
                    </div>

                    {/* 层级标记 */}
                    {mode === "MANAGER" && (
                      <div className="mb-3 flex items-center gap-2">
                        <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${managerSubjectTypeMeta[subjectOrgType].badge}`}>
                          {managerSubjectTypeMeta[subjectOrgType].levelLabel}投放
                        </span>
                        <span className="text-xs text-slate-400">
                          推送给所选{orgTypeMeta[subjectOrgType].label}下的对应管理账号
                        </span>
                      </div>
                    )}

                    <div className="space-y-3">
                      {/* ACCOUNT模式：精确账号 */}
                      {mode === "ACCOUNT" && (
                        <SummaryGroup
                          label="精确账号"
                          badge="bg-blue-50 text-blue-700"
                          count={selectedAccounts.length}
                          emptyText="未选择精确账号"
                          previewLimit={PREVIEW_LIMIT}
                        >
                          {selectedAccounts.map((acc) => (
                            <span key={acc.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
                              <span className="font-semibold">{acc.nickname}</span>
                              <span className="text-slate-400">{acc.phone}</span>
                            </span>
                          ))}
                        </SummaryGroup>
                      )}

                      {/* 团队（含直选团队 + 全选厅折叠的团队） */}
                      {allTeamItems.length > 0 && (
                        <SummaryGroup
                          label="团队"
                          badge="bg-violet-50 text-violet-700"
                          count={allTeamItems.length}
                          emptyText=""
                          previewLimit={PREVIEW_LIMIT}
                        >
                          {allTeamItems.map(({ org, hallCount }) => (
                            <span key={org.id} title={hallCount !== undefined ? `全选 ${hallCount} 个厅` : undefined} className="inline-flex items-center gap-1 rounded-lg border border-violet-100 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-800">
                              {hallCount !== undefined && (
                                <span className="rounded bg-violet-200 px-1 py-0.5 text-[9px] font-bold text-violet-700">全选</span>
                              )}
                              {org.name}
                              {hallCount !== undefined && (
                                <span className="text-[11px] text-violet-400">·{hallCount}厅</span>
                              )}
                            </span>
                          ))}
                        </SummaryGroup>
                      )}

                      {/* 部分选厅：按团队分组展示具体厅 */}
                      {(partialHallGroups.length > 0 || orphanHallsPreview.length > 0) && (
                        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
                            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">厅</span>
                              厅框选
                            </span>
                            <span className="text-xs text-slate-400">
                              {partialHallGroups.reduce((s, g) => s + g.halls.length, 0) + orphanHallsPreview.length} 个
                            </span>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {partialHallGroups.map(({ team, halls }) => (
                              <HallGroupRow key={team.id} team={team} halls={halls} previewLimit={PREVIEW_LIMIT} />
                            ))}
                            {orphanHallsPreview.length > 0 && (
                              <HallGroupRow team={null} halls={orphanHallsPreview} previewLimit={PREVIEW_LIMIT} />
                            )}
                          </div>
                        </div>
                      )}

                      {totalOrgCount === 0 && (
                        <p className="py-4 text-center text-sm text-slate-400">尚未选择任何发布目标</p>
                      )}
                    </div>
                  </div>
                );
              })()
            )}
            {mode === "MANAGER" && (publishPreview?.missingManagerOrgs?.length ?? 0) > 0 && (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">以下组织当前无可承接管理账号</p>
                    <p className="mt-1 text-xs leading-5 text-amber-700">这些组织已被你选中，但本次发布不会生成对应主体任务，请先补齐管理身份后再发布。</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-amber-700">{publishPreview?.missingManagerOrgs?.length ?? 0} 个组织</span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {(publishPreview?.missingManagerOrgs ?? []).map((org) => {
                    const fullOrg = orgMap.get(org.orgId);
                    const hallDouyinNo = org.orgType === "HALL" ? fullOrg?.douyinNo?.trim() : "";
                    const hallDouyinUid = org.orgType === "HALL" ? fullOrg?.douyinUid?.trim() : "";
                    return (
                      <div key={org.orgId} className="rounded-2xl border border-amber-200 bg-white px-3 py-3 text-xs text-amber-900">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{orgTypeMeta[(org.orgType as "BASE" | "TEAM" | "HALL") ?? "TEAM"]?.label ?? org.orgType}</span>
                          <span className="font-medium">{org.orgName}</span>
                        </div>
                        {org.orgType === "HALL" && (hallDouyinNo || hallDouyinUid) ? (
                          <div className="mt-2 space-y-1 text-[11px] leading-5 text-amber-800">
                            <p>抖音号：{hallDouyinNo || "未登记"}</p>
                            <p>UID：{hallDouyinUid || "未登记"}</p>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">发布后将立即生成临时任务记录，并由发起人负责后续关闭、删除和重新开启。</div>
            <div className="flex flex-wrap gap-3"><button type="button" onClick={() => setStep(3)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">返回调整配置</button><button type="button" onClick={() => void persistDraft()} disabled={savingDraft} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">保存当前修改</button>{draftAssignmentId && <button type="button" onClick={() => void handleDeleteDraft()} className="rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"><span className="inline-flex items-center gap-1"><Trash2 size={15} />删除草稿</span></button>}<button type="button" onClick={() => void handlePublishClick()} disabled={issuing || savingDraft || !canConfigurePreview || !deadlineAt} className="rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">{issuing ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />正在正式发布...</span> : <span className="inline-flex items-center gap-2"><Send size={15} />确认发布临时任务</span>}</button></div>
          </div>
          <aside className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div>
              <p className="text-sm font-semibold text-slate-900">发布核对清单</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-3"><span>表单</span><span className="max-w-[180px] truncate font-medium text-slate-900">{selectedTemplate?.title ?? "未选择"}</span></div>
              <div className="mt-3 flex items-center justify-between gap-3"><span>任务类型</span><span className={`rounded-full px-2 py-1 text-xs font-medium ${temporaryModeMeta[mode].badge}`}>{temporaryModeMeta[mode].label}</span></div>
              <div className="mt-3 flex items-center justify-between gap-3"><span>完成主体</span><span className="font-medium text-slate-900">{mode === "MANAGER" ? `${orgTypeMeta[subjectOrgType].label}主体` : "账号主体"}</span></div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-6 text-slate-500">
              <p>- 触达式任务：按账号归并，不再单独选择可见身份。</p>
              <p>- 主播式任务：固定只触达主播身份，管理账号不推送。</p>
              <p>- 管理式任务：固定只触达管理账号，主播账号不推送，多组织管理会分别推送。</p>
            </div>
            <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-xs leading-6 text-violet-700">如果这份任务需要长期保存为模板，请继续通过第一步表单管理沉淀标准表单，再在草稿中复用。</div>
          </aside>
        </section>
      )}

      {detailAssignment && (
        <div className="fixed inset-0 z-40 bg-slate-950/15" onClick={() => setDetailAssignment(null)} />
      )}

      {delayModalAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
            <div className="border-b border-slate-100 px-6 py-5">
              <p className="text-lg font-semibold text-slate-900">调整结束时间</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">复用正式发布时的结束时间选择器，修改后会同步更新该临时任务及未完成记录的截止时间。</p>
            </div>
            <div className="space-y-4 px-6 py-5">
              <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">完成截止时间</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">请选择北京时间，系统会持续收集到该时间点。</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">北京时间 UTC+8</span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">截止日期</label>
                    <MiniDatePicker
                      value={delayDeadlineAt ? delayDeadlineAt.slice(0, 10) : ""}
                      onChange={(val) => {
                        const currentTime = delayDeadlineAt ? delayDeadlineAt.slice(11, 16) : "23:59";
                        setDelayDeadlineAt(val ? `${val}T${currentTime}` : "");
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">截止时间</label>
                    <MiniTimePicker
                      value={delayDeadlineAt ? delayDeadlineAt.slice(11, 16) : ""}
                      onChange={(val) => {
                        const currentDate = delayDeadlineAt ? delayDeadlineAt.slice(0, 10) : "";
                        setDelayDeadlineAt(currentDate ? `${currentDate}T${val || "23:59"}` : "");
                      }}
                    />
                  </div>
                </div>
              </section>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setDelayModalAssignment(null);
                  setDelayDeadlineAt("");
                }}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitDelayDeadline()}
                disabled={!delayDeadlineAt}
                className="rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                确认更新
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8">
          <div className="max-h-full w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
            <div className="border-b border-slate-100 px-6 py-5">
              <p className="text-lg font-semibold text-slate-900">二次确认：正式发布临时任务</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">请强制阅读以下内容，避免表单、截止时间或排除名单配置出错。倒计时结束后才能确认发布；任务将在截止时间到达后自动终止。</p>
            </div>
            <div className="max-h-[62vh] space-y-4 overflow-y-auto px-6 py-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">表单名称</p>
                  <p className="mt-2 truncate text-sm font-semibold text-slate-900" title={selectedTemplate?.title}>{selectedTemplate?.title ?? "未选择"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">完成截止日期</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{deadlineDate || "未设置"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">任务类型</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${temporaryModeMeta[mode].badge}`}>
                      {temporaryModeMeta[mode].label}
                    </span>
                    {mode === "MANAGER" && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${managerSubjectTypeMeta[subjectOrgType].badge}`}>
                        {managerSubjectTypeMeta[subjectOrgType].levelLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {mode === "ANCHOR" ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-slate-500">排除名单</p>
                    <span className="text-xs font-medium text-slate-900">共 {totalExcludedCount} 项</span>
                  </div>
                  <div className="mt-3 max-h-56 space-y-3 overflow-y-auto pr-1">
                    {totalExcludedCount === 0 ? (
                      <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-700">当前没有排除名单，当前范围内主播将默认全部参与任务。</div>
                    ) : (
                      <>
                        {excludedOrgSections.map((section) => (
                          <div key={section.title}>
                            <p className="text-[11px] font-medium text-slate-400">{section.title}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {section.items.map((org) => (
                                <span key={org.id} className="inline-flex rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700" title={org.name}>{org.name}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                        {excludedAnchorSummaries.length > 0 && (
                          <div>
                            <p className="text-[11px] font-medium text-slate-400">不参与任务主播</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {excludedAnchorSummaries.map((anchor) => {
                                const douyinText = anchor.douyinNo || anchor.douyinUid || "未登记抖音号";
                                return (
                                  <span key={anchor.id} className="inline-flex items-center gap-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700" title={`${anchor.nickname}-${douyinText}`}>
                                    <span className="font-medium">{anchor.nickname}</span>
                                    <span className="text-slate-400">-{douyinText}</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                (() => {
                  const confirmSelBases = selectedOrgIds.map(id => orgMap.get(id)).filter(o => o?.orgType === "BASE") as OrgUnit[];
                  const confirmSelTeams = selectedOrgIds.map(id => orgMap.get(id)).filter(o => o?.orgType === "TEAM") as OrgUnit[];
                  const confirmSelHalls = selectedOrgIds.map(id => orgMap.get(id)).filter(o => o?.orgType === "HALL") as OrgUnit[];


                  // 厅按所属团队分组，判断是否全选
                  // 全选：该团队下所有厅都在选中列表中 → 只显示团队
                  // 非全选：显示具体的厅
                  const confirmHallSelSet = new Set(confirmSelHalls.map(h => h.id));
                  // 取当前管理范围内所有厅
                  const allHallsInScope = targetOrgRows.filter(o => o.orgType === "HALL");
                  // 对每个有归属团队的厅进行分组
                  type ConfirmHallGroup = { team: OrgUnit; halls: OrgUnit[]; allSelected: boolean };
                  const confirmHallGroupMap = new Map<string, ConfirmHallGroup>();
                  for (const hall of confirmSelHalls) {
                    const parentTeam = hall.parentId ? orgMap.get(hall.parentId) : undefined;
                    if (parentTeam?.orgType === "TEAM") {
                      if (!confirmHallGroupMap.has(parentTeam.id)) {
                        // 计算该团队下全部厅数量
                        const totalTeamHalls = allHallsInScope.filter(h => h.parentId === parentTeam.id);
                        confirmHallGroupMap.set(parentTeam.id, { team: parentTeam, halls: [], allSelected: false });
                        // 判断全选：此团队下所有厅是否都在已选中
                        const allSel = totalTeamHalls.length > 0 && totalTeamHalls.every(h => confirmHallSelSet.has(h.id));
                        confirmHallGroupMap.get(parentTeam.id)!.allSelected = allSel;
                      }
                      confirmHallGroupMap.get(parentTeam.id)!.halls.push(hall);
                    }
                  }
                  const confirmHallGroups = [...confirmHallGroupMap.values()];
                  // 全选团队（用团队代替）
                  const fullTeamGroups = confirmHallGroups.filter(g => g.allSelected);
                  // 部分选厅（需展示具体厅）
                  const partialHallGroups = confirmHallGroups.filter(g => !g.allSelected);
                  // 无归属团队的孤立厅
                  const confirmOrphanHalls = confirmSelHalls.filter(h => {
                    const parentTeam = h.parentId ? orgMap.get(h.parentId) : undefined;
                    return !(parentTeam?.orgType === "TEAM");
                  });

                  const totalConfirmCount = mode === "ACCOUNT" ? selectedAccounts.length + selectedOrgIds.length : selectedOrgIds.length;

                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium text-slate-500">圈定范围汇总</p>
                        <span className="text-xs font-medium text-slate-900">共 {totalConfirmCount} 项</span>
                      </div>
                      <div className="mt-3 space-y-3">
                        {/* 精确账号 */}
                        {mode === "ACCOUNT" && selectedAccounts.length > 0 && (
                          <div>
                            <p className="text-[11px] font-medium text-slate-400">精确账号</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {selectedAccounts.map((acc) => (
                                <span key={acc.id} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                  <span className="font-medium">{acc.nickname}</span>
                                  <span className="text-slate-400">{acc.phone}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {confirmSelBases.length > 0 && (
                          <div>
                            <p className="text-[11px] font-medium text-slate-400">基地框选</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {confirmSelBases.map((org) => (
                                <span key={org.id} className="inline-flex items-center gap-1 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-700">
                                  <span className="rounded-md bg-violet-200 px-1 py-0.5 text-[9px] font-bold text-violet-700">基地</span>
                                  {org.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* 团队（含手动选中的团队 + 全选厅的团队） */}
                        {(confirmSelTeams.length > 0 || fullTeamGroups.length > 0) && (
                          <div>
                            <p className="text-[11px] font-medium text-slate-400">
                              团队框选
                              {fullTeamGroups.length > 0 && (
                                <span className="ml-1 text-slate-300">（含全选厅的团队）</span>
                              )}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {confirmSelTeams.map((org) => (
                                <span key={org.id} className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                                  <span className="rounded-md bg-emerald-200 px-1 py-0.5 text-[9px] font-bold text-emerald-700">团队</span>
                                  {org.name}
                                </span>
                              ))}
                              {fullTeamGroups.map(({ team, halls }) => (
                                <span key={team.id} title={`全选 ${halls.length} 个厅`} className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                                  <span className="rounded-md bg-emerald-200 px-1 py-0.5 text-[9px] font-bold text-emerald-700">全选</span>
                                  {team.name}
                                  <span className="text-[11px] text-emerald-400">·{halls.length}厅</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* 部分选厅：按团队分组展示 */}
                        {(partialHallGroups.length > 0 || confirmOrphanHalls.length > 0) && (
                          <div>
                            <p className="text-[11px] font-medium text-slate-400">厅框选</p>
                            <div className="mt-2 space-y-2">
                              {partialHallGroups.map(({ team, halls }) => (
                                <div key={team.id}>
                                  <p className="mb-1 flex items-center gap-1 text-[10px] text-slate-400">
                                    <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-bold text-violet-600">{team.name}</span>
                                    <span>{halls.length} 厅</span>
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {halls.map((org) => (
                                      <span key={org.id} className="inline-flex rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{org.name}</span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                              {confirmOrphanHalls.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {confirmOrphanHalls.map((org) => (
                                    <span key={org.id} className="inline-flex rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{org.name}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {totalConfirmCount === 0 && (
                          <p className="py-2 text-center text-xs text-slate-400">尚未选择任何发布目标</p>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}

              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                发布后将立即生成临时任务记录，由发起人负责后续关闭、删除和重新开启；请确认以上内容完全正确后再继续。
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
              <span className="text-sm text-slate-500">{confirmCountdown > 0 ? `请继续阅读，${confirmCountdown}s 后可确认` : "已完成强制阅读，可以确认发布"}</span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmModalOpen(false)}
                  disabled={issuing}
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  返回修改
                </button>
                <button
                  type="button"
                  disabled={confirmCountdown > 0 || issuing}
                  onClick={() => void handleConfirmPublish()}
                  className="rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {issuing ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />正在发布...</span> : confirmCountdown > 0 ? `确认发布（${confirmCountdown}s）` : "我已核对，确认发布"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <TaskTemplateDrawer
        open={editorOpen}
        category="TEMPORARY"
        currentOrgId={currentOrgId ?? ""}
        scopeOrgId={managementOrgId}
        template={editingTemplate}
        readOnly={editorReadOnly}
        onClose={() => {
          setEditorOpen(false);
          setEditingTemplate(null);
          setEditorReadOnly(false);
          setViewingTemplateId("");
        }}
        onSaved={async (template) => {
          resetDraftConfiguration(template.id);
          setDraftAssignmentId("");
          setEditorOpen(false);
          setEditingTemplate(null);
          setEditorReadOnly(false);
          setLibraryTab("draft");
          setStep(1);

          if (template.status === "draft") {
            setNotice("临时任务表单草稿已保存，请从第一步选择这份草稿后继续配置任务类型、目标人群和截止时间。 ");
          } else {
            setNotice("临时任务表单已保存。 ");
          }

          await onReload();
          setSelectedTemplateId(template.id);
        }}
        onSavedAndNext={async (template) => {
          // 第一阶段：完全复用 onSaved 的逻辑，原封不动
          resetDraftConfiguration(template.id);
          setDraftAssignmentId("");
          setEditorOpen(false);
          setEditingTemplate(null);
          setEditorReadOnly(false);
          setLibraryTab("draft");
          setStep(1);
          setNotice("表单草稿已创建，正在跳转到任务类型配置...");
          await onReload();
          setSelectedTemplateId(template.id);
          // 第二阶段：自动帮用户触发"下一步"，传入 template 绕过闭包旧值问题
          await handleNext(2, template);
        }}
      />
    </div>
  );
}
