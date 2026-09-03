import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ExternalLink, FileImage, Loader2, Paperclip, Send, CheckCircle2 } from "lucide-react";
import { taskApi } from "../services/task";
import type { TaskItem, TaskItemRecord, TaskRecord } from "../types";
import { hallRecordForDetail, learningLink, recordEditingReason } from "../utils/taskFilling";
import { formatImageSize, MAX_IMAGE_BYTES, prepareTaskImage } from "../utils/imageCompression";

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
  if (!items.length || recordEditingReason(record)) return false;
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

function ItemEditor({ item, itemRecord, record, kind, onRefresh, orderLabel }: { item: TaskItem; itemRecord?: TaskItemRecord; record: TaskRecord; kind: "record" | "hall"; onRefresh: (itemSaved?: boolean) => Promise<void>; orderLabel: string }) {
  const recordId = record.id;
  const lockedReason = recordEditingReason(record);
  const saveItem = kind === "hall" ? taskApi.submitHallItem : taskApi.submitItemRecord;
  const [answerText, setAnswerText] = useState(itemRecord?.answerText ?? "");
  const [selectedOptions, setSelectedOptions] = useState<string[]>(itemRecord?.answerOptions ?? []);
  const [linkConfirmed, setLinkConfirmed] = useState(Boolean(itemRecord?.isLinkConfirmed));
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preparingImage, setPreparingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [imagePreview, setImagePreview] = useState<{ file: File; url: string; originalSize: number } | null>(null);
  const imageOperation = useRef(0);
  const uploadBusy = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const done = itemRecord?.status === "done";

  useEffect(() => () => { imageOperation.current += 1; }, []);
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview.url); }, [imagePreview]);

  useEffect(() => {
    setAnswerText(itemRecord?.answerText ?? "");
    setSelectedOptions(itemRecord?.answerOptions ?? []);
    setLinkConfirmed(Boolean(itemRecord?.isLinkConfirmed));
  }, [itemRecord?.answerOptions, itemRecord?.answerText, itemRecord?.isLinkConfirmed]);

  async function submit(payload: { answerText?: string; answerOptions?: string[]; isLinkConfirmed?: boolean; done: boolean }) {
    if (submitting || recordEditingReason(record)) return;
    setSubmitting(true);
    try {
      await saveItem({
        taskRecordId: recordId,
        taskItemId: item.id,
        answerText: payload.answerText,
        answerOptions: payload.answerOptions,
        isLinkConfirmed: payload.isLinkConfirmed,
        done: payload.done,
      });
      await onRefresh(payload.done);
    } catch (err) {
      alert(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || recordEditingReason(record)) return;
    const operation = ++imageOperation.current;
    setPreparingImage(true);
    setImageError("");
    setImagePreview(null);
    try {
      const prepared = await prepareTaskImage(file);
      if (operation !== imageOperation.current) return;
      if (prepared !== file || file.size > MAX_IMAGE_BYTES) {
        setImagePreview({ file: prepared, url: URL.createObjectURL(prepared), originalSize: file.size });
      } else {
        // Files already within the limit keep the existing direct-upload flow.
        await uploadImage(prepared, file.size);
      }
    } catch (err) {
      if (operation === imageOperation.current) setImageError(err instanceof Error ? err.message : "图片处理失败，请重新选择");
    } finally {
      if (operation === imageOperation.current) setPreparingImage(false);
    }
  }

  async function uploadImage(file: File, originalSize: number) {
    if (uploadBusy.current || recordEditingReason(record)) return;
    const operation = imageOperation.current;
    uploadBusy.current = true;
    setUploading(true);
    setImageError("");
    try {
      let target = itemRecord;
      if (!target?.id) {
        const saved = await saveItem({ taskRecordId: recordId, taskItemId: item.id, done: false });
        // Some temporary-task responses contain the entire record instead of one item.
        target = "taskItemId" in saved ? saved : saved.itemRecords?.find((entry) => entry.taskItemId === item.id);
      }
      if (!target?.id) throw new Error("未获取到附件关联记录，请刷新后重试");
      if (operation !== imageOperation.current) return;
      await (kind === "hall" ? taskApi.uploadHallAttachment(target.id, file) : taskApi.upload(target.id, file));
      if (operation !== imageOperation.current) return;
      setImagePreview(null);
      await onRefresh();
    } catch (err) {
      // Keep the prepared file so retrying never recompresses the image.
      if (operation === imageOperation.current) {
        setImagePreview({ file, originalSize, url: URL.createObjectURL(file) });
        setImageError(err instanceof Error ? err.message : "上传失败，请重试");
      }
    } finally {
      uploadBusy.current = false;
      setUploading(false);
    }
  }

  const content = (() => {
    switch (item.itemType) {
      case "QA":
        return (
          <div className="detail-answer-form">
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
            {learningLink(item.linkUrl) ? (
              <a className="btn btn-ghost" href={learningLink(item.linkUrl)} target="_blank" rel="noreferrer" onClick={() => setLinkConfirmed(true)}>
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
              <button className="btn btn-ghost icon-btn" aria-label="拍照或选择图片" style={{ width: 76, height: 76 }} onClick={() => fileRef.current?.click()} disabled={uploading || preparingImage}>
                {uploading || preparingImage ? <Loader2 size={18} className="animate-spin" /> : <FileImage size={18} />}
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
            <div className="muted" style={{ fontSize: 12 }}>支持拍照或相册选图，超过 1MB 自动压缩，不修改相册原图。</div>
            {uploading || preparingImage ? <div className="section-note" role="status">{uploading ? "正在上传图片…" : "正在处理图片，请稍候…"}</div> : null}
            {imageError ? <div className="error" role="alert">{imageError}</div> : null}
            {imagePreview ? <div className="upload-image-preview">
              <div className="upload-image-preview-heading"><strong>上传前预览</strong><span>{formatImageSize(imagePreview.originalSize)} → {formatImageSize(imagePreview.file.size)}</span></div>
              <a href={imagePreview.url} target="_blank" rel="noreferrer" aria-label="查看待上传图片原尺寸"><img src={imagePreview.url} alt="待上传图片预览" /></a>
              <div className="section-note">点击图片查看细节，确认文字清晰后上传；若不清晰，可裁剪重点内容或分开拍摄。</div>
              <div className="action-row"><button className="btn btn-ghost" disabled={uploading || preparingImage} onClick={() => { setImagePreview(null); setImageError(""); }}>取消</button><button className="btn btn-primary" disabled={uploading || preparingImage} onClick={() => void uploadImage(imagePreview.file, imagePreview.originalSize)}>{uploading ? "上传中…" : "确认清晰并上传"}</button></div>
            </div> : null}
            {(itemRecord?.attachments?.length ?? 0) > 0 ? <button className="btn btn-primary" disabled={submitting || uploading || preparingImage || Boolean(imagePreview)} onClick={() => void submit({ done: true })}><span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}><Paperclip size={15} />确认附件已上传</span></button> : null}
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
          <span className="detail-item-kind"><span className="detail-item-order">{orderLabel}</span><span>{itemTypeLabel(item.itemType)}</span></span>
          <div className="detail-item-title">{item.isRequired ? <span className="detail-item-required" aria-label="必填">*</span> : null}{item.title}</div>
        </div>
        <span className={`tag ${done ? "tag-green" : "tag-slate"}`}>{done ? "已完成" : "待处理"}</span>
      </div>
      {itemRecord?.completedByName || itemRecord?.answerText || itemRecord?.answerOptions?.length || itemRecord?.attachments?.length ? <div className="detail-row" style={{ marginTop: 8 }}>
        {itemRecord?.completedByName ? <div>完成人：{itemRecord.completedByName}</div> : null}
        {itemRecord?.answerText ? <div>结果：{itemRecord.answerText}</div> : null}
        {itemRecord?.answerOptions?.length ? <div>选项：{itemRecord.answerOptions.join("、")}</div> : null}
        {itemRecord?.attachments?.length ? <div>附件：{itemRecord.attachments.length} 个</div> : null}
      </div> : null}
      <div style={{ marginTop: 12 }}>
        {lockedReason ? <div className="collaboration-readonly"><div>{lockedReason}</div>{done && item.itemType === "LINK" ? <div>已完成学习并确认</div> : null}{(itemRecord?.attachments ?? []).map((attachment) => <a key={attachment.id} href={resolveFileUrl(attachment.fileUrl)} target="_blank" rel="noreferrer">{attachment.fileName}</a>)}</div> : content}
      </div>
    </div>
  );
}

export function TodoDetailPage({ kind = "record" }: { kind?: "record" | "hall" }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<TaskRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittingRecord, setSubmittingRecord] = useState(false);
  const [submitHint, setSubmitHint] = useState("");
  const requestId = useRef(0);
  const recordSubmitBusy = useRef(false);

  async function loadRecord(itemSaved = false) {
    if (!id) return;
    const request = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      let data: TaskRecord;
      if (kind === "hall") {
        const found = (await taskApi.getHallDailyRecords()).find((entry) => entry.id === id);
        if (!found) throw new Error("该厅管任务已不在当前身份的可查看范围，请返回列表刷新");
        data = hallRecordForDetail(found);
      } else data = await taskApi.getRecord(id);
      if (request !== requestId.current) return;
      setRecord(data);
      if (kind === "hall" && itemSaved && isRecordSubmittable(data) && !recordSubmitBusy.current) {
        recordSubmitBusy.current = true;
        try {
          await taskApi.submitHallRecord(id);
          if (request === requestId.current) { setRecord({ ...data, status: "submitted" }); setSubmitHint("任务已自动提交成功"); }
        } catch (err) {
          if (request === requestId.current) setSubmitHint(err instanceof Error ? err.message : "自动提交失败，请点击底部按钮重试");
        } finally { recordSubmitBusy.current = false; }
      }
    } catch (err) {
      if (request === requestId.current) setError(err instanceof Error ? err.message : "加载详情失败");
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    setRecord(null);
    void loadRecord();
    return () => { requestId.current += 1; };
  }, [id, kind]);

  const status = record ? statusMeta(record.status) : null;
  const items = record?.assignment?.template?.items ?? [];
  const pendingItems = useMemo(() => items.filter((item) => record?.itemRecords?.find((entry) => entry.taskItemId === item.id)?.status !== "done"), [items, record?.itemRecords]);
  const doneItems = useMemo(() => items.filter((item) => record?.itemRecords?.find((entry) => entry.taskItemId === item.id)?.status === "done"), [items, record?.itemRecords]);
  const lockedReason = record ? recordEditingReason(record) : "";
  const canSubmit = record ? isRecordSubmittable(record) : false;

  async function handleSubmitRecord() {
    if (!record || !isRecordSubmittable(record) || recordSubmitBusy.current) return;
    recordSubmitBusy.current = true;
    setSubmittingRecord(true);
    setSubmitHint("");
    try {
      await (kind === "hall" ? taskApi.submitHallRecord(record.id) : taskApi.submitRecord(record.id));
      await loadRecord();
      setSubmitHint("任务已提交成功");
    } catch (err) {
      setSubmitHint(err instanceof Error ? err.message : "提交失败");
    } finally {
      recordSubmitBusy.current = false;
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
                    {pendingItems.map((item) => {
                      const itemRecord = record.itemRecords?.find((entry) => entry.taskItemId === item.id);
                      return <ItemEditor key={item.id} item={item} itemRecord={itemRecord} record={record} kind={kind} onRefresh={loadRecord} orderLabel={`${items.findIndex((entry) => entry.id === item.id) + 1}`} />;
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
                    {doneItems.map((item) => {
                      const itemRecord = record.itemRecords?.find((entry) => entry.taskItemId === item.id);
                      return <ItemEditor key={item.id} item={item} itemRecord={itemRecord} record={record} kind={kind} onRefresh={loadRecord} orderLabel={`${items.findIndex((entry) => entry.id === item.id) + 1}`} />;
                    })}
                  </div>
                </div>
              ) : null}

              <div className="card detail-block">
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>提交任务</div>
                      <div className="section-note" style={{ marginTop: 4 }}>{lockedReason || (canSubmit ? "必填项已完成，可提交" : kind === "hall" ? "逐项填写，必填项完成后自动提交" : "请先完成必填项")}</div>
                    </div>
                    <span className={`tag ${canSubmit ? "tag-green" : "tag-slate"}`}>{record.status === "submitted" ? "已完成" : canSubmit ? "可提交" : "未完成"}</span>
                  </div>
                  {submitHint ? <div className="section-note" style={{ color: submitHint.includes("成功") ? "#15803d" : "#dc2626" }}>{submitHint}</div> : null}
                  <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} disabled={!canSubmit || submittingRecord} onClick={() => void handleSubmitRecord()}>
                    {submittingRecord ? "提交中..." : lockedReason || (canSubmit ? "确认提交当前任务" : "请先完成所有必填项")}
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
