import { Prisma } from "@prisma/client";
import { prisma } from "../../../shared/prisma.js";
import type { WorkflowQuestionType as PrismaQuestionType } from "@prisma/client";

export type WorkflowTaskStatus = "in_progress" | "completed" | "ended";
export type WorkflowStepStatus = "pending" | "active" | "completed";

export type WorkflowTaskQuestionType = "QA" | "FILL_BLANK" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "LINK" | "ATTACHMENT";

export type WorkflowTaskQuestionRecord = {
  id: string;
  title: string;
  itemType: WorkflowTaskQuestionType;
  isRequired: boolean;
  options?: string[];
  linkUrl?: string | null;
};

export type WorkflowStepAnswer = {
  questionId: string;
  answerText?: string;
  answerOptions?: string[];
  isLinkConfirmed?: boolean;
  attachmentUrls?: string[];
};

export type WorkflowTaskStepRecord = {
  id: string;
  order: number;
  title: string;
  requirement: string;
  questions: WorkflowTaskQuestionRecord[];
  assigneeUserId: string;
  assigneeName: string;
  assigneeOrgId?: string | null;
  assigneeOrgName?: string | null;
  status: WorkflowStepStatus;
  completedAt?: string | null;
  stepAnswers?: WorkflowStepAnswer[];
  submittedAt?: string | null;
  submittedByUserId?: string | null;
};

export type WorkflowTaskRecord = {
  id: string;
  mode: "workflow";
  title: string;
  description?: string;
  targetOrgId: string;
  targetOrgName: string;
  issuerOrgId?: string | null;
  issuerOrgName?: string | null;
  issuerScopePath?: string | null;
  createdByUserId: string;
  createdByIdentityId: string;
  createdByName: string;
  dueAt?: string | null;
  status: WorkflowTaskStatus;
  currentStepOrder: number;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowTaskStepRecord[];
};

export type WorkflowTaskCreateInput = Omit<WorkflowTaskRecord, "id" | "createdAt" | "updatedAt" | "steps"> & {
  steps: Array<Omit<WorkflowTaskStepRecord, "id" | "completedAt" | "questions"> & {
    questions: Array<Omit<WorkflowTaskQuestionRecord, "id">>;
  }>;
};

// ─── 内部辅助：Prisma 行 → 业务类型 ────────────────────────────────────────────

const STEP_INCLUDE = {
  questions: { orderBy: { id: "asc" as const } },
  answers: true,
};

const TASK_INCLUDE = {
  steps: {
    orderBy: { order: "asc" as const },
    include: STEP_INCLUDE,
  },
};

type DbTask = Awaited<ReturnType<typeof prisma.workflowTask.findUnique>> & {
  steps: Array<{
    id: string;
    taskId: string;
    order: number;
    title: string;
    requirement: string;
    assigneeUserId: string;
    assigneeName: string;
    assigneeOrgId: string | null;
    assigneeOrgName: string | null;
    status: string;
    submittedAt: Date | null;
    submittedByUserId: string | null;
    completedAt: Date | null;
    questions: Array<{
      id: string;
      stepId: string;
      title: string;
      itemType: string;
      isRequired: boolean;
      options: unknown;
      linkUrl: string | null;
    }>;
    answers: Array<{
      id: string;
      stepId: string;
      questionId: string;
      answerText: string | null;
      answerOptions: unknown;
      isLinkConfirmed: boolean | null;
      attachmentUrls: unknown;
    }>;
  }>;
};

function mapDbTaskToRecord(t: NonNullable<DbTask>): WorkflowTaskRecord {
  return {
    id: t.id,
    mode: "workflow",
    title: t.title,
    description: t.description ?? undefined,
    targetOrgId: t.targetOrgId,
    targetOrgName: t.targetOrgName,
    issuerOrgId: t.issuerOrgId,
    issuerOrgName: t.issuerOrgName,
    issuerScopePath: t.issuerScopePath,
    createdByUserId: t.createdByUserId,
    createdByIdentityId: t.createdByIdentityId,
    createdByName: t.createdByName,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    status: t.status as WorkflowTaskStatus,
    currentStepOrder: t.currentStepOrder,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    steps: t.steps.map((s) => ({
      id: s.id,
      order: s.order,
      title: s.title,
      requirement: s.requirement,
      assigneeUserId: s.assigneeUserId,
      assigneeName: s.assigneeName,
      assigneeOrgId: s.assigneeOrgId,
      assigneeOrgName: s.assigneeOrgName,
      status: s.status as WorkflowStepStatus,
      submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
      submittedByUserId: s.submittedByUserId,
      completedAt: s.completedAt ? s.completedAt.toISOString() : null,
      questions: s.questions.map((q) => ({
        id: q.id,
        title: q.title,
        itemType: q.itemType as WorkflowTaskQuestionType,
        isRequired: q.isRequired,
        options: Array.isArray(q.options) ? (q.options as string[]) : [],
        linkUrl: q.linkUrl,
      })),
      stepAnswers: s.answers.map((a) => ({
        questionId: a.questionId,
        answerText: a.answerText ?? undefined,
        answerOptions: Array.isArray(a.answerOptions) ? (a.answerOptions as string[]) : undefined,
        isLinkConfirmed: a.isLinkConfirmed ?? undefined,
        attachmentUrls: Array.isArray(a.attachmentUrls) ? (a.attachmentUrls as string[]) : undefined,
      })),
    })),
  };
}

