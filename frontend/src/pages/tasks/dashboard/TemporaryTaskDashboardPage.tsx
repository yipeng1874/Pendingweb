import { useEffect, useMemo, useState } from "react";
import { Bell, ChevronRight, Loader2, RefreshCw, Search, X } from "lucide-react";
import type {
  Identity,
  OrgUnit,
  TaskAssignment,
  TemporaryDashboardAnchorOrgNode,
  TemporaryDashboardProgressFilter,
  TemporaryDashboardRecordDetailResponse,
  TemporaryDashboardRecordItem,
  TemporaryDashboardRecordListResponse,
  TemporaryDashboardSummaryResponse,
  TemporaryTaskMode,
} from "../../../types";
import { notifyApi, reportApi } from "../../../services/task";
import { fetchOrgTree } from "../../../services/organization";
import { useIdentityStore } from "../../../stores/identityStore";
import { TemporaryNotifyScheduleModal } from "../components/TemporaryNotifyScheduleModal";

const ASSIGNMENT_PAGE_SIZE = 5;
const RECORD_PAGE_SIZE = 10;

type AnchorOrgNodeState = {
  teams: TemporaryDashboardAnchorOrgNode[];
  selectedTeam: TemporaryDashboardAnchorOrgNode | null;
  halls: TemporaryDashboardAnchorOrgNode[];
};

type LifecycleTab = "active" | "ended";

function isOrgWithinScope(org: OrgUnit, scopePath?: string) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`) || scopePath.startsWith(`${org.path}/`);
}

function findBaseByOrgId(orgs: OrgUnit[], orgId?: string) {
  if (!orgId) return null;
  let current: OrgUnit | null = orgs.find((org) => org.id === orgId) ?? null;
  while (current && current.orgType !== "BASE") {
    current = current.parentId ? orgs.find((org) => org.id === current?.parentId) ?? null : null;
  }
  return current;
}

function getAvailableBaseOrgs(orgs: OrgUnit[], identity?: Identity) {
  return orgs
    .filter((org) => org.status === "active" && org.orgType === "BASE" && isOrgWithinScope(org, identity?.scopePath))
    .sort((left, right) => left.path.localeCompare(right.path));
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

function canSelectBase(identity?: Identity) {
  return ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(identity?.roleCode ?? "");
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function resolveAttachmentUrl(fileUrl?: string | null) {
  if (!fileUrl) return "#";
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  if (fileUrl.startsWith("/api/uploads/")) return fileUrl;
  if (fileUrl.startsWith("/uploads/")) return `/api${fileUrl}`;
  return fileUrl.startsWith("/") ? `/api${fileUrl}` : `/api/${fileUrl}`;
}

function getModeMeta(mode: TemporaryTaskMode) {
  if (mode === "ACCOUNT") return { label: "触达式任务" };
  if (mode === "ANCHOR") return { label: "主播式任务" };
  return { label: "管理式任务" };
}

function getStatusMeta(status: TemporaryDashboardRecordItem["status"]) {
  if (status === "submitted") return { label: "已完成", cls: "bg-emerald-50 text-emerald-700" };
  if (status === "in_progress") return { label: "进行中", cls: "bg-blue-50 text-blue-700" };
  if (status === "overdue") return { label: "已逾期", cls: "bg-rose-50 text-rose-700" };
  return { label: "未开始", cls: "bg-slate-100 text-slate-600" };
}

function MetricCard({
  label,
  value,
  active,
  tone,
  onClick,
}: {
  label: string;
  value: number | string;
  active: boolean;
  tone?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left shadow-sm transition ${active ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
    >
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`mt-1.5 text-xl font-bold ${tone ?? "text-slate-900"}`}>{value}</p>
    </button>
  );
}

function AnchorTreeNode({
  node,
  selectedHallId,
  onOpenChildren,
  onSelectHall,
}: {
  node: TemporaryDashboardAnchorOrgNode;
  selectedHallId?: string | null;
  onOpenChildren: (node: TemporaryDashboardAnchorOrgNode) => void;
  onSelectHall: (node: TemporaryDashboardAnchorOrgNode) => void;
}) {
  const isHall = node.orgType === "HALL";
  const isSelected = selectedHallId === node.orgId;
  const canExpand = node.hasChildren && !isHall;
  return (
    <div className={`rounded-2xl border px-4 py-4 shadow-sm transition ${isSelected ? "border-blue-200 bg-blue-50/60" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canExpand}
            onClick={() => canExpand && onOpenChildren(node)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border ${canExpand ? "border-slate-200 text-slate-500 hover:bg-slate-50" : "border-slate-100 text-slate-300"}`}
          >
            {canExpand ? <ChevronRight size={16} /> : <span className="text-xs">·</span>}
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-semibold text-slate-900">{node.orgName}</h4>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{node.orgType === "TEAM" ? "团队" : node.orgType === "HALL" ? "厅" : node.orgType}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">投放 {node.total} 个主体 · 完成率 <span className="font-semibold text-slate-900">{node.completionRate}%</span></p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>已完成 {node.submitted}</span>
              <span>进行中 {node.inProgress}</span>
              <span>未开始 {node.pending}</span>
              <span>已逾期 {node.overdue}</span>
            </div>
          </div>
        </div>
        {isHall && (
          <button
            type="button"
            onClick={() => onSelectHall(node)}
            className={`rounded-xl px-3 py-2 text-xs font-medium transition ${isSelected ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"}`}
          >
            {isSelected ? "已选中" : "查看主播"}
          </button>
        )}
      </div>
    </div>
  );
}

