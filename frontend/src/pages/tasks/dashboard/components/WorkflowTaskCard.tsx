import { useRef, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Image,
  Loader2,
  Lock,
  Paperclip,
  Play,
  User,
  UserRound,
  X,
} from "lucide-react";
import type { WorkflowMyTask, WorkflowMyTaskStep, WorkflowStepAnswer } from "../../../../services/workflowTask";
import { workflowTaskApi } from "../../../../services/workflowTask";

// ─────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────

function formatDatetime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hh}:${mm}`;
}

function formatDueAt(dueAt?: string | null) {
  if (!dueAt) return null;
  const date = new Date(dueAt);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const dateStr = formatDatetime(dueAt);
  if (diff < 0) return { label: "已逾期", dateStr, overdue: true };
  if (days === 0) return { label: `${hours}h 后截止`, dateStr, overdue: false };
  return { label: `${days}天后截止`, dateStr, overdue: false };
}

function isTaskOverdue(dueAt?: string | null) {
  if (!dueAt) return false;
  return new Date(dueAt) < new Date();
}

function questionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    FILL_BLANK: "待办",
    SINGLE_CHOICE: "单选",
    MULTI_CHOICE: "多选",
    QA: "问答",
    LINK: "链接",
    ATTACHMENT: "附件",
  };
  return labels[type] ?? type;
}

/** 判断 URL 是否是图片 */
function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
}

/** 判断 URL 是否是视频 */
function isVideoUrl(url: string) {
  return /\.(mp4|mov|avi|mkv|webm)(\?.*)?$/i.test(url);
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

// ─────────────────────────────────────────────────────────────────
// 附件展示组件（只读，支持图片预览 / 文档下载 / 视频）
// ─────────────────────────────────────────────────────────────────

function AttachmentItem({ url }: { url: string }) {
  const name = fileNameFromUrl(url);
  const isImg = isImageUrl(url);
  const isVid = isVideoUrl(url);

  if (isImg) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="group relative block overflow-hidden rounded-lg border border-slate-200"
        style={{ width: 72, height: 72 }}
        title={name}
      >
        <img src={url} alt={name} className="h-full w-full object-cover transition group-hover:opacity-80" />
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-black/40 py-0.5 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
          <ExternalLink size={8} />查看
        </span>
      </a>
    );
  }

  if (isVid) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition"
        title={name}
      >
        <Play size={11} className="shrink-0 text-indigo-400" />
        <span className="max-w-[140px] truncate">{name}</span>
        <ExternalLink size={9} className="shrink-0 text-slate-300" />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition"
      title={name}
    >
      {name.match(/\.(pdf)$/i) ? (
        <FileText size={11} className="shrink-0 text-red-400" />
      ) : name.match(/\.(doc|docx)$/i) ? (
        <FileText size={11} className="shrink-0 text-blue-400" />
      ) : name.match(/\.(xls|xlsx)$/i) ? (
        <FileText size={11} className="shrink-0 text-emerald-500" />
      ) : (
        <Paperclip size={11} className="shrink-0 text-slate-400" />
      )}
      <span className="max-w-[140px] truncate">{name}</span>
      <ExternalLink size={9} className="shrink-0 text-slate-300" />
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────
// 只读答案展示（用于他人节点 & 自己已完成节点）
// ─────────────────────────────────────────────────────────────────

function ReadonlyAnswer({
  question,
  answer,
  pendingName,
}: {
  question: WorkflowMyTaskStep["questions"][number];
  answer?: WorkflowStepAnswer;
  pendingName?: string;
}) {
  const hasAnswer =
    answer &&
    ((answer.answerOptions?.length ?? 0) > 0 ||
      !!answer.answerText?.trim() ||
      answer.isLinkConfirmed ||
      (answer.attachmentUrls?.length ?? 0) > 0);

  return (
    <div className="rounded-lg bg-white/80 px-2.5 py-2 text-[11px]">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
          {questionTypeLabel(question.itemType)}
        </span>
        <p className="font-medium text-slate-600">{question.title}</p>
        {question.isRequired && !hasAnswer && (
          <span className="ml-auto shrink-0 text-[9px] text-red-300">必填</span>
        )}
      </div>

      {hasAnswer ? (
        <>
          {(question.itemType === "QA" || question.itemType === "FILL_BLANK") && (
            <p className="text-slate-700 leading-relaxed">{answer!.answerText}</p>
          )}
          {(question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") && (
            <div className="flex flex-wrap gap-1">
              {answer!.answerOptions?.map((opt) => (
                <span key={opt} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                  {opt}
                </span>
              ))}
            </div>
          )}
          {question.itemType === "LINK" && answer!.isLinkConfirmed && (
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 size={11} />已确认完成
            </span>
          )}
          {question.itemType === "ATTACHMENT" && (answer!.attachmentUrls?.length ?? 0) > 0 && (
            <div className="mt-1.5">
              {/* 图片统一展示在图片网格 */}
              {answer!.attachmentUrls!.some(isImageUrl) && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {answer!.attachmentUrls!.filter(isImageUrl).map((url) => (
                    <AttachmentItem key={url} url={url} />
                  ))}
                </div>
              )}
              {/* 非图片文件列表 */}
              {answer!.attachmentUrls!.filter((u) => !isImageUrl(u)).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {answer!.attachmentUrls!.filter((u) => !isImageUrl(u)).map((url) => (
                    <AttachmentItem key={url} url={url} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="flex items-center gap-1 text-slate-300 mt-0.5">
          <Lock size={9} />
          {pendingName ? `等待 ${pendingName} 填写` : "暂未填写"}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 我的节点：单题填写行（右上角"确认"按钮逐题提交）
// ─────────────────────────────────────────────────────────────────

function MyQuestionRow({
  question,
  existingAnswer,
  taskId,
  stepId,
  disabled,
  onSaved,
}: {
  question: WorkflowMyTaskStep["questions"][number];
  existingAnswer?: WorkflowStepAnswer;
  taskId: string;
  stepId: string;
  disabled: boolean;
  onSaved: (stepCompleted: boolean) => void;
}) {
  const [text, setText] = useState(existingAnswer?.answerText ?? "");
  const [selected, setSelected] = useState<string[]>(existingAnswer?.answerOptions ?? []);
  const [confirmed, setConfirmed] = useState(existingAnswer?.isLinkConfirmed ?? false);
  const [attachments, setAttachments] = useState<{ url: string; name: string }[]>(
    (existingAnswer?.attachmentUrls ?? []).map((url) => ({ url, name: fileNameFromUrl(url) }))
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!existingAnswer);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLocked = disabled || saved;
  const typeColor = "bg-indigo-50 text-indigo-500";

  function currentAnswer(): WorkflowStepAnswer {
    const base: WorkflowStepAnswer = { questionId: question.id ?? "" };
    if (question.itemType === "QA" || question.itemType === "FILL_BLANK") return { ...base, answerText: text };
    if (question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") return { ...base, answerOptions: selected };
    if (question.itemType === "LINK") return { ...base, isLinkConfirmed: confirmed };
    if (question.itemType === "ATTACHMENT") return { ...base, attachmentUrls: attachments.map((a) => a.url) };
    return base;
  }

  function isAnswered(): boolean {
    if (question.itemType === "QA" || question.itemType === "FILL_BLANK") return !!text.trim();
    if (question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") return selected.length > 0;
    if (question.itemType === "LINK") return confirmed;
    if (question.itemType === "ATTACHMENT") return attachments.length > 0;
    return false;
  }

  async function handleSave() {
    if (question.isRequired && !isAnswered()) {
      alert(`请先填写：${question.title}`);
      return;
    }
    setSaving(true);
    try {
      const result = await workflowTaskApi.saveAnswer(taskId, stepId, currentAnswer());
      setSaved(true);
      onSaved(result.stepCompleted);
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    try {
      const result = await workflowTaskApi.uploadAttachment(file);
      setAttachments((prev) => [...prev, { url: result.fileUrl, name: result.fileName }]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(url: string) {
    setAttachments((prev) => prev.filter((a) => a.url !== url));
  }

  function copyLink(url: string) {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={`rounded-xl border p-2.5 transition-all ${saved ? "border-emerald-100 bg-emerald-50/30" : "border-slate-100 bg-white"}`}>
      <div className="mb-2 flex items-start gap-1.5">
        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${typeColor}`}>{questionTypeLabel(question.itemType)}</span>
        <span className="flex-1 text-xs font-medium text-slate-700">{question.title}</span>
        {question.isRequired && !saved && <span className="shrink-0 text-[10px] text-red-400">*</span>}
        {saved ? (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            <CheckCircle2 size={9} />已确认
          </span>
        ) : !disabled && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !isAnswered()}
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-indigo-600 disabled:opacity-40"
          >
            {saving ? <Loader2 size={9} className="animate-spin" /> : <CheckCircle2 size={9} />}
            {saving ? "保存中" : "确认"}
          </button>
        )}
      </div>

      {isLocked ? (
        <div className="text-xs text-slate-500">
          {(question.itemType === "QA" || question.itemType === "FILL_BLANK") && (
            <span className="text-slate-700">{text || existingAnswer?.answerText || <span className="text-slate-300">未填写</span>}</span>
          )}
          {(question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") && (
            <div className="flex flex-wrap gap-1">
              {(selected.length ? selected : existingAnswer?.answerOptions ?? []).map((opt) => (
                <span key={opt} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">{opt}</span>
              ))}
              {!(selected.length || existingAnswer?.answerOptions?.length) && <span className="text-slate-300">未选择</span>}
            </div>
          )}
          {question.itemType === "LINK" && (confirmed || existingAnswer?.isLinkConfirmed) && (
            <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={11} />已确认完成</span>
          )}
          {question.itemType === "ATTACHMENT" && (
            <div className="mt-1">
              {/* 图片预览 */}
              {(attachments.length ? attachments.map((a) => a.url) : existingAnswer?.attachmentUrls ?? [])
                .filter(isImageUrl).length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {(attachments.length ? attachments.map((a) => a.url) : existingAnswer?.attachmentUrls ?? [])
                    .filter(isImageUrl)
                    .map((url) => <AttachmentItem key={url} url={url} />)}
                </div>
              )}
              {/* 非图片 */}
              <div className="flex flex-wrap gap-1.5">
                {(attachments.length ? attachments.map((a) => a.url) : existingAnswer?.attachmentUrls ?? [])
                  .filter((u) => !isImageUrl(u))
                  .map((url) => <AttachmentItem key={url} url={url} />)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {(question.itemType === "QA" || question.itemType === "FILL_BLANK") && (
            <input
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
              placeholder={question.itemType === "FILL_BLANK" ? "完成情况说明..." : "输入回答..."}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          {(question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") && question.options && (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    const single = question.itemType === "SINGLE_CHOICE";
                    setSelected((prev) => single ? [opt] : prev.includes(opt) ? prev.filter((v) => v !== opt) : [...prev, opt]);
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition ${selected.includes(opt) ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700" : "border-slate-200 text-slate-600 hover:border-indigo-200"}`}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          {question.itemType === "LINK" && (
            <div className="space-y-1.5">
              {question.linkUrl && (
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <a href={question.linkUrl} target="_blank" rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-xs text-indigo-600 hover:underline"
                    onClick={(e) => e.stopPropagation()}>{question.linkUrl}</a>
                  <button type="button" onClick={(e) => { e.stopPropagation(); copyLink(question.linkUrl!); }}
                    className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100" title="复制链接">
                    {copied ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  </button>
                  <a href={question.linkUrl} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100" title="新标签页打开"
                    onClick={(e) => e.stopPropagation()}><ExternalLink size={12} /></a>
                </div>
              )}
              <button type="button" onClick={() => setConfirmed(true)}
                className={`rounded-lg border px-3 py-1 text-xs transition ${confirmed ? "border-emerald-300 bg-emerald-50 font-medium text-emerald-700" : "border-slate-200 text-slate-600 hover:border-indigo-200"}`}>
                {confirmed ? "✓ 已确认完成" : "点击确认完成"}
              </button>
            </div>
          )}
          {question.itemType === "ATTACHMENT" && (
            <div className="space-y-1.5">
              {attachments.length > 0 && (
                <div className="space-y-1.5">
                  {/* 图片预览网格 */}
                  {attachments.filter((a) => isImageUrl(a.url)).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {attachments.filter((a) => isImageUrl(a.url)).map((att) => (
                        <div key={att.url} className="relative">
                          <img src={att.url} alt={att.name}
                            className="h-[72px] w-[72px] rounded-lg border border-slate-200 object-cover" />
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); removeAttachment(att.url); }}
                            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-400 text-white shadow hover:bg-red-500">
                            <X size={8} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 非图片文件列表 */}
                  {attachments.filter((a) => !isImageUrl(a.url)).map((att) => (
                    <div key={att.url} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                      <Paperclip size={10} className="shrink-0 text-slate-400" />
                      <a href={att.url} target="_blank" rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate text-[11px] text-indigo-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}>{att.name}</a>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removeAttachment(att.url); }}
                        className="shrink-0 text-slate-300 transition hover:text-red-400"><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={fileInputRef} type="file" className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.mov" onChange={handleFileChange} />
              <button type="button" disabled={uploading}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/60 px-3 py-1.5 text-xs text-indigo-500 transition hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50">
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
                {uploading ? "上传中..." : "点击上传附件"}
              </button>
              <p className="text-[10px] text-slate-400">支持图片、PDF、Office 文档、视频，单文件最大 20MB</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 我的节点区块
// ─────────────────────────────────────────────────────────────────

function MyStepBlock({
  step,
  taskId,
  isOverdue,
  onRefresh,
}: {
  step: WorkflowMyTaskStep;
  taskId: string;
  isOverdue: boolean;
  onRefresh: () => void;
}) {
  const isSubmitted = step.status === "completed";
  const isLocked = isSubmitted || isOverdue;
  const [confirmedCount, setConfirmedCount] = useState(step.stepAnswers?.length ?? 0);
  const totalCount = step.questions.length;

  function getExistingAnswer(questionId: string) {
    return step.stepAnswers?.find((a) => a.questionId === questionId);
  }

  function handleQuestionSaved(stepCompleted: boolean) {
    setConfirmedCount((prev) => Math.min(prev + 1, totalCount));
    if (stepCompleted) onRefresh();
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">{step.order}</span>
        <span className="flex-1 text-xs font-semibold text-slate-800">{step.title}</span>
        <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">我的节点</span>
        {isSubmitted && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">已完成</span>}
        {!isSubmitted && isOverdue && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">已逾期</span>}
        {!isSubmitted && !isOverdue && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
            已确认 {confirmedCount}/{totalCount}
          </span>
        )}
      </div>

      {step.requirement && (
        <p className="mb-2 text-[11px] leading-4 text-slate-500">{step.requirement}</p>
      )}

      {isSubmitted && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
          <CheckCircle2 size={11} />
          已于 {formatDatetime(step.submittedAt)} 完成
        </div>
      )}

      {isOverdue && !isSubmitted && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600">
          <Lock size={11} />已超截止时间，节点锁定
        </div>
      )}

      <div className="space-y-1.5">
        {step.questions.map((q) => (
          <MyQuestionRow
            key={q.id}
            question={q}
            existingAnswer={getExistingAnswer(q.id ?? "")}
            taskId={taskId}
            stepId={step.id}
            disabled={isLocked}
            onSaved={handleQuestionSaved}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 他人节点区块（只读，展示题目+答案）
// ─────────────────────────────────────────────────────────────────

function OtherStepBlock({ step }: { step: WorkflowMyTaskStep }) {
  const [expanded, setExpanded] = useState(false);
  const isCompleted = step.status === "completed";
  const answeredCount = step.questions.filter((q) => {
    const ans = step.stepAnswers?.find((a) => a.questionId === q.id);
    return ans && (
      (ans.answerOptions?.length ?? 0) > 0 ||
      !!ans.answerText?.trim() ||
      ans.isLinkConfirmed ||
      (ans.attachmentUrls?.length ?? 0) > 0
    );
  }).length;
  const totalCount = step.questions.length;

  return (
    <div className={`rounded-xl border p-3 transition ${isCompleted ? "border-emerald-100 bg-emerald-50/20" : "border-slate-100 bg-slate-50/40"}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${isCompleted ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
          {step.order}
        </span>
        <span className="flex-1 text-xs font-medium text-slate-700">{step.title}</span>
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-slate-500">
          <User size={10} />{step.assigneeName}
        </span>
        {/* 完成 x/n 项进度 */}
        {totalCount > 0 && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            isCompleted
              ? "bg-emerald-100 text-emerald-700"
              : answeredCount > 0
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-100 text-slate-400"
          }`}>
            {answeredCount}/{totalCount} 项
          </span>
        )}
        {isCompleted ? (
          <CheckCircle2 size={13} className="shrink-0 text-emerald-500" />
        ) : (
          <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">待完成</span>
        )}
        {expanded ? <ChevronUp size={11} className="shrink-0 text-slate-300" /> : <ChevronDown size={11} className="shrink-0 text-slate-300" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 pl-7">
          {step.requirement && (
            <p className="mb-1 text-[11px] leading-relaxed text-slate-400">{step.requirement}</p>
          )}
          {step.questions.length > 0 ? (
            step.questions.map((q) => (
              <ReadonlyAnswer
                key={q.id}
                question={q}
                answer={step.stepAnswers?.find((a) => a.questionId === q.id)}
                pendingName={step.assigneeName}
              />
            ))
          ) : (
            <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-400">暂无问题</div>
          )}
          {step.submittedAt && (
            <p className="text-[10px] text-slate-300">完成于 {formatDatetime(step.submittedAt)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 主卡片组件
// ─────────────────────────────────────────────────────────────────

interface WorkflowTaskCardProps {
  task: WorkflowMyTask;
  currentUserId: string;
  onRefresh: () => void;
}

export function WorkflowTaskCard({ task, currentUserId, onRefresh }: WorkflowTaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const overdue = isTaskOverdue(task.dueAt);
  const dueInfo = formatDueAt(task.dueAt);
  const completedSteps = task.steps.filter((s) => s.status === "completed").length;
  const totalSteps = task.steps.length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const mySteps = task.steps.filter((s) => s.assigneeUserId === currentUserId);
  const myActiveSteps = mySteps.filter((s) => s.status === "active");
  const myPendingCount = myActiveSteps.length;
  const iMyAllDone = mySteps.length > 0 && mySteps.every((s) => s.status === "completed");
  const isAllDone = task.status === "completed";

  const accentColor = isAllDone
    ? "from-emerald-400 to-teal-400"
    : overdue
    ? "from-red-400 to-rose-400"
    : myPendingCount > 0
    ? "from-indigo-500 to-violet-500"
    : "from-slate-300 to-slate-400";

  const borderLeft = isAllDone
    ? "border-l-emerald-400"
    : overdue
    ? "border-l-red-400"
    : myPendingCount > 0
    ? "border-l-indigo-400"
    : "border-l-slate-300";

  return (
    <div className={`overflow-hidden rounded-2xl border border-l-[3px] border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] transition hover:shadow-[0_4px_20px_rgba(15,23,42,0.09)] ${borderLeft}`}>
      {/* 顶部进度条 */}
      <div className="h-0.5 w-full bg-slate-100">
        <div className={`h-full bg-gradient-to-r transition-all ${accentColor}`} style={{ width: `${progressPct}%` }} />
      </div>

      {/* 卡片头部 */}
      <button
        type="button"
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-slate-50/80"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* 左侧圆形进度 */}
        <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center">
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#f1f5f9" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15" fill="none"
              stroke={isAllDone ? "#34d399" : overdue ? "#f87171" : "#818cf8"}
              strokeWidth="3"
              strokeDasharray={`${progressPct * 0.942} 94.2`}
              strokeLinecap="round"
            />
          </svg>
          <span className="text-[10px] font-bold text-slate-600">{completedSteps}/{totalSteps}</span>
        </div>

        <div className="min-w-0 flex-1">
          {/* 行1：状态标签 + 任务标题 */}
          <div className="flex min-w-0 items-center gap-1.5">
            {mySteps.length > 0 && (
              iMyAllDone ? (
                <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                  <CheckCircle2 size={9} />我已完成
                </span>
              ) : myPendingCount > 0 ? (
                <span className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-white">待我填写</span>
              ) : (
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">我未完成</span>
              )
            )}
            {isAllDone ? (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                <CheckCircle2 size={9} />全员完成
              </span>
            ) : overdue ? (
              <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500">已逾期</span>
            ) : (
              <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-500">进行中</span>
            )}
            <p className="min-w-0 truncate text-[15px] font-bold text-slate-800">{task.title}</p>
          </div>

          {/* 行2：发起时间 · 截止时间 · 发布人 */}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
            <span className="flex shrink-0 items-center gap-0.5">
              <Clock size={10} />发起 {formatDatetime(task.createdAt)}
            </span>
            <span className="shrink-0">·</span>
            {dueInfo ? (
              <span className={`flex shrink-0 items-center gap-0.5 font-medium ${dueInfo.overdue ? "text-red-500" : "text-slate-500"}`}>
                <CalendarClock size={10} />截止 {dueInfo.dateStr}
                {!dueInfo.overdue && <span className="ml-0.5 text-slate-400">({dueInfo.label})</span>}
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-0.5 text-slate-400">
                <CalendarClock size={10} />无截止时间
              </span>
            )}
            <span className="shrink-0">·</span>
            <span className="flex shrink-0 items-center gap-0.5 font-medium text-slate-500">
              <UserRound size={10} />{task.createdByName}
            </span>
          </div>

          {/* 行3：各节点细化进度 */}
          <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
            {task.steps.map((step) => {
              const isMe = step.assigneeUserId === currentUserId;
              const answered = step.questions.filter((q) => {
                const ans = step.stepAnswers?.find((a) => a.questionId === q.id);
                return ans && (
                  (ans.answerOptions?.length ?? 0) > 0 ||
                  !!ans.answerText?.trim() ||
                  ans.isLinkConfirmed ||
                  (ans.attachmentUrls?.length ?? 0) > 0
                );
              }).length;
              const total = step.questions.length;
              const stepDone = step.status === "completed";

              return (
                <div
                  key={step.id}
                  title={`${step.title} · ${step.assigneeName}（${answered}/${total} 项）`}
                  className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                    stepDone
                      ? "bg-emerald-50 text-emerald-600"
                      : isMe
                      ? "bg-amber-50 text-amber-600"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                    stepDone ? "bg-emerald-400 text-white" : isMe ? "bg-amber-400 text-white" : "bg-slate-300 text-white"
                  }`}>
                    {step.order}
                  </span>
                  <span className="max-w-[48px] truncate font-medium">{step.title}</span>
                  <span className="shrink-0 text-slate-400">·</span>
                  <span className="shrink-0">{step.assigneeName}</span>
                  {total > 0 && (
                    <>
                      <span className="shrink-0 text-slate-300">·</span>
                      <span className={`shrink-0 font-medium ${stepDone ? "text-emerald-600" : answered > 0 ? "text-amber-600" : "text-slate-400"}`}>
                        {answered}/{total}项
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-1 shrink-0 text-slate-300">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/50 px-3.5 py-3">
          {task.description && (
            <p className="rounded-xl bg-white/80 px-3 py-2 text-xs leading-5 text-slate-500">
              <span className="font-medium text-slate-600">说明：</span>{task.description}
            </p>
          )}
          <div className="space-y-2">
            {task.steps.map((step) =>
              step.assigneeUserId === currentUserId ? (
                <MyStepBlock
                  key={step.id}
                  step={step}
                  taskId={task.id}
                  isOverdue={overdue}
                  onRefresh={onRefresh}
                />
              ) : (
                <OtherStepBlock key={step.id} step={step} />
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