// ─── 过期处理（批量） ───────────────────────────────────────────────────────────
async function applyWorkflowExpire() {
  const now = new Date();
  await prisma.workflowTask.updateMany({
    where: { status: "in_progress", dueAt: { lt: now } },
    data: { status: "ended" },
  });
}

// ─── 查询 ──────────────────────────────────────────────────────────────────────
export async function listWorkflowTasks(): Promise<WorkflowTaskRecord[]> {
  const tasks = await prisma.workflowTask.findMany({
    include: TASK_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return tasks.map((t) => mapDbTaskToRecord(t as unknown as NonNullable<DbTask>));
}

export async function getWorkflowTasksForUser(userId: string): Promise<WorkflowTaskRecord[]> {
  const now = new Date();

  const tasks = await prisma.workflowTask.findMany({
    where: {
      status: { not: "ended" },
      OR: [
        { dueAt: null },
        { dueAt: { gt: now } },
      ],
      steps: { some: { assigneeUserId: userId } },
    },
    include: TASK_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return tasks.map((t) => mapDbTaskToRecord(t as unknown as NonNullable<DbTask>));
}

export async function getWorkflowTasksByIssuer(userId: string): Promise<WorkflowTaskRecord[]> {
  await applyWorkflowExpire();

  const tasks = await prisma.workflowTask.findMany({
    where: { createdByUserId: userId },
    include: TASK_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return tasks.map((t) => mapDbTaskToRecord(t as unknown as NonNullable<DbTask>));
}

export async function getWorkflowTaskById(taskId: string): Promise<WorkflowTaskRecord | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id: taskId },
    include: TASK_INCLUDE,
  });
  if (!t) return null;
  return mapDbTaskToRecord(t as unknown as NonNullable<DbTask>);
}

// ─── 提交节点（一次性全量提交，兼容旧接口） ────────────────────────────────────
export async function submitWorkflowStep(
  taskId: string,
  stepId: string,
  userId: string,
  answers: WorkflowStepAnswer[],
): Promise<{ success: boolean; task?: WorkflowTaskRecord; error?: string }> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    include: { task: true },
  });
  if (!step || step.taskId !== taskId) return { success: false, error: "STEP_NOT_FOUND" };
  if (step.assigneeUserId !== userId) return { success: false, error: "FORBIDDEN" };
  if (step.status === "completed") return { success: false, error: "STEP_ALREADY_COMPLETED" };

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // 批量 upsert 答案
    for (const ans of answers) {
      await tx.workflowAnswer.upsert({
        where: { stepId_questionId: { stepId, questionId: ans.questionId } },
        create: {
          stepId,
          questionId: ans.questionId,
          answerText: ans.answerText ?? null,
          answerOptions: ans.answerOptions ?? Prisma.JsonNull,
          isLinkConfirmed: ans.isLinkConfirmed ?? null,
          attachmentUrls: ans.attachmentUrls ?? Prisma.JsonNull,
        },
        update: {
          answerText: ans.answerText ?? null,
          answerOptions: ans.answerOptions ?? Prisma.JsonNull,
          isLinkConfirmed: ans.isLinkConfirmed ?? null,
          attachmentUrls: ans.attachmentUrls ?? Prisma.JsonNull,
        },
      });
    }

    // 标记节点完成
    await tx.workflowStep.update({
      where: { id: stepId },
      data: {
        status: "completed",
        submittedAt: now,
        submittedByUserId: userId,
        completedAt: now,
      },
    });

    // 检查是否所有节点都完成
    const allSteps = await tx.workflowStep.findMany({ where: { taskId } });
    const updatedSteps = allSteps.map((s) => (s.id === stepId ? { ...s, status: "completed" } : s));
    const allCompleted = updatedSteps.every((s) => s.status === "completed");
    const firstIncomplete = updatedSteps.find((s) => s.status !== "completed");

    await tx.workflowTask.update({
      where: { id: taskId },
      data: {
        status: allCompleted ? "completed" : "in_progress",
        currentStepOrder: firstIncomplete ? firstIncomplete.order : (step.task.currentStepOrder),
        updatedAt: now,
      },
    });
  });

  const updated = await getWorkflowTaskById(taskId);
  return { success: true, task: updated ?? undefined };
}

/**
 * 保存单道题目的答案（草稿），若节点内所有必填题均已填则自动完成节点。
 */