function ConfirmNotifyModal({
  open,
  preview,
  prefix,
  loading,
  onPrefixChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  preview: { total: number; distinctUserCount: number; pendingCount: number; inProgressCount: number } | null;
  prefix: string;
  loading: boolean;
  onPrefixChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open || !preview) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">确认发送飞书通知</h3>
            <p className="mt-1 text-xs text-slate-400">仅通知当前临时任务中未完成的主体。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">未完成主体</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{preview.total}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">涉及账号</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{preview.distinctUserCount}</p>
            </div>
            <div className="rounded-2xl bg-amber-50 px-4 py-3">
              <p className="text-xs text-amber-700">未开始</p>
              <p className="mt-1 text-xl font-semibold text-amber-800">{preview.pendingCount}</p>
            </div>
            <div className="rounded-2xl bg-blue-50 px-4 py-3">
              <p className="text-xs text-blue-700">进行中</p>
              <p className="mt-1 text-xl font-semibold text-blue-800">{preview.inProgressCount}</p>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-xs text-slate-500">飞书通知前缀</label>
            <input
              value={prefix}
              onChange={(event) => onPrefixChange(event.target.value)}
              placeholder="来自系统提醒"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-400"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "发送中..." : "确认发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordDetailModal({
  detail,
  loading,
  onClose,
}: {
  detail: TemporaryDashboardRecordDetailResponse | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
      <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">主体任务详情</h3>
            <p className="mt-1 text-xs text-slate-400">查看该主体的子任务完成情况、回传内容与可见身份。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(88vh-72px)] overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-400">
              <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />详情加载中...</span>
            </div>
          ) : !detail ? (
            <div className="py-10 text-center text-sm text-slate-400">暂无主体详情数据。</div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-slate-900">{detail.record.subjectName || detail.record.subjectKey}</h4>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusMeta(detail.record.status).cls}`}>{getStatusMeta(detail.record.status).label}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">完成进度 {detail.record.doneItems}/{detail.record.totalItems} · 截止时间 {formatDateTime(detail.record.deadlineAt)}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>发布人：{detail.record.publisherName ?? "—"}</span>
                      {detail.record.participantCount ? <span>协同人数：{detail.record.participantCount}</span> : null}
                      {detail.record.submissionCount ? <span>已填写子项：{detail.record.submissionCount}</span> : null}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>最后提交：{formatDateTime(detail.record.lastSubmittedAt ?? detail.record.submittedAt)}</p>
                    <p className="mt-1">最后填写人：{detail.record.lastSubmittedByName ?? detail.record.lastSubmittedByIdentityId ?? detail.record.lastSubmittedByUserId ?? "—"}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <h5 className="text-sm font-semibold text-slate-900">可见身份 / 操作身份</h5>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(detail.record.visibleIdentities ?? []).length === 0 ? (
                    <p className="text-xs text-slate-400">暂无可见身份信息</p>
                  ) : (
                    (detail.record.visibleIdentities ?? []).map((identity) => (
                      <div key={identity.id} className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <p className="font-medium text-slate-800">{identity.userName || identity.userId}</p>
                        <p className="mt-1">{identity.roleCode}{identity.orgName ? ` · ${identity.orgName}` : ""}</p>
                        {identity.phone && <p className="mt-1 text-slate-400">{identity.phone}</p>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {detail.items.map((item) => (
                  <div key={item.taskItemId} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{item.title}</p>
                        <p className="mt-1 text-xs text-slate-400">{item.isRequired ? "必做项" : "选做项"} · {item.itemType}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.done ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{item.done ? "已完成" : "未完成"}</span>
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-500">
                      {item.completedByName && <p>完成人：{item.completedByName}</p>}
                      {item.doneAt && <p>完成时间：{formatDateTime(item.doneAt)}</p>}
                      {item.answerText && (
                        <p>
                          {detail.record.subjectType === "ORG" && detail.record.assignment?.temporaryMode === "MANAGER" ? "当前结果：" : "回传文本："}
                          {item.answerText}
                        </p>
                      )}
                      {item.answerOptions?.length ? <p>回传选项：{item.answerOptions.join("、")}</p> : null}
                      {item.itemType === "LINK" ? <p>链接确认：{item.isLinkConfirmed ? "已确认" : "未确认"}</p> : null}
                      {item.attachments.length ? (
                        <div>
                          <p>附件：</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {item.attachments.map((attachment) => (
                              <a
                                key={attachment.id}
                                href={resolveAttachmentUrl(attachment.fileUrl)}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
                              >
                                {attachment.fileName}
                              </a>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {!item.done && !item.answerText && !item.answerOptions?.length && !item.attachments.length && <p>暂无回传数据</p>}
                    </div>
                    {detail.record.subjectType === "ORG" && detail.record.assignment?.temporaryMode === "MANAGER" ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-xs font-semibold text-slate-700">协同填写记录</p>
                        {(item.contributions?.length ?? 0) > 0 ? (
                          <div className="mt-3 space-y-2">
                            {item.contributions?.map((contribution, index) => (
                              <div key={`${contribution.identityId}-${contribution.createdAt}-${index}`} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-medium text-slate-800">{contribution.contributorName ?? contribution.identityId}</p>
                                  <p className="text-[11px] text-slate-400">{formatDateTime(contribution.createdAt)}</p>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap leading-5 text-slate-500">{contribution.content}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs leading-5 text-slate-400">当前子任务暂无可追溯的协同填写记录。历史任务若未记录贡献流水，将仅展示当前结果与最后提交信息。</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TemporaryTaskDashboardPage() {
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [selectedScopeOrgId, setSelectedScopeOrgId] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleTab>("active");
  const [mode, setMode] = useState<TemporaryTaskMode>("ACCOUNT");
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [assignmentHasNextPage, setAssignmentHasNextPage] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [summary, setSummary] = useState<TemporaryDashboardSummaryResponse | null>(null);
  const [recordPage, setRecordPage] = useState(1);
  const [recordFilter, setRecordFilter] = useState<TemporaryDashboardProgressFilter>("all");
  const [recordKeywordInput, setRecordKeywordInput] = useState("");
  const [recordKeyword, setRecordKeyword] = useState("");
  const [recordList, setRecordList] = useState<TemporaryDashboardRecordListResponse | null>(null);
  const [anchorOrgState, setAnchorOrgState] = useState<AnchorOrgNodeState>({ teams: [], selectedTeam: null, halls: [] });
  const [anchorTeamCache, setAnchorTeamCache] = useState<Record<string, TemporaryDashboardAnchorOrgNode[]>>({});
  const [anchorHallCache, setAnchorHallCache] = useState<Record<string, TemporaryDashboardAnchorOrgNode[]>>({});
  const [anchorRecordCache, setAnchorRecordCache] = useState<Record<string, TemporaryDashboardRecordListResponse>>({});
  const [selectedAnchorHall, setSelectedAnchorHall] = useState<TemporaryDashboardAnchorOrgNode | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [recordDetail, setRecordDetail] = useState<TemporaryDashboardRecordDetailResponse | null>(null);
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [activeModeCount, setActiveModeCount] = useState<{ ACCOUNT: number; ANCHOR: number; MANAGER: number } | null>(null);
  const [notifyPrefix, setNotifyPrefix] = useState("");
  const [notifyPreviewing, setNotifyPreviewing] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyNotice, setNotifyNotice] = useState("");
  const [notifyPreview, setNotifyPreview] = useState<{ total: number; distinctUserCount: number; pendingCount: number; inProgressCount: number } | null>(null);
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);

  const availableBaseOrgs = useMemo(() => getAvailableBaseOrgs(orgs, currentIdentity), [orgs, currentIdentity]);
  const resolvedIdentityBaseId = useMemo(() => resolveIdentityBaseId(orgs, currentIdentity), [orgs, currentIdentity]);
  const canManageTemporaryNotify = useMemo(() => ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(currentIdentity?.roleCode ?? ""), [currentIdentity]);
  const resolvedIdentityBase = useMemo(() => orgs.find((org) => org.id === resolvedIdentityBaseId) ?? null, [orgs, resolvedIdentityBaseId]);
  const allowBaseSelection = useMemo(() => canSelectBase(currentIdentity), [currentIdentity]);
  const activeModeMeta = useMemo(() => getModeMeta(mode), [mode]);

  const metrics = useMemo<Array<{ key: TemporaryDashboardProgressFilter; label: string; value: number; tone?: string }>>(() => {
    if (!summary) return [];
    return [
      { key: "all", label: "投放主体", value: summary.total },
      { key: "submitted", label: "已完成", value: summary.submitted, tone: "text-emerald-600" },
      { key: "in_progress", label: "进行中", value: summary.inProgress, tone: "text-blue-600" },
      { key: "pending", label: "未开始", value: summary.pending, tone: "text-slate-700" },
      { key: "overdue", label: "已逾期", value: summary.overdue, tone: "text-rose-600" },
    ];
  }, [summary]);

  async function loadAssignments(page = 1, preserveSelection = false) {
    if (!selectedScopeOrgId) {
      setAssignments([]);
      setSelectedAssignmentId("");
      setSummary(null);
      setRecordList(null);
      setAssignmentHasNextPage(false);
      return;
    }
    setLoadingAssignments(true);
    const payload = await reportApi
      .listTemporaryDashboardAssignments({
        scopeOrgId: selectedScopeOrgId,
        mode,
        lifecycle,
        limit: ASSIGNMENT_PAGE_SIZE,
        offset: (page - 1) * ASSIGNMENT_PAGE_SIZE,
      })
      .catch(() => null);
    const nextAssignments = payload?.items ?? [];
    setAssignments(nextAssignments);
    setAssignmentHasNextPage(payload?.hasMore ?? false);
    setAssignmentPage(page);
    setLoadingAssignments(false);

    if (!preserveSelection || !nextAssignments.some((item) => item.id === selectedAssignmentId)) {
      const nextSelected = nextAssignments[0]?.id ?? "";
      setSelectedAssignmentId(nextSelected);
      setRecordFilter("all");
      setRecordPage(1);
      setRecordKeyword("");
      setRecordKeywordInput("");
      setSelectedAnchorHall(null);
      setAnchorOrgState({ teams: [], selectedTeam: null, halls: [] });
      setAnchorTeamCache({});
      setAnchorHallCache({});
      setAnchorRecordCache({});
      if (!nextSelected) {
        setSummary(null);
        setRecordList(null);
      }
    }
  }

  async function handleSendTemporaryNotify() {
    if (!selectedAssignmentId || !selectedScopeOrgId) return;
    setNotifyPreviewing(true);
    setNotifyNotice("");
    try {
      const preview = await notifyApi.getTemporaryFeishuPreview(selectedAssignmentId, selectedScopeOrgId);
      const suggestedPrefix = notifyPrefix || preview.prefixPlaceholder || "来自系统提醒";
      setNotifyPrefix(suggestedPrefix);
      setNotifyPreview({
        total: preview.total,
        distinctUserCount: preview.distinctUserCount,
        pendingCount: preview.pendingCount,
        inProgressCount: preview.inProgressCount,
      });
      setNotifyModalOpen(true);
    } catch (error: any) {
      setNotifyNotice(error?.message ?? "临时任务飞书通知预览失败，请稍后重试。");
    } finally {
      setNotifyPreviewing(false);
    }
  }

  async function confirmSendTemporaryNotify() {
    if (!selectedAssignmentId || !selectedScopeOrgId) return;
    setNotifying(true);
    setNotifyNotice("");
    try {
      const result = await notifyApi.sendTemporaryFeishu({ assignmentId: selectedAssignmentId, scopeOrgId: selectedScopeOrgId, prefix: notifyPrefix || "来自系统提醒" });
      const successCount = result.results.reduce((sum, item) => sum + item.successCount, 0);
      setNotifyNotice(`临时任务飞书通知已发送，成功触达 ${successCount} 人，未绑定 ${result.summary.unboundCount} 人。`);
      setNotifyModalOpen(false);
    } catch (error: any) {
      setNotifyNotice(error?.message ?? "临时任务飞书通知发送失败，请稍后重试。");
    } finally {
      setNotifying(false);
    }
  }

  async function loadSummary(assignmentId: string) {
    if (!assignmentId) {
      setSummary(null);
      return;
    }
    setLoadingSummary(true);
    const payload = await reportApi.getTemporaryDashboardSummary(assignmentId).catch(() => null);
    setSummary(payload);
    setLoadingSummary(false);
  }

  async function loadRecords(assignmentId: string, filter: TemporaryDashboardProgressFilter, page = 1, keyword = recordKeyword) {
    if (!assignmentId) {
      setRecordList(null);
      return;
    }

    const cacheKey = mode === "ANCHOR" && selectedAnchorHall
      ? `${assignmentId}:${selectedAnchorHall.orgId}:${filter}:${keyword}:${page}`
      : "";
    if (cacheKey && anchorRecordCache[cacheKey]) {
      setRecordList(anchorRecordCache[cacheKey]);
      setRecordPage(page);
      return;
    }

    setLoadingRecords(true);
    const payload = mode === "ANCHOR" && selectedAnchorHall
      ? await reportApi.getTemporaryDashboardAnchorHallRecords(assignmentId, selectedAnchorHall.orgId, {
          filter,
          keyword,
          limit: RECORD_PAGE_SIZE,
          offset: (page - 1) * RECORD_PAGE_SIZE,
        }).catch(() => null)
      : await reportApi.getTemporaryDashboardRecords(assignmentId, {
          filter,
          keyword,
          limit: RECORD_PAGE_SIZE,
          offset: (page - 1) * RECORD_PAGE_SIZE,
        }).catch(() => null);
    if (cacheKey && payload) {
      setAnchorRecordCache((current) => ({ ...current, [cacheKey]: payload }));
    }
    setRecordList(payload);
    setRecordPage(page);
    setLoadingRecords(false);
  }

  async function loadAnchorTeams(assignmentId: string) {
    if (!assignmentId || mode !== "ANCHOR") {
      setAnchorOrgState({ teams: [], selectedTeam: null, halls: [] });
      return;
    }
    if (anchorTeamCache[assignmentId]) {
      setAnchorOrgState({ teams: anchorTeamCache[assignmentId], selectedTeam: null, halls: [] });
      return;
    }
    const payload = await reportApi.getTemporaryDashboardAnchorTeamNodes(assignmentId).catch(() => null);
    const items = payload?.items ?? [];
    setAnchorTeamCache((current) => ({ ...current, [assignmentId]: items }));
    setAnchorOrgState({ teams: items, selectedTeam: null, halls: [] });
  }

  async function loadAnchorHalls(assignmentId: string, team: TemporaryDashboardAnchorOrgNode) {
    if (!assignmentId || mode !== "ANCHOR") return;
    const cacheKey = `${assignmentId}:${team.orgId}`;
    if (anchorHallCache[cacheKey]) {
      setAnchorOrgState((current) => ({ ...current, selectedTeam: team, halls: anchorHallCache[cacheKey] }));
      return;
    }
    const payload = await reportApi.getTemporaryDashboardAnchorHallNodes(assignmentId, team.orgId).catch(() => null);
    const items = payload?.items ?? [];
    setAnchorHallCache((current) => ({ ...current, [cacheKey]: items }));
    setAnchorOrgState((current) => ({ ...current, selectedTeam: team, halls: items }));
  }

  async function openRecordDetail(recordId: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    const payload = await reportApi.getTemporaryDashboardRecordDetail(recordId).catch(() => null);
    setRecordDetail(payload);
    setDetailLoading(false);
  }

  async function bootstrap() {
    setLoadingPage(true);
    const orgTree = await fetchOrgTree().catch(() => [] as OrgUnit[]);
    setOrgs(orgTree);
    const availableBases = getAvailableBaseOrgs(orgTree, currentIdentity);
    const fallbackBaseId = resolveIdentityBaseId(orgTree, currentIdentity) || (availableBases.length === 1 ? availableBases[0].id : "") || availableBases[0]?.id || "";
    setSelectedScopeOrgId((current) => current || fallbackBaseId);
    setLoadingPage(false);
  }

  useEffect(() => {
    void bootstrap();
  }, [currentIdentity?.orgId, currentIdentity?.scopePath, currentIdentity?.roleCode]);

  useEffect(() => {
    const validIds = new Set(availableBaseOrgs.map((org) => org.id));
    if (selectedScopeOrgId && validIds.has(selectedScopeOrgId)) return;

    const fallbackCandidates = [
      resolvedIdentityBaseId,
      availableBaseOrgs.length === 1 ? availableBaseOrgs[0].id : "",
      availableBaseOrgs[0]?.id ?? "",
    ].filter((value): value is string => Boolean(value));
    const nextScopeOrgId = fallbackCandidates.find((value) => validIds.has(value)) ?? "";
    if (nextScopeOrgId !== selectedScopeOrgId) setSelectedScopeOrgId(nextScopeOrgId);
  }, [availableBaseOrgs, resolvedIdentityBaseId, selectedScopeOrgId]);

  useEffect(() => {
    if (!selectedScopeOrgId) return;
    void loadAssignments(1);
  }, [selectedScopeOrgId, lifecycle, mode]);

  useEffect(() => {
    if (!selectedScopeOrgId) {
      setActiveModeCount(null);
      return;
    }
    reportApi.getTemporaryActiveModeCount(selectedScopeOrgId).then(setActiveModeCount).catch(() => null);
  }, [selectedScopeOrgId]);

  useEffect(() => {
    if (!selectedAssignmentId) return;
    void loadSummary(selectedAssignmentId);
    if (mode === "ANCHOR") {
      setSelectedAnchorHall(null);
      setRecordList(null);
      void loadAnchorTeams(selectedAssignmentId);
    } else {
      void loadRecords(selectedAssignmentId, recordFilter, 1, recordKeyword);
    }
  }, [selectedAssignmentId, mode]);

  useEffect(() => {
    if (!selectedAssignmentId) return;
    if (mode === "ANCHOR") {
      if (!selectedAnchorHall) return;
      void loadRecords(selectedAssignmentId, recordFilter, 1, recordKeyword);
      return;
    }
    void loadRecords(selectedAssignmentId, recordFilter, 1, recordKeyword);
  }, [recordFilter, recordKeyword, selectedAnchorHall?.orgId]);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold text-slate-900">临时任务看板</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">按生命周期与模式查看主体进度</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">基地</span>
            {allowBaseSelection && availableBaseOrgs.length > 1 ? (
              <select
                value={selectedScopeOrgId}
                onChange={(event) => setSelectedScopeOrgId(event.target.value)}
                className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400"
              >
                <option value="">请选择基地</option>
                {availableBaseOrgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            ) : (
              <span className="min-w-[180px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {availableBaseOrgs.find((org) => org.id === selectedScopeOrgId)?.name ?? resolvedIdentityBase?.name ?? (availableBaseOrgs.length ? availableBaseOrgs[0].name : "暂无可管理基地")}
              </span>
            )}
            {canManageTemporaryNotify && (
              <button
                type="button"
                onClick={() => setScheduleModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
              >
                <Bell size={14} />自动催办
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void loadAssignments(assignmentPage, true);
                if (selectedAssignmentId) {
                  void loadSummary(selectedAssignmentId);
                  if (mode === "ANCHOR") {
                    if (anchorOrgState.selectedTeam) {
                      void loadAnchorHalls(selectedAssignmentId, anchorOrgState.selectedTeam);
                    } else {
                      void loadAnchorTeams(selectedAssignmentId);
                    }
                    if (selectedAnchorHall) void loadRecords(selectedAssignmentId, recordFilter, recordPage, recordKeyword);
                  } else {
                    void loadRecords(selectedAssignmentId, recordFilter, recordPage, recordKeyword);
                  }
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RefreshCw size={14} />刷新
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="inline-flex w-fit rounded-2xl border border-slate-200 bg-slate-50 p-1">
            {([
              { key: "active", label: "进行中" },
              { key: "ended", label: "已结束" },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setLifecycle(item.key)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${lifecycle === item.key ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="inline-flex w-fit flex-wrap rounded-2xl border border-slate-200 bg-slate-50 p-1">
            {(["ACCOUNT", "ANCHOR", "MANAGER"] as TemporaryTaskMode[]).map((item) => {
              const meta = getModeMeta(item);
              const count = activeModeCount?.[item] ?? 0;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition ${mode === item ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {meta.label}
                  {count > 0 && (
                    <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loadingPage ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">临时任务看板加载中...</div>
      ) : !selectedScopeOrgId && availableBaseOrgs.length > 0 ? (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 px-6 py-10 text-center shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <p className="mb-4 text-sm text-amber-700">请选择一个基地后查看临时任务看板。</p>
          <div className="flex flex-wrap justify-center gap-2">
            {availableBaseOrgs.slice(0, 6).map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => setSelectedScopeOrgId(org.id)}
                className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
              >
                {org.name}
              </button>
            ))}
          </div>
        </div>
      ) : !selectedScopeOrgId ? (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 px-6 py-16 text-center text-sm text-amber-700">请先选择一个基地后查看临时任务看板。</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">任务列表</h3>
                <p className="mt-1 text-xs text-slate-500">{activeModeMeta.label} · 每页 {ASSIGNMENT_PAGE_SIZE} 条</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">第 {assignmentPage} 页</span>
            </div>

            <div className="mt-3 space-y-2.5">
              {loadingAssignments ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">任务列表加载中...</div>
              ) : assignments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">当前筛选下暂无临时任务。</div>
              ) : (
                assignments.map((assignment) => (
                  <button
                    key={assignment.id}
                    type="button"
                    onClick={() => {
                      setSelectedAssignmentId(assignment.id);
                      setRecordFilter("all");
                      setRecordPage(1);
                      setRecordKeyword("");
                      setRecordKeywordInput("");
                      setSelectedAnchorHall(null);
                    }}
                    className={`w-full rounded-2xl border px-3.5 py-3 text-left transition ${selectedAssignmentId === assignment.id ? "border-blue-300 bg-blue-50 shadow-[0_8px_20px_rgba(76,114,255,0.08)]" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                  >
                    <p className="line-clamp-2 text-sm font-semibold text-slate-900">{assignment.template?.title ?? "未命名临时任务"}</p>
                    <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                      <p>发布时间：{formatDateTime(assignment.publishedAt ?? assignment.createdAt)}</p>
                      <p>截止时间：{formatDateTime(assignment.deadlineAt)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="mt-4 flex items-center justify-center gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                disabled={assignmentPage <= 1 || loadingAssignments}
                onClick={() => void loadAssignments(assignmentPage - 1, true)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={!assignmentHasNextPage || loadingAssignments}
                onClick={() => void loadAssignments(assignmentPage + 1, true)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </aside>

          <section className="space-y-4">
            {!selectedAssignmentId ? (
              <div className="rounded-3xl bg-white py-20 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">请先从左侧选择一条临时任务。</div>
            ) : loadingSummary ? (
              <div className="rounded-3xl bg-white py-20 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />任务汇总加载中...</span>
              </div>
            ) : summary ? (
              <>
                <div className="rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">飞书通知</p>
                      <p className="mt-1 text-xs text-slate-500">点击后在弹窗中填写通知前缀，并确认本次待通知主体。</p>
                    </div>
                    {canManageTemporaryNotify ? (
                      <button
                        type="button"
                        onClick={() => void handleSendTemporaryNotify()}
                        disabled={notifyPreviewing || notifying || !selectedAssignmentId}
                        className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {notifyPreviewing ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />预览中...</span> : notifying ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />发送中...</span> : <>通知未完成</>}
                      </button>
                    ) : null}
                  </div>
                  {notifyNotice && <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{notifyNotice}</div>}
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {metrics.map((metric) => (
                    <MetricCard
                      key={metric.key}
                      label={metric.label}
                      value={metric.value}
                      tone={metric.tone}
                      active={recordFilter === metric.key}
                      onClick={() => setRecordFilter(metric.key)}
                    />
                  ))}
                </div>

                {mode === "ANCHOR" ? (
                  <div className="space-y-4 rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">团队 → 厅进度</h3>
                        <p className="mt-1 text-sm text-slate-500">先看团队完成率，再点团队查看厅，最后点厅查看主播分页明细。</p>
                      </div>
                      {anchorOrgState.selectedTeam && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAnchorHall(null);
                            setRecordList(null);
                            setAnchorOrgState((current) => ({ ...current, selectedTeam: null, halls: [] }));
                          }}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                        >
                          返回团队列表
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">当前层级</span>
                      <span>{anchorOrgState.selectedTeam ? `厅列表 · ${anchorOrgState.selectedTeam.orgName}` : "团队列表"}</span>
                    </div>

                    <div className="space-y-3">
                      {(anchorOrgState.selectedTeam ? anchorOrgState.halls : anchorOrgState.teams).map((node) => (
                        <AnchorTreeNode
                          key={node.orgId}
                          node={node}
                          selectedHallId={selectedAnchorHall?.orgId}
                          onOpenChildren={(item) => {
                            if (!selectedAssignmentId) return;
                            if (item.orgType === "TEAM") {
                              void loadAnchorHalls(selectedAssignmentId, item);
                              setSelectedAnchorHall(null);
                              setRecordList(null);
                            }
                          }}
                          onSelectHall={(item) => {
                            setSelectedAnchorHall(item);
                            setRecordPage(1);
                            setRecordKeyword("");
                            setRecordKeywordInput("");
                          }}
                        />
                      ))}
                    </div>

                    {selectedAnchorHall && (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">{selectedAnchorHall.orgName} · 主播明细</h3>
                            <p className="mt-1 text-sm text-slate-500">当前筛选：{metrics.find((item) => item.key === recordFilter)?.label ?? "投放主体"} · 每页 {RECORD_PAGE_SIZE} 条。点击主播查看子任务详情。</p>
                          </div>
                          <div className="flex w-full flex-col gap-2 xl:w-auto xl:min-w-[420px] xl:items-end">
                            <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto xl:items-center">
                              <div className="relative w-full xl:w-[320px]">
                                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                  value={recordKeywordInput}
                                  onChange={(event) => setRecordKeywordInput(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      setRecordPage(1);
                                      setRecordKeyword(recordKeywordInput.trim());
                                    }
                                  }}
                                  placeholder="搜索昵称 / 抖音号 / 手机号"
                                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-20 text-sm outline-none transition focus:border-blue-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRecordPage(1);
                                    setRecordKeyword(recordKeywordInput.trim());
                                  }}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
                                >
                                  搜索
                                </button>
                              </div>
                              {recordKeyword && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRecordKeywordInput("");
                                    setRecordKeyword("");
                                    setRecordPage(1);
                                  }}
                                  className="w-fit rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                                >
                                  清空搜索
                                </button>
                              )}
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">{recordList?.total ?? 0} 条主播</span>
                          </div>
                        </div>

                        <div className="mt-4">
                          {loadingRecords ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-400">主播明细加载中...</div>
                          ) : !recordList || recordList.items.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-400">当前筛选下暂无主播进度数据。</div>
                          ) : (
                            <div className="grid gap-3 xl:grid-cols-2">
                              {recordList.items.map((record) => {
                                const statusMeta = getStatusMeta(record.status);
                                return (
                                  <button
                                    key={record.id}
                                    type="button"
                                    onClick={() => void openRecordDetail(record.id)}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-slate-50"
                                  >
                                    <div className="flex flex-wrap items-center gap-3 text-sm">
                                      <h4 className="min-w-0 flex-1 truncate font-semibold text-slate-900">{record.subjectName || record.subjectKey}</h4>
                                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.cls}`}>{statusMeta.label}</span>
                                      <span className="inline-flex min-w-[92px] items-center justify-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                                        {record.doneItems}/{record.totalItems}
                                      </span>
                                      <span className="text-xs text-slate-400">发布人 {record.publisherName ?? "—"}</span>
                                      {record.participantCount ? <span className="text-xs text-slate-400">协同 {record.participantCount} 人</span> : null}
                                      <span className="text-xs text-slate-400">完成时间 {record.submittedAt || record.lastSubmittedAt ? formatDateTime(record.lastSubmittedAt ?? record.submittedAt) : "—"}</span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex items-center justify-center gap-2 border-t border-slate-200 pt-3">
                          <button
                            type="button"
                            disabled={recordPage <= 1 || loadingRecords}
                            onClick={() => selectedAssignmentId && void loadRecords(selectedAssignmentId, recordFilter, recordPage - 1, recordKeyword)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            上一页
                          </button>
                          <button
                            type="button"
                            disabled={!recordList?.hasMore || loadingRecords}
                            onClick={() => selectedAssignmentId && void loadRecords(selectedAssignmentId, recordFilter, recordPage + 1, recordKeyword)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            下一页
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">主体进度明细</h3>
                        <p className="mt-1 text-sm text-slate-500">当前筛选：{metrics.find((item) => item.key === recordFilter)?.label ?? "投放主体"} · 每页 {RECORD_PAGE_SIZE} 条。点击主体查看子任务详情。</p>
                      </div>
                      <div className="flex w-full flex-col gap-2 xl:w-auto xl:min-w-[420px] xl:items-end">
                        <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto xl:items-center">
                          <div className="relative w-full xl:w-[320px]">
                            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              value={recordKeywordInput}
                              onChange={(event) => setRecordKeywordInput(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  setRecordPage(1);
                                  setRecordKeyword(recordKeywordInput.trim());
                                }
                              }}
                              placeholder="搜索昵称 / 抖音号 / 手机号"
                              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-20 text-sm outline-none transition focus:border-blue-400"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setRecordPage(1);
                                setRecordKeyword(recordKeywordInput.trim());
                              }}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
                            >
                              搜索
                            </button>
                          </div>
                          {recordKeyword && (
                            <button
                              type="button"
                              onClick={() => {
                                setRecordKeywordInput("");
                                setRecordKeyword("");
                                setRecordPage(1);
                              }}
                              className="w-fit rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                            >
                              清空搜索
                            </button>
                          )}
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{recordList?.total ?? 0} 条主体</span>
                      </div>
                    </div>

                    <div className="mt-4">
                      {loadingRecords ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">主体进度加载中...</div>
                      ) : !recordList || recordList.items.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">当前筛选下暂无主体进度数据。</div>
                      ) : (
                        <div className="grid gap-3 xl:grid-cols-2">
                          {recordList.items.map((record) => {
                            const statusMeta = getStatusMeta(record.status);
                            return (
                              <button
                                key={record.id}
                                type="button"
                                onClick={() => void openRecordDetail(record.id)}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-slate-50"
                              >
                                <div className="flex flex-wrap items-center gap-3 text-sm">
                                  <h4 className="min-w-0 flex-1 truncate font-semibold text-slate-900">{record.subjectName || record.subjectKey}</h4>
                                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.cls}`}>{statusMeta.label}</span>
                                  <span className="inline-flex min-w-[92px] items-center justify-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                                    {record.doneItems}/{record.totalItems}
                                  </span>
                                  <span className="text-xs text-slate-400">发布人 {record.publisherName ?? "—"}</span>
                                  {record.participantCount ? <span className="text-xs text-slate-400">协同 {record.participantCount} 人</span> : null}
                                  <span className="text-xs text-slate-400">完成时间 {record.submittedAt || record.lastSubmittedAt ? formatDateTime(record.lastSubmittedAt ?? record.submittedAt) : "—"}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-center gap-2 border-t border-slate-200 pt-3">
                      <button
                        type="button"
                        disabled={recordPage <= 1 || loadingRecords}
                        onClick={() => selectedAssignmentId && void loadRecords(selectedAssignmentId, recordFilter, recordPage - 1, recordKeyword)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        上一页
                      </button>
                      <button
                        type="button"
                        disabled={!recordList?.hasMore || loadingRecords}
                        onClick={() => selectedAssignmentId && void loadRecords(selectedAssignmentId, recordFilter, recordPage + 1, recordKeyword)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-3xl bg-white py-20 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">任务汇总加载失败，请稍后重试。</div>
            )}
          </section>
        </div>
      )}

      <TemporaryNotifyScheduleModal
        open={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
      />

      <ConfirmNotifyModal
        open={notifyModalOpen}
        preview={notifyPreview}
        prefix={notifyPrefix}
        loading={notifying}
        onPrefixChange={setNotifyPrefix}
        onClose={() => {
          if (notifying) return;
          setNotifyModalOpen(false);
        }}
        onConfirm={() => void confirmSendTemporaryNotify()}
      />

      {detailOpen && (
        <RecordDetailModal
          detail={recordDetail}
          loading={detailLoading}
          onClose={() => {
            setDetailOpen(false);
            setRecordDetail(null);
          }}
        />
      )}
    </div>
  );
}
