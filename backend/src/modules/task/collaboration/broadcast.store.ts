import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ─── 题目类型 ──────────────────────────────────────────────────────────────────
export type BroadcastQuestionType = "QA" | "FILL_BLANK" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "LINK" | "ATTACHMENT";

export type BroadcastQuestion = {
  id: string;
  title: string;
  itemType: BroadcastQuestionType;
  isRequired: boolean;
  options?: string[];
  linkUrl?: string | null;
};

// ─── 任务记录（每个主播一条） ────────────────────────────────────────────────────
export type BroadcastAnchorRecord = {
  id: string;
  /** 对应的主播 userId */
  anchorUserId: string;
  anchorNickname: string;
  anchorPhone: string;
  anchorDouyinNo?: string | null;
  /** 主播归属厅 orgId */
  anchorOrgId?: string | null;
  anchorOrgName?: string | null;
  status: "pending" | "in_progress" | "submitted" | "overdue";
  submittedAt?: string | null;
};

// ─── 群发任务主体 ──────────────────────────────────────────────────────────────
export type BroadcastTask = {
  id: string;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  /** 发布者信息 */
  createdByUserId: string;
  createdByIdentityId: string;
  createdByName: string;
  /** 所属厅 */
  hallOrgId: string;
  hallOrgName: string;
  /** 题目列表 */
  questions: BroadcastQuestion[];
  /** 每个主播对应的任务记录 */
  anchorRecords: BroadcastAnchorRecord[];
  status: "active" | "ended";
  createdAt: string;
  updatedAt: string;
};

// ─── 存储 ──────────────────────────────────────────────────────────────────────
type BroadcastDb = { tasks: BroadcastTask[] };

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "broadcast-tasks.json");

