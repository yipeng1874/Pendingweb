import { prisma } from "../../../shared/prisma.js";
import { runtimeErrorDetails, writeRuntimeLog } from "../../../shared/runtime-log.js";
import { sendFeishuBatchMessage } from "./feishu-message.service.js";
import { formatCompletionAnswerLine } from "./completion-answer-format.js";

type WorkflowCompletion = {
  taskId: string;
  taskTitle: string;
  issuerUserId: string;
  stepId: string;
  questions: Array<{ id: string; title: string; itemType: string }>;
  assigneeName: string;
};

/** Called only by the request that committed the node's first completion. */
export async function notifyWorkflowStepCompleted(completion: WorkflowCompletion): Promise<void> {
  const context = { taskId: completion.taskId, stepId: completion.stepId, issuerUserId: completion.issuerUserId };
  try {
    const issuer = await prisma.user.findUnique({
      where: { id: completion.issuerUserId },
      select: { status: true, feishuConfigId: true, feishuOpenId: true },
    });
    if (!issuer || issuer.status !== "active" || !issuer.feishuConfigId || !issuer.feishuOpenId) {
      writeRuntimeLog("info", "workflow_completion_notify_skipped", { ...context, reason: "ISSUER_UNAVAILABLE_OR_UNBOUND" });
      return;
    }
    const config = await prisma.feishuEnterpriseConfig.findFirst({
      where: { id: issuer.feishuConfigId, status: "active" },
      select: { appId: true, appSecret: true },
    });
    if (!config) {
      writeRuntimeLog("warn", "workflow_completion_notify_skipped", { ...context, reason: "FEISHU_CONFIG_UNAVAILABLE" });
      return;
    }
    // Read committed answers so the last saved question is included in both submission paths.
    const answers = await prisma.workflowAnswer.findMany({
      where: { stepId: completion.stepId },
      select: { questionId: true, answerText: true, answerOptions: true, isLinkConfirmed: true },
    });
    const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));
    const text = [
      `【流转任务·（${completion.assigneeName}）节点完成】`,
      `主任务：${completion.taskTitle}`,
      ...completion.questions.map((question, index) => formatCompletionAnswerLine(index, question, answerMap.get(question.id))),
      `执行人：${completion.assigneeName}`,
      "该节点必填子任务已全部完成。",
    ].join("\n");
    const result = await sendFeishuBatchMessage(config, [issuer.feishuOpenId], text);
    if (result.invalidOpenIds.length) throw new Error("任务发起人的飞书 openId 无效");
    writeRuntimeLog("info", "workflow_completion_notify_sent", { ...context, messageId: result.messageId });
  } catch (error) {
    // Completion has already committed. Notification errors must not undo it or ask the executor to resubmit.
    writeRuntimeLog("error", "workflow_completion_notify_failed", { ...context, error: runtimeErrorDetails(error) });
  }
}
