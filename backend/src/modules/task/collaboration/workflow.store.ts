import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type WorkflowTaskStatus = "draft" | "in_progress" | "completed" | "ended";
export type WorkflowStepStatus = "pending" | "active" | "completed";

export type WorkflowTaskQuestionType = "FILL_BLANK" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "LINK" | "ATTACHMENT";

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

type WorkflowTaskDb = {
  tasks: WorkflowTaskRecord[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "workflow-tasks.json");

async function ensureDb(): Promise<WorkflowTaskDb> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const content = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(content) as Partial<WorkflowTaskDb>;
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch {
    const initial = { tasks: [] } satisfies WorkflowTaskDb;
    await writeFile(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
}

async function saveDb(db: WorkflowTaskDb) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

export async function listWorkflowTasks() {
  const db = await ensureDb();
  return db.tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getWorkflowTasksForUser(userId: string) {
  const db = await ensureDb();
  const now = new Date();
  let dirty = false;

  for (const task of db.tasks) {
    // 懒判断：in_progress 任务到达截止时间则自动打 ended
    if (task.status === "in_progress" && task.dueAt && new Date(task.dueAt) < now) {
      task.status = "ended";
      task.updatedAt = now.toISOString();
      dirty = true;
    }
  }

  if (dirty) {
    await saveDb(db);
  }

  return db.tasks
    .filter((task) =>
      // 只返回该用户参与的、且非 ended 状态的任务（已结束不出现在"我的待办"）
      task.status !== "ended" &&
      task.steps.some((step) => step.assigneeUserId === userId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getWorkflowTasksByIssuer(userId: string) {
  const db = await ensureDb();
  const now = new Date();
  let dirty = false;

  // 懒判断：in_progress 任务到达截止时间则自动打 ended（与 getWorkflowTasksForUser 保持一致）
  for (const task of db.tasks) {
    if (task.status === "in_progress" && task.dueAt && new Date(task.dueAt) < now) {
      task.status = "ended";
      task.updatedAt = now.toISOString();
      dirty = true;
    }
  }
  if (dirty) await saveDb(db);

  // 严格按发布者过滤：谁发布谁能看，不做 scopePath 前缀匹配
  return db.tasks
    .filter((task) => task.createdByUserId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getWorkflowTaskById(taskId: string) {
  const db = await ensureDb();
  return db.tasks.find((t) => t.id === taskId) ?? null;
}

export async function submitWorkflowStep(
  taskId: string,
  stepId: string,
  userId: string,
  answers: WorkflowStepAnswer[],
): Promise<{ success: boolean; task?: WorkflowTaskRecord; error?: string }> {
  const db = await ensureDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: "TASK_NOT_FOUND" };

  const step = task.steps.find((s) => s.id === stepId);
  if (!step) return { success: false, error: "STEP_NOT_FOUND" };
  if (step.assigneeUserId !== userId) return { success: false, error: "FORBIDDEN" };
  if (step.status === "completed") return { success: false, error: "STEP_ALREADY_COMPLETED" };

  const now = new Date().toISOString();
  step.stepAnswers = answers;
  step.submittedAt = now;
  step.submittedByUserId = userId;
  step.status = "completed";
  step.completedAt = now;

  // 更新 currentStepOrder 为第一个未完成节点的 order（兼容并行填写场景）
  const firstIncomplete = task.steps.find((s) => s.status !== "completed");
  if (firstIncomplete) {
    task.currentStepOrder = firstIncomplete.order;
  }

  const allCompleted = task.steps.every((s) => s.status === "completed");
  if (allCompleted) {
    task.status = "completed";
  }
  task.updatedAt = now;

  await saveDb(db);
  return { success: true, task };
}

/**
 * 保存单道题目的答案（草稿），若节点内所有必填题均已填则自动完成节点。
 * 返回更新后的任务，以及是否刚刚触发了节点完成。
 */
export async function saveStepQuestionAnswer(
  taskId: string,
  stepId: string,
  userId: string,
  answer: WorkflowStepAnswer,
): Promise<{ success: boolean; task?: WorkflowTaskRecord; stepCompleted?: boolean; error?: string }> {
  const db = await ensureDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: "TASK_NOT_FOUND" };

  const step = task.steps.find((s) => s.id === stepId);
  if (!step) return { success: false, error: "STEP_NOT_FOUND" };
  if (step.assigneeUserId !== userId) return { success: false, error: "FORBIDDEN" };
  // 已完成的节点不允许修改
  if (step.status === "completed") return { success: false, error: "STEP_ALREADY_COMPLETED" };

  const now = new Date().toISOString();

  // 更新或插入该题答案
  if (!step.stepAnswers) step.stepAnswers = [];
  const idx = step.stepAnswers.findIndex((a) => a.questionId === answer.questionId);
  if (idx >= 0) {
    step.stepAnswers[idx] = answer;
  } else {
    step.stepAnswers.push(answer);
  }

  // 检查是否所有必填题都已有有效答案
  const allRequiredFilled = step.questions.every((q) => {
    if (!q.isRequired) return true;
    const ans = step.stepAnswers?.find((a) => a.questionId === q.id);
    if (!ans) return false;
    if (q.itemType === "FILL_BLANK") return !!ans.answerText?.trim();
    if (q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE") return (ans.answerOptions?.length ?? 0) > 0;
    if (q.itemType === "LINK") return !!ans.isLinkConfirmed;
    if (q.itemType === "ATTACHMENT") return (ans.attachmentUrls?.length ?? 0) > 0;
    return false;
  });

  let stepCompleted = false;
  if (allRequiredFilled) {
    step.status = "completed";
    step.completedAt = now;
    step.submittedAt = now;
    step.submittedByUserId = userId;
    stepCompleted = true;

    // 更新 currentStepOrder 为第一个未完成节点（并行填写场景）
    const firstIncomplete = task.steps.find((s) => s.status !== "completed");
    if (firstIncomplete) {
      task.currentStepOrder = firstIncomplete.order;
    }

    // 检查整个任务是否完成
    if (task.steps.every((s) => s.status === "completed")) {
      task.status = "completed";
    }
  }

  task.updatedAt = now;
  await saveDb(db);
  return { success: true, task, stepCompleted };
}

export async function createWorkflowTask(input: WorkflowTaskCreateInput) {
  const db = await ensureDb();
  const now = new Date().toISOString();
  const task: WorkflowTaskRecord = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    steps: input.steps.map((step, index) => ({
      ...step,
      id: randomUUID(),
      questions: step.questions.map((question) => ({
        ...question,
        id: randomUUID(),
      })),
      order: index + 1,
      status: "active",
      completedAt: null,
    })),
  };
  db.tasks.unshift(task);
  await saveDb(db);
  return task;
}