async function ensureDb(): Promise<BroadcastDb> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const content = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(content) as Partial<BroadcastDb>;
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch {
    const initial: BroadcastDb = { tasks: [] };
    await writeFile(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
}

async function saveDb(db: BroadcastDb) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

// ─── 带 answers 的完整任务类型（厅管看板用） ────────────────────────────────────
export type BroadcastTaskWithAnswers = Omit<BroadcastTask, "anchorRecords"> & {
  anchorRecords: BroadcastAnchorRecordWithAnswers[];
};

// ─── 查询 ──────────────────────────────────────────────────────────────────────
export async function listBroadcastTasksByIssuer(userId: string): Promise<BroadcastTask[]> {
  const db = await ensureDb();
  autoExpire(db);
  return db.tasks
    .filter((t) => t.createdByUserId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 厅管看板专用：返回含每位主播 answers 的完整数据（已废弃，保留兼容） */
export async function listBroadcastTasksByIssuerWithAnswers(userId: string): Promise<BroadcastTaskWithAnswers[]> {
  const db = await ensureDb();
  autoExpire(db);
  return db.tasks
    .filter((t) => t.createdByUserId === userId)
    .map((t) => ({
      ...t,
      anchorRecords: t.anchorRecords.map((r) => ({
        ...r,
        answers: ((r as BroadcastAnchorRecordWithAnswers).answers ?? []),
      })),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── 分页查询（不含 answers，节省带宽） ──────────────────────────────────────
export type ListBroadcastTasksPageOptions = {
  page: number;
  pageSize: number;
};

export type BroadcastTaskPageResult = {
  tasks: BroadcastTaskWithAnswers[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

/** 厅管看板分页查询：anchorRecords.answers 为空数组，需点击后懒加载 */
export async function listBroadcastTasksByIssuerPaged(
  userId: string,
  opts: ListBroadcastTasksPageOptions,
): Promise<BroadcastTaskPageResult> {
  const db = await ensureDb();
  autoExpire(db);

  const sorted = db.tasks
    .filter((t) => t.createdByUserId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = sorted.length;
  const start = (opts.page - 1) * opts.pageSize;
  const slice = sorted.slice(start, start + opts.pageSize);

  // ⚡ 剥离 answers，只保留主播状态摘要
  const tasks: BroadcastTaskWithAnswers[] = slice.map((t) => ({
    ...t,
    anchorRecords: t.anchorRecords.map((r) => ({
      ...r,
      answers: [],
    })),
  }));

  return {
    tasks,
    total,
    page: opts.page,
    pageSize: opts.pageSize,
    hasMore: start + opts.pageSize < total,
  };
}

/** 懒加载：获取单个任务所有主播的答案 */
export async function getBroadcastTaskAnchorAnswers(
  taskId: string,
  userId: string,
): Promise<BroadcastAnchorRecordWithAnswers[] | null> {
  const db = await ensureDb();
  const task = db.tasks.find((t) => t.id === taskId && t.createdByUserId === userId);
  if (!task) return null;
  return task.anchorRecords.map((r) => ({
    ...r,
    answers: ((r as BroadcastAnchorRecordWithAnswers).answers ?? []),
  }));
}

export async function getBroadcastTaskById(taskId: string): Promise<BroadcastTask | null> {
  const db = await ensureDb();
  return db.tasks.find((t) => t.id === taskId) ?? null;
}

// ─── 创建 ──────────────────────────────────────────────────────────────────────
export type BroadcastCreateInput = {
  title: string;
  description?: string;
  dueAt?: string | null;
  createdByUserId: string;
  createdByIdentityId: string;
  createdByName: string;
  hallOrgId: string;
  hallOrgName: string;
  questions: Array<Omit<BroadcastQuestion, "id">>;
  anchors: Array<{
    userId: string;
    nickname: string;
    phone: string;
    douyinNo?: string | null;
    orgId?: string | null;
    orgName?: string | null;
  }>;
};

export async function createBroadcastTask(input: BroadcastCreateInput): Promise<BroadcastTask> {
  const db = await ensureDb();
  const now = new Date().toISOString();
  const task: BroadcastTask = {
    id: randomUUID(),
    title: input.title,
    description: input.description ?? null,
    dueAt: input.dueAt ?? null,
    createdByUserId: input.createdByUserId,
    createdByIdentityId: input.createdByIdentityId,
    createdByName: input.createdByName,
    hallOrgId: input.hallOrgId,
    hallOrgName: input.hallOrgName,
    questions: input.questions.map((q) => ({ ...q, id: randomUUID() })),
    anchorRecords: input.anchors.map((anchor) => ({
      id: randomUUID(),
      anchorUserId: anchor.userId,
      anchorNickname: anchor.nickname,
      anchorPhone: anchor.phone,
      anchorDouyinNo: anchor.douyinNo ?? null,
      anchorOrgId: anchor.orgId ?? null,
      anchorOrgName: anchor.orgName ?? null,
      status: "pending" as const,
      submittedAt: null,
    })),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  db.tasks.unshift(task);
  await saveDb(db);
  return task;
}

// ─── 答案存储类型 ────────────────────────────────────────────────────────────
export type BroadcastAnswer = {
  questionId: string;
  answerText?: string;
  answerOptions?: string[];
  isLinkConfirmed?: boolean;
  attachmentUrls?: string[];
};

/** 主播记录（含答案） */
export type BroadcastAnchorRecordWithAnswers = BroadcastAnchorRecord & {
  answers: BroadcastAnswer[];
};

/** 带答案的任务视图（对应"我的任务"） */
export type BroadcastTaskForAnchor = Omit<BroadcastTask, "anchorRecords"> & {
  myRecord: BroadcastAnchorRecordWithAnswers;
};

// ─── 查询"我的"群发任务 ────────────────────────────────────────────────────────
export async function getBroadcastTasksForAnchor(userId: string): Promise<BroadcastTaskForAnchor[]> {
  const db = await ensureDb();
  autoExpire(db);
  const result: BroadcastTaskForAnchor[] = [];
  for (const task of db.tasks) {
    // 任务已结束（到截止时间）则不推送给主播
    if (task.status === "ended") continue;
    const rec = task.anchorRecords.find((r) => r.anchorUserId === userId);
    if (!rec) continue;
    const recWithAnswers = rec as BroadcastAnchorRecordWithAnswers;
    if (!recWithAnswers.answers) recWithAnswers.answers = [];
    const { anchorRecords: _drop, ...taskBase } = task;
    result.push({ ...taskBase, myRecord: recWithAnswers });
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── 保存单道题目答案 ──────────────────────────────────────────────────────────
export async function saveBroadcastAnswer(
  taskId: string,
  userId: string,
  answer: BroadcastAnswer,
): Promise<{ success: boolean; task?: BroadcastTaskForAnchor; recordCompleted?: boolean; error?: string }> {
  const db = await ensureDb();

  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: "TASK_NOT_FOUND" };

  const rec = task.anchorRecords.find((r) => r.anchorUserId === userId) as BroadcastAnchorRecordWithAnswers | undefined;
  if (!rec) return { success: false, error: "FORBIDDEN" };
  if (rec.status === "submitted") return { success: false, error: "ALREADY_SUBMITTED" };
  if (rec.status === "overdue") return { success: false, error: "OVERDUE" };

  if (!rec.answers) rec.answers = [];

  const idx = rec.answers.findIndex((a) => a.questionId === answer.questionId);
  if (idx >= 0) {
    rec.answers[idx] = answer;
  } else {
    rec.answers.push(answer);
  }

  // 激活中
  if (rec.status === "pending") rec.status = "in_progress";

  // 检查是否所有必填题都填完 → 自动完成
  const allRequiredDone = task.questions.every((q) => {
    if (!q.isRequired) return true;
    const ans = rec.answers.find((a) => a.questionId === q.id);
    if (!ans) return false;
    if (q.itemType === "QA" || q.itemType === "FILL_BLANK") return !!ans.answerText?.trim();
    if (q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE") return (ans.answerOptions?.length ?? 0) > 0;
    if (q.itemType === "LINK") return !!ans.isLinkConfirmed;
    if (q.itemType === "ATTACHMENT") return (ans.attachmentUrls?.length ?? 0) > 0;
    return false;
  });

  let recordCompleted = false;
  const now = new Date().toISOString();
  if (allRequiredDone && (rec.status as string) !== "submitted") {
    rec.status = "submitted";
    rec.submittedAt = now;
    recordCompleted = true;
  }

  task.updatedAt = now;
  await saveDb(db);

  const { anchorRecords: _drop, ...taskBase } = task;
  return {
    success: true,
    task: { ...taskBase, myRecord: rec },
    recordCompleted,
  };
}

// ─── 懒过期（到截止时间自动 ended） ────────────────────────────────────────────
function autoExpire(db: BroadcastDb) {
  const now = new Date();
  for (const task of db.tasks) {
    if (task.status === "active" && task.dueAt && new Date(task.dueAt) < now) {
      task.status = "ended";
      task.updatedAt = now.toISOString();
      // 同步过期主播记录
      for (const rec of task.anchorRecords) {
        if (rec.status === "pending" || rec.status === "in_progress") {
          rec.status = "overdue";
        }
      }
    }
  }
}
