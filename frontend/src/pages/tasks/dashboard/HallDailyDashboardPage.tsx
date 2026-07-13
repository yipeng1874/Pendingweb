import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Clock3, Loader2, RefreshCw } from "lucide-react";

import type {
  HallDailyDashboardResponse,
  HallDailyAdminOverviewResponse,
  HallDailyAdminTeamSummary,
  HallDailyAdminHallRow,
  HallDailyAdminHallDetailResponse,
  HallDailyAdminBaseSummary,
  OrgUnit,
  Identity,
} from "../../../types";
import { hallDailyApi, reportApi } from "../../../services/task";
import { fetchOrgTree } from "../../../services/organization";
import { useIdentityStore } from "../../../stores/identityStore";

// ── 共用工具 ─────────────────────────────────────────────────────────────────

function getPhaseMeta(phase: string) {
  if (phase === "in_progress") return { label: "今日执行中", cls: "border-blue-100 bg-blue-50 text-blue-700" };
  if (phase === "supplement") return { label: "补录期", cls: "border-amber-100 bg-amber-50 text-amber-700" };
  return { label: "统计已冻结", cls: "border-emerald-100 bg-emerald-50 text-emerald-700" };
}

function getStatusMeta(status: string | null) {
  if (status === "submitted") return { label: "已提交", cls: "text-emerald-600", badgeCls: "border-emerald-100 bg-emerald-50 text-emerald-700" };
  if (status === "leave_approved") return { label: "已请假", cls: "text-violet-600", badgeCls: "border-violet-100 bg-violet-50 text-violet-700" };
  if (status === "leave_pending") return { label: "请假待审", cls: "text-amber-600", badgeCls: "border-amber-100 bg-amber-50 text-amber-700" };
  if (status === "in_progress") return { label: "进行中", cls: "text-blue-600", badgeCls: "border-blue-100 bg-blue-50 text-blue-700" };
  if (status === "overdue") return { label: "已逾期", cls: "text-red-600", badgeCls: "border-red-100 bg-red-50 text-red-700" };
  if (status === "pending") return { label: "未开始", cls: "text-slate-500", badgeCls: "border-slate-200 bg-slate-50 text-slate-500" };
  return { label: "暂无数据", cls: "text-slate-400", badgeCls: "border-slate-200 bg-slate-50 text-slate-400" };
}

function getItemTypeName(itemType: string) {
  const map: Record<string, string> = {
    QA: "问答",
    SINGLE_CHOICE: "单选",
    MULTI_CHOICE: "多选",
    FILL_BLANK: "填空",
    LINK: "学习链接",
    ATTACHMENT: "附件",
  };
  return map[itemType] ?? itemType;
}