export async function saveStepQuestionAnswer(
  taskId: string,
  stepId: string,
  userId: string,
  answer: WorkflowStepAnswer,
): Promise<{ success: boolean; task?: WorkflowTaskRecord; stepCompleted?: boolean; error?: string }> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    include: { questions: true, task: true },
  });
  if (!step || step.taskId !== taskId) return { success: false, error: "STEP_NOT_FOUND" };
  if (step.assigneeUserId !== userId) return { success: false, error: "FORBIDDEN" };
  if (step.status === "completed") return { success: false, error: "STEP_ALREADY_COMPLETED" };

  const now = new Date();

  // upsert 答案
  await prisma.workflowAnswer.upsert({
    where: { stepId_questionId: { stepId, questionId: answer.questionId } },
    create: {
      stepId,
      questionId: answer.questionId,
      answerText: answer.answerText ?? null,
      answerOptions: answer.answerOptions ?? Prisma.JsonNull,
      isLinkConfirmed: answer.isLinkConfirmed ?? null,
      attachmentUrls: answer.attachmentUrls ?? Prisma.JsonNull,
    },
    update: {
      answerText: answer.answerText ?? null,
      answerOptions: answer.answerOptions ?? Prisma.JsonNull,
      isLinkConfirmed: answer.isLinkConfirmed ?? null,
      attachmentUrls: answer.attachmentUrls ?? Prisma.JsonNull,
    },
  });

  // 拉最新答案，判断必填题是否全填
  const freshAnswers = await prisma.workflowAnswer.findMany({ where: { stepId } });
  const allRequiredFilled = step.questions.every((q) => {
    if (!q.isRequired) return true;
    const ans = freshAnswers.find((a) => a.questionId === q.id);
    if (!ans) return false;
    if (q.itemType === "FILL_BLANK" || q.itemType === "QA") return !!(ans.answerText?.trim());
    if (q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE")
      return (Array.isArray(ans.answerOptions) ? ans.answerOptions.length : 0) > 0;
    if (q.itemType === "LINK") return !!ans.isLinkConfirmed;
    if (q.itemType === "ATTACHMENT")
      return (Array.isArray(ans.attachmentUrls) ? ans.attachmentUrls.length : 0) > 0;
    return false;
  });

  let stepCompleted = false;
  if (allRequiredFilled) {
    stepCompleted = true;
    await prisma.$transaction(async (tx) => {
      await tx.workflowStep.update({
        where: { id: stepId },
        data: {
          status: "completed",
          submittedAt: now,
          submittedByUserId: userId,
          completedAt: now,
        },
      });

      const allSteps = await tx.workflowStep.findMany({ where: { taskId } });
      const updatedSteps = allSteps.map((s) => (s.id === stepId ? { ...s, status: "completed" } : s));
      const allDone = updatedSteps.every((s) => s.status === "completed");
      const firstIncomplete = updatedSteps.find((s) => s.status !== "completed");

      await tx.workflowTask.update({
        where: { id: taskId },
        data: {
          status: allDone ? "completed" : "in_progress",
          currentStepOrder: firstIncomplete ? firstIncomplete.order : step.task.currentStepOrder,
          updatedAt: now,
        },
      });
    });
  } else {
    // 仅更新 updatedAt
    await prisma.workflowTask.update({
      where: { id: taskId },
      data: { updatedAt: now },
    });
  }

  const updated = await getWorkflowTaskById(taskId);
  return { success: true, task: updated ?? undefined, stepCompleted };
}

// ─── 创建流转任务 ──────────────────────────────────────────────────────────────
export async function createWorkflowTask(input: WorkflowTaskCreateInput): Promise<WorkflowTaskRecord> {
  const task = await prisma.workflowTask.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      targetOrgId: input.targetOrgId,
      targetOrgName: input.targetOrgName,
      issuerOrgId: input.issuerOrgId ?? null,
      issuerOrgName: input.issuerOrgName ?? null,
      issuerScopePath: input.issuerScopePath ?? null,
      createdByUserId: input.createdByUserId,
      createdByIdentityId: input.createdByIdentityId,
      createdByName: input.createdByName,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      status: "in_progress",
      currentStepOrder: 1,
      steps: {
        create: input.steps.map((step, index) => ({
          order: index + 1,
          title: step.title,
          requirement: step.requirement,
          assigneeUserId: step.assigneeUserId,
          assigneeName: step.assigneeName,
          assigneeOrgId: step.assigneeOrgId ?? null,
          assigneeOrgName: step.assigneeOrgName ?? null,
          status: "active",
          questions: {
            create: step.questions.map((q) => ({
              title: q.title,
              itemType: q.itemType as PrismaQuestionType,
              isRequired: q.isRequired,
              options: (q.options ?? []) as string[],
              linkUrl: q.linkUrl ?? null,
            })),
          },
        })),
      },
    },
    include: TASK_INCLUDE,
  });
  return mapDbTaskToRecord(task as unknown as NonNullable<DbTask>);
}
