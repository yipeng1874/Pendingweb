import { useEffect, useState, useCallback } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  Lock,
  Megaphone,
  Paperclip,
  Play,
  RefreshCw,
  Search,
  User,
  UserRound,
  X,
} from "lucide-react";
import { workflowTaskApi } from "../../../services/workflowTask";
import type { WorkflowMyTask, WorkflowMyTaskStep } from "../../../services/workflowTask";
import { broadcastTaskApi } from "../../../services/broadcastTask";
import type { BroadcastTaskWithAnswers, BroadcastAnchorRecordWithAnswers } from "../../../services/broadcastTask";
import { useIdentityStore } from "../../../stores/identityStore";

// ─────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dueLabel(dueAt?: string | null): { text: string; overdue: boolean } | null {
  if (!dueAt) return null;
  const diff = new Date(dueAt).getTime() - Date.now();
  if (diff < 0) return { text: "已逾期", overdue: true };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return { text: days > 0 ? `${days}天后截止` : `${hours}h 后截止`, overdue: false };
}

function taskProgress(task: WorkflowMyTask) {
  const total = task.steps.length;
  const done = task.steps.filter((s) => s.status === "completed").length;
  return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

function resolveLifecycle(task: WorkflowMyTask): "in_progress" | "completed" | "ended" {
  const now = Date.now();
  const isExpired = task.dueAt ? new Date(task.dueAt).getTime() < now : false;
  if (task.status === "ended" || isExpired) return "ended";
  if (task.status === "completed") return "completed";
  return "in_progress";
}

function statusBadge(lifecycle: "in_progress" | "completed" | "ended") {
  if (lifecycle === "completed")
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">已完成</span>;
  if (lifecycle === "in_progress")
    return <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">进行中</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">已结束</span>;
}

function stepStatusIcon(status: "pending" | "active" | "completed") {
  if (status === "completed") return <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />;
  if (status === "active") return <Loader2 size={16} className="text-violet-500 shrink-0 animate-spin" />;
  return <Lock size={16} className="text-slate-300 shrink-0" />;
}

/** 从 URL 提取文件名 */
function fileNameFromUrl(url: string) {
  try {
    const parts = new URL(url).pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1] || url);
  } catch {
    return url.split("/").pop() ?? url;
  }
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|avi|mkv|webm)(\?.*)?$/i.test(url);
}

// ─────────────────────────────────────────────────────────────────
// 附件展示（只读）
// ─────────────────────────────────────────────────────────────────

