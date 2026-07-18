import { useEffect, useMemo, useRef, useState } from "react";
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
  ShieldOff,
  Sparkles,
  X,
} from "lucide-react";

import type { TaskItem, TaskItemRecord, TaskRecord } from "../../../types";
import { recordApi, uploadApi } from "../../../services/task";
import { orgTypeMeta } from "../../../shared/constants/org";
import { recordSubjectMeta, temporaryModeMeta } from "../../../shared/constants/taskTemporary";
import { normalizeLearningLink } from "../../../shared/utils/learningLink";

function resolveFileUrl(fileUrl: string) {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  return fileUrl.startsWith("/uploads") ? `/api${fileUrl}` : fileUrl;
}

function parseRecordDate(recordDate: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(recordDate);
  if (!matched) return null;
  return {
    year: Number(matched[1]),
    month: Number(matched[2]),
    day: Number(matched[3]),
  };
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

function getDailyTaskInfo(record: TaskRecord) {
  if (record.assignment?.category !== "DAILY" || !record.recordDate) return null;
  const nextDate = addDays(record.recordDate, 1);
  return {
    taskDateLabel: formatRecordDate(record.recordDate),
    taskDateRaw: record.recordDate,
    supplementDateLabel: formatRecordDate(nextDate),
    supplementDateRaw: nextDate,
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface Props {
  record: TaskRecord;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  formatDeadline: (record: TaskRecord) => string;
  urgent?: boolean;
  compact?: boolean;
  currentIdentityId?: string;
  rightSlot?: React.ReactNode;
}

function statusLabel(status: string) {
  if (status === "submitted") return { text: "已完成", cls: "bg-emerald-50 text-emerald-600" };
  if (status === "in_progress") return { text: "进行中", cls: "bg-blue-50 text-blue-600" };
  if (status === "overdue") return { text: "已逾期", cls: "bg-red-50 text-red-600" };
  return { text: "待开始", cls: "bg-slate-100 text-slate-500" };
}

function reconfirmBadge(record: TaskRecord) {
  if (record.reconfirmStatus === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-orange-600">
        <Sparkles size={10} />
        今日重点关注
      </span>
    );
  }
  if (record.reconfirmStatus === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-500">
        <CheckCircle2 size={10} />
        已确认
      </span>
    );
  }
  return null;
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

function canSupplementRecord(record: TaskRecord) {
  return record.assignment?.category === "TEMPORARY" && record.subjectType === "ORG" && record.status === "submitted";
}

function getIncompleteRequiredItems(record: TaskRecord) {
  const items = record.assignment?.template?.items ?? [];
  return items.filter((item) => item.isRequired && record.itemRecords?.find((entry) => entry.taskItemId === item.id)?.status !== "done");
}

function ItemRow({ item, itemRecord, recordId, onDone, allowSupplementAfterSubmit, index }: { item: TaskItem; itemRecord?: TaskItemRecord; recordId: string; onDone: () => void; allowSupplementAfterSubmit: boolean; index?: number }) {

  const [loading, setLoading] = useState(false);
  const [answerText, setAnswerText] = useState(itemRecord?.answerText ?? "");
  const [selectedOptions, setSelectedOptions] = useState<string[]>(itemRecord?.answerOptions ?? []);
  const [linkConfirmed, setLinkConfirmed] = useState(itemRecord?.isLinkConfirmed ?? false);
  const [uploading, setUploading] = useState(false);
  const [localFiles, setLocalFiles] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteActive, setPasteActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      localFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    };
  }, [localFiles]);
  const isDone = itemRecord?.status === "done";
  const showSupplementEditor = allowSupplementAfterSubmit && (item.itemType === "QA" || item.itemType === "ATTACHMENT");
  const showEditor = !isDone || showSupplementEditor;
  const learningLink = item.itemType === "LINK" ? normalizeLearningLink(item.linkUrl) : undefined;
  const completionSummary = useMemo(() => {
    if (!isDone || showEditor) return "";
    if (item.itemType === "SINGLE_CHOICE" || item.itemType === "MULTI_CHOICE") {
      return itemRecord?.answerOptions?.length ? `已选择：${itemRecord.answerOptions.join("、")}` : "已完成选择";
    }
    if (item.itemType === "QA") {
      return itemRecord?.answerText?.trim() ? `已填写：${itemRecord.answerText.trim()}` : "已提交回答";
    }
    if (item.itemType === "FILL_BLANK") {
      return "已确认完成";
    }
    if (item.itemType === "LINK") {
      return itemRecord?.isLinkConfirmed ? "已完成学习并确认" : "已完成学习";
    }
    if (item.itemType === "ATTACHMENT") {
      const count = itemRecord?.attachments?.length ?? 0;
      return count > 0 ? `已上传 ${count} 张图片` : "已上传附件";
    }
    return "已完成";
  }, [isDone, item.itemType, itemRecord?.answerOptions, itemRecord?.answerText, itemRecord?.attachments, itemRecord?.isLinkConfirmed, showEditor]);

  async function submit(done: boolean, extra?: { answerText?: string; answerOptions?: string[]; isLinkConfirmed?: boolean }) {
    if (loading) return;
    setLoading(true);
    try {
      await recordApi.submitItemRecord({
        taskRecordId: recordId,
        taskItemId: item.id,
        answerText: extra?.answerText ?? (answerText || undefined),
        answerOptions: extra?.answerOptions ?? (selectedOptions.length ? selectedOptions : undefined),
        isLinkConfirmed: extra?.isLinkConfirmed ?? linkConfirmed,
        done,
      });
      onDone();
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

  function getImageFilesFromClipboardData(clipboardData: DataTransfer) {
    const filesFromItems = Array.from(clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (filesFromItems.length > 0) return filesFromItems;
    return Array.from(clipboardData.files).filter((file) => file.type.startsWith("image/"));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const files = getImageFilesFromClipboardData(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    addImageFiles(files, "粘贴图片");
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

  useEffect(() => {
    if (item.itemType !== "ATTACHMENT" || !showEditor || !pasteActive) return;
    function handleWindowPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return;
      const files = getImageFilesFromClipboardData(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      addImageFiles(files, "粘贴图片");
    }
    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, [item.itemType, pasteActive, showEditor]);

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
      const targetItemRecord = itemRecord?.id
        ? itemRecord
        : await recordApi.submitItemRecord({
            taskRecordId: recordId,
            taskItemId: item.id,
            done: false,
          });
      for (const { file } of localFiles) {
        await uploadApi.upload(targetItemRecord.id, file);
      }
      localFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      setLocalFiles([]);
      await recordApi.submitItemRecord({
        taskRecordId: recordId,
        taskItemId: item.id,
        done: true,
      });
      onDone();
    } catch (error) {
      console.error(error);
      alert(getErrorMessage(error, "图片上传失败，请稍后重试"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteUploaded(attachmentId: string) {
    try {
      await uploadApi.deleteAttachment(attachmentId);
      onDone();
    } catch (error) {
      console.error(error);
      alert(getErrorMessage(error, "删除失败，请稍后重试"));
    }
  }

  return (
    <div className={`rounded-2xl border p-3 transition ${isDone ? "border-emerald-100 bg-emerald-50/60" : "border-slate-100 bg-white"}`}>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => submit(!isDone)}
          disabled={loading || item.itemType === "LINK" || item.itemType === "ATTACHMENT" || allowSupplementAfterSubmit}
          className="mt-0.5 shrink-0 text-slate-400 transition hover:text-emerald-500 disabled:cursor-default"
        >
          {loading ? <Loader2 size={16} className="animate-spin text-blue-500" /> : isDone ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={`text-base font-semibold ${isDone && !showSupplementEditor ? "text-slate-400 line-through" : "text-slate-800"}`}>
              {index !== undefined ? `${index}. ` : ""}{item.title}
            </p>
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-500">{itemTypeLabel(item.itemType)}</span>
            {item.isRequired && <span className="text-xs text-red-400">*必填</span>}
            {showSupplementEditor && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-600">可继续补充</span>}
          </div>
          {showEditor ? (
            <div className="mt-2">
              {item.itemType === "QA" && (
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
                    placeholder={showSupplementEditor ? "继续补充备注或阶段说明" : "请输入回答..."}
                    value={answerText}
                    onChange={(event) => setAnswerText(event.target.value)}
                  />
                  <button type="button" onClick={() => void submit(true)} disabled={!answerText.trim() || loading} className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white transition hover:bg-blue-600 disabled:opacity-40">
                    <Send size={13} />
                  </button>
                </div>
              )}
              {item.itemType === "FILL_BLANK" && !showSupplementEditor && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">该项为待办确认，下级勾选即可完成。</p>
                  <button type="button" onClick={() => void submit(true)} disabled={loading} className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs text-white transition hover:bg-emerald-600 disabled:opacity-40">勾选确认</button>
                </div>
              )}
              {item.itemType === "SINGLE_CHOICE" && item.options && !showSupplementEditor && (
                <div className="flex flex-wrap gap-2">
                  {item.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setSelectedOptions([option.label]);
                        void submit(true, { answerOptions: [option.label] });
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${selectedOptions.includes(option.label) ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              {item.itemType === "MULTI_CHOICE" && item.options && !showSupplementEditor && (
                <div className="flex flex-wrap gap-2">
                  {item.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedOptions((prev) => (prev.includes(option.label) ? prev.filter((value) => value !== option.label) : [...prev, option.label]))}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${selectedOptions.includes(option.label) ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                  {selectedOptions.length > 0 && <button type="button" onClick={() => void submit(true, { answerOptions: selectedOptions })} className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white transition hover:bg-blue-600">确认</button>}
                </div>
              )}
              {item.itemType === "LINK" && !showSupplementEditor && (
                <div className="flex flex-col gap-2">
                  {learningLink ? (
                    <a href={learningLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-500 hover:text-blue-700" onClick={() => setLinkConfirmed(true)}>
                      <ExternalLink size={14} />前往学习
                    </a>
                  ) : item.linkUrl ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-amber-600">
                      <ExternalLink size={14} />学习链接格式无效，请联系管理员修正
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 cursor-not-allowed text-sm text-slate-400">
                      <ExternalLink size={14} />学习链接未配置，请联系管理员补充
                    </span>
                  )}
                  {learningLink && linkConfirmed && <button type="button" onClick={() => void submit(true, { isLinkConfirmed: true })} className="w-fit rounded-lg bg-emerald-500 px-3 py-1.5 text-sm text-white transition hover:bg-emerald-600">已完成学习，确认提交</button>}
                </div>
              )}
              {item.itemType === "ATTACHMENT" && (
                <div className="space-y-2">
                  {/* 已上传图片 */}
                  {(itemRecord?.attachments?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {itemRecord!.attachments!.map((attachment) => (
                        <div key={attachment.id} className="relative rounded-lg border border-slate-200 bg-white p-1">
                          <img src={resolveFileUrl(attachment.fileUrl)} alt={attachment.fileName} className="h-16 w-16 rounded object-cover" />
                          <button
                            type="button"
                            onClick={() => void handleDeleteUploaded(attachment.id)}
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 本地预览 + 添加按钮（支持拖拽） */}
                  <div
                    className={`flex flex-wrap gap-2 rounded-lg border-2 border-dashed p-2 transition focus:outline-none focus:ring-2 focus:ring-blue-200 ${isDragOver || pasteActive ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}
                    tabIndex={0}
                    onFocus={() => setPasteActive(true)}
                    onBlur={() => setPasteActive(false)}
                    onMouseEnter={() => setPasteActive(true)}
                    onMouseLeave={() => setPasteActive(false)}
                    onPaste={handlePaste}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                  >
                    {localFiles.map(({ previewUrl }) => (
                      <div key={previewUrl} className="relative rounded-lg border border-blue-200 bg-white p-1">
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
                      className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-slate-400 transition hover:border-blue-400 hover:text-blue-500"
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
                      <div className="flex flex-1 items-center justify-center text-sm text-blue-400">松开鼠标以添加图片</div>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                  <p className="text-xs text-slate-400">支持点击“粘贴”读取剪贴板图片，也支持拖拽或点击上传，JPG / PNG / GIF / WebP，单张 ≤ 1MB{showSupplementEditor ? "，已提交后仍可继续追加" : ""}</p>
                  {localFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleSubmitAttachments()}
                      disabled={uploading}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white transition hover:bg-blue-600 disabled:opacity-40"
                    >
                      {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                      {uploading ? "上传中..." : `提交 ${localFiles.length} 张图片`}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : completionSummary ? (
            <>
              <p className="mt-2 text-xs leading-5 text-slate-500">{completionSummary}</p>
              {itemRecord?.completedByName && <p className="mt-1 text-[11px] text-slate-400">完成人：{itemRecord.completedByName}</p>}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TaskRecordCard({ record, expanded, onToggle, onRefresh, formatDeadline, urgent, compact = false, currentIdentityId, rightSlot }: Props) {
  const status = statusLabel(record.status);
  const reconfirmTag = reconfirmBadge(record);
  const items = record.assignment?.template?.items ?? [];
  const subjectMeta = recordSubjectMeta[record.subjectType];
  const allowSupplementAfterSubmit = canSupplementRecord(record);
  const [showDoneItems, setShowDoneItems] = useState(false);
  const pendingItems = useMemo(() => items.filter((item) => {
    const ir = record.itemRecords?.find((entry) => entry.taskItemId === item.id);
    return ir?.status !== "done";
  }), [items, record.itemRecords]);
  const doneItems = useMemo(() => items.filter((item) => {
    const ir = record.itemRecords?.find((entry) => entry.taskItemId === item.id);
    return ir?.status === "done";
  }), [items, record.itemRecords]);
  const tempModeMeta = record.assignment?.temporaryMode ? temporaryModeMeta[record.assignment.temporaryMode] : null;
  const isTouchTask = record.assignment?.category === "TEMPORARY" && record.assignment?.temporaryMode === "ACCOUNT";
  const leftBorderColor = urgent ? "border-l-red-400" : record.assignment?.category === "DAILY" ? "border-l-blue-400" : "border-l-violet-400";
  const visibleIdentityCount = record.visibleIdentityLinks?.length ?? 0;
  const collaboratorNames = (record.visibleIdentityLinks ?? []).map((entry) => entry.userName ?? entry.identityId).filter(Boolean);
  const publisherLabel = record.assignment?.publisher?.label ?? "未知发布人";
  const publisherPhone = record.assignment?.publisher?.phone?.trim() ?? "";
  const templateDescription = record.assignment?.template?.description?.trim() ?? "";
  const subjectOrgLabel = record.subjectOrgType ? orgTypeMeta[record.subjectOrgType].label : "组织";
  const dailyTaskInfo = getDailyTaskInfo(record);
  const incompleteRequiredItems = useMemo(() => getIncompleteRequiredItems(record), [record]);
  const isReconfirmPending = record.reconfirmStatus === "pending";
  const isReconfirmConfirmed = record.reconfirmStatus === "confirmed";
  const canSubmitRecord = record.status !== "submitted" && incompleteRequiredItems.length === 0 && items.length > 0 && !isReconfirmPending;

  // 二次确认操作
  const [reconfirming, setReconfirming] = useState(false);
  async function handleReconfirmRecord() {
    setReconfirming(true);
    try {
      await recordApi.reconfirmRecord(record.id);
      onRefresh();
    } catch (error) {
      console.error(error);
      alert(getErrorMessage(error, "确认失败，请稍后重试"));
    } finally {
      setReconfirming(false);
    }
  }

  // 日常任务使用内部独立展开状态，初始为 true（自动展开）
  const [dailyExpanded, setDailyExpanded] = useState(true);
  const isExpanded = dailyTaskInfo ? dailyExpanded : expanded;
  const handleToggle = dailyTaskInfo ? () => setDailyExpanded((v) => !v) : onToggle;

  const [showExemptionInput, setShowExemptionInput] = useState(false);
  const [exemptionReason, setExemptionReason] = useState("");
  const [exemptionLoading, setExemptionLoading] = useState(false);
  const prevDoneItemCountRef = useRef(doneItems.length);

  useEffect(() => {
    if (!isExpanded) return;
    if (pendingItems.length === 0 && doneItems.length > 0) {
      setShowDoneItems(true);
    } else if (doneItems.length > prevDoneItemCountRef.current) {
      setShowDoneItems(true);
    }
    prevDoneItemCountRef.current = doneItems.length;
  }, [doneItems.length, isExpanded, pendingItems.length]);

  const isTemporaryTask = record.assignment?.category === "TEMPORARY";
  const canApplyExemption = !isTemporaryTask && record.status !== "submitted" && (!record.exemption || record.exemption.status === "rejected");
  const exemptionStatusText = record.exemption?.status === "pending" ? "豁免审核中" : record.exemption?.status === "approved" ? "已批准豁免" : record.exemption?.status === "rejected" ? "豁免已拒绝" : null;

  async function handleApplyExemption() {
    if (!exemptionReason.trim()) return;
    setExemptionLoading(true);
    try {
      await recordApi.applyExemption({ taskRecordId: record.id, reason: exemptionReason });
      setShowExemptionInput(false);
      setExemptionReason("");
      onRefresh();
    } catch (error) {
      console.error(error);
      alert(getErrorMessage(error, "提交豁免失败，请稍后重试"));
    } finally {
      setExemptionLoading(false);
    }
  }

  async function handleCancelExemption() {
    setExemptionLoading(true);
    try {
      await recordApi.cancelExemption(record.id);
      onRefresh();
    } catch (error) {
      console.error(error);
      alert(getErrorMessage(error, "撤回失败，请稍后重试"));
    } finally {
      setExemptionLoading(false);
    }
  }

  async function handleSubmitRecord() {
    try {
      await recordApi.submitRecord(record.id);
      onRefresh();
    } catch (error) {
      console.error(error);
      alert(getErrorMessage(error, record.status === "overdue" ? "补录提交失败，请稍后重试" : "任务提交失败，请稍后重试"));
    }
  }

  const subjectHint = record.assignment?.category === "TEMPORARY"
    ? record.subjectType === "ORG"
      ? `当前按${subjectOrgLabel}协同完成，任一可见管理身份提交即可完成；提交后仍可继续补充备注或附件。`
      : visibleIdentityCount > 1
        ? `当前账号已映射 ${visibleIdentityCount} 个身份，任一身份确认都算同一份任务完成。`
        : tempModeMeta?.summary
    : null;

  const progress = record.totalItems > 0 ? Math.round((record.doneItems / record.totalItems) * 100) : 0;

  return (
    <div className={`overflow-hidden border border-l-4 bg-white transition ${compact ? "rounded-2xl border-slate-200/80 shadow-[0_2px_10px_rgba(15,23,42,0.04)]" : "rounded-3xl border-slate-100 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"} ${leftBorderColor}`}>
      <button type="button" className={`flex w-full items-center text-left transition hover:bg-slate-50 ${compact ? "gap-2.5 p-3" : "gap-3 p-4"}`} onClick={handleToggle}>
        {dailyTaskInfo ? (
          /* ── 日常任务：所有字段扁平化在同一 flex 行，彻底不换行 ── */
          <>
            {/* 1. 日期 */}
            <span className={`flex shrink-0 items-center gap-1 text-sm font-medium ${urgent ? "text-red-500" : "text-slate-500"}`}>
              <Clock size={14} />{dailyTaskInfo.taskDateLabel}
            </span>
            {/* 2. 补录提示（仅逾期） */}
            {record.status === "overdue" && (
              <span className="shrink-0 text-sm font-medium text-red-500">仅支持补录前一天</span>
            )}
            {/* 3. 身份标签（跨身份任务） */}
            {currentIdentityId && record.identityId && record.identityId !== currentIdentityId && (
              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">来自主播身份任务</span>
            )}
            {/* 4. 模板标题：flex-1 + min-w-0 + truncate，占满剩余空间并截断 */}
            <p className={`${compact ? "text-xs" : "text-sm"} min-w-0 flex-1 truncate font-normal text-slate-400`}>（{record.assignment?.template?.title ?? "任务"}）</p>
            {/* 5. 进度 */}
            {record.totalItems > 0 && (
              <span className="shrink-0 text-sm text-slate-400">{record.doneItems}/{record.totalItems}</span>
            )}
            {/* 6. 状态胶囊 */}
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>{status.text}</span>
            {/* 6.1 二次通知标签 */}
            {reconfirmTag}
            {/* 折叠箭头 */}
            {isExpanded ? <ChevronUp size={15} className="shrink-0 text-slate-400" /> : <ChevronDown size={15} className="shrink-0 text-slate-400" />}
          </>
        ) : (
          /* ── 非日常任务：保持原结构 ── */
          <>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                {!compact && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${status.cls}`}>{status.text}</span>}
                {!compact && reconfirmTag}
                {!compact && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{record.assignment?.category === "DAILY" ? "主播日常任务" : "临时任务"}</span>}
                {tempModeMeta && !compact && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tempModeMeta.badge}`}>{tempModeMeta.label}</span>}
                {!compact && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${subjectMeta.badge}`}>{subjectMeta.label}</span>}
                {record.subjectType === "ORG" && record.subjectOrgType && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${orgTypeMeta[record.subjectOrgType].badge}`}>{orgTypeMeta[record.subjectOrgType].label}</span>}
              </div>
              <p className={`${compact ? "line-clamp-2 text-sm leading-5" : "truncate text-base"} font-semibold text-slate-900`}>{record.assignment?.template?.title ?? "任务"}</p>
              {templateDescription && (
                <p className={`${compact ? "line-clamp-2" : "line-clamp-3"} mt-1 text-xs leading-5 text-slate-500`}>
                  <span className="font-medium text-slate-600">说明：</span>{templateDescription}
                </p>
              )}
              <div className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium ${urgent ? "text-red-500" : "text-slate-500"}`}>
                <span className="flex items-center gap-1"><Clock size={12} />{formatDeadline(record)}</span>
                {record.totalItems > 0 && (
                  <span>共{record.totalItems}项子任务{record.totalItems - record.doneItems > 0 ? `，未完成${record.totalItems - record.doneItems}项` : "，全部完成"}</span>
                )}
                {record.assignment?.category === "TEMPORARY" && <span className="max-w-full truncate">{record.subjectName ?? "未识别主体"}</span>}
                {record.assignment?.category === "TEMPORARY" && record.assignment?.temporaryMode === "ANCHOR" && currentIdentityId && record.identityId && record.identityId !== currentIdentityId && (
                  <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600">来自主播身份任务</span>
                )}
              </div>
              {record.assignment?.category === "TEMPORARY" && compact && (
                <div className="mt-2 text-xs font-medium leading-5 text-slate-500">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${status.cls}`}>{status.text}</span>
                    {reconfirmTag}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">临时任务</span>
                    {tempModeMeta && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tempModeMeta.badge}`}>{tempModeMeta.label}</span>}
                  </div>
                  <p>{isTouchTask ? "发布者账号" : "发布人"}：{publisherLabel}</p>
                </div>
              )}
              {record.assignment?.category === "TEMPORARY" && !compact && (
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                  {isTouchTask ? (
                    <p>发布者账号：{publisherLabel}</p>
                  ) : (
                    <p>发布人：{publisherLabel}{publisherPhone ? ` · ${publisherPhone}` : ""}</p>
                  )}
                  {record.subjectType === "USER" && <p>完成主体：当前账号（同账号任一身份完成即视为完成）</p>}
                  {record.subjectType === "ORG" && (
                    <>
                      <p>协同维护：{visibleIdentityCount > 0 ? `${visibleIdentityCount} 人` : "暂无协同人"}</p>
                      {collaboratorNames.length > 0 && <p>当前可见：{collaboratorNames.join("、")}</p>}
                      {record.lastSubmittedByName && <p>最近填写：{record.lastSubmittedByName}</p>}
                    </>
                  )}
                </div>
              )}
              {subjectHint && !compact && <p className="mt-2 text-xs leading-5 text-slate-500">{subjectHint}</p>}
            </div>
            {!compact && (
              <div className="w-24 shrink-0">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 text-right text-xs text-slate-400">{progress}%</p>
              </div>
            )}
            {compact && rightSlot && <div className="shrink-0">{rightSlot}</div>}
            {isExpanded ? <ChevronUp size={15} className="mt-1 shrink-0 text-slate-400" /> : <ChevronDown size={15} className="mt-1 shrink-0 text-slate-400" />}
          </>
        )}
      </button>

      {isExpanded && (
        <div className={`space-y-3 border-t border-slate-100 bg-slate-50/60 ${compact ? "p-3" : "p-4"}`}>

          {isReconfirmPending && (
            <div className="rounded-2xl bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-700">
              <div className="flex items-center gap-1.5 font-medium">
                <Sparkles size={13} />
                今日重点关注
              </div>
              <p className="mt-1.5 text-xs leading-5 text-orange-600/80">此任务明天截止，请回顾下方你已提交的内容是否准确无误；如需修改请联系任务发布者。</p>
            </div>
          )}
          {record.status === "submitted" && !isReconfirmPending && (
            <div className={`rounded-2xl px-4 py-3 text-sm ${allowSupplementAfterSubmit ? "bg-violet-50 text-violet-700" : "bg-emerald-50 text-emerald-700"}`}>{allowSupplementAfterSubmit ? "当前组织主体已完成提交，后续仍可继续补充备注或附件。多人补充内容会保留在同一条记录里。" : "任务已完成提交。"}</div>
          )}
          {items.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">暂无子任务</p>
          ) : (
            <>
              {pendingItems.length > 0 && (
                <div className="space-y-3">
                  {pendingItems.map((item) => {
                    const contributionSummary = record.itemContributionSummaries?.find((entry) => entry.taskItemId === item.id);
                    return (
                      <div key={item.id} className="space-y-2">
                        <ItemRow item={item} itemRecord={record.itemRecords?.find((entry) => entry.taskItemId === item.id)} recordId={record.id} onDone={onRefresh} allowSupplementAfterSubmit={allowSupplementAfterSubmit} index={items.indexOf(item) + 1} />
                        {record.assignment?.temporaryMode === "MANAGER" && contributionSummary?.contributions?.length ? (
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                            <p className="font-medium text-slate-700">协同填写记录</p>
                            <div className="mt-2 space-y-2">
                              {contributionSummary.contributions.map((contribution, index) => (
                                <div key={`${contribution.identityId}-${contribution.createdAt}-${index}`} className="rounded-lg bg-slate-50 px-2.5 py-2">
                                  <p className="font-medium text-slate-700">{contribution.contributorName ?? contribution.identityId}</p>
                                  <p className="mt-1 text-slate-500">{contribution.content}</p>
                                  <p className="mt-1 text-[11px] text-slate-400">{new Date(contribution.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
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
                      {doneItems.map((item) => {
                        const contributionSummary = record.itemContributionSummaries?.find((entry) => entry.taskItemId === item.id);
                        return (
                          <div key={item.id} className="space-y-2">
                            <ItemRow item={item} itemRecord={record.itemRecords?.find((entry) => entry.taskItemId === item.id)} recordId={record.id} onDone={onRefresh} allowSupplementAfterSubmit={allowSupplementAfterSubmit} index={items.indexOf(item) + 1} />
                            {record.assignment?.temporaryMode === "MANAGER" ? (
                              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                                <p className="font-medium text-slate-700">协同填写记录</p>
                                {contributionSummary?.contributions?.length ? (
                                  <div className="mt-2 space-y-2">
                                    {contributionSummary.contributions.map((contribution, index) => (
                                      <div key={`${contribution.identityId}-${contribution.createdAt}-${index}`} className="rounded-lg bg-slate-50 px-2.5 py-2">
                                        <p className="font-medium text-slate-700">{contribution.contributorName ?? contribution.identityId}</p>
                                        <p className="mt-1 text-slate-500">{contribution.content}</p>
                                        <p className="mt-1 text-[11px] text-slate-400">{new Date(contribution.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="mt-2 leading-5 text-slate-400">当前子任务暂无可追溯的协同填写记录。历史任务若未记录贡献流水，将仅展示当前结果与最后提交信息。</p>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {pendingItems.length === 0 && doneItems.length === 0 && (
                <p className="py-4 text-center text-sm text-slate-400">暂无子任务</p>
              )}
            </>
          )}
          {record.status !== "submitted" && incompleteRequiredItems.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              还有 {incompleteRequiredItems.length} 项必填子任务未完成，暂不可提交{record.assignment?.category === "DAILY" ? "主播日常任务" : "任务"}。
            </div>
          )}
          {isReconfirmPending && (
            <button type="button" onClick={() => void handleReconfirmRecord()} disabled={reconfirming} className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-medium text-white transition hover:bg-orange-600 disabled:opacity-50">
              {reconfirming ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              确认内容无误
            </button>
          )}
          {canSubmitRecord && <button type="button" onClick={() => void handleSubmitRecord()} className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-white transition ${record.status === "overdue" ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"}`}><Send size={14} />{record.status === "overdue" ? "提交补录" : "提交任务"}</button>}

          {!isTemporaryTask && exemptionStatusText && (
            <div className={`flex items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-sm ${record.exemption?.status === "approved" ? "bg-emerald-50 text-emerald-700" : record.exemption?.status === "rejected" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
              <span className="flex items-center gap-2"><ShieldOff size={14} />{exemptionStatusText}{record.exemption?.status === "rejected" && "，可重新发起申请"}</span>
              {(record.exemption?.status === "pending" || record.exemption?.status === "approved") && (
                <button type="button" onClick={() => void handleCancelExemption()} disabled={exemptionLoading} className="shrink-0 rounded-lg border border-current px-2 py-0.5 text-xs opacity-70 transition hover:opacity-100 disabled:opacity-30">
                  {exemptionLoading ? <Loader2 size={11} className="animate-spin" /> : "撤回申请"}
                </button>
              )}
            </div>
          )}
          {canApplyExemption && !showExemptionInput && <button type="button" onClick={() => setShowExemptionInput(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-sm text-slate-500 transition hover:border-amber-400 hover:text-amber-600"><ShieldOff size={14} />申请任务豁免</button>}
          {canApplyExemption && showExemptionInput && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-xs font-medium text-amber-700">填写豁免原因（管理员审核后生效）</p>
              <textarea className="w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none" rows={2} placeholder="请说明无法完成此任务的原因..." value={exemptionReason} onChange={(event) => setExemptionReason(event.target.value)} />
              <div className="flex gap-2">
                <button type="button" onClick={() => void handleApplyExemption()} disabled={!exemptionReason.trim() || exemptionLoading} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 py-1.5 text-sm text-white transition hover:bg-amber-600 disabled:opacity-40">{exemptionLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}提交申请</button>
                <button type="button" onClick={() => { setShowExemptionInput(false); setExemptionReason(""); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100"><X size={13} /></button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
