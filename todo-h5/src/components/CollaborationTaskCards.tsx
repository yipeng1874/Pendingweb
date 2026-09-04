import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Paperclip } from "lucide-react";
import { taskApi } from "../services/task";
import type { BroadcastTask, CollaborationAnswer, CollaborationQuestion, WorkflowTask } from "../types";
import { formatImageSize, prepareTaskImage } from "../utils/imageCompression";
import { hasCollaborationAnswer, isPastDeadline, learningLink, workflowEditingReason } from "../utils/taskFilling";

const labels: Record<string, string> = { QA: "问答", FILL_BLANK: "完成说明", SINGLE_CHOICE: "单选", MULTI_CHOICE: "多选", LINK: "链接确认", ATTACHMENT: "附件" };
const fileUrl = (url: string) => url.startsWith("/uploads/") ? `/api${url}` : url;
const fileName = (url: string) => { try { return decodeURIComponent(url.split("/").pop()?.split("?")[0] || "附件"); } catch { return "附件"; } };

function AnswerFiles({ urls }: { urls: string[] }) {
  return <div className="collaboration-files">{urls.map((url) => <a key={url} href={fileUrl(url)} target="_blank" rel="noreferrer">{/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url) ? <img src={fileUrl(url)} alt={fileName(url)} /> : <Paperclip size={16} />}<span>{fileName(url)}</span></a>)}</div>;
}

function useTaskSave<T>(onUpdate: (task: T) => void) {
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  async function save(request: () => Promise<T>) {
    if (busy.current) throw new Error("上一题正在保存，请稍后再试");
    busy.current = true;
    setSaving(true);
    try { onUpdate(await request()); }
    finally { busy.current = false; setSaving(false); }
  }
  return { saving, save };
}