function AttachmentReadonly({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  const images = urls.filter(isImageUrl);
  const others = urls.filter((u) => !isImageUrl(u));

  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="group relative block overflow-hidden rounded-lg border border-slate-200"
              style={{ width: 64, height: 64 }}
              title={fileNameFromUrl(url)}
            >
              <img src={url} alt={fileNameFromUrl(url)} className="h-full w-full object-cover transition group-hover:opacity-80" />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-black/40 py-0.5 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
                <ExternalLink size={8} />查看
              </span>
            </a>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((url) => {
            const name = fileNameFromUrl(url);
            const isVid = isVideoUrl(url);
            const isPdf = /\.pdf$/i.test(name);
            const isDoc = /\.(doc|docx)$/i.test(name);
            const isXls = /\.(xls|xlsx)$/i.test(name);
            return (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition"
                title={name}
              >
                {isVid ? <Play size={11} className="shrink-0 text-indigo-400" /> :
                 isPdf ? <FileText size={11} className="shrink-0 text-red-400" /> :
                 isDoc ? <FileText size={11} className="shrink-0 text-blue-400" /> :
                 isXls ? <FileText size={11} className="shrink-0 text-emerald-500" /> :
                 <Paperclip size={11} className="shrink-0 text-slate-400" />}
                <span className="max-w-[160px] truncate">{name}</span>
                <ExternalLink size={9} className="shrink-0 text-slate-300" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 答案展示（详情抽屉内使用）
// ─────────────────────────────────────────────────────────────────

function answerDisplay(step: WorkflowMyTaskStep) {
  // 无论节点是否完成，只要有题目就展示（有答案展示答案，没有则提示"等待填写"）
  if (!step.questions?.length) return null;

  return (
    <div className="mt-2 space-y-2">
      {step.questions.map((q) => {
        const ans = step.stepAnswers?.find((a) => a.questionId === q.id);
        const hasAnswer = ans && (
          (ans.answerOptions?.length ?? 0) > 0 ||
          !!ans.answerText?.trim() ||
          ans.isLinkConfirmed ||
          (ans.attachmentUrls?.length ?? 0) > 0
        );

        let content: React.ReactNode = null;

        if (!hasAnswer) {
          content = (
            <span className="flex items-center gap-1 text-[11px] text-slate-300">
              <Lock size={9} />等待填写
            </span>
          );
        } else if (q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE") {
          const opts = ans!.answerOptions ?? [];
          content = (
            <div className="flex flex-wrap gap-1">
              {opts.map((opt) => (
                <span key={opt} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">{opt}</span>
              ))}
            </div>
          );
        } else if (q.itemType === "LINK") {
          content = (
            <span className="flex items-center gap-1 text-[12px] font-medium text-emerald-600">
              <CheckCircle2 size={11} />已确认完成
            </span>
          );
        } else if (q.itemType === "ATTACHMENT") {
          const urls = ans!.attachmentUrls ?? [];
          content = <AttachmentReadonly urls={urls} />;
        } else {
          // QA / FILL_BLANK
          content = (
            <span className="text-slate-700 text-[12px] break-all leading-relaxed">{ans!.answerText}</span>
          );
        }

        return (
          <div key={q.id} className="rounded-lg bg-white px-3 py-2 border border-slate-100">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                {q.itemType === "FILL_BLANK" ? "待办" :
                 q.itemType === "QA" ? "问答" :
                 q.itemType === "SINGLE_CHOICE" ? "单选" :
                 q.itemType === "MULTI_CHOICE" ? "多选" :
                 q.itemType === "LINK" ? "链接" : "附件"}
              </span>
              <p className="text-[11px] text-slate-500 font-medium flex-1">{q.title}</p>
              {hasAnswer && (
                <CheckCircle2 size={11} className="shrink-0 text-emerald-400" />
              )}
            </div>
            <div>{content}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 节点时间线（详情抽屉）
// ─────────────────────────────────────────────────────────────────

function StepTimelineItem({ step, idx, total }: { step: WorkflowMyTaskStep; idx: number; total: number }) {
  // 已完成默认展开，其他默认收起
  const [open, setOpen] = useState(step.status === "completed");
  const answeredCount = step.questions?.filter((q) => {
    const ans = step.stepAnswers?.find((a) => a.questionId === q.id);
    return ans && (
      (ans.answerOptions?.length ?? 0) > 0 ||
      !!ans.answerText?.trim() ||
      ans.isLinkConfirmed ||
      (ans.attachmentUrls?.length ?? 0) > 0
    );
  }).length ?? 0;
  const totalCount = step.questions?.length ?? 0;

  return (
    <div className="relative mb-0 last:mb-0">
      {idx < total - 1 && (
        <span className="absolute left-[-12px] top-[22px] bottom-0 w-px bg-slate-200" />
      )}
      <span className="absolute left-[-17px] top-[4px]">
        {stepStatusIcon(step.status)}
      </span>
      <div className={`rounded-xl border mb-3 overflow-hidden ${
        step.status === "active" ? "border-violet-200 bg-violet-50/40" :
        step.status === "completed" ? "border-emerald-100 bg-emerald-50/30" :
        "border-slate-100 bg-white"
      }`}>
        {/* 节点头（点击折叠/展开） */}
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-semibold text-slate-400">节点{step.order}</span>
            <span className="text-sm font-semibold text-slate-700 truncate">{step.title}</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <User size={11} />{step.assigneeName}
              {step.assigneeOrgName && <span className="text-slate-300">· {step.assigneeOrgName}</span>}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {totalCount > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                step.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                answeredCount > 0 ? "bg-amber-100 text-amber-700" :
                "bg-slate-100 text-slate-400"
              }`}>
                {answeredCount}/{totalCount} 项
              </span>
            )}
            {step.status === "completed" && (
              <span className="text-[11px] text-emerald-600 font-medium">{fmtDate(step.completedAt)} 提交</span>
            )}
            {step.status === "active" && (
              <span className="text-[11px] text-violet-600 font-medium animate-pulse">执行中</span>
            )}
            {step.status === "pending" && (
              <span className="text-[11px] text-slate-400">等待中</span>
            )}
            <span className="text-slate-300">
              {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </span>
          </div>
        </button>

        {/* 展开：题目与答案 */}
        {open && (
          <div className="border-t border-slate-100/80 px-3 pb-3 pt-2">
            {answerDisplay(step)}
          </div>
        )}
      </div>
    </div>
  );
}

function StepTimeline({ steps }: { steps: WorkflowMyTaskStep[] }) {
  return (
    <div className="relative pl-5">
      {steps.map((step, idx) => (
        <StepTimelineItem key={step.id} step={step} idx={idx} total={steps.length} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 单任务卡片
// ─────────────────────────────────────────────────────────────────

function TaskCard({ task, onViewDetail }: { task: WorkflowMyTask; onViewDetail: (task: WorkflowMyTask) => void }) {
  const { total, done, pct } = taskProgress(task);
  const due = dueLabel(task.dueAt);
  const lifecycle = resolveLifecycle(task);

  const borderColor =
    lifecycle === "completed" ? "border-emerald-100" :
    lifecycle === "ended" ? "border-slate-200" :
    "border-violet-100";

  const progressColor =
    lifecycle === "completed" ? "bg-emerald-400" :
    lifecycle === "ended" ? "bg-slate-300" :
    "bg-violet-400";

  return (
    <div className={`rounded-2xl border bg-white transition-shadow hover:shadow-md ${borderColor}`}>
      {/* 顶部细进度条 */}
      <div className="h-0.5 w-full bg-slate-100 rounded-t-2xl overflow-hidden">
        <div className={`h-full transition-all ${progressColor}`} style={{ width: `${pct}%` }} />
      </div>

      {/* 头部 */}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          {/* 唯一一行：状态标签 + 标题 + 发布人 + 发起时间 + 截止时间 */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {statusBadge(lifecycle)}
            {lifecycle === "ended" && task.steps.every((s) => s.status === "completed") && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-400">正常结束</span>
            )}
            {lifecycle === "ended" && !task.steps.every((s) => s.status === "completed") && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-500">逾期结束</span>
            )}
            {lifecycle !== "ended" && due && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${due.overdue ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>
                {due.text}
              </span>
            )}
            <p className="font-bold text-base text-slate-800">{task.title}</p>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-0.5 text-xs font-medium text-slate-600">
              <UserRound size={11} />{task.createdByName}
            </span>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-0.5 text-xs text-slate-500">
              <Clock size={11} />发起 {fmtDate(task.createdAt)}
            </span>
            {task.dueAt && (
              <>
                <span className="text-slate-300">·</span>
                <span className={`flex items-center gap-0.5 text-xs ${due?.overdue ? "text-red-500 font-medium" : "text-slate-500"}`}>
                  截止 {fmtDate(task.dueAt)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 右侧：进度条 + 数字 + 查看详情（同一行） */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-semibold text-slate-500 tabular-nums">{done}/{total}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onViewDetail(task); }}
            className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-100 hover:text-blue-700 transition-colors border border-blue-100"
          >
            查看详情
          </button>
        </div>
      </div>

      {/* 节点细化进度（始终展示） */}
      <div className="border-t border-slate-50 px-4 pb-3 pt-3">
        <div className="flex flex-wrap gap-2">
          {task.steps.map((step) => {
            const stepDone = step.status === "completed";
            const stepActive = step.status === "active";
            const totalCount = step.questions?.length ?? 0;
            const answeredCount = (step.questions ?? []).filter((q) => {
              const ans = step.stepAnswers?.find((a) => a.questionId === q.id);
              return ans && (
                (ans.answerOptions?.length ?? 0) > 0 ||
                !!ans.answerText?.trim() ||
                ans.isLinkConfirmed ||
                (ans.attachmentUrls?.length ?? 0) > 0
              );
            }).length;

            return (
              <div
                key={step.id}
                className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 border text-[11px] ${
                  stepDone ? "border-emerald-100 bg-emerald-50 text-emerald-700" :
                  stepActive ? "border-violet-100 bg-violet-50 text-violet-700" :
                  "border-slate-100 bg-slate-50 text-slate-400"
                }`}
              >
                {stepStatusIcon(step.status)}
                <span className="font-medium max-w-[60px] truncate">{step.title}</span>
                <span className="opacity-40">·</span>
                <span className="opacity-80">{step.assigneeName}</span>
                {totalCount > 0 && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className={`font-medium ${stepDone ? "text-emerald-600" : answeredCount > 0 ? "text-amber-600" : ""}`}>
                      {answeredCount}/{totalCount}项
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 详情抽屉
// ─────────────────────────────────────────────────────────────────

function DetailDrawer({ task, onClose }: { task: WorkflowMyTask; onClose: () => void }) {
  const lifecycle = resolveLifecycle(task);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-violet-500" />
            <span className="text-sm font-bold text-slate-800">任务执行详情</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            {/* 基本信息 */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {statusBadge(lifecycle)}
                {lifecycle === "ended" && task.steps.every((s) => s.status === "completed") && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-400">正常结束</span>
                )}
                {lifecycle === "ended" && !task.steps.every((s) => s.status === "completed") && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-500">逾期结束</span>
                )}
                {lifecycle !== "ended" && dueLabel(task.dueAt) && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${dueLabel(task.dueAt)!.overdue ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>
                    {dueLabel(task.dueAt)!.text}
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-slate-800">{task.title}</h2>
              {task.description && <p className="text-sm text-slate-500">{task.description}</p>}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-slate-500 pt-1">
                <span>发布人：<span className="text-slate-700 font-medium">{task.createdByName}</span></span>
                {task.issuerOrgName && <span>发布组织：<span className="text-slate-700 font-medium">{task.issuerOrgName}</span></span>}
                <span>发起时间：{fmtDate(task.createdAt)}</span>
                {task.dueAt && <span>截止时间：{fmtDate(task.dueAt)}</span>}
              </div>
            </div>

            {/* 节点执行进度 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">节点执行进度</p>
                <span className="text-xs text-slate-400 tabular-nums">
                  {task.steps.filter((s) => s.status === "completed").length} / {task.steps.length} 已完成
                </span>
              </div>
              <div className="flex gap-1 mb-4">
                {task.steps.map((step) => (
                  <div
                    key={step.id}
                    className={`h-1.5 flex-1 rounded-full transition-all ${
                      step.status === "completed" ? "bg-emerald-400" :
                      step.status === "active" ? "bg-violet-400" :
                      "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
              <StepTimeline steps={task.steps as WorkflowMyTaskStep[]} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 群发看板：辅助函数
// ─────────────────────────────────────────────────────────────────

function broadcastAnchorStatusLabel(status: BroadcastAnchorRecordWithAnswers["status"]) {
  switch (status) {
    case "submitted":
      return <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 size={11} />已提交</span>;
    case "in_progress":
      return <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600"><Loader2 size={11} className="animate-spin" />进行中</span>;
    case "overdue":
      return <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600"><Clock size={11} />已逾期</span>;
    default:
      return <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500"><Lock size={11} />待开始</span>;
  }
}

/**
 * 群发任务生命周期：
 * - active       任务未到截止时间（不管主播完没完成）
 * - finished     任务已结束 且 所有主播都已提交
 * - overdue      任务已结束 且 有主播未完成（部分逾期）
 */
function broadcastTaskLifecycle(task: BroadcastTaskWithAnswers): "active" | "finished" | "overdue" {
  if (task.status !== "ended") return "active";
  const allDone = task.anchorRecords.every((r) => r.status === "submitted");
  return allDone ? "finished" : "overdue";
}

// ─────────────────────────────────────────────────────────────────
// 群发看板：主播答案展示（内联，可折叠）
// ─────────────────────────────────────────────────────────────────

function BroadcastAnchorAnswers({
  rec,
  questions,
}: {
  rec: BroadcastAnchorRecordWithAnswers;
  questions: BroadcastTaskWithAnswers["questions"];
}) {
  const answers = rec.answers ?? [];
  if (!answers.length) {
    return <p className="text-[11px] text-slate-400 px-1 py-1">暂无填写记录</p>;
  }
  return (
    <div className="mt-2 space-y-1.5">
      {questions.map((q, idx) => {
        const ans = answers.find((a) => a.questionId === q.id);
        const typeLabel =
          q.itemType === "QA" ? "问答" :
          q.itemType === "FILL_BLANK" ? "待办" :
          q.itemType === "SINGLE_CHOICE" ? "单选" :
          q.itemType === "MULTI_CHOICE" ? "多选" :
          q.itemType === "LINK" ? "链接" : "附件";

        let content: React.ReactNode;
        if (!ans) {
          content = <span className="flex items-center gap-1 text-[11px] text-slate-300"><Lock size={9} />未填写</span>;
        } else if (q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE") {
          content = (
            <div className="flex flex-wrap gap-1">
              {(ans.answerOptions ?? []).map((opt) => (
                <span key={opt} className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-600">{opt}</span>
              ))}
            </div>
          );
        } else if (q.itemType === "LINK") {
          content = <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 size={11} />已确认完成</span>;
        } else if (q.itemType === "ATTACHMENT") {
          const urls = ans.attachmentUrls ?? [];
          content = urls.length ? (
            <div className="flex flex-wrap gap-1.5">
              {urls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-indigo-600 hover:bg-indigo-50 transition">
                  <Paperclip size={10} />查看附件<ExternalLink size={9} />
                </a>
              ))}
            </div>
          ) : <span className="text-[11px] text-slate-300">无附件</span>;
        } else {
          content = <span className="text-slate-700 text-[12px] break-all leading-relaxed">{ans.answerText || <span className="text-slate-300">（空）</span>}</span>;
        }

        return (
          <div key={q.id ?? idx} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{typeLabel}</span>
              <p className="text-[11px] text-slate-500 font-medium flex-1">{q.title}</p>
              {ans && <CheckCircle2 size={10} className="shrink-0 text-emerald-400" />}
            </div>
            <div>{content}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 群发看板：单任务卡片（主播行可展开查看答案）
// ─────────────────────────────────────────────────────────────────

function BroadcastAnchorRow({
  rec,
  questions,
}: {
  rec: BroadcastAnchorRecordWithAnswers;
  questions: BroadcastTaskWithAnswers["questions"];
}) {
  const [open, setOpen] = useState(false);
  const hasAnswers = (rec.answers ?? []).length > 0;

  return (
    <div className={`rounded-xl border transition-colors ${open ? "border-orange-200 bg-orange-50/30" : "border-slate-100 bg-slate-50/60"}`}>
      {/* 主播行头 */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <UserRound size={13} className="shrink-0 text-slate-400" />
          <span className="text-sm font-medium text-slate-700 truncate">{rec.anchorNickname}</span>
          {rec.anchorDouyinNo && (
            <span className="text-[11px] text-slate-400 hidden sm:inline">抖音号 {rec.anchorDouyinNo}</span>
          )}
          {rec.anchorOrgName && (
            <span className="text-[11px] text-slate-400 hidden sm:inline">· {rec.anchorOrgName}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {rec.submittedAt && (
            <span className="text-[11px] text-slate-400">{fmtDate(rec.submittedAt)}</span>
          )}
          {broadcastAnchorStatusLabel(rec.status)}
          {/* 仅有答案时才能展开 */}
          {hasAnswers && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-0.5 rounded-lg bg-orange-50 border border-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-600 hover:bg-orange-100 transition-colors"
            >
              {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {open ? "收起" : "查看答案"}
            </button>
          )}
        </div>
      </div>
      {/* 展开：答案详情 */}
      {open && (
        <div className="border-t border-orange-100/60 px-3 pb-3 pt-1">
          <BroadcastAnchorAnswers rec={rec} questions={questions} />
        </div>
      )}
    </div>
  );
}

function BroadcastTaskCard({ task }: { task: BroadcastTaskWithAnswers }) {
  const [expanded, setExpanded] = useState(false);
  // 答案懒加载状态
  const [anchorRecords, setAnchorRecords] = useState<BroadcastAnchorRecordWithAnswers[]>(task.anchorRecords);
  const [answersLoaded, setAnswersLoaded] = useState(false);
  const [answersLoading, setAnswersLoading] = useState(false);

  const total = anchorRecords.length;
  const submitted = anchorRecords.filter((r) => r.status === "submitted").length;
  const pct = total > 0 ? Math.round((submitted / total) * 100) : 0;
  const lifecycle = broadcastTaskLifecycle(task);
  const due = dueLabel(task.dueAt);

  const borderColor =
    lifecycle === "finished" ? "border-emerald-100" :
    lifecycle === "overdue" ? "border-red-100" :
    "border-orange-100";

  const progressColor =
    lifecycle === "finished" ? "bg-emerald-400" :
    lifecycle === "overdue" ? "bg-red-300" :
    "bg-orange-400";

  // 点击展开时才拉取答案
  const handleExpand = async () => {
    if (!expanded && !answersLoaded) {
      setAnswersLoading(true);
      try {
        const res = await broadcastTaskApi.taskAnchorAnswers(task.id);
        setAnchorRecords(res.anchorRecords);
        setAnswersLoaded(true);
      } catch {
        // 静默失败，仍展开显示主播列表（答案为空）
      } finally {
        setAnswersLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <div className={`rounded-2xl border bg-white transition-shadow hover:shadow-md ${borderColor}`}>
      {/* 顶部进度条 */}
      <div className="h-0.5 w-full bg-slate-100 rounded-t-2xl overflow-hidden">
        <div className={`h-full transition-all ${progressColor}`} style={{ width: `${pct}%` }} />
      </div>

      {/* 头部 */}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {lifecycle === "active" && (
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-600">进行中</span>
            )}
            {lifecycle === "finished" && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">已结束（全部完成）</span>
            )}
            {lifecycle === "overdue" && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">已逾期</span>
            )}
            {lifecycle === "active" && due && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${due.overdue ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>
                {due.text}
              </span>
            )}
            <p className="font-bold text-base text-slate-800">{task.title}</p>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-0.5 text-xs text-slate-500">
              <Clock size={11} />发起 {fmtDate(task.createdAt)}
            </span>
            {task.dueAt && (
              <>
                <span className="text-slate-300">·</span>
                <span className={`flex items-center gap-0.5 text-xs ${due?.overdue ? "text-red-500 font-medium" : "text-slate-500"}`}>
                  截止 {fmtDate(task.dueAt)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-semibold text-slate-500 tabular-nums">{submitted}/{total}</span>
          <button
            type="button"
            onClick={() => void handleExpand()}
            disabled={answersLoading}
            className="flex items-center gap-1 rounded-lg bg-orange-50 border border-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-600 hover:bg-orange-100 transition-colors disabled:opacity-60"
          >
            {answersLoading
              ? <Loader2 size={12} className="animate-spin" />
              : expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />
            }
            {answersLoading ? "加载中" : expanded ? "收起" : "查看主播"}
          </button>
        </div>
      </div>

      {/* 展开：主播列表（含答案，懒加载后填充） */}
      {expanded && (
        <div className="border-t border-slate-50 px-4 pb-3 pt-2">
          <div className="space-y-1.5">
            {anchorRecords.map((rec) => (
              <BroadcastAnchorRow key={rec.id} rec={rec} questions={task.questions} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 群发看板视图
// ─────────────────────────────────────────────────────────────────

type BroadcastFilterStatus = "all" | "active" | "finished" | "overdue";

const BROADCAST_PAGE_SIZE = 5;

function BroadcastBoardView() {
  const [tasks, setTasks] = useState<BroadcastTaskWithAnswers[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<BroadcastFilterStatus>("active");

  // 首次加载 / 刷新：重置到第一页
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await broadcastTaskApi.issuedTasksPaged({ page: 1, pageSize: BROADCAST_PAGE_SIZE });
      setTasks(result.tasks);
      setServerTotal(result.total);
      setCurrentPage(1);
      setHasMore(result.hasMore);
    } catch {
      setTasks([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载更多：追加到列表末尾
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = currentPage + 1;
    try {
      const result = await broadcastTaskApi.issuedTasksPaged({ page: nextPage, pageSize: BROADCAST_PAGE_SIZE });
      setTasks((prev) => [...prev, ...result.tasks]);
      setCurrentPage(nextPage);
      setHasMore(result.hasMore);
    } catch {
      // 静默失败
    } finally {
      setLoadingMore(false);
    }
  }, [currentPage, hasMore, loadingMore]);

  useEffect(() => { void load(); }, [load]);

  const tasksWithLifecycle = tasks.map((t) => ({ task: t, lifecycle: broadcastTaskLifecycle(t) }));

  const filtered = tasksWithLifecycle.filter(({ task, lifecycle }) => {
    const matchSearch = !search.trim() || task.title.includes(search.trim());
    const matchStatus = filterStatus === "all" || lifecycle === filterStatus;
    return matchSearch && matchStatus;
  });

  const activeCount = tasksWithLifecycle.filter((x) => x.lifecycle === "active").length;
  const finishedCount = tasksWithLifecycle.filter((x) => x.lifecycle === "finished").length;
  const overdueCount = tasksWithLifecycle.filter((x) => x.lifecycle === "overdue").length;

  const filterLabels: Record<BroadcastFilterStatus, string> = {
    all: "全部",
    active: "进行中",
    finished: "已结束（全部完成）",
    overdue: "已逾期",
  };

  return (
    <div>
      {/* 统计卡片 */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: "全部任务", value: serverTotal, color: "text-slate-700", bg: "bg-white border-slate-100" },
          { label: "进行中", value: activeCount, color: "text-orange-600", bg: "bg-orange-50/60 border-orange-100" },
          { label: "已结束（全部完成）", value: finishedCount, color: "text-emerald-600", bg: "bg-emerald-50/60 border-emerald-100" },
          { label: "已逾期", value: overdueCount, color: "text-red-500", bg: "bg-red-50/60 border-red-100" },
        ].map((item) => (
          <div key={item.label} className={`rounded-2xl border p-4 ${item.bg}`}>
            <p className="text-[11px] text-slate-400 mb-1">{item.label}</p>
            <p className={`text-2xl font-bold tabular-nums ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务名称..."
            className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-orange-300 focus:outline-none"
          />
        </div>
        {(["all", "active", "finished", "overdue"] as BroadcastFilterStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilterStatus(s)}
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
              filterStatus === s
                ? s === "overdue"
                  ? "border-red-300 bg-red-50 text-red-700"
                  : s === "finished"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-orange-300 bg-orange-50 text-orange-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {filterLabels[s]}
            {s !== "all" && (
              <span className="ml-1.5 text-[11px] opacity-70 tabular-nums">
                {s === "active" ? activeCount : s === "finished" ? finishedCount : overdueCount}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>

      {/* 任务列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400 gap-2">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
          <Megaphone size={32} className="opacity-30" />
          <p className="text-sm">
            {tasks.length === 0 ? "暂无已发布的群发主播任务" : "没有符合条件的任务"}
          </p>
          {tasks.length === 0 && (
            <a
              href="/tasks/collaboration/workflow"
              className="mt-1 rounded-xl bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
            >
              去发布群发任务
            </a>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {filtered.map(({ task }) => (
              <BroadcastTaskCard key={task.id} task={task} />
            ))}
          </div>

          {/* 加载更多 */}
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-6 py-2.5 text-sm font-medium text-orange-600 hover:bg-orange-100 transition-colors disabled:opacity-50"
              >
                {loadingMore
                  ? <><Loader2 size={14} className="animate-spin" />加载中...</>
                  : <>加载更多（已显示 {tasks.length} / {serverTotal} 条）</>
                }
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 主页面
// ─────────────────────────────────────────────────────────────────

type FilterStatus = "all" | "in_progress" | "completed" | "ended";

export function WorkflowBoardPage() {
  const currentIdentity = useIdentityStore((s) => s.currentIdentity);
  const isHallManager = currentIdentity?.roleCode === "HALL_MANAGER";
  const [activeTab, setActiveTab] = useState<"workflow" | "broadcast">("workflow");

  const [tasks, setTasks] = useState<WorkflowMyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("in_progress");
  const [detailTask, setDetailTask] = useState<WorkflowMyTask | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await workflowTaskApi.issuedTasks();
      setTasks(data);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const tasksWithLifecycle = tasks.map((t) => ({ task: t, lifecycle: resolveLifecycle(t) }));

  const filtered = tasksWithLifecycle.filter(({ task, lifecycle }) => {
    const matchSearch = !search.trim() ||
      task.title.includes(search) ||
      task.createdByName.includes(search) ||
      task.steps.some((s) => s.assigneeName.includes(search));
    const matchStatus = filterStatus === "all" || lifecycle === filterStatus;
    return matchSearch && matchStatus;
  });

  const total = tasks.length;
  const inProgressCount = tasksWithLifecycle.filter((x) => x.lifecycle === "in_progress").length;
  const completedCount = tasksWithLifecycle.filter((x) => x.lifecycle === "completed").length;
  const endedCount = tasksWithLifecycle.filter((x) => x.lifecycle === "ended").length;

  const filterLabels: Record<FilterStatus, string> = {
    all: "全部",
    in_progress: "进行中",
    completed: "已完成",
    ended: "已结束",
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/30 px-4 py-6 md:px-8">
      {/* 页头 */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {activeTab === "workflow"
              ? <GitBranch size={20} className="text-violet-500" />
              : <Megaphone size={20} className="text-orange-500" />}
            <h1 className="text-xl font-bold text-slate-800">协同任务看板</h1>
          </div>
          <p className="text-sm text-slate-400">
            {activeTab === "workflow"
              ? "仅展示我发布的协同任务；任务到截止时间后自动归入「已结束」"
              : "仅展示我发布的群发主播任务及每位主播的完成情况"}
          </p>
        </div>
      </div>

      {/* Tab 切换器（仅厅管显示群发看板 Tab） */}
      {isHallManager && (
        <div className="mb-5 flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 w-fit">
          <button
            type="button"
            onClick={() => setActiveTab("workflow")}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === "workflow"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <GitBranch size={14} />
            流转看板
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("broadcast")}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === "broadcast"
                ? "bg-orange-500 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <Megaphone size={14} />
            群发看板
          </button>
        </div>
      )}

      {/* ── 群发看板 ── */}
      {activeTab === "broadcast" && isHallManager && (
        <BroadcastBoardView />
      )}

      {/* ── 流转看板（现有内容） ── */}
      {activeTab === "workflow" && (
        <>
          {/* 刷新按钮 */}
          <div className="mb-5 flex justify-end">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              刷新
            </button>
          </div>

          {/* 统计卡片 */}
          <div className="mb-5 grid grid-cols-4 gap-3">
            {[
              { label: "全部任务", value: total, color: "text-slate-700", bg: "bg-white border-slate-100" },
              { label: "进行中", value: inProgressCount, color: "text-violet-600", bg: "bg-violet-50/60 border-violet-100" },
              { label: "已完成", value: completedCount, color: "text-emerald-600", bg: "bg-emerald-50/60 border-emerald-100" },
              { label: "已结束", value: endedCount, color: "text-slate-500", bg: "bg-slate-50 border-slate-200" },
            ].map((item) => (
              <div key={item.label} className={`rounded-2xl border p-4 ${item.bg}`}>
                <p className="text-[11px] text-slate-400 mb-1">{item.label}</p>
                <p className={`text-2xl font-bold tabular-nums ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* 筛选栏 */}
          <div className="mb-4 flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索任务名称 / 执行人..."
                className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-violet-300 focus:outline-none"
              />
            </div>
            {(["all", "in_progress", "completed", "ended"] as FilterStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilterStatus(s)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  filterStatus === s
                    ? "border-violet-300 bg-violet-50 text-violet-700"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {filterLabels[s]}
                {s !== "all" && (
                  <span className="ml-1.5 text-[11px] opacity-70 tabular-nums">
                    {s === "in_progress" ? inProgressCount : s === "completed" ? completedCount : endedCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* 任务列表 */}
          {loading ? (
            <div className="flex items-center justify-center py-24 text-slate-400 gap-2">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
              <GitBranch size={32} className="opacity-30" />
              <p className="text-sm">
                {tasks.length === 0 ? "暂无已发布的协同任务" : "没有符合条件的任务"}
              </p>
              {tasks.length === 0 && (
                <a
                  href="/tasks/collaboration/workflow"
                  className="mt-1 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
                >
                  去发布协同任务
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(({ task }) => (
                <TaskCard key={task.id} task={task} onViewDetail={setDetailTask} />
              ))}
            </div>
          )}
        </>
      )}

      {detailTask && (
        <DetailDrawer task={detailTask} onClose={() => setDetailTask(null)} />
      )}
    </div>
  );
}
