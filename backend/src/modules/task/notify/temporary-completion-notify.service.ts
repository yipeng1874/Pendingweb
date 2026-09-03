import { prisma } from "../../../shared/prisma.js";
import { runtimeErrorDetails, writeRuntimeLog } from "../../../shared/runtime-log.js";
import { resolveTemporaryMode } from "../assignment/temporary-assignment.utils.js";
import { sendFeishuBatchMessage } from "./feishu-message.service.js";
import { formatCompletionAnswerLine } from "./completion-answer-format.js";

const MODE_LABELS = { ACCOUNT: "触达式", ANCHOR: "主播式", MANAGER: "管理式" } as const;

/** Called after the first successful submission of one temporary execution record. */
export async function notifyTemporaryRecordCompleted(recordId: string, submitterName: string): Promise<void> {
  const context: Record<string, unknown> = { recordId };
  try {
    const record = await prisma.taskRecord.findUnique({
      where: { id: recordId },
      include: {
        assignment: { include: { template: { include: { items: { orderBy: { sortOrder: "asc" } } } } } },
        user: { select: { nickname: true } },
        subjectOrg: { select: { name: true } },
        itemRecords: { select: { taskItemId: true, status: true, answerText: true, answerOptions: true, isLinkConfirmed: true } },
      },
    });
    if (!record || record.assignment.category !== "TEMPORARY" || record.status !== "submitted") return;
    const assignment = record.assignment;
    Object.assign(context, { assignmentId: assignment.id, issuerUserId: assignment.createdBy, subjectKey: record.subjectKey });
    const issuer = await prisma.user.findUnique({
      where: { id: assignment.createdBy },
      select: { status: true, feishuConfigId: true, feishuOpenId: true },
    });
    if (!issuer || issuer.status !== "active" || !issuer.feishuConfigId || !issuer.feishuOpenId) {
      writeRuntimeLog("info", "temporary_completion_notify_skipped", { ...context, reason: "ISSUER_UNAVAILABLE_OR_UNBOUND" });
      return;
    }
    const config = await prisma.feishuEnterpriseConfig.findFirst({
      where: { id: issuer.feishuConfigId, status: "active" },
      select: { appId: true, appSecret: true },
    });
    if (!config) {
      writeRuntimeLog("warn", "temporary_completion_notify_skipped", { ...context, reason: "FEISHU_CONFIG_UNAVAILABLE" });
      return;
    }
    const mode = resolveTemporaryMode(assignment);
    const subjectLines = record.subjectType === "ORG"
      ? [`组织：${record.subjectName || record.subjectOrg?.name || "未命名组织"}`, `提交人：${submitterName}`]
      : [`执行人：${record.subjectName || record.user?.nickname || submitterName}`];
    const answerMap = new Map(record.itemRecords.map((answer) => [answer.taskItemId, answer]));
    const text = [
      `【临时任务·${MODE_LABELS[mode]}】`,
      `任务标题：${assignment.template.title}`,
      ...assignment.template.items.map((item, index) => formatCompletionAnswerLine(index, item, answerMap.get(item.id))),
      ...subjectLines,
      "该任务必填子任务已全部完成。",
    ].join("\n");
    const result = await sendFeishuBatchMessage(config, [issuer.feishuOpenId], text);
    if (result.invalidOpenIds.length) throw new Error("任务发起人的飞书 openId 无效");
    writeRuntimeLog("info", "temporary_completion_notify_sent", { ...context, messageId: result.messageId });
  } catch (error) {
    writeRuntimeLog("error", "temporary_completion_notify_failed", { ...context, error: runtimeErrorDetails(error) });
  }
}
