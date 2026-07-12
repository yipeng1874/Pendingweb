import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  ExternalLink,
  FileImage,
  Loader2,
  Paperclip,
  Send,
  X,
} from "lucide-react";

import type { HallTaskItemRecord, HallTaskRecord } from "../../../../services/task";
import { hallDailyApi } from "../../../../services/task";
import { normalizeLearningLink } from "../../../../shared/utils/learningLink";

// ─── 工具 ──────────────────────────────────────────────────────────────────────

function resolveFileUrl(fileUrl: string) {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  return fileUrl.startsWith("/uploads") ? `/api${fileUrl}` : fileUrl;
}

function parseRecordDate(recordDate: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(recordDate);
  if (!matched) return null;
  return { year: Number(matched[1]), month: Number(matched[2]), day: Number(matched[3]) };
}

function formatRecordDate(recordDate?: string) {
  if (!recordDate) return "";
  const parsed = parseRecordDate(recordDate);
  if (!parsed) return recordDate;
  return `${parsed.month}月${parsed.day}日`;
}

function addDays(recordDate: string, days: number) {
  const parsed = parseRecordDate(recordDate);
  if (!parsed) return recordDate;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function statusLabel(status: string) {
  if (status === "submitted") return { text: "已完成", cls: "bg-emerald-50 text-emerald-600" };
  if (status === "in_progress") return { text: "进行中", cls: "bg-teal-50 text-teal-600" };
  if (status === "overdue") return { text: "已逾期", cls: "bg-red-50 text-red-600" };
  return { text: "待开始", cls: "bg-slate-100 text-slate-500" };
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

// ─── ItemRow 子组件 ────────────────────────────────────────────────────────────

type ItemType = NonNullable<NonNullable<HallTaskRecord["assignment"]>["template"]>["items"][number];

function HallItemRow({
  item,
  itemRecord,
  recordId,
  onDone,
  index,
}: {
  item: ItemType;
  itemRecord?: HallTaskItemRecord;
  recordId: string;
  onDone: (updated: HallTaskItemRecord) => void;
  index?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [answerText, setAnswerText] = useState(itemRecord?.answerText ?? "");
  const [selectedOptions, setSelectedOptions] = useState<string[]>(itemRecord?.answerOptions ?? []);
  const [linkConfirmed, setLinkConfirmed] = useState(itemRecord?.isLinkConfirmed ?? false);
  const [uploading, setUploading] = useState(false);
  const [localFiles, setLocalFiles] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const [uploadedAttachments, setUploadedAttachments] = useState<Array<{ id: string; fileUrl: string; fileName: string }>>(
    (itemRecord?.attachments ?? []).map((a) => ({ id: a.id, fileUrl: a.fileUrl, fileName: a.fileName }))
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      localFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    };
  }, [localFiles]);

  const isDone = itemRecord?.status === "done";
  const learningLink = item.itemType === "LINK" ? normalizeLearningLink(item.linkUrl) : undefined;

  async function submit(
    done: boolean,
    extra?: { answerText?: string; answerOptions?: string[]; isLinkConfirmed?: boolean }
  ) {
    if (loading) return;
    setLoading(true);
    try {
      const updated = await hallDailyApi.submitItemRecord({
        taskRecordId: recordId,
        taskItemId: item.id,
        answerText: extra?.answerText ?? (answerText || undefined),
        answerOptions: extra?.answerOptions ?? (selectedOptions.length ? selectedOptions : undefined),
        isLinkConfirmed: extra?.isLinkConfirmed ?? linkConfirmed,
        done,
      });
      onDone(updated);
    } catch (error) {
      console.error(error);
      alert(getErrorMessage(error, "保存失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }

  function addImageFiles(files: File[], sourceLabel = "图片") {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 1048576) {
        alert(`${sourceLabel} ${file.name || "剪贴板图片"} 超过 1MB，已跳过`);
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      setLocalFiles((prev) => [...prev, { file, previewUrl }]);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    addImageFiles(files);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    addImageFiles(Array.from(e.dataTransfer.files));
  }

  async function handlePasteButtonClick() {
    if (!navigator.clipboard?.read) {
      alert("当前浏览器不支持点击读取剪贴板图片，请使用拖拽或点击上传。");
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await clipboardItem.getType(imageType);
        const ext = imageType.split("/")[1] || "png";
        files.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imageType }));
      }
      if (files.length === 0) {
        alert("剪贴板中没有可上传的图片，请先复制图片或截图后再点击粘贴。");
        return;
      }
      addImageFiles(files, "粘贴图片");
    } catch (error) {
      console.error(error);
      alert("读取剪贴板失败，请确认已复制图片，并允许浏览器访问剪贴板。");
    }
  }

  function removeLocalFile(previewUrl: string) {
    setLocalFiles((prev) => {
      const target = prev.find((f) => f.previewUrl === previewUrl);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.previewUrl !== previewUrl);
    });
  }

  async function handleSubmitAttachments() {
    if (localFiles.length === 0) return;
    setUploading(true);
    try {
      // 优先用已有的 itemRecord id；若不存在才调用接口创建（不改变 done 状态）
      let hallTaskItemRecordId = itemRecord?.id;
      if (!hallTaskItemRecordId) {
        const ir = await hallDailyApi.submitItemRecord({ taskRecordId: recordId, taskItemId: item.id, done: false });
        hallTaskItemRecordId = ir.id;
      }

      // 逐张上传
      const results: Array<{ id: string; fileUrl: string; fileName: string }> = [];
      for (const { file } of localFiles) {
        const attachment = await hallDailyApi.uploadAttachment(hallTaskItemRecordId, file);
        results.push({ id: attachment.id, fileUrl: attachment.fileUrl, fileName: attachment.fileName });
      }

      // 图片上传完成后把题目标记为已完成
      const updated = await hallDailyApi.submitItemRecord({ taskRecordId: recordId, taskItemId: item.id, done: true });

      setUploadedAttachments((prev) => [...prev, ...results]);
      setLocalFiles([]);
      onDone(updated);
    } catch (error) {
      console.error(error);
      alert(getErrorMessage(error, "图片上传失败，请稍后重试"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAttachment(id: string) {
    try {
      await hallDailyApi.deleteAttachment(id);
      setUploadedAttachments((prev) => prev.filter((a) => a.id !== id));
    } catch (error) {
      alert(getErrorMessage(error, "删除附件失败"));
    }
  }

  return (
    <div className={`rounded-2xl border p-3 transition ${isDone ? "border-emerald-100 bg-emerald-50/60" : "border-slate-100 bg-white"}`}>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => void submit(!isDone)}
          disabled={loading || item.itemType === "LINK" || item.itemType === "ATTACHMENT"}
          className="mt-0.5 shrink-0 text-slate-400 transition hover:text-emerald-500 disabled:cursor-default"
        >
          {loading ? <Loader2 size={16} className="animate-spin text-blue-500" /> : isDone ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={`text-base font-semibold ${isDone ? "text-slate-400 line-through" : "text-slate-800"}`}>
              {index !== undefined ? `${index}. ` : ""}{item.title}
            </p>
            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-500">{itemTypeLabel(item.itemType)}</span>
            {item.isRequired && <span className="text-xs text-red-400">*必填</span>}
          </div>

          {!isDone && (
            <div className="mt-2">
              {item.itemType === "QA" && (
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-teal-400 focus:outline-none"
                    placeholder="请输入回答..."
                    value={answerText}
                    onChange={(event) => setAnswerText(event.target.value)}
                  />
                  <button type="button" onClick={() => void submit(true)} disabled={!answerText.trim() || loading} className="rounded-lg bg-teal-500 px-3 py-1.5 text-sm text-white transition hover:bg-teal-600 disabled:opacity-40">
                    <Send size={13} />
                  </button>
                </div>
              )}
              {item.itemType === "FILL_BLANK" && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">该项为待办确认，勾选即可完成。</p>
                  <button type="button" onClick={() => void submit(true)} disabled={loading} className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs text-white transition hover:bg-emerald-600 disabled:opacity-40">勾选确认</button>
                </div>
              )}
              {item.itemType === "SINGLE_CHOICE" && item.options && (
                <div className="flex flex-wrap gap-2">
                  {item.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setSelectedOptions([option.label]);
                        void submit(true, { answerOptions: [option.label] });
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${selectedOptions.includes(option.label) ? "border-teal-400 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-600 hover:border-teal-300"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              {item.itemType === "MULTI_CHOICE" && item.options && (
                <div className="flex flex-wrap gap-2">
                  {item.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedOptions((prev) => (prev.includes(option.label) ? prev.filter((v) => v !== option.label) : [...prev, option.label]))}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${selectedOptions.includes(option.label) ? "border-teal-400 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-600 hover:border-teal-300"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                  {selectedOptions.length > 0 && (
                    <button type="button" onClick={() => void submit(true, { answerOptions: selectedOptions })} className="rounded-lg bg-teal-500 px-3 py-1.5 text-sm text-white transition hover:bg-teal-600">确认</button>
                  )}
                </div>
              )}
              {item.itemType === "LINK" && (
                <div className="flex flex-col gap-2">
                  {learningLink ? (
                    <a href={learningLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-500 hover:text-teal-700" onClick={() => setLinkConfirmed(true)}>
                      <ExternalLink size={14} />前往学习
                    </a>
                  ) : item.linkUrl ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-amber-600"><ExternalLink size={14} />学习链接格式无效，请联系管理员修正</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 cursor-not-allowed text-sm text-slate-400"><ExternalLink size={14} />学习链接未配置，请联系管理员补充</span>
                  )}
                  {learningLink && linkConfirmed && (
                    <button type="button" onClick={() => void submit(true, { isLinkConfirmed: true })} className="w-fit rounded-lg bg-emerald-500 px-3 py-1.5 text-sm text-white transition hover:bg-emerald-600">已完成学习，确认提交</button>
                  )}
                </div>
              )}
              {item.itemType === "ATTACHMENT" && (
                <div className="space-y-2">
                  {/* 已上传附件列表 */}
                  {uploadedAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {uploadedAttachments.map((att) => (
                        <div key={att.id} className="relative rounded-lg border border-emerald-200 bg-white p-1">
                          <img
                            src={resolveFileUrl(att.fileUrl)}
                            alt={att.fileName}
                            className="h-16 w-16 rounded object-cover cursor-pointer"
                            onClick={() => window.open(resolveFileUrl(att.fileUrl), "_blank")}
                          />
                          {!isDone && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteAttachment(att.id)}
                              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-400 text-white shadow hover:bg-red-500"
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 待上传预览 + 上传区 */}
                  {!isDone && (
                    <>
                      <div
                        className={`flex flex-wrap gap-2 rounded-lg border-2 border-dashed p-2 transition ${isDragOver ? "border-teal-400 bg-teal-50" : "border-slate-200"}`}
                        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                        onDragLeave={() => setIsDragOver(false)}
                        onDrop={handleDrop}
                      >
                        {localFiles.map(({ previewUrl }) => (
                          <div key={previewUrl} className="relative rounded-lg border border-teal-200 bg-white p-1">
                            <img src={previewUrl} alt="预览" className="h-16 w-16 rounded object-cover" />
                            <button
                              type="button"
                              onClick={() => removeLocalFile(previewUrl)}
                              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-500 text-white shadow hover:bg-slate-600"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          disabled={uploading}
                          className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-slate-400 transition hover:border-teal-400 hover:text-teal-500"
                          title="点击选择图片"
                        >
                          <FileImage size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePasteButtonClick()}
                          disabled={uploading}
                          className="flex h-16 min-w-16 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-emerald-200 px-3 text-xs font-medium text-emerald-600 transition hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-40"
                          title="读取剪贴板中的图片"
                        >
                          <Paperclip size={16} />
                          粘贴
                        </button>
                        {isDragOver && (
                          <div className="flex flex-1 items-center justify-center text-sm text-teal-400">松开鼠标以添加图片</div>
                        )}
                      </div>
                      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                      <p className="text-xs text-slate-400">支持点击“粘贴”读取剪贴板图片，也支持拖拽或点击上传，JPG / PNG / GIF / WebP，单张 ≤ 1MB</p>
                      {localFiles.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void handleSubmitAttachments()}
                          disabled={uploading}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-3 py-1.5 text-sm text-white transition hover:bg-teal-600 disabled:opacity-40"
                        >
                          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                          {uploading ? "上传中..." : `提交 ${localFiles.length} 张图片`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {isDone && (
            <p className="mt-1.5 text-xs text-slate-400">
              {item.itemType === "QA" && itemRecord?.answerText ? `已填写：${itemRecord.answerText}` : null}
              {item.itemType === "SINGLE_CHOICE" || item.itemType === "MULTI_CHOICE"
                ? itemRecord?.answerOptions?.length ? `已选择：${itemRecord.answerOptions.join("、")}` : "已完成选择"
                : null}
              {item.itemType === "FILL_BLANK" ? "已确认完成" : null}
              {item.itemType === "LINK" ? "已完成学习并确认" : null}
              {item.itemType === "ATTACHMENT" ? (uploadedAttachments.length > 0 ? `已上传 ${uploadedAttachments.length} 张图片` : "已上传附件") : null}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 卡片主体 ──────────────────────────────────────────────────────────────────

interface HallDailyRecordCardProps {
  record: HallTaskRecord;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}

export function HallDailyRecordCard({ record, expanded, onToggle, onRefresh }: HallDailyRecordCardProps) {
  const [showDoneItems, setShowDoneItems] = useState(false);
  // 本地维护 itemRecords，子任务完成后直接本地更新，避免触发父组件刷新导致展开状态丢失
  const [localItemRecords, setLocalItemRecords] = useState<HallTaskItemRecord[]>(record.itemRecords ?? []);
  const [recordStatus, setRecordStatus] = useState(record.status);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false); // 同步守门，防止并发重复提交

  // 当父组件传入的 record 变化时同步本地状态
  const prevRecordIdRef = useRef(record.id);
  useEffect(() => {
    if (prevRecordIdRef.current !== record.id) {
      // record 切换（不同任务），完整重置
      prevRecordIdRef.current = record.id;
      setLocalItemRecords(record.itemRecords ?? []);
      setRecordStatus(record.status);
    } else {
      // 同一任务刷新：只同步 status（itemRecords 保持本地最新，避免倒退）
      setRecordStatus(record.status);
    }
  }, [record.id, record.itemRecords, record.status]);

  const items = record.assignment?.template?.items ?? [];
  const itemRecordsMap = new Map(localItemRecords.map((ir) => [ir.taskItemId, ir]));

  const pendingItems = items.filter((item) => itemRecordsMap.get(item.id)?.status !== "done");
  const doneItems = items.filter((item) => itemRecordsMap.get(item.id)?.status === "done");

  const incompleteRequired = items.filter(
    (item) => item.isRequired && itemRecordsMap.get(item.id)?.status !== "done"
  );

  const status = statusLabel(recordStatus);
  const isOverdue = recordStatus === "overdue";
  const isSubmitted = recordStatus === "submitted";
  const leftBorderColor = isOverdue ? "border-l-red-400" : isSubmitted ? "border-l-emerald-400" : "border-l-teal-400";

  const dateLabel = formatRecordDate(record.recordDate);
  const supplementDateLabel = record.recordDate ? formatRecordDate(addDays(record.recordDate, 1)) : "";

  const prevDoneCountRef = useRef(doneItems.length);
  useEffect(() => {
    if (!expanded) return;
    if (pendingItems.length === 0 && doneItems.length > 0) {
      setShowDoneItems(true);
    } else if (doneItems.length > prevDoneCountRef.current) {
      setShowDoneItems(true);
    }
    prevDoneCountRef.current = doneItems.length;
  }, [doneItems.length, expanded, pendingItems.length]);

  // 组件加载时：若所有必填项已完成但记录仍为 in_progress，自动提交
  const autoSubmitCalledRef = useRef(false);
  useEffect(() => {
    if (autoSubmitCalledRef.current) return;
    if (recordStatus !== "in_progress" && recordStatus !== "overdue") return;
    const currentItems = record.assignment?.template?.items ?? [];
    if (currentItems.length === 0) return;
    const requiredItems = currentItems.filter((item) => item.isRequired);
    if (requiredItems.length === 0) return;
    const irMap = new Map((record.itemRecords ?? []).map((ir) => [ir.taskItemId, ir]));
    const allDone = requiredItems.every((item) => irMap.get(item.id)?.status === "done");
    if (allDone) {
      autoSubmitCalledRef.current = true;
      void handleSubmitRecord();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id]);

  // 子任务完成后本地更新；若全部必填项完成则自动调用后端提交
  function handleItemDone(taskItemId: string, updatedItemRecord: HallTaskItemRecord) {
    const currentItems = record.assignment?.template?.items ?? [];
    let shouldSubmit = false;
    setLocalItemRecords((prev) => {
      const exists = prev.some((ir) => ir.taskItemId === taskItemId);
      const next = exists
        ? prev.map((ir) => ir.taskItemId === taskItemId ? updatedItemRecord : ir)
        : [...prev, updatedItemRecord];

      const nextMap = new Map(next.map((ir) => [ir.taskItemId, ir]));
      const allRequiredDone =
        currentItems.length > 0 &&
        currentItems.filter((item) => item.isRequired).every((item) => nextMap.get(item.id)?.status === "done");

      if (allRequiredDone) {
        shouldSubmit = true;
      }
      return next;
    });
    // 在 setState 回调外触发提交，避免副作用在 render 阶段执行
    if (shouldSubmit) {
      void handleSubmitRecord();
    }
  }

  // 整体提交记录，调用后端接口
  async function handleSubmitRecord() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await hallDailyApi.submitRecord(record.id);
      setRecordStatus("submitted");
      setTimeout(() => onRefresh(), 300);
    } catch (error) {
      alert(getErrorMessage(error, "提交失败，请稍后重试"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-l-4 border-slate-200/80 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.04)] transition ${leftBorderColor}`}>
      {/* 卡片 Header */}
      <button
        type="button"
        className="flex w-full items-center gap-2.5 p-3 text-left transition hover:bg-slate-50"
        onClick={onToggle}
      >
        {/* 日期 */}
        <span className={`flex shrink-0 items-center gap-1 text-sm font-medium ${isOverdue ? "text-red-500" : "text-slate-500"}`}>
          <Clock size={14} />{dateLabel}
        </span>
        {/* 补录提示 */}
        {isOverdue && (
          <span className="shrink-0 text-xs font-medium text-red-400">
            补录截止 {supplementDateLabel} 16:00
          </span>
        )}
        {/* 执行组织 */}
        {record.hallOrg?.name && (
          <span className="shrink-0 text-base font-bold text-teal-700">
            厅：{record.hallOrg.name}
          </span>
        )}
        {/* 模板标题 */}
        <p className="min-w-0 flex-1 truncate text-xs font-normal text-slate-400">
          {record.assignment?.template?.title ?? "厅管日常任务"}
        </p>
        {/* 进度（用本地计算值，实时反映已完成子任务数量） */}
        {items.length > 0 && (
          <span className="shrink-0 text-sm text-slate-400">{doneItems.length}/{items.length}</span>
        )}
        {/* 状态胶囊 */}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>{status.text}</span>
        {/* 折叠箭头 */}
        {expanded ? <ChevronUp size={15} className="shrink-0 text-slate-400" /> : <ChevronDown size={15} className="shrink-0 text-slate-400" />}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-3">

          {isSubmitted && (
            <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              任务已完成提交。
            </div>
          )}

          {isOverdue && !isSubmitted && (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">
              当前任务已逾期，可在今日 16:00 前补录提交；到点后将不可再补录。
            </div>
          )}

          {items.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">暂无子任务</p>
          ) : (
            <>
              {/* 未完成项 */}
              {pendingItems.length > 0 && (
                <div className="space-y-3">
                  {pendingItems.map((item) => (
                    <HallItemRow
                      key={item.id}
                      item={item}
                      itemRecord={itemRecordsMap.get(item.id)}
                      recordId={record.id}
                      onDone={(updated) => handleItemDone(item.id, updated)}
                      index={items.indexOf(item) + 1}
                    />
                  ))}
                </div>
              )}

              {/* 已完成项（可折叠） */}
              {doneItems.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowDoneItems((v) => !v)}
                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-slate-400 transition hover:bg-slate-100"
                  >
                    <CheckCircle2 size={12} className="text-emerald-500" />
                    已完成 {doneItems.length} 项
                    <span className="text-[10px] text-slate-300">{showDoneItems ? "点击收起" : "点击展开"}</span>
                    {showDoneItems ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {showDoneItems && (
                    <div className="mt-1 space-y-2">
                      {doneItems.map((item) => (
                        <HallItemRow
                          key={item.id}
                          item={item}
                          itemRecord={itemRecordsMap.get(item.id)}
                          recordId={record.id}
                          onDone={(updated) => handleItemDone(item.id, updated)}
                          index={items.indexOf(item) + 1}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* 必填项提示 */}
          {!isSubmitted && incompleteRequired.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              还有 {incompleteRequired.length} 项必填子任务未完成。
            </div>
          )}

          {/* 自动提交中提示 */}
          {!isSubmitted && submitting && (
            <div className="flex items-center justify-center gap-2 rounded-2xl bg-teal-50 py-3 text-sm text-teal-600">
              <Loader2 size={15} className="animate-spin" />
              正在自动提交...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
