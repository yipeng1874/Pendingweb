import type { CollaborationAnswer, CollaborationQuestion, HallDailyRecord, TaskRecord, WorkflowTask, WorkflowTaskStep } from "../types";

export function isPastDeadline(value?: string | null, now = Date.now()) {
  return Boolean(value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now);
}

export function workflowEditingReason(task: WorkflowTask, step: WorkflowTaskStep, userId?: string) {
  if (!userId || step.assigneeUserId !== userId) return `由 ${step.assigneeName || "节点负责人"} 填写`;
  if (step.status === "completed") return "该节点已完成";
  if (task.status !== "in_progress") return "任务已结束，无法填写";
  if (isPastDeadline(task.dueAt)) return "已超过截止时间，无法填写";
  return "";
}

export function hasCollaborationAnswer(question: CollaborationQuestion, answer?: CollaborationAnswer) {
  if (!answer) return false;
  if (question.itemType === "QA" || question.itemType === "FILL_BLANK") return Boolean(answer.answerText?.trim());
  if (question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") return Boolean(answer.answerOptions?.length);
  if (question.itemType === "LINK") return Boolean(answer.isLinkConfirmed);
  return question.itemType === "ATTACHMENT" && Boolean(answer.attachmentUrls?.length);
}

export function learningLink(value?: string | null) {
  const text = value?.trim();
  if (!text || /^(\/|\.\/|\.\.\/|#|\?)/.test(text)) return undefined;
  try {
    const url = new URL(/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(text) ? text : `https://${text}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export function dailySupplementDeadline(recordDate: string) {
  return new Date(Date.parse(`${recordDate}T16:00:00+08:00`) + 86400000).toISOString();
}

export function hallRecordForDetail(record: HallDailyRecord): TaskRecord {
  const leave = record.leaveRequests?.find((item) => item.status === "approved" || item.status === "pending");
  return {
    ...record,
    assignmentId: record.assignmentId ?? record.assignment?.id ?? "",
    subjectType: "ORG", subjectKey: record.hallOrg?.id ?? record.id,
    subjectName: record.hallOrg?.name ?? "当前厅",
    deadlineAt: dailySupplementDeadline(record.recordDate),
    editingBlockedReason: leave ? (leave.status === "approved" ? "已请假，无法填写" : "请假审核中，暂不可填写") : "",
    assignment: { id: record.assignmentId ?? "", category: "DAILY", status: record.assignment?.status, template: record.assignment?.template ?? undefined },
  };
}

export function recordEditingReason(record: TaskRecord) {
  if (record.editingBlockedReason) return record.editingBlockedReason;
  if (record.exemptionStatus === "approved" || record.exemption?.status === "approved") return "任务已豁免，无法填写";
  const supplementable = record.assignment?.category === "TEMPORARY" && record.subjectType === "ORG";
  if (record.status === "submitted" && !supplementable) return "任务已提交";
  if (record.assignment?.category === "DAILY" && record.recordDate) {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    if (record.recordDate > today) return "任务尚未开始";
    if (record.recordDate === today && record.assignment.status && record.assignment.status !== "active") return "该日常任务已停用";
    if (isPastDeadline(dailySupplementDeadline(record.recordDate))) return "已超过次日16:00补录截止时间";
  }
  return "";
}
