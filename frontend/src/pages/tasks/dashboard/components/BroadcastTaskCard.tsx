import { useRef, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Megaphone,
  Paperclip,
  X,
} from "lucide-react";
import {
  broadcastTaskApi,
  type BroadcastAnswer,
  type BroadcastQuestion,
  type BroadcastTaskForAnchor,
} from "../../../../services/broadcastTask";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDatetime(iso?: string | null) {
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

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
}
function fileNameFromUrl(url: string) {
  try {
    const parts = new URL(url).pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1] || url);
  } catch {
    return url.split("/").pop() ?? url;
  }
}

function questionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    QA: "问答", FILL_BLANK: "待办", SINGLE_CHOICE: "单选",
    MULTI_CHOICE: "多选", LINK: "链接确认", ATTACHMENT: "附件上传",
  };
  return labels[type] ?? type;
}

// ─── 单题填写行（逐题确认，与 WorkflowTaskCard.MyQuestionRow 同逻辑） ───────────

function QuestionRow({
  question,
  existingAnswer,
  taskId,
  disabled,
  onSaved,
}: {
  question: BroadcastQuestion & { id: string };
  existingAnswer?: BroadcastAnswer;
  taskId: string;
  disabled: boolean;
  onSaved: (completed: boolean) => void;
}) {
  const [text, setText] = useState(existingAnswer?.answerText ?? "");
  const [selected, setSelected] = useState<string[]>(existingAnswer?.answerOptions ?? []);
  const [confirmed, setConfirmed] = useState(existingAnswer?.isLinkConfirmed ?? false);
  const [attachments, setAttachments] = useState<{ url: string; name: string }[]>(
    (existingAnswer?.attachmentUrls ?? []).map((url) => ({ url, name: fileNameFromUrl(url) })),
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!existingAnswer);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isLocked = disabled || saved;

  function currentAnswer(): BroadcastAnswer {
    const base: BroadcastAnswer = { questionId: question.id };
    if (question.itemType === "QA" || question.itemType === "FILL_BLANK") return { ...base, answerText: text };
    if (question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") return { ...base, answerOptions: selected };
    if (question.itemType === "LINK") return { ...base, isLinkConfirmed: confirmed };
    if (question.itemType === "ATTACHMENT") return { ...base, attachmentUrls: attachments.map((a) => a.url) };
    return base;
  }

  function isAnswered() {
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
      const result = await broadcastTaskApi.saveAnswer(taskId, currentAnswer());
      setSaved(true);
      onSaved(result.recordCompleted);
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
    if (file.size > 20 * 1024 * 1024) { alert("文件不得超过 20MB"); return; }
    setUploading(true);
    try {
      // 复用 workflow 附件上传接口
      const { useAuthStore } = await import("../../../../stores/authStore");
      const { useIdentityStore } = await import("../../../../stores/identityStore");
      const token = useAuthStore.getState().token;
      const identityId = useIdentityStore.getState().currentIdentity?.id;
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch("/api/tasks/collaboration/workflows/attachments/upload", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(identityId ? { "X-Identity-Id": identityId } : {}),
        },
        body: form,
      });
      const body = await resp.json() as { success: boolean; data?: { fileUrl: string; fileName: string }; error?: { message?: string } };
      if (!body.success) throw new Error(body.error?.message ?? "上传失败");
      const { fileUrl, fileName } = body.data!;
      setAttachments((prev) => [...prev, { url: fileUrl, name: fileName }]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
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
        <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-50 text-orange-500">
          {questionTypeLabel(question.itemType)}
        </span>
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
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-orange-600 disabled:opacity-40"
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
                <span key={opt} className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-600">{opt}</span>
              ))}
              {!(selected.length || existingAnswer?.answerOptions?.length) && <span className="text-slate-300">未选择</span>}
            </div>
          )}
          {question.itemType === "LINK" && (confirmed || existingAnswer?.isLinkConfirmed) && (
            <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={11} />已确认完成</span>
          )}
          {question.itemType === "ATTACHMENT" && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(attachments.length ? attachments.map((a) => a.url) : existingAnswer?.attachmentUrls ?? []).map((url) =>
                isImageUrl(url) ? (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block h-16 w-16 overflow-hidden rounded-lg border border-slate-200">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </a>
                ) : (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-orange-600 hover:bg-orange-50">
                    <Paperclip size={10} /><span className="max-w-[120px] truncate">{fileNameFromUrl(url)}</span>
                  </a>
                )
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {(question.itemType === "QA" || question.itemType === "FILL_BLANK") && (
            <input
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs focus:border-orange-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-100"
              placeholder={question.itemType === "FILL_BLANK" ? "完成情况说明..." : "输入回答..."}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          {(question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") && question.options && (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((opt) => (
                <button key={opt} type="button"
                  onClick={() => {
                    const single = question.itemType === "SINGLE_CHOICE";
                    setSelected((prev) => single ? [opt] : prev.includes(opt) ? prev.filter((v) => v !== opt) : [...prev, opt]);
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition ${selected.includes(opt) ? "border-orange-300 bg-orange-50 font-medium text-orange-700" : "border-slate-200 text-slate-600 hover:border-orange-200"}`}
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
                    className="min-w-0 flex-1 truncate text-xs text-orange-600 hover:underline">{question.linkUrl}</a>
                  <button type="button" onClick={() => copyLink(question.linkUrl!)}
                    className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100">
                    {copied ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  </button>
                  <a href={question.linkUrl} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100"><ExternalLink size={12} /></a>
                </div>
              )}
              <button type="button" onClick={() => setConfirmed(true)}
                className={`rounded-lg border px-3 py-1 text-xs transition ${confirmed ? "border-emerald-300 bg-emerald-50 font-medium text-emerald-700" : "border-slate-200 text-slate-600 hover:border-orange-200"}`}>
                {confirmed ? "✓ 已确认完成" : "点击确认完成"}
              </button>
            </div>
          )}
          {question.itemType === "ATTACHMENT" && (
            <div className="space-y-1.5">
              {attachments.length > 0 && (
                <div className="space-y-1.5">
                  {attachments.filter((a) => isImageUrl(a.url)).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {attachments.filter((a) => isImageUrl(a.url)).map((att) => (
                        <div key={att.url} className="relative">
                          <img src={att.url} alt={att.name} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
                          <button type="button" onClick={() => setAttachments((p) => p.filter((a) => a.url !== att.url))}
                            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-400 text-white shadow">
                            <X size={8} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {attachments.filter((a) => !isImageUrl(a.url)).map((att) => (
                    <div key={att.url} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                      <Paperclip size={10} className="shrink-0 text-slate-400" />
                      <a href={att.url} target="_blank" rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate text-[11px] text-orange-600 hover:underline">{att.name}</a>
                      <button type="button" onClick={() => setAttachments((p) => p.filter((a) => a.url !== att.url))}
                        className="shrink-0 text-slate-300 hover:text-red-400"><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={fileRef} type="file" className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.mov" onChange={handleFileChange} />
              <button type="button" disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-orange-200 bg-orange-50/60 px-3 py-1.5 text-xs text-orange-500 transition hover:border-orange-400 hover:bg-orange-50 disabled:opacity-50">
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

// ─── 主卡片 ───────────────────────────────────────────────────────────────────

interface Props {
  task: BroadcastTaskForAnchor;
  onRefresh: () => void;
}

export function BroadcastTaskCard({ task, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  const rec = task.myRecord;
  const dueInfo = formatDueAt(task.dueAt);
  const overdue = dueInfo?.overdue ?? false;

  const isSubmitted = rec.status === "submitted";
  const isOverdue = rec.status === "overdue" || overdue;

  // 答题进度
  const answeredCount = task.questions.filter((q) => {
    const ans = rec.answers?.find((a) => a.questionId === q.id);
    if (!ans) return false;
    return (
      (ans.answerOptions?.length ?? 0) > 0 ||
      !!ans.answerText?.trim() ||
      ans.isLinkConfirmed ||
      (ans.attachmentUrls?.length ?? 0) > 0
    );
  }).length;
  const totalCount = task.questions.length;
  const progressPct = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;

  const borderLeft = isSubmitted
    ? "border-l-emerald-400"
    : isOverdue
    ? "border-l-red-400"
    : "border-l-orange-400";

  const accentGradient = isSubmitted
    ? "from-emerald-400 to-teal-400"
    : isOverdue
    ? "from-red-400 to-rose-400"
    : "from-orange-400 to-amber-400";

  function handleQuestionSaved(completed: boolean) {
    if (completed) onRefresh();
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-l-[3px] border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] transition hover:shadow-[0_4px_20px_rgba(15,23,42,0.09)] ${borderLeft}`}>
      {/* 顶部进度条 */}
      <div className="h-0.5 w-full bg-slate-100">
        <div className={`h-full bg-gradient-to-r transition-all ${accentGradient}`} style={{ width: `${progressPct}%` }} />
      </div>

      {/* 卡片头 */}
      <button
        type="button"
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-slate-50/80"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* 圆形进度 */}
        <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center">
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#f1f5f9" strokeWidth="3" />
            <circle cx="18" cy="18" r="15" fill="none"
              stroke={isSubmitted ? "#34d399" : isOverdue ? "#f87171" : "#fb923c"}
              strokeWidth="3"
              strokeDasharray={`${progressPct * 0.942} 94.2`}
              strokeLinecap="round"
            />
          </svg>
          <Megaphone size={13} className={isSubmitted ? "text-emerald-500" : isOverdue ? "text-red-400" : "text-orange-400"} />
        </div>

        <div className="min-w-0 flex-1">
          {/* 行1：状态 + 标题 */}
          <div className="flex min-w-0 items-center gap-1.5">
            {isSubmitted ? (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                <CheckCircle2 size={9} />已完成
              </span>
            ) : isOverdue ? (
              <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500">已逾期</span>
            ) : (
              <span className="shrink-0 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-500">待完成</span>
            )}
            <p className="min-w-0 truncate text-[15px] font-bold text-slate-800">{task.title}</p>
          </div>

          {/* 行2：发布人 · 厅 · 截止时间 */}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
            <span className="shrink-0">{task.createdByName} · {task.hallOrgName}</span>
            <span className="shrink-0">·</span>
            {dueInfo ? (
              <span className={`flex shrink-0 items-center gap-0.5 font-medium ${dueInfo.overdue ? "text-red-500" : "text-slate-500"}`}>
                <CalendarClock size={10} />截止 {dueInfo.dateStr}
                {!dueInfo.overdue && <span className="ml-0.5 text-slate-400">({dueInfo.label})</span>}
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-0.5"><CalendarClock size={10} />无截止时间</span>
            )}
            {rec.submittedAt && (
              <>
                <span className="shrink-0">·</span>
                <span className="flex shrink-0 items-center gap-0.5 text-emerald-600">
                  <Clock size={10} />完成于 {formatDatetime(rec.submittedAt)}
                </span>
              </>
            )}
          </div>

          {/* 行3：题目进度胶囊 */}
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="h-1 w-24 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full bg-gradient-to-r transition-all ${accentGradient}`} style={{ width: `${progressPct}%` }} />
            </div>
            <span className={`text-[10px] font-medium tabular-nums ${isSubmitted ? "text-emerald-600" : "text-orange-500"}`}>
              {answeredCount}/{totalCount} 题
            </span>
          </div>
        </div>

        <div className="mt-1 shrink-0 text-slate-300">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/50 px-3.5 py-3">
          {/* 描述 */}
          {task.description && (
            <p className="rounded-xl bg-white/80 px-3 py-2 text-xs leading-5 text-slate-500">
              <span className="font-medium text-slate-600">说明：</span>{task.description}
            </p>
          )}

          {/* 逾期 / 完成提示 */}
          {isSubmitted && (
            <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              <CheckCircle2 size={13} />
              已于 {formatDatetime(rec.submittedAt)} 完成所有题目
            </div>
          )}
          {isOverdue && !isSubmitted && (
            <div className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
              <CalendarClock size={13} />
              任务已超截止时间，无法继续填写
            </div>
          )}

          {/* 题目列表 */}
          <div className="space-y-1.5">
            {task.questions.map((q) => (
              <QuestionRow
                key={q.id as string}
                question={q as BroadcastQuestion & { id: string }}
                existingAnswer={rec.answers?.find((a) => a.questionId === q.id)}
                taskId={task.id}
                disabled={isSubmitted || isOverdue}
                onSaved={handleQuestionSaved}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
