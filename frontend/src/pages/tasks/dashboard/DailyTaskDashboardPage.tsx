import { useEffect, useMemo, useState } from "react";
import { Bell, ChevronDown, ChevronRight, Clock3, Loader2, RefreshCw, X } from "lucide-react";

import type { DailyDashboardAnchorItemDetailResponse, DailyDashboardHallDetailsResponse, DailyDashboardOrgNode, DailyDashboardResponse, DailyDashboardTeamChildrenResponse, Identity, OrgUnit } from "../../../types";
import { notifyApi, recordApi, reportApi } from "../../../services/task";
import { fetchOrgTree } from "../../../services/organization";
import { useIdentityStore } from "../../../stores/identityStore";
import { DailyNotifyScheduleModal } from "../components/DailyNotifyScheduleModal";

function isOrgWithinScope(org: OrgUnit, scopePath?: string) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`);
}

function getAvailableBaseOrgs(orgs: OrgUnit[], identity?: Identity) {
  if (!identity || !["DEV_ADMIN", "HQ_ADMIN"].includes(identity.roleCode)) return [];
  return orgs
    .filter((org) => org.status === "active" && org.orgType === "BASE" && isOrgWithinScope(org, identity.scopePath))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function getPhaseMeta(phase: DailyDashboardResponse["phase"]) {
  if (phase === "in_progress") return { label: "今日执行中", cls: "border-blue-100 bg-blue-50 text-blue-700" };
  if (phase === "supplement") return { label: "补录期", cls: "border-amber-100 bg-amber-50 text-amber-700" };
  return { label: "统计已冻结", cls: "border-emerald-100 bg-emerald-50 text-emerald-700" };
}

function getCompletionTone(rate: number) {
  if (rate >= 95) return "text-emerald-600";
  if (rate >= 80) return "text-amber-600";
  return "text-red-600";
}

function resolveAttachmentUrl(fileUrl?: string | null) {
  if (!fileUrl) return "#";
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  if (fileUrl.startsWith("/api/uploads/")) return fileUrl;
  if (fileUrl.startsWith("/uploads/")) return `/api${fileUrl}`;
  return fileUrl.startsWith("/") ? `/api${fileUrl}` : `/api/${fileUrl}`;
}

const DEFAULT_DAILY_NOTIFY_OPTIONS = [
  { intervalHours: 12, label: "每天2次", description: "00:00、12:00" },
  { intervalHours: 6, label: "每天4次", description: "00:00、06:00、12:00、18:00" },
  { intervalHours: 3, label: "每天8次", description: "每3小时整点发送一次" },
  { intervalHours: 2, label: "每天12次", description: "每2小时整点发送一次" },
  { intervalHours: 1, label: "每天24次", description: "每小时整点发送一次" },
];

function NodeSummary({ node, children = [], level = 0, taskDate, scopeOrgId, defaultOpen = false, lazyLoadTeamChildren = false }: { node: DailyDashboardOrgNode; children?: DailyDashboardOrgNode[]; level?: number; taskDate?: string; scopeOrgId?: string; defaultOpen?: boolean; lazyLoadTeamChildren?: boolean }) {

  const [open, setOpen] = useState(defaultOpen);
  const [teamChildren, setTeamChildren] = useState<DailyDashboardOrgNode[] | null>(lazyLoadTeamChildren ? null : children);
  const [teamChildrenLoading, setTeamChildrenLoading] = useState(false);

  const levelTone = node.orgType === "TEAM"
    ? {
        card: "border-blue-100 bg-blue-50/50",
        icon: "border-blue-200 text-blue-500 hover:bg-blue-50",
        badge: "bg-blue-100 text-blue-600",
        accent: "bg-blue-200",
      }
    : node.orgType === "HALL"
      ? {
          card: "border-violet-100 bg-violet-50/50",
          icon: "border-violet-200 text-violet-500 hover:bg-violet-50",
          badge: "bg-violet-100 text-violet-600",
          accent: "bg-violet-200",
        }
      : {
          card: "border-slate-200 bg-slate-50/60",
          icon: "border-slate-200 text-slate-500 hover:bg-slate-50",
          badge: "bg-slate-100 text-slate-600",
          accent: "bg-slate-200",
        };
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [details, setDetails] = useState<DailyDashboardHallDetailsResponse | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<DailyDashboardAnchorItemDetailResponse | null>(null);
  const [anchorLoading, setAnchorLoading] = useState(false);
  const [anchorModalOpen, setAnchorModalOpen] = useState(false);
  const [exemptionReasonInput, setExemptionReasonInput] = useState("");
  const [exemptionSaving, setExemptionSaving] = useState(false);
  const visibleChildren = teamChildren ?? children;
  const hasChildren = node.orgType === "TEAM" ? true : visibleChildren.length > 0;
  const isHall = node.orgType === "HALL";

  async function toggleNodeOpen() {
    if (!hasChildren) return;
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || node.orgType !== "TEAM" || !lazyLoadTeamChildren || teamChildren !== null || !taskDate) return;
    setTeamChildrenLoading(true);
    const payload = await reportApi.getDailyDashboardTeamChildren(node.orgId, taskDate, scopeOrgId).catch(() => null);
    setTeamChildren(payload?.halls ?? []);
    setTeamChildrenLoading(false);
  }

  async function toggleHallDetails() {
    if (!isHall) return;
    const nextOpen = !detailOpen;
    setDetailOpen(nextOpen);
    if (!nextOpen) {
      setSelectedAnchor(null);
      return;
    }
    if (details || !taskDate) return;
    setDetailLoading(true);
    const payload = await reportApi.getDailyDashboardHallDetails(node.orgId, taskDate, scopeOrgId).catch(() => null);
    setDetails(payload);
    setDetailLoading(false);
  }

  async function openAnchorDetail(userId: string) {
    if (!taskDate) return;
    setAnchorModalOpen(true);
    setAnchorLoading(true);
    const payload = await reportApi.getDailyDashboardAnchorItems(node.orgId, userId, taskDate, scopeOrgId).catch(() => null);
    setSelectedAnchor(payload);
    setExemptionReasonInput(payload?.anchor.exemptionReason ?? "");
    setAnchorLoading(false);
  }

  async function submitExemption() {
    if (!selectedAnchor?.anchor.taskRecordId || !exemptionReasonInput.trim()) return;
    setExemptionSaving(true);
    await recordApi.applyExemption({ taskRecordId: selectedAnchor.anchor.taskRecordId, reason: exemptionReasonInput.trim() }).catch(() => null);
    const refreshed = await reportApi.getDailyDashboardAnchorItems(node.orgId, selectedAnchor.anchor.userId, taskDate, scopeOrgId).catch(() => null);
    if (refreshed) setSelectedAnchor(refreshed);
    setExemptionSaving(false);
  }

  async function reviewExemption(approved: boolean) {
    if (!selectedAnchor?.anchor.taskRecordId || !selectedAnchor.anchor.exemptionStatus) return;
    const hallDetails = details;
    const matched = hallDetails?.details.find((item) => item.userId === selectedAnchor.anchor.userId);
    if (!matched?.taskRecordId) return;
    setExemptionSaving(true);
    const exemptions = await recordApi.listExemptions("pending").catch(() => []);
    const target = exemptions.find((item) => item.taskRecordId === matched.taskRecordId);
    if (target) {
      await recordApi.reviewExemption(target.id, approved).catch(() => null);
    }
    const refreshed = await reportApi.getDailyDashboardAnchorItems(node.orgId, selectedAnchor.anchor.userId, taskDate, scopeOrgId).catch(() => null);
    const refreshedHall = await reportApi.getDailyDashboardHallDetails(node.orgId, taskDate, scopeOrgId).catch(() => null);
    if (refreshed) setSelectedAnchor(refreshed);
    if (refreshedHall) setDetails(refreshedHall);
    setExemptionSaving(false);
  }

  return (
    <div className="space-y-3">
      <div className={`rounded-2xl border px-4 py-4 shadow-sm ${levelTone.card}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`h-12 w-1 rounded-full ${levelTone.accent}`} />
            <button
              type="button"
              onClick={() => void toggleNodeOpen()}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border ${hasChildren ? levelTone.icon : "border-slate-200 text-slate-300"}`}
            >
              {hasChildren ? (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="text-xs">·</span>}
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">{node.orgName}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs ${levelTone.badge}`}>{node.orgType === "TEAM" ? "团队" : node.orgType === "HALL" ? "厅" : "基地"}</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">投放共 {node.total} 人 · 完成 {node.completed} 人 · 进行中 {node.inProgress} 人 · 完成率 <span className={`font-semibold ${getCompletionTone(node.completionRate)}`}>{node.completionRate}%</span></p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap xl:justify-end">
            {isHall && (
              <button
                type="button"
                onClick={() => void toggleHallDetails()}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
              >
                {detailOpen ? "收起主播" : "查看主播"}
              </button>
            )}
            <div className="grid grid-cols-5 gap-2 xl:min-w-[360px]">
              {[
                { label: "投放", value: node.total, tone: "text-slate-900" },
                { label: "完成", value: node.completed, tone: "text-emerald-600" },
                { label: "进行中", value: node.inProgress, tone: "text-blue-600" },
                { label: "未开始", value: node.pending, tone: "text-slate-500" },
                { label: "豁免", value: node.exemptions ?? 0, tone: "text-amber-600" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-2 text-center">
                  <p className="text-[11px] text-slate-500">{item.label}</p>
                  <p className={`mt-1 text-lg font-bold ${item.tone}`}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {hasChildren && open && (
        <div className="space-y-3 pl-6">
          {teamChildrenLoading ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">厅级汇总加载中...</div>
          ) : visibleChildren.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">暂无厅级汇总数据。</div>
          ) : (
            visibleChildren.map((child) => <NodeSummary key={child.orgId} node={child} level={level + 1} taskDate={taskDate} scopeOrgId={scopeOrgId} defaultOpen={false} lazyLoadTeamChildren={false} />)
          )}
        </div>
      )}

      {isHall && detailOpen && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          {detailLoading ? (
            <div className="text-sm text-slate-400">主播明细加载中...</div>
          ) : !details ? (
            <div className="text-sm text-slate-400">暂无主播明细</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {details.details.map((item) => (
                <button
                  key={`${item.userId}-${item.subjectKey}`}
                  type="button"
                  onClick={() => void openAnchorDetail(item.userId)}
                  className="rounded-2xl bg-white px-4 py-3 text-left text-sm transition hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{item.subjectName}</p>
                      <p className="mt-1 text-xs text-slate-400">必做项 {item.doneItems}/{item.totalItems} · 完成率 {item.completionRate}%</p>
                      {item.exemptionStatus && <p className="mt-1 text-xs text-amber-600">豁免：{item.exemptionStatus === "pending" ? "待审核" : item.exemptionStatus === "approved" ? "已通过" : "已驳回"}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-medium ${item.status === "completed" || item.status === "supplemented" ? "text-emerald-600" : item.status === "in_progress" ? "text-blue-600" : "text-slate-500"}`}>
                        {item.status === "completed" ? "已完成" : item.status === "supplemented" ? "补录完成" : item.status === "in_progress" ? "进行中" : "未开始"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
                      {item.lastSubmittedAt ? `最近完成 ${item.lastSubmittedAt.slice(5, 16).replace("T", " ")}` : "查看子任务详情"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {anchorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">主播子任务详情</h3>
                <p className="mt-1 text-xs text-slate-400">查看每个子任务的完成情况与回传内容</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAnchorModalOpen(false);
                  setSelectedAnchor(null);
                }}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[calc(85vh-72px)] overflow-y-auto px-6 py-5">
              {anchorLoading ? (
                <div className="text-sm text-slate-400">主播任务项加载中...</div>
              ) : selectedAnchor ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-4">
                    <div>
                      <h4 className="text-base font-semibold text-slate-900">{selectedAnchor.anchor.subjectName}</h4>
                      <p className="mt-1 text-xs text-slate-400">必做项 {selectedAnchor.anchor.requiredDoneItems}/{selectedAnchor.anchor.requiredTotalItems}</p>
                      {selectedAnchor.anchor.exemptionStatus && <p className="mt-1 text-xs text-amber-600">豁免状态：{selectedAnchor.anchor.exemptionStatus === "pending" ? "待审核" : selectedAnchor.anchor.exemptionStatus === "approved" ? "已通过" : "已驳回"}</p>}
                    </div>
                    <div className="text-right text-sm text-slate-500">
                      <p>{selectedAnchor.anchor.status === "completed" ? "已完成" : selectedAnchor.anchor.status === "supplemented" ? "补录完成" : selectedAnchor.anchor.status === "in_progress" ? "进行中" : "未开始"}</p>
                      <p className="mt-1 text-xs text-slate-400">{selectedAnchor.anchor.completedAt ? `最后完成 ${selectedAnchor.anchor.completedAt.slice(0, 16).replace("T", " ")}` : "暂无完成时间"}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {selectedAnchor.items.map((taskItem) => (
                      <div key={taskItem.taskItemId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-slate-900">{taskItem.title}</p>
                            <p className="mt-1 text-xs text-slate-400">{taskItem.isRequired ? "必做项" : "选做项"} · {taskItem.itemType}</p>
                          </div>
                          <div className={`text-sm font-medium ${taskItem.done ? "text-emerald-600" : "text-slate-500"}`}>{taskItem.done ? "已完成" : "未完成"}</div>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-slate-500">
                          {taskItem.doneAt && <p>完成时间：{taskItem.doneAt.slice(0, 16).replace("T", " ")}</p>}
                          {taskItem.answerText && <p>回传文本：{taskItem.answerText}</p>}
                          {taskItem.answerOptions?.length ? <p>回传选项：{taskItem.answerOptions.join("、")}</p> : null}
                          {taskItem.itemType === "LINK" ? <p>链接确认：{taskItem.isLinkConfirmed ? "已确认" : "未确认"}</p> : null}
                          {taskItem.attachments.length ? (
                            <div>
                              <p>附件：</p>
                              <div className="mt-1 flex flex-wrap gap-2">
                                {taskItem.attachments.map((attachment) => (
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
                          {!taskItem.done && !taskItem.answerText && !taskItem.answerOptions?.length && !taskItem.attachments.length && <p>暂无回传数据</p>}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4">
                    <h5 className="text-sm font-semibold text-amber-900">豁免记录</h5>
                    {selectedAnchor.anchor.exemptionStatus ? (
                      <div className="mt-2 space-y-1 text-xs text-amber-800">
                        <p>状态：{selectedAnchor.anchor.exemptionStatus === "pending" ? "待审核" : selectedAnchor.anchor.exemptionStatus === "approved" ? "已通过" : "已驳回"}</p>
                        {selectedAnchor.anchor.exemptionReason && <p>原因：{selectedAnchor.anchor.exemptionReason}</p>}
                        {selectedAnchor.anchor.exemptionReviewerName && <p>审核人：{selectedAnchor.anchor.exemptionReviewerName}</p>}
                        {selectedAnchor.anchor.exemptionReviewedAt && <p>审核时间：{selectedAnchor.anchor.exemptionReviewedAt.slice(0, 16).replace("T", " ")}</p>}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedAnchor.anchor.exemptionStatus === "pending" && (
                            <>
                              <button type="button" onClick={() => void reviewExemption(true)} disabled={exemptionSaving} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">同意豁免</button>
                              <button type="button" onClick={() => void reviewExemption(false)} disabled={exemptionSaving} className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">驳回豁免</button>
                            </>
                          )}
                          {(selectedAnchor.anchor.exemptionStatus === "pending" || selectedAnchor.anchor.exemptionStatus === "approved") && (
                            <button type="button" onClick={async () => {
                              if (!selectedAnchor.anchor.taskRecordId) return;
                              setExemptionSaving(true);
                              await recordApi.cancelExemption(selectedAnchor.anchor.taskRecordId).catch(() => null);
                              const refreshed = await reportApi.getDailyDashboardAnchorItems(node.orgId, selectedAnchor.anchor.userId, taskDate, scopeOrgId).catch(() => null);
                              const refreshedHall = await reportApi.getDailyDashboardHallDetails(node.orgId, taskDate, scopeOrgId).catch(() => null);
                              if (refreshed) {
                                setSelectedAnchor(refreshed);
                                setExemptionReasonInput(refreshed.anchor.exemptionReason ?? "");
                              }
                              if (refreshedHall) setDetails(refreshedHall);
                              setExemptionSaving(false);
                            }} disabled={exemptionSaving} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-700 disabled:opacity-50">{selectedAnchor.anchor.exemptionStatus === "pending" ? "回撤申请" : "取消豁免"}</button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 space-y-3">
                        <textarea
                          value={exemptionReasonInput}
                          onChange={(event) => setExemptionReasonInput(event.target.value)}
                          placeholder="填写豁免原因"
                          className="min-h-24 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                        />
                        <button type="button" onClick={() => void submitExemption()} disabled={exemptionSaving || !selectedAnchor.anchor.taskRecordId} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">提交豁免申请</button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-400">暂无主播任务项数据</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DailyTaskDashboardPage() {
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [taskDate, setTaskDate] = useState("");
  const [selectedBaseOrgId, setSelectedBaseOrgId] = useState("");
  const [data, setData] = useState<DailyDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notifyPrefix, setNotifyPrefix] = useState("");

  const [notifyLoading, setNotifyLoading] = useState(false);
  const [notifyPreview, setNotifyPreview] = useState<null | { total: number; pendingCount: number; inProgressCount: number; unboundCount: number; prefixPlaceholder: string }>(null);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  const availableBaseOrgs = useMemo(() => getAvailableBaseOrgs(orgs, currentIdentity), [orgs, currentIdentity]);
  const baseSelectionRequired = ["DEV_ADMIN", "HQ_ADMIN", "TEAM_ADMIN"].includes(currentIdentity?.roleCode ?? "");
  const effectiveBaseOrgId = selectedBaseOrgId || data?.baseOrg?.id;
  const effectiveBaseOrgName = data?.baseOrg?.name || availableBaseOrgs.find((org) => org.id === selectedBaseOrgId)?.name;


  async function load(forceDate?: string, forceBaseOrgId?: string) {
    setLoading(true);
    setError("");
    setNotice("");

    const requestBaseOrgId = forceBaseOrgId ?? selectedBaseOrgId;
    const [orgTree, dashboard] = await Promise.all([
      fetchOrgTree().catch(() => [] as OrgUnit[]),
      reportApi.getDailyDashboard((forceDate ?? taskDate) || undefined, requestBaseOrgId || undefined).catch((err) => {
        setError(err instanceof Error ? err.message : "主播日常任务看板加载失败");
        return null;
      }),
    ]);
    setOrgs(orgTree);
    setData(dashboard);
    if (!taskDate && dashboard?.taskDate) setTaskDate(dashboard.taskDate);
    if (dashboard?.baseOrg?.id && dashboard.baseOrg.id !== selectedBaseOrgId) {
      setSelectedBaseOrgId(dashboard.baseOrg.id);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!availableBaseOrgs.length || selectedBaseOrgId || !baseSelectionRequired) return;
    if (availableBaseOrgs.length === 1) setSelectedBaseOrgId(availableBaseOrgs[0].id);
  }, [availableBaseOrgs, baseSelectionRequired, selectedBaseOrgId]);

  const phaseMeta = data ? getPhaseMeta(data.phase) : null;
  const treeRoots = useMemo(() => {
    if (!data) return [] as DailyDashboardOrgNode[];
    if (data.viewer.roleCode === "HALL_MANAGER") return data.tree.halls;
    return data.tree.teams;
  }, [data]);

  function shouldDefaultOpenNode(node: DailyDashboardOrgNode) {
    if (!data) return false;
    if (data.viewer.roleCode === "HALL_MANAGER") return true;
    if (data.viewer.roleCode === "TEAM_ADMIN") return true;
    return false;
  }

  async function handleNotifyToday() {
    const effectiveDate = taskDate || data?.taskDate;
    if (!effectiveDate) {
      setError("请先选择通知日期");
      return;
    }
    setNotifyLoading(true);
    try {
      const preview = await notifyApi.getDailyFeishuPreview(effectiveDate, effectiveBaseOrgId || undefined);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "飞书通知预览失败");
    } finally {
      setNotifyLoading(false);
    }
  }

  async function confirmNotifyToday() {
    const effectiveDate = taskDate || data?.taskDate;
    if (!effectiveDate) {
      setError("请先选择通知日期");
      return;
    }
    setNotifyLoading(true);
    try {
      const prefix = notifyPrefix.trim() || notifyPreview?.prefixPlaceholder || "来自系统提醒";
      const result = await notifyApi.sendDailyFeishu({ taskDate: effectiveDate, scopeOrgId: effectiveBaseOrgId || undefined, prefix });

      setNotifyPrefix(prefix);
      const successCount = result.results.reduce((sum, item) => sum + item.successCount, 0);
      setNotifyDialogOpen(false);
      setNotifyPreview(null);
      setNotice(`飞书通知已执行。成功 ${successCount} 人，未绑定 ${result.summary.unboundCount} 人。`);

    } catch (err) {
      setError(err instanceof Error ? err.message : "飞书通知发送失败");
    } finally {
      setNotifyLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <DailyNotifyScheduleModal
        open={scheduleDialogOpen}
        scopeOrgId={effectiveBaseOrgId}
        scopeOrgName={effectiveBaseOrgName}
        taskDate={taskDate || data?.taskDate}
        onClose={() => setScheduleDialogOpen(false)}
        onSuccessMessage={setNotice}
      />

      {notice && <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <section className="rounded-3xl bg-white px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">

        <div className="flex flex-wrap items-center justify-between gap-4 xl:flex-nowrap">
          <div className="shrink-0">
            <h1 className="text-[28px] font-bold tracking-[-0.02em] text-slate-900">主播日常任务看板</h1>
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <input
              type="date"
              value={taskDate}
              onChange={(event) => setTaskDate(event.target.value)}
              className="h-11 min-w-[210px] rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-blue-400"
            />
            <select
              value={selectedBaseOrgId}
              onChange={(event) => setSelectedBaseOrgId(event.target.value)}
              disabled={!baseSelectionRequired}
              className="h-11 min-w-[240px] rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">{baseSelectionRequired ? "请选择基地" : data?.baseOrg?.name || "自动锁定基地"}</option>
              {availableBaseOrgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void load(taskDate || undefined, selectedBaseOrgId || undefined)}
              disabled={baseSelectionRequired && !selectedBaseOrgId}
              className="h-11 rounded-2xl bg-blue-500 px-5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              查询看板
            </button>
            <button
              type="button"
              onClick={() => {
                const today = data?.quickRanges.today ?? taskDate;
                if (!today) return;
                setTaskDate(today);
                void load(today, selectedBaseOrgId || undefined);
              }}
              disabled={!data?.quickRanges.today && !taskDate}
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
            >
              今天
            </button>
            <button
              type="button"
              onClick={() => {
                const yesterday = data?.quickRanges.yesterday;
                if (!yesterday) return;
                setTaskDate(yesterday);
                void load(yesterday, selectedBaseOrgId || undefined);
              }}
              disabled={!data?.quickRanges.yesterday}
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
            >
              昨天
            </button>
            <button
              type="button"
              onClick={() => void handleNotifyToday()}
              disabled={notifyLoading || (baseSelectionRequired && !selectedBaseOrgId)}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {notifyLoading ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />发送中...</span> : <span className="inline-flex items-center gap-2"><Bell size={15} />通知今日待办</span>}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RefreshCw size={15} />刷新数据
            </button>
          </div>
        </div>
      </section>

      {notifyDialogOpen && notifyPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">确认发送主播日常任务通知</h3>
                <p className="mt-1 text-xs text-slate-400">发送前再确认本次待通知人数与文案前缀</p>
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
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="mb-2 block text-xs text-slate-500">通知前缀</label>
                <input
                  type="text"
                  value={notifyPrefix}
                  onChange={(event) => setNotifyPrefix(event.target.value)}
                  placeholder={notifyPreview.prefixPlaceholder}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-blue-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">待通知总人数</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{notifyPreview.total}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">未绑定飞书</p>
                  <p className="mt-1 text-2xl font-bold text-amber-600">{notifyPreview.unboundCount}</p>
                </div>
                <div className="rounded-2xl bg-blue-50 px-4 py-3">
                  <p className="text-xs text-blue-500">未开始</p>
                  <p className="mt-1 text-2xl font-bold text-blue-700">{notifyPreview.pendingCount}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                  <p className="text-xs text-emerald-500">进行中</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-700">{notifyPreview.inProgressCount}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                未绑定飞书的人员不会收到本次通知，请确认后继续发送。
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
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
                onClick={() => void confirmNotifyToday()}
                disabled={notifyLoading}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {notifyLoading ? <><Loader2 size={15} className="animate-spin" />发送中...</> : <><Bell size={15} />确认发送</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />主播日常任务看板加载中...</span>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : data ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "投放总人数", value: data.summary.total, tone: "text-slate-900" },
              { label: "完成人数", value: data.summary.completed, tone: "text-emerald-600" },
              { label: "进行中", value: data.summary.inProgress, tone: "text-blue-600" },
              { label: "未开始", value: data.summary.pending, tone: "text-slate-500" },
              { label: "豁免记录", value: data.summary.exemptions, tone: "text-amber-600" },
              { label: "完成率", value: `${data.summary.completionRate}%`, tone: getCompletionTone(data.summary.completionRate) },
            ].map((item) => (
              <div key={item.label} className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <p className="text-sm text-slate-500">{item.label}</p>
                <p className={`mt-3 text-3xl font-bold ${item.tone}`}>{item.value}</p>
              </div>
            ))}
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">组织树进度</h2>
            </div>
            <div className="mt-5 space-y-4">
              {treeRoots.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-400">当前基地下暂无可展示的组织进度数据。</div>
              ) : (
                treeRoots.map((node) => {
                  const children = data.viewer.roleCode === "HALL_MANAGER"
                    ? []
                    : (node as DailyDashboardOrgNode & { halls?: DailyDashboardOrgNode[] }).halls ?? node.children ?? [];
                  return <NodeSummary key={node.orgId} node={node} children={children} taskDate={data.taskDate} scopeOrgId={selectedBaseOrgId || undefined} defaultOpen={shouldDefaultOpenNode(node)} lazyLoadTeamChildren={data.viewer.roleCode !== "TEAM_ADMIN" && data.viewer.roleCode !== "HALL_MANAGER"} />;
                })
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
