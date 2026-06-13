import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ExternalLink, FileImage, Loader2, Paperclip, Send, CheckCircle2 } from "lucide-react";
import { taskApi } from "../services/task";
import type { TaskItem, TaskItemRecord, TaskRecord } from "../types";

function statusMeta(status: string) {
  if (status === "submitted") return { text: "已完成", cls: "tag-green" };
  if (status === "in_progress") return { text: "进行中", cls: "tag-blue" };
  if (status === "overdue") return { text: "已逾期", cls: "tag-red" };
  return { text: "待开始", cls: "tag-slate" };
}

function resolveFileUrl(fileUrl: string) {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  return fileUrl.startsWith("/uploads") ? `/api${fileUrl}` : fileUrl;
}

function itemTypeLabel(type: string) {
  const labels: Record<string, string> = {
    QA: "问答",
    SINGLE_CHOICE: "单选",
    MULTI_CHOICE: "多选",
    FILL_BLANK: "待办确认",
    LINK: "学习链接",
    ATTACHMENT: "图片上传",
  };
  return labels[type] ?? type;
}

function isRecordSubmittable(record: TaskRecord) {
  const items = record.assignment?.template?.items ?? [];
  if (!items.length || record.status === "submitted") return false;
  return items.every((item) => !item.isRequired || record.itemRecords?.find((entry) => entry.taskItemId === item.id)?.status === "done");
}

