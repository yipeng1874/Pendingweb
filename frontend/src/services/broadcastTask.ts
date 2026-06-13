import { api } from "./http";

// ─── 题目类型 ──────────────────────────────────────────────────────────────────
export type BroadcastQuestionType =
  | "QA"
  | "FILL_BLANK"
  | "SINGLE_CHOICE"
  | "MULTI_CHOICE"
  | "LINK"
  | "ATTACHMENT";

export type BroadcastQuestion = {
  id?: string;
  title: string;
  itemType: BroadcastQuestionType;
  isRequired: boolean;
  options?: string[];
  linkUrl?: string | null;
};

// ─── 主播选项 ──────────────────────────────────────────────────────────────────
export type BroadcastAnchorOption = {
  userId: string;
  nickname: string;
  phone: string;
  douyinNo?: string | null;
  douyinUid?: string | null;
  anchorNickname?: string | null;
  orgId?: string | null;
  orgName?: string | null;
};

// ─── Bootstrap 返回 ──────────────────────────────────────────────────────────
export type BroadcastBootstrapPayload = {
  allowed: boolean;
  /** 非厅管时给出的引导提示 */
  redirectHint: string | null;
  operator: {
    identityId: string;
    roleCode: string;
    orgId: string | null;
    orgName: string | null;
  };
  anchors: BroadcastAnchorOption[];
};

// ─── 任务主播记录 ─────────────────────────────────────────────────────────────
export type BroadcastAnchorRecord = {
  id: string;
  anchorUserId: string;
  anchorNickname: string;
  anchorPhone: string;
  anchorDouyinNo?: string | null;
  anchorOrgId?: string | null;
  anchorOrgName?: string | null;
  status: "pending" | "in_progress" | "submitted" | "overdue";
  submittedAt?: string | null;
};

// ─── 已创建的任务 ─────────────────────────────────────────────────────────────
export type BroadcastTask = {
  id: string;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  createdByUserId: string;
  createdByName: string;
  hallOrgId: string;
  hallOrgName: string;
  questions: Array<BroadcastQuestion & { id: string }>;
  anchorRecords: BroadcastAnchorRecord[];
  status: "active" | "ended";
  createdAt: string;
  updatedAt: string;
};

// ─── 答案类型 ─────────────────────────────────────────────────────────────────
export type BroadcastAnswer = {
  questionId: string;
  answerText?: string;
  answerOptions?: string[];
  isLinkConfirmed?: boolean;
  attachmentUrls?: string[];
};

// ─── 主播记录（含答案） ───────────────────────────────────────────────────────
export type BroadcastAnchorRecordWithAnswers = BroadcastAnchorRecord & {
  answers: BroadcastAnswer[];
};

// ─── 我的任务视图 ─────────────────────────────────────────────────────────────
export type BroadcastTaskForAnchor = Omit<BroadcastTask, "anchorRecords"> & {
  myRecord: BroadcastAnchorRecordWithAnswers;
};

// ─── 厅管看板专用（anchorRecords 含 answers） ─────────────────────────────────
export type BroadcastTaskWithAnswers = Omit<BroadcastTask, "anchorRecords"> & {
  anchorRecords: BroadcastAnchorRecordWithAnswers[];
};

// ─── 分页查询结果 ──────────────────────────────────────────────────────────────
export type BroadcastTaskPageResult = {
  tasks: BroadcastTaskWithAnswers[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

// ─── 创建入参 ─────────────────────────────────────────────────────────────────
export type BroadcastCreateInput = {
  title: string;
  description?: string;
  dueAt?: string;
  selectedAnchorUserIds: string[];
  questions: Array<Omit<BroadcastQuestion, "id">>;
};

// ─── API ─────────────────────────────────────────────────────────────────────
export const broadcastTaskApi = {
  bootstrap: () =>
    api.get<BroadcastBootstrapPayload>("/tasks/collaboration/broadcast/bootstrap"),

  create: (payload: BroadcastCreateInput) =>
    api.post<BroadcastTask>("/tasks/collaboration/broadcast", payload),

  /** 主播查看自己的群发主播任务 */
  myTasks: () =>
    api.get<BroadcastTaskForAnchor[]>("/tasks/collaboration/broadcast/mine"),

  /** 逐题保存答案（必填全填后自动 submitted） */
  saveAnswer: (taskId: string, answer: BroadcastAnswer) =>
    api.post<{ task: BroadcastTaskForAnchor; recordCompleted: boolean }>(
      `/tasks/collaboration/broadcast/${taskId}/answer`,
      answer,
    ),

  /** 厅管分页查看自己发布的群发主播任务（不含答案，节省带宽） */
  issuedTasksPaged: (params: { page: number; pageSize?: number }) =>
    api.get<BroadcastTaskPageResult>(
      `/tasks/collaboration/broadcast/issued?page=${params.page}&pageSize=${params.pageSize ?? 5}`,
    ),

  /** 懒加载：获取指定任务的所有主播答案（点击"查看主播"时调用） */
  taskAnchorAnswers: (taskId: string) =>
    api.get<{ anchorRecords: BroadcastAnchorRecordWithAnswers[] }>(
      `/tasks/collaboration/broadcast/issued/${taskId}/anchor-answers`,
    ),
};