function isOrgWithinScope(org: OrgUnit, scopePath?: string) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`);
}

function getAvailableBaseOrgs(orgs: OrgUnit[], identity?: Identity) {
  if (!identity || !["DEV_ADMIN", "HQ_ADMIN"].includes(identity.roleCode)) return [];
  return orgs
    .filter((org) => org.status === "active" && org.orgType === "BASE" && isOrgWithinScope(org, identity.scopePath))
    .sort((a, b) => a.path.localeCompare(b.path));
}

// ── 厅管视图：任务项卡片 ────────────────────────────────────────────────────

type HallItem = NonNullable<HallDailyDashboardResponse["record"]>["items"][number];

function TaskItemCard({ item }: { item: HallItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-2xl border ${item.done ? "border-emerald-100 bg-emerald-50/60" : "border-slate-200 bg-white"} px-4 py-3`}>
      <div className="flex cursor-pointer items-center justify-between gap-3" onClick={() => setOpen((p) => !p)}>
        <div className="flex items-center gap-3">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${item.done ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
            {item.done ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">{item.title}</p>
            <p className="mt-0.5 text-xs text-slate-400">{getItemTypeName(item.itemType)} · {item.isRequired ? "必填" : "选填"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${item.done ? "text-emerald-600" : "text-slate-500"}`}>
            {item.done ? "已完成" : "未完成"}
          </span>
          {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {item.doneAt && <p>完成时间：{item.doneAt.slice(0, 16).replace("T", " ")}</p>}
          {item.answerText && <p>填写内容：{item.answerText}</p>}
          {item.answerOptions?.length ? <p>选项答案：{item.answerOptions.join("、")}</p> : null}
          {item.itemType === "LINK" && (
            <div className="flex items-center gap-2">
              <span>链接确认：{item.isLinkConfirmed ? "已确认" : "未确认"}</span>
              {item.linkUrl && (
                <a href={item.linkUrl} target="_blank" rel="noreferrer"
                  className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-700 transition hover:bg-blue-100">
                  打开链接
                </a>
              )}
            </div>
          )}
          {!item.done && !item.answerText && !item.answerOptions?.length && <p>暂无回传内容</p>}
        </div>
      )}
    </div>
  );
}

// ── 厅管视图（保持原有逻辑）─────────────────────────────────────────────────

function HallManagerView() {
  const [taskDate, setTaskDate] = useState("");
  const [data, setData] = useState<HallDailyDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(forceDate?: string) {
    setLoading(true);
    setError("");
    const result = await reportApi.getHallDailyDashboard((forceDate ?? taskDate) || undefined).catch((err: Error) => {
      setError(err.message || "厅管日常任务看板加载失败");
      return null;
    });
    setData(result);
    if (!taskDate && result?.taskDate) setTaskDate(result.taskDate);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const phaseMeta = data ? getPhaseMeta(data.phase) : null;
  const statusMeta = data ? getStatusMeta(data.summary.status) : null;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-4 xl:flex-nowrap">
          <div className="shrink-0">
            <h1 className="text-[28px] font-bold tracking-[-0.02em] text-slate-900">厅管日常任务看板</h1>
            {data?.hall && (
              <p className="mt-1 text-sm text-slate-500">当前厅：<span className="font-medium text-slate-700">{data.hall.name}</span></p>
            )}
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <input type="date" value={taskDate}
              onChange={(e) => { const d = e.target.value; setTaskDate(d); if (d) void load(d); }}
              className="h-11 min-w-[200px] rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-blue-400"
            />
            <button type="button" onClick={() => { const t = data?.quickRanges.today ?? taskDate; if (!t) return; setTaskDate(t); void load(t); }}
              disabled={!data?.quickRanges.today && !taskDate}
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500 transition hover:bg-slate-100 disabled:opacity-50">
              今天
            </button>
            {data?.quickRanges.canSupplementYesterday && (
              <button type="button" onClick={() => { const y = data.quickRanges.yesterday; if (!y) return; setTaskDate(y); void load(y); }}
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500 transition hover:bg-slate-100">
                昨天（补录）
              </button>
            )}
            <button type="button" onClick={() => void load()}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
              <RefreshCw size={15} />刷新
            </button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />加载中...</span>
        </div>
      ) : data ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <p className="text-sm text-slate-500">当前状态</p>
              <p className={`mt-3 text-2xl font-bold ${statusMeta?.cls ?? "text-slate-400"}`}>{statusMeta?.label}</p>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <p className="text-sm text-slate-500">已完成题目</p>
              <p className="mt-3 text-2xl font-bold text-emerald-600">
                {data.summary.doneItems}<span className="text-base font-normal text-slate-400"> / {data.summary.totalItems}</span>
              </p>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <p className="text-sm text-slate-500">完成率</p>
              <p className={`mt-3 text-2xl font-bold ${data.summary.completionRate >= 100 ? "text-emerald-600" : data.summary.completionRate >= 60 ? "text-amber-600" : "text-red-600"}`}>
                {data.summary.completionRate}%
              </p>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <p className="text-sm text-slate-500">数据阶段</p>
              <span className={`mt-3 inline-block rounded-full border px-3 py-1 text-sm font-medium ${phaseMeta?.cls}`}>{phaseMeta?.label}</span>
            </div>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">今日任务题目</h2>
              {data.record?.templateTitle && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{data.record.templateTitle}</span>
              )}
            </div>
            {!data.record ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-400">
                {data.taskDate} 暂无厅管日常任务记录。请确认当日是否有生效中的任务被分配至本厅。
              </div>
            ) : data.record.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-400">模板暂无题目。</div>
            ) : (
              <div className="space-y-3">
                {data.record.items.map((item) => <TaskItemCard key={item.taskItemId} item={item} />)}
              </div>
            )}
            {data.record?.submittedAt && (
              <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                本日任务已于 {data.record.submittedAt.slice(0, 16).replace("T", " ")} 提交完成。
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

// ── 管理员视图：厅详情展开面板 ───────────────────────────────────────────────

function HallDetailPanel({ hallOrgId, taskDate }: { hallOrgId: string; taskDate: string }) {
  const [data, setData] = useState<HallDailyAdminHallDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);

  async function loadDetail() {
    setLoading(true);
    setError("");
    reportApi.getHallDailyAdminHallDetail(hallOrgId, { taskDate })
      .then((r) => { setData(r); })
      .catch((err: Error) => { setError(err.message || "加载失败"); })
      .finally(() => { setLoading(false); });
  }

  useEffect(() => {
    void loadDetail();
  }, [hallOrgId, taskDate]);

  async function handleApproveLeave(leaveRequestId: string) {
    setReviewLoading(true);
    try {
      await hallDailyApi.approveLeave(leaveRequestId, "同意请假");
      setLeaveModalOpen(false);
      await loadDetail();
    } catch (error) {
      alert(error instanceof Error ? error.message : "同意请假失败");
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleRejectLeave(leaveRequestId: string) {
    const comment = rejectComment.trim();
    if (!comment) {
      alert("请填写拒绝原因");
      return;
    }
    setReviewLoading(true);
    try {
      await hallDailyApi.rejectLeave(leaveRequestId, comment);
      setRejectComment("");
      setLeaveModalOpen(false);
      await loadDetail();
    } catch (error) {
      alert(error instanceof Error ? error.message : "拒绝请假失败");
    } finally {
      setReviewLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 pl-4 text-sm text-slate-400">
        <Loader2 size={14} className="animate-spin" />加载厅详情...
      </div>
    );
  }
  if (error) {
    return <div className="py-4 pl-4 text-sm text-red-500">{error}</div>;
  }
  if (!data?.record) {
    return <div className="py-4 pl-4 text-sm text-slate-400">{taskDate} 该厅暂无任务记录。</div>;
  }

  return (
    <div className="mt-2 space-y-1.5 border-l-2 border-teal-200 pl-4">
      {data.record.templateTitle && (
        <p className="mb-2 text-xs font-medium text-slate-400">模板：{data.record.templateTitle}</p>
      )}
      {data.record.leaveRequest && data.record.leaveRequest.status !== "cancelled" && (
        <div className={`mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm ${data.record.leaveRequest.status === "approved" ? "border-violet-100 bg-violet-50 text-violet-700" : data.record.leaveRequest.status === "pending" ? "border-amber-100 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-500"}`}>
          <div>
            <p className="font-semibold">{data.record.leaveRequest.status === "approved" ? "已请假" : data.record.leaveRequest.status === "pending" ? "请假待审批" : "请假未通过"}</p>
            <p className="mt-1 text-xs opacity-80">点击查看申请人详情和审批信息</p>
          </div>
          <button
            type="button"
            onClick={() => setLeaveModalOpen(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${data.record.leaveRequest.status === "pending" ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            请假审批
          </button>
        </div>
      )}
      {data.record.items.length === 0 ? (
        <p className="text-sm text-slate-400">模板暂无题目。</p>
      ) : (
        data.record.items.map((item) => (
          <div
            key={item.taskItemId}
            className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${
              item.done
                ? "border-emerald-200 bg-emerald-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"}`}>
                {item.done ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
              </div>
              <span className={`flex-1 font-medium ${item.done ? "text-slate-700" : "text-slate-800"}`}>{item.title}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">{getItemTypeName(item.itemType)}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${item.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {item.done ? "✓ 已完成" : "未完成"}
              </span>
            </div>
            {item.done && (
              <div className="mt-2 space-y-1 pl-8 text-xs text-slate-500">
                {item.doneAt && <p>完成时间：{item.doneAt.slice(0, 16).replace("T", " ")}</p>}
                {item.answerText && <p>填写内容：{item.answerText}</p>}
                {item.answerOptions?.length ? <p>选项答案：{item.answerOptions.join("、")}</p> : null}
                {item.itemType === "LINK" && (
                  <span>链接确认：{item.isLinkConfirmed ? "已确认" : "未确认"}</span>
                )}
                {item.attachments?.length > 0 && (
                  <div>
                    <p className="mb-1">上传图片（{item.attachments.length} 张）：</p>
                    <div className="flex flex-wrap gap-1.5">
                      {item.attachments.map((att) => (
                        <a
                          key={att.id}
                          href={att.fileUrl.startsWith("/uploads") ? `/api${att.fileUrl}` : att.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={att.fileUrl.startsWith("/uploads") ? `/api${att.fileUrl}` : att.fileUrl}
                            alt={att.fileName}
                            className="h-16 w-16 rounded-lg border border-slate-200 object-cover transition hover:opacity-80"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
      {data.record.submittedAt && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <CheckCircle2 size={13} />
          已于 {data.record.submittedAt.slice(0, 16).replace("T", " ")} 提交完成
        </div>
      )}

      {leaveModalOpen && data.record.leaveRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setLeaveModalOpen(false)}>
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-amber-600">厅管日常任务</p>
                <h3 className="mt-1 text-xl font-bold text-slate-900">请假审批</h3>
              </div>
              <button type="button" onClick={() => setLeaveModalOpen(false)} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-500 transition hover:bg-slate-200">关闭</button>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
              <div className="flex justify-between gap-3"><span className="text-slate-400">申请状态</span><span className="font-semibold text-slate-800">{data.record.leaveRequest.status === "approved" ? "已请假" : data.record.leaveRequest.status === "pending" ? "待审批" : "请假未通过"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-400">申请人</span><span className="font-semibold text-slate-800">{data.record.leaveRequest.applicantName || "-"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-400">申请时间</span><span className="font-medium text-slate-700">{data.record.leaveRequest.createdAt.slice(0, 16).replace("T", " ")}</span></div>
              <div>
                <p className="mb-1 text-slate-400">请假原因</p>
                <p className="rounded-xl bg-white px-3 py-2 font-medium text-slate-800 ring-1 ring-slate-100">{data.record.leaveRequest.reason}</p>
              </div>
              {data.record.leaveRequest.reviewComment && (
                <div>
                  <p className="mb-1 text-slate-400">审批意见</p>
                  <p className="rounded-xl bg-white px-3 py-2 font-medium text-slate-800 ring-1 ring-slate-100">{data.record.leaveRequest.reviewComment}</p>
                </div>
              )}
            </div>

            {data.record.leaveRequest.status === "pending" && (
              <div className="mt-4 space-y-3">
                <button type="button" disabled={reviewLoading} onClick={() => void handleApproveLeave(data.record!.leaveRequest!.id)} className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                  {reviewLoading ? "处理中..." : "同意请假"}
                </button>
                <div className="rounded-2xl border border-red-100 bg-red-50 p-3">
                  <input value={rejectComment} onChange={(event) => setRejectComment(event.target.value)} placeholder="拒绝请假需填写原因" className="h-10 w-full rounded-xl border border-red-200 bg-white px-3 text-sm outline-none focus:border-red-400" />
                  <button type="button" disabled={reviewLoading || !rejectComment.trim()} onClick={() => void handleRejectLeave(data.record!.leaveRequest!.id)} className="mt-2 w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50">
                    拒绝请假
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 管理员视图：厅进度行（内联展开）──────────────────────────────────────────

function HallProgressRow({ hall, taskDate }: { hall: HallDailyAdminHallRow; taskDate: string }) {
  const statusMeta = getStatusMeta(hall.status);

  // 未参与任务的厅
  if (!hall.hasTask) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50/60">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="text-sm text-slate-400">{hall.hallOrgName}</span>
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-400">未参与任务</span>
        </div>
      </div>
    );
  }

  const rowBg =
    hall.status === "submitted" ? "border-emerald-100 bg-emerald-50/40" :
    hall.status === "in_progress" ? "border-blue-100 bg-blue-50/30" :
    hall.status === "overdue" ? "border-red-100 bg-red-50/20" :
    "border-slate-100 bg-white";

  return (
    <div className={`rounded-xl border ${rowBg}`}>
      {/* 厅标题行 */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <ChevronDown size={14} className="shrink-0 text-teal-500" />
          <span className="text-sm font-medium text-slate-800">{hall.hallOrgName}</span>
        </div>
        <div className="flex items-center gap-2">
          {hall.submittedAt && (
            <span className="text-xs text-slate-400 tabular-nums">
              {hall.submittedAt.slice(0, 16).replace("T", " ")}
            </span>
          )}
          <span className={`shrink-0 rounded-full border px-3 py-0.5 text-xs font-semibold ${statusMeta.badgeCls}`}>
            {hall.status ? `${hall.completionRate}% · ` : ""}{statusMeta.label}
          </span>
        </div>
      </div>
      {/* 任务详情（始终展开） */}
      <div className="border-t border-slate-100 px-4 pb-3 pt-2">
        <HallDetailPanel hallOrgId={hall.hallOrgId} taskDate={taskDate} />
      </div>
    </div>
  );
}

// ── 管理员视图：团队汇总卡片（含懒加载厅列表）───────────────────────────────

function TeamSummaryCard({ team, taskDate }: { team: HallDailyAdminTeamSummary; taskDate: string }) {
  const [expanded, setExpanded] = useState(false);
  const [halls, setHalls] = useState<HallDailyAdminHallRow[] | null>(null);
  const [hallsLoading, setHallsLoading] = useState(false);
  const [hallsError, setHallsError] = useState("");

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (!next || halls !== null) return;
    setHallsLoading(true);
    setHallsError("");
    const result = await reportApi.getHallDailyAdminTeamHalls(team.teamOrgId, { taskDate }).catch((err: Error) => {
      setHallsError(err.message || "加载失败");
      return null;
    });
    setHalls(result ?? []);
    setHallsLoading(false);
  }

  const completionTextColor =
    team.completionRate >= 80 ? "text-emerald-600" :
    team.completionRate >= 50 ? "text-amber-500" : "text-red-500";

  return (
    <div className={`overflow-hidden rounded-2xl border bg-white shadow-[0_4px_12px_rgba(15,23,42,0.04)] ${team.hasTask ? "border-slate-200" : "border-slate-100"}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
        onClick={toggle}
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown size={16} className="shrink-0 text-slate-400" /> : <ChevronRight size={16} className="shrink-0 text-slate-400" />}
          <div>
            <div className="flex items-center gap-2">
              <p className={`text-base font-semibold ${team.hasTask ? "text-slate-900" : "text-slate-400"}`}>{team.teamOrgName}</p>
              {!team.hasTask && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-400">未参与任务</span>
              )}
              {team.hasTask && team.templateTitle && (
                <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">{team.templateTitle}</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              共 {team.totalHalls} 个厅
              {team.hasTask && team.assignedHalls < team.totalHalls && (
                <span className="ml-1 text-amber-500">· {team.assignedHalls} 个参与任务</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {team.hasTask ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                <CheckCircle2 size={11} /> {team.submittedCount} 已提交
              </span>
              {(team.leaveApprovedCount ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-100">
                  {team.leaveApprovedCount} 已请假
                </span>
              )}
              {(team.leavePendingCount ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-100">
                  {team.leavePendingCount} 请假待审
                </span>
              )}
              {team.inProgressCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100">
                  <Loader2 size={11} /> {team.inProgressCount} 进行中
                </span>
              )}
              {team.overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-100">
                  {team.overdueCount} 逾期
                </span>
              )}
              {team.pendingCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                  {team.pendingCount} 未开始
                </span>
              )}
              {team.noRecordCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-400 ring-1 ring-slate-200">
                  {team.noRecordCount} 无记录
                </span>
              )}
              <span className={`ml-1 min-w-[3rem] text-right text-lg font-bold tabular-nums ${completionTextColor}`}>
                {team.completionRate}%
              </span>
            </>
          ) : (
            <span className="text-sm text-slate-300">—</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 pb-4 pt-3">
          {hallsLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" />加载厅列表...
            </div>
          ) : hallsError ? (
            <div className="py-3 text-sm text-red-500">{hallsError}</div>
          ) : halls && halls.length === 0 ? (
            <div className="py-3 text-sm text-slate-400">该团队暂无直播厅。</div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {[...(halls ?? [])]
                .sort((a, b) => (b.hasTask ? 1 : 0) - (a.hasTask ? 1 : 0))
                .map((hall) => (
                  <HallProgressRow key={hall.hallOrgId} hall={hall} taskDate={taskDate} />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 管理员视图 ───────────────────────────────────────────────────────────────

function AdminView() {
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const identityVersion = useIdentityStore((state) => state.identityVersion);
  const roleCode = currentIdentity?.roleCode ?? "";

  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [taskDate, setTaskDate] = useState("");
  const [selectedBaseOrgId, setSelectedBaseOrgId] = useState("");
  const [data, setData] = useState<HallDailyAdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const needsBaseSelector = ["DEV_ADMIN", "HQ_ADMIN"].includes(roleCode);
  const availableBaseOrgs = useMemo(() => getAvailableBaseOrgs(orgs, currentIdentity ?? undefined), [orgs, currentIdentity]);

  // 加载组织树（供 HQ_ADMIN/DEV_ADMIN 选基地）
  useEffect(() => {
    if (!needsBaseSelector) return;
    fetchOrgTree().then(setOrgs).catch(() => {});
  }, [needsBaseSelector]);

  // 自动选第一个基地
  useEffect(() => {
    if (!selectedBaseOrgId && availableBaseOrgs.length) {
      setSelectedBaseOrgId(availableBaseOrgs[0].id);
    }
  }, [availableBaseOrgs, selectedBaseOrgId]);

  async function load(forceDate?: string, forceBaseId?: string) {
    const date = forceDate ?? taskDate ?? undefined;
    const baseId = forceBaseId ?? selectedBaseOrgId ?? undefined;
    if (needsBaseSelector && !baseId) return;

    setLoading(true);
    setError("");
    const result = await reportApi.getHallDailyAdminOverview({
      taskDate: date || undefined,
      scopeOrgId: baseId || undefined,
    }).catch((err: Error) => {
      setError(err.message || "加载失败");
      return null;
    });
    setData(result);
    if (!taskDate && result?.taskDate) setTaskDate(result.taskDate);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [identityVersion, selectedBaseOrgId]);

  const phaseMeta = data ? getPhaseMeta(data.phase) : null;

  return (
    <div className="space-y-6">
      {/* 顶栏 */}
      <section className="rounded-3xl bg-white px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-4 xl:flex-nowrap">
          <div className="shrink-0">
            <h1 className="text-[28px] font-bold tracking-[-0.02em] text-slate-900">厅管日常任务看板</h1>
            {data?.baseOrg && (
              <p className="mt-1 text-sm text-slate-500">
                基地：<span className="font-medium text-slate-700">{data.baseOrg.name}</span>
                {phaseMeta && (
                  <span className={`ml-2 inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${phaseMeta.cls}`}>{phaseMeta.label}</span>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            {/* 基地选择（仅 HQ/DEV_ADMIN） */}
            {needsBaseSelector && (
              <select
                value={selectedBaseOrgId}
                onChange={(e) => { setSelectedBaseOrgId(e.target.value); void load(taskDate || undefined, e.target.value); }}
                className="h-11 min-w-[160px] rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-400"
              >
                <option value="">请选择基地</option>
                {availableBaseOrgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            )}

            <input
              type="date"
              value={taskDate}
              onChange={(e) => { const d = e.target.value; setTaskDate(d); if (d) void load(d); }}
              className="h-11 min-w-[200px] rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-blue-400"
            />
            <button type="button"
              onClick={() => { const t = data?.quickRanges.today ?? taskDate; if (!t) return; setTaskDate(t); void load(t); }}
              disabled={!data?.quickRanges.today && !taskDate}
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500 transition hover:bg-slate-100 disabled:opacity-50">
              今天
            </button>
            {data?.quickRanges.canSupplementYesterday && (
              <button type="button"
                onClick={() => { const y = data.quickRanges.yesterday; if (!y) return; setTaskDate(y); void load(y); }}
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500 transition hover:bg-slate-100">
                昨天（补录）
              </button>
            )}
            <button type="button" onClick={() => void load()}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
              <RefreshCw size={15} />刷新
            </button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {needsBaseSelector && !selectedBaseOrgId && !loading && (
        <div className="rounded-3xl bg-white py-14 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          请先在上方选择基地，以查看厅管日常任务进度。
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />加载中...</span>
        </div>
      ) : data ? (
        <>
          {/* 汇总数字：基地层面 */}
          {(() => {
            const s: HallDailyAdminBaseSummary = data.baseSummary;
            const unsubmitted = s.assignedHalls - s.submittedHalls;
            const rateColor = s.completionRate >= 80 ? "text-emerald-600" : s.completionRate >= 50 ? "text-amber-600" : "text-red-600";
            const rateBg = s.completionRate >= 80 ? "bg-emerald-50 ring-emerald-100" : s.completionRate >= 50 ? "bg-amber-50 ring-amber-100" : "bg-red-50 ring-red-100";
            return (
              <section className="rounded-3xl bg-white px-5 py-3.5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="flex flex-wrap items-center gap-x-0 gap-y-2 divide-x divide-slate-100">
                  {/* 总规模 */}
                  <div className="flex items-baseline gap-1.5 pr-5">
                    <span className="text-xs text-slate-400">共</span>
                    <span className="text-base font-bold text-slate-700">{s.totalTeams}</span>
                    <span className="text-xs text-slate-400">团队</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-base font-bold text-slate-700">{s.totalHalls}</span>
                    <span className="text-xs text-slate-400">厅</span>
                  </div>
                  {/* 参与任务 */}
                  <div className="flex items-baseline gap-1.5 px-5">
                    <span className="text-xs text-slate-400">参与任务</span>
                    <span className="text-base font-bold text-blue-600">{s.assignedTeams}</span>
                    <span className="text-xs text-slate-400">团队</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-base font-bold text-blue-600">{s.assignedHalls}</span>
                    <span className="text-xs text-slate-400">厅</span>
                  </div>
                  {/* 已完成 */}
                  <div className="flex items-baseline gap-1.5 px-5">
                    <span className="text-xs text-slate-400">已完成</span>
                    <span className="text-xl font-bold text-emerald-600 tabular-nums">{s.submittedHalls}</span>
                    <span className="text-xs text-slate-400">厅</span>
                  </div>
                  {/* 未完成 */}
                  <div className="flex items-baseline gap-1.5 px-5">
                    <span className="text-xs text-slate-400">未完成</span>
                    <span className="text-xl font-bold text-red-500 tabular-nums">{unsubmitted}</span>
                    <span className="text-xs text-slate-400">厅</span>
                  </div>
                  {/* 完成率 */}
                  <div className="flex items-baseline gap-2 pl-5">
                    <span className="text-xs text-slate-400">完成率</span>
                    <span className={`text-2xl font-bold tabular-nums ${rateColor}`}>{s.completionRate}%</span>
                    <span className="text-xs text-slate-300">= 已完成/参与任务</span>
                  </div>
                </div>
                {/* 未参与提示 */}
                {(s.totalTeams > s.assignedTeams || s.totalHalls > s.assignedHalls) && (
                  <p className="mt-3 text-xs text-slate-400">
                    另有 {s.totalTeams - s.assignedTeams} 个团队 · {s.totalHalls - s.assignedHalls} 个厅未参与任务（已在下方标注）
                  </p>
                )}
              </section>
            );
          })()}

          {/* 团队列表 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-800">团队进度（点击厅名展开详情）</h2>
            {data.teams.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-400">
                {taskDate} 该基地暂无团队数据。
              </div>
            ) : (
              [...data.teams]
                .sort((a, b) => (b.hasTask ? 1 : 0) - (a.hasTask ? 1 : 0))
                .map((team) => (
                  <TeamSummaryCard key={team.teamOrgId} team={team} taskDate={data.taskDate} />
                ))
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

// ── 页面入口：按角色分叉 ─────────────────────────────────────────────────────

export function HallDailyDashboardPage() {
  const roleCode = useIdentityStore((state) => state.currentIdentity?.roleCode);

  if (roleCode === "HALL_MANAGER") {
    return <HallManagerView />;
  }
  return <AdminView />;
}