function QuestionEditor({ question, answer, order, lockedReason, onSave, taskSaving }: {
  question: CollaborationQuestion; answer?: CollaborationAnswer; order: number;
  taskSaving: boolean;
  lockedReason: () => string; onSave: (answer: CollaborationAnswer) => Promise<void>;
}) {
  const [text, setText] = useState(answer?.answerText ?? "");
  const [options, setOptions] = useState<string[]>(answer?.answerOptions ?? []);
  const [confirmed, setConfirmed] = useState(Boolean(answer?.isLinkConfirmed));
  const [urls, setUrls] = useState<string[]>(answer?.attachmentUrls ?? []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ file: File; url: string; originalSize: number } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const reason = lockedReason();
  const saved = Boolean(answer);
  const locked = Boolean(reason) || saved;
  const link = learningLink(question.linkUrl);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    if (!answer) return;
    setText(answer.answerText ?? ""); setOptions(answer.answerOptions ?? []);
    setConfirmed(Boolean(answer.isLinkConfirmed)); setUrls(answer.attachmentUrls ?? []);
  }, [answer]);
  const currentAnswer: CollaborationAnswer = {
    questionId: question.id,
    ...(question.itemType === "QA" || question.itemType === "FILL_BLANK" ? { answerText: text.trim() } : {}),
    ...(question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE" ? { answerOptions: options } : {}),
    ...(question.itemType === "LINK" ? { isLinkConfirmed: confirmed } : {}),
    ...(question.itemType === "ATTACHMENT" ? { attachmentUrls: urls } : {}),
  };

  async function save() {
    const latestReason = lockedReason();
    if (busy.current || saved || taskSaving) return;
    if (latestReason) { setError(latestReason); return; }
    if (!hasCollaborationAnswer(question, currentAnswer)) return;
    busy.current = true; setSaving(true); setError("");
    try { await onSave(currentAnswer); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "保存失败，请重试"); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  }

  async function sendFile(file: File) {
    if (lockedReason()) throw new Error(lockedReason());
    const result = await taskApi.uploadCollaborationAttachment(file);
    if (mounted.current) { setUrls((current) => [...current, result.fileUrl]); setPreview(null); }
  }

  async function selectFile(file?: File) {
    if (!file || busy.current || locked) return;
    busy.current = true; setUploading(true); setError(""); setPreview(null);
    try {
      const image = file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
      const prepared = image && file.type !== "image/gif" && !/\.gif$/i.test(file.name) ? await prepareTaskImage(file) : file;
      if (!mounted.current) return;
      if (prepared.size > 20 * 1024 * 1024) throw new Error("附件不得超过20MB");
      // Retain the prepared file on upload errors, allowing a retry.
      setPreview({ file: prepared, url: URL.createObjectURL(prepared), originalSize: file.size });
      if (prepared === file) await sendFile(prepared);
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "附件处理失败"); }
    finally { busy.current = false; if (mounted.current) setUploading(false); }
  }

  async function uploadPreview() {
    if (!preview || busy.current || locked) return;
    busy.current = true; setUploading(true); setError("");
    try { await sendFile(preview.file); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "上传失败，请重试"); }
    finally { busy.current = false; if (mounted.current) setUploading(false); }
  }

  return <div className="detail-item collaboration-question">
    <div className="collaboration-question-title"><span className="detail-item-kind"><span className="detail-item-order">{order}</span><span>{labels[question.itemType]}</span></span><strong>{question.isRequired ? <span className="detail-item-required" aria-label="必填">*</span> : null}{question.title}</strong>{saved ? <span className="tag tag-green">已确认</span> : null}</div>
    {locked ? <div className="collaboration-readonly">{question.itemType === "ATTACHMENT" && urls.length ? <AnswerFiles urls={urls} /> : <span>{question.itemType === "LINK" ? (confirmed ? "已完成学习并确认" : "未确认") : question.itemType.includes("CHOICE") ? options.join("、") || "未填写" : text || "未填写"}</span>}</div> : <fieldset className="collaboration-controls" disabled={saving || uploading || taskSaving}>
      {question.itemType === "QA" || question.itemType === "FILL_BLANK" ? <div className="detail-answer-form"><textarea className="input" aria-label={question.title} rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder={question.itemType === "FILL_BLANK" ? "请填写完成情况说明" : "请输入回答"} /></div> : null}
      {question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE" ? <div className="list">{question.options?.map((option) => <button key={option} type="button" aria-pressed={options.includes(option)} className={`btn ${options.includes(option) ? "btn-primary" : "btn-ghost"}`} onClick={() => setOptions((current) => question.itemType === "SINGLE_CHOICE" ? [option] : current.includes(option) ? current.filter((value) => value !== option) : [...current, option])}>{option}</button>)}</div> : null}
      {question.itemType === "LINK" ? <div className="list">{link ? <a className="btn btn-ghost" href={link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> 打开学习链接</a> : <span className="error">学习链接未配置或格式无效</span>}<label className="collaboration-link-confirm"><input type="checkbox" checked={confirmed} disabled={!link} onChange={(event) => setConfirmed(event.target.checked)} />我已查看并完成学习</label></div> : null}
      {question.itemType === "ATTACHMENT" ? <div className="list"><AnswerFiles urls={urls} />{urls.map((url, index) => <button className="btn btn-ghost" key={url} type="button" onClick={() => setUrls((current) => current.filter((value) => value !== url))}>移除附件 {index + 1}</button>)}<input ref={input} type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.mov" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void selectFile(file); }} /><button className="btn btn-ghost" type="button" onClick={() => input.current?.click()}>{uploading ? "正在处理附件…" : "拍照 / 选择附件"}</button><span className="section-note">静态图片超过1MB自动压缩；附件上限20MB。上传后请确认本题。</span>{preview ? <div className="upload-image-preview"><strong>上传前预览 · {formatImageSize(preview.originalSize)} → {formatImageSize(preview.file.size)}</strong>{preview.file.type.startsWith("image/") ? <a href={preview.url} target="_blank" rel="noreferrer"><img src={preview.url} alt="待上传图片预览" /></a> : <span>{preview.file.name}</span>}<div className="action-row"><button className="btn btn-ghost" type="button" onClick={() => setPreview(null)}>取消</button><button className="btn btn-primary" type="button" onClick={() => void uploadPreview()}>确认并上传</button></div></div> : null}</div> : null}
      <button className="btn btn-primary" type="button" disabled={!hasCollaborationAnswer(question, currentAnswer) || Boolean(preview)} onClick={() => void save()}>{saving ? "保存中…" : "确认本题"}</button>
    </fieldset>}
    {error ? <div className="error" role="alert">{error}</div> : null}
  </div>;
}

export function WorkflowCard({ task, currentUserId, onUpdate, readOnly = false }: { task: WorkflowTask; currentUserId?: string; readOnly?: boolean; onUpdate: (task: WorkflowTask) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [busyStep, setBusyStep] = useState("");
  const [error, setError] = useState("");
  const taskSave = useTaskSave(onUpdate);
  const mySteps = task.steps.filter((step) => step.assigneeUserId === currentUserId);
  const done = task.status === "completed" || (mySteps.length > 0 && mySteps.every((step) => step.status === "completed"));
  const status = done ? "已完成" : task.status === "ended" ? "已结束" : isPastDeadline(task.dueAt) ? "已逾期" : "进行中";
  const active = !done && task.status === "in_progress" && !isPastDeadline(task.dueAt);
  return <div className={`dashboard-task-card${active ? " dashboard-task-active" : ""}${readOnly ? " wp-issued-card" : ""}`}>
    <button className="dashboard-card-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><div className="dashboard-card-main"><div className="dashboard-card-topline">{readOnly ? <strong className="wp-issued-title">{task.title}</strong> : <span className="tag tag-purple">流转任务</span>}{readOnly && <span className="wp-issued-progress">节点完成 {task.steps.filter(step => step.status === "completed").length}/{task.steps.length}</span>}<span className={`tag ${done ? "tag-green" : active ? "task-status-active" : status === "已逾期" ? "tag-red" : "tag-slate"}`}>{status}</span></div>{!readOnly && <p className="todo-title">{task.title}</p>}<div className="dashboard-meta"><span>{task.createdByName} · {task.targetOrgName}</span><span>截止 {task.dueAt ? new Date(task.dueAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "不限"}</span></div></div>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
    {expanded ? <div className="dashboard-expanded">{task.description && <p className="dashboard-description dashboard-description-full">{task.description}</p>}{!readOnly && <p className="section-note">填写自己的节点，逐题确认；全部必填题确认后自动完成节点。</p>}{task.steps.map((step) => {
      const reason = readOnly ? "发布者查看" : workflowEditingReason(task, step, currentUserId);
      return <section className="collaboration-step" key={step.id}><div className="dashboard-card-topline"><strong>{readOnly ? `节点 ${step.order} · ${step.assigneeName || "未指定"}` : `${step.order}. ${step.title}`}</strong><span className={`tag ${step.status === "completed" ? "tag-green" : "tag-blue"}`}>{step.status === "completed" ? "已完成" : readOnly ? step.status === "active" ? "进行中" : "待处理" : step.assigneeUserId === currentUserId ? "我的节点" : "他人节点"}</span></div>{!readOnly && <div className="section-note">负责人：{step.assigneeName || "未指定"}</div>}{readOnly && step.title && !/^节点\s*\d+$/.test(step.title) && <div className="section-note">{step.title}</div>}{step.requirement && (!readOnly || !step.questions.some(question => question.title.trim() === step.requirement?.trim())) ? <p className="dashboard-description dashboard-description-full">{step.requirement}</p> : null}{reason && !readOnly ? <p className="section-note">{reason}</p> : null}<div className="list">{step.questions.map((question, index) => <QuestionEditor taskSaving={taskSave.saving} key={question.id} question={question} order={index + 1} answer={step.stepAnswers?.find((answer) => answer.questionId === question.id)} lockedReason={() => readOnly ? "发布者查看" : workflowEditingReason(task, step, currentUserId)} onSave={async (answer) => { await taskSave.save(async () => (await taskApi.saveWorkflowAnswer(task.id, step.id, answer)).task); }} />)}</div>{!step.questions.length && !reason ? <button className="btn btn-primary" disabled={Boolean(busyStep) || taskSave.saving} onClick={async () => { if (busyStep || workflowEditingReason(task, step, currentUserId)) return; setBusyStep(step.id); setError(""); try { await taskSave.save(() => taskApi.submitWorkflowStep(task.id, step.id)); } catch (err) { setError(err instanceof Error ? err.message : "提交失败"); } finally { setBusyStep(""); } }}>确认完成节点</button> : null}</section>;
    })}{error ? <div className="error" role="alert">{error}</div> : null}</div> : null}
  </div>;
}

export function BroadcastCard({ task, onUpdate }: { task: BroadcastTask; onUpdate: (task: BroadcastTask) => void }) {
  const [expanded, setExpanded] = useState(false);
  const taskSave = useTaskSave(onUpdate);
  const done = task.myRecord.status === "submitted";
  const lockedReason = () => done ? "任务已完成" : task.status === "ended" ? "任务已结束" : task.myRecord.status === "overdue" || isPastDeadline(task.dueAt) ? "已超过截止时间" : "";
  const active = !lockedReason();
  const answered = task.questions.filter((question) => hasCollaborationAnswer(question, task.myRecord.answers.find((answer) => answer.questionId === question.id))).length;
  return <div className={`dashboard-task-card${active ? " dashboard-task-active" : ""}`}><button className="dashboard-card-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><div className="dashboard-card-main"><div className="dashboard-card-topline"><span className="tag tag-orange">厅内直达</span><span className={`tag ${done ? "tag-green" : active ? "task-status-active" : "tag-slate"}`}>{done ? "已完成" : lockedReason() || "进行中"}</span></div><p className="todo-title">{task.title}</p><div className="dashboard-meta"><span>{task.createdByName} · {task.hallOrgName}</span><span>已确认 {answered}/{task.questions.length}</span><span>截止 {task.dueAt ? new Date(task.dueAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "不限"}</span></div></div>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>{expanded ? <div className="dashboard-expanded"><p className="dashboard-description dashboard-description-full">{task.description}</p><p className="section-note">{lockedReason() || "逐题确认，全部必填题确认后自动完成任务。"}</p><div className="list">{task.questions.map((question, index) => <QuestionEditor taskSaving={taskSave.saving} key={question.id} question={question} order={index + 1} answer={task.myRecord.answers.find((answer) => answer.questionId === question.id)} lockedReason={lockedReason} onSave={async (answer) => { await taskSave.save(async () => (await taskApi.saveBroadcastAnswer(task.id, answer)).task); }} />)}</div></div> : null}</div>;
}