function formatDeadline(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function ItemEditor({ item, itemRecord, recordId, onRefresh, orderLabel }: { item: TaskItem; itemRecord?: TaskItemRecord; recordId: string; onRefresh: () => Promise<void>; orderLabel: string }) {
  const [answerText, setAnswerText] = useState(itemRecord?.answerText ?? "");
  const [selectedOptions, setSelectedOptions] = useState<string[]>(itemRecord?.answerOptions ?? []);
  const [linkConfirmed, setLinkConfirmed] = useState(Boolean(itemRecord?.isLinkConfirmed));
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const done = itemRecord?.status === "done";

  useEffect(() => {
    setAnswerText(itemRecord?.answerText ?? "");
    setSelectedOptions(itemRecord?.answerOptions ?? []);
    setLinkConfirmed(Boolean(itemRecord?.isLinkConfirmed));
  }, [itemRecord?.answerOptions, itemRecord?.answerText, itemRecord?.isLinkConfirmed]);

  async function submit(payload: { answerText?: string; answerOptions?: string[]; isLinkConfirmed?: boolean; done: boolean }) {
    setSubmitting(true);
    try {
      await taskApi.submitItemRecord({
        taskRecordId: recordId,
        taskItemId: item.id,
        answerText: payload.answerText,
        answerOptions: payload.answerOptions,
        isLinkConfirmed: payload.isLinkConfirmed,
        done: payload.done,
      });
      await onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      alert("图片不得超过 1MB");
      return;
    }
    setUploading(true);
    try {
      const target = itemRecord?.id
        ? itemRecord
        : await taskApi.submitItemRecord({ taskRecordId: recordId, taskItemId: item.id, done: false }) as TaskItemRecord;
      await taskApi.upload(target.id, file);
      await onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const content = (() => {
    switch (item.itemType) {
      case "QA":
        return (
          <div style={{ display: "grid", gap: 8 }}>
            <textarea className="input" rows={3} placeholder="请输入你的说明或回答" value={answerText} onChange={(e) => setAnswerText(e.target.value)} />
            <button className="btn btn-primary" disabled={submitting || !answerText.trim()} onClick={() => void submit({ answerText: answerText.trim(), done: true })}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}><Send size={15} />提交回答</span>
            </button>
          </div>
        );
      case "SINGLE_CHOICE":
        return (
          <div className="list">
            {(item.options ?? []).map((option) => (
              <button key={option.id} className={`btn ${selectedOptions.includes(option.label) ? "btn-primary" : "btn-ghost"}`} onClick={() => void submit({ answerOptions: [option.label], done: true })} disabled={submitting}>
                {option.label}
              </button>
            ))}
          </div>
        );
      case "MULTI_CHOICE":
        return (
          <div className="list">
            {(item.options ?? []).map((option) => {
              const active = selectedOptions.includes(option.label);
              return (
                <button
                  key={option.id}
                  className={`btn ${active ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setSelectedOptions((prev) => active ? prev.filter((entry) => entry !== option.label) : [...prev, option.label])}
                >
                  {option.label}
                </button>
              );
            })}
            <button className="btn btn-secondary" disabled={submitting || selectedOptions.length === 0} onClick={() => void submit({ answerOptions: selectedOptions, done: true })}>确认多选结果</button>
          </div>
        );
      case "FILL_BLANK":
        return <button className="btn btn-primary" disabled={submitting} onClick={() => void submit({ done: true })}>确认完成该项</button>;
      case "LINK":
        return (
          <div className="list">
            {item.linkUrl ? (
              <a className="btn btn-ghost" href={item.linkUrl} target="_blank" rel="noreferrer" onClick={() => setLinkConfirmed(true)}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}><ExternalLink size={15} />前往学习链接</span>
              </a>
            ) : <div className="muted">当前未配置学习链接</div>}
            <button className="btn btn-primary" disabled={submitting || !linkConfirmed} onClick={() => void submit({ isLinkConfirmed: true, done: true })}>已完成学习并确认</button>
          </div>
        );
      case "ATTACHMENT":
        return (
          <div className="list">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {(itemRecord?.attachments ?? []).map((attachment) => (
                <a key={attachment.id} href={resolveFileUrl(attachment.fileUrl)} target="_blank" rel="noreferrer" style={{ width: 76, height: 76, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(148,163,184,0.18)" }}>
                  <img src={resolveFileUrl(attachment.fileUrl)} alt={attachment.fileName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </a>
              ))}
              <button className="btn btn-ghost icon-btn" style={{ width: 76, height: 76 }} onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <FileImage size={18} />}
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
            <div className="muted" style={{ fontSize: 12 }}>支持拍照或相册上传，单张图片不超过 1MB。</div>
            {(itemRecord?.attachments?.length ?? 0) > 0 ? <button className="btn btn-primary" disabled={submitting} onClick={() => void submit({ done: true })}><span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}><Paperclip size={15} />确认附件已上传</span></button> : null}
          </div>
        );
      default:
        return <div className="muted">暂不支持的题型：{item.itemType}</div>;
    }
  })();

  return (
    <div className="detail-item detail-item-strong">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="detail-item-order">{orderLabel}</span>
          <div className="detail-item-title">{item.title}</div>
        </div>
        <span className={`tag ${done ? "tag-green" : "tag-slate"}`}>{done ? "已完成" : "待处理"}</span>
      </div>
      <div className="detail-row" style={{ marginTop: 8 }}>
        <div>类型：{itemTypeLabel(item.itemType)}</div>
        {itemRecord?.completedByName ? <div>完成人：{itemRecord.completedByName}</div> : null}
        {itemRecord?.answerText ? <div>结果：{itemRecord.answerText}</div> : null}
        {itemRecord?.answerOptions?.length ? <div>选项：{itemRecord.answerOptions.join("、")}</div> : null}
        {itemRecord?.attachments?.length ? <div>附件：{itemRecord.attachments.length} 个</div> : null}
      </div>
      <div style={{ marginTop: 12 }}>
        {content}
      </div>
    </div>
  );
}

export function TodoDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<TaskRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittingRecord, setSubmittingRecord] = useState(false);
  const [submitHint, setSubmitHint] = useState("");

  async function loadRecord() {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await taskApi.getRecord(id);
      setRecord(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载详情失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRecord();
  }, [id]);

  const status = record ? statusMeta(record.status) : null;
  const items = record?.assignment?.template?.items ?? [];
  const pendingItems = useMemo(() => items.filter((item) => record?.itemRecords?.find((entry) => entry.taskItemId === item.id)?.status !== "done"), [items, record?.itemRecords]);
  const doneItems = useMemo(() => items.filter((item) => record?.itemRecords?.find((entry) => entry.taskItemId === item.id)?.status === "done"), [items, record?.itemRecords]);
  const canSubmit = record ? isRecordSubmittable(record) : false;

  async function handleSubmitRecord() {
    if (!record) return;
    setSubmittingRecord(true);
    setSubmitHint("");
    try {
      await taskApi.submitRecord(record.id);
      await loadRecord();
      setSubmitHint("任务已提交成功");
    } catch (err) {
      setSubmitHint(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmittingRecord(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="mobile-page bottom-safe">
        <div className="section" style={{ paddingTop: 22, paddingBottom: 12 }}>
          <div className="topbar">
            <button className="btn btn-ghost icon-btn" onClick={() => navigate(-1)}><ChevronLeft size={18} /></button>
            <h1 className="topbar-title">任务详情</h1>
            <button className="btn btn-ghost" style={{ paddingInline: 12 }} onClick={() => void loadRecord()}>刷新</button>
          </div>

          {loading ? <div className="card" style={{ padding: 18 }}>加载中...</div> : null}
          {error ? <div className="card error" style={{ padding: 18 }}>{error}</div> : null}

          {record ? (
            <div className="list">
              <div className="card detail-block card-strong">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="card-title" style={{ fontSize: 17 }}>{record.assignment?.template?.title ?? record.subjectName ?? record.subjectKey}</p>
                    {record.assignment?.template?.description?.trim() ? <p className="card-subtitle">{record.assignment.template.description.trim()}</p> : null}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    {status ? <span className={`tag ${status.cls}`}>{status.text}</span> : null}
                    <span className="tag tag-slate">进度 {record.doneItems}/{record.totalItems}</span>
                  </div>
                </div>
                <div className="detail-row detail-meta-block" style={{ marginTop: 10 }}>
                  <div className="detail-meta-line">
                    <span className="meta-inline-item">主体：{record.subjectName ?? record.subjectKey}</span>
                    <span className="meta-inline-item">截止：{formatDeadline(record.deadlineAt)}</span>
                    <span className="meta-inline-item">发布：{record.assignment?.publisher?.label ?? "-"}</span>
                  </div>
                </div>
              </div>

              <div className="card detail-block">
                <div className="section-title-row">
                  <p className="card-title" style={{ fontSize: 16, marginBottom: 0 }}>待处理子任务</p>
                  <span className="tag tag-slate">{pendingItems.length} 项</span>
                </div>
                {pendingItems.length === 0 ? (
                  <div className="card" style={{ padding: 14, background: "rgba(220,252,231,0.45)" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <CheckCircle2 size={18} color="#16a34a" />
                      <div>
                        <div style={{ fontWeight: 700 }}>暂无待处理子任务</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="list">
                    {pendingItems.map((item, index) => {
                      const itemRecord = record.itemRecords?.find((entry) => entry.taskItemId === item.id);
                      return <ItemEditor key={item.id} item={item} itemRecord={itemRecord} recordId={record.id} onRefresh={loadRecord} orderLabel={`${index + 1}`} />;
                    })}
                  </div>
                )}
              </div>

              {doneItems.length > 0 ? (
                <div className="card detail-block">
                  <div className="section-title-row">
                    <p className="card-title" style={{ fontSize: 16, marginBottom: 0 }}>已完成子任务</p>
                    <span className="tag tag-green">{doneItems.length} 项</span>
                  </div>
                  <div className="list">
                    {doneItems.map((item, index) => {
                      const itemRecord = record.itemRecords?.find((entry) => entry.taskItemId === item.id);
                      return <ItemEditor key={item.id} item={item} itemRecord={itemRecord} recordId={record.id} onRefresh={loadRecord} orderLabel={`${index + 1}`} />;
                    })}
                  </div>
                </div>
              ) : null}

              <div className="sticky-submit-bar">
                <div className="sticky-submit-inner">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>提交任务</div>
                      <div className="section-note" style={{ marginTop: 4 }}>{canSubmit ? "必填项已完成，可提交" : "请先完成必填项"}</div>
                    </div>
                    <span className={`tag ${canSubmit ? "tag-green" : "tag-slate"}`}>{canSubmit ? "可提交" : "未完成"}</span>
                  </div>
                  {submitHint ? <div className="section-note" style={{ color: submitHint.includes("成功") ? "#15803d" : "#dc2626" }}>{submitHint}</div> : null}
                  <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} disabled={!canSubmit || submittingRecord} onClick={() => void handleSubmitRecord()}>
                    {submittingRecord ? "提交中..." : canSubmit ? "确认提交当前任务" : "请先完成所有必填项"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
