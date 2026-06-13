import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";
import { createWorkflowTask, getWorkflowTasksByIssuer, getWorkflowTaskById, getWorkflowTasksForUser, listWorkflowTasks, saveStepQuestionAnswer, submitWorkflowStep } from "./workflow.store.js";
import type { WorkflowStepAnswer } from "./workflow.store.js";

// ── 流转任务附件上传（支持图片 + 常见文档/视频） ──────────────────────────────
const WORKFLOW_ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "video/mp4", "video/quicktime",
];
const WORKFLOW_MAX_SIZE = 20 * 1024 * 1024; // 20MB

const workflowStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    const now = new Date();
    const dir = path.join(process.cwd(), "uploads", "workflow", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const workflowUpload = multer({
  storage: workflowStorage,
  limits: { fileSize: WORKFLOW_MAX_SIZE },
  fileFilter(_req, file, cb) {
    if (WORKFLOW_ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error("MIME_NOT_ALLOWED"));
  },
});

export const workflowTaskRoutes = Router();
// 所有路由都需要登录
workflowTaskRoutes.use(authRequired);
// 管理员接口额外需要 identity（在各路由内部通过 identityRequired 或 canManageWorkflow 校验）

type WorkflowCreateQuestionInput = {
  title?: string;
  itemType?: "FILL_BLANK" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "LINK" | "ATTACHMENT";
  isRequired?: boolean;
  options?: string[];
  linkUrl?: string;
};

type WorkflowCreateStepInput = {
  title?: string;
  requirement?: string;
  assigneeUserId?: string;
  questions?: WorkflowCreateQuestionInput[];
};

type AssigneeCategory = "subordinate_anchor" | "subordinate_manager" | "peer_manager";

type AssigneeOption = {
  userId: string;
  nickname: string;
  phone: string;
  orgId?: string | null;
  orgName?: string | null;
  orgPath?: string | null;
  roleCodes: string[];
  categories: AssigneeCategory[];
  primaryCategory: AssigneeCategory;
  anchorDouyinNo?: string | null;
  anchorNickname?: string | null;
};

function canManageWorkflow(roleCode?: string | null) {
  return ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(roleCode ?? "");
}

async function loadOperatorContext(identity: NonNullable<Express.Request["identity"]>) {
  const [operatorOrg, operatorUser] = await Promise.all([
    identity.orgId ? prisma.orgUnit.findUnique({ where: { id: identity.orgId } }) : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: identity.userId } }),
  ]);

  return {
    operatorOrg,
    operatorUser,
    scopePath: identity.scopePath ?? operatorOrg?.path ?? null,
  };
}

workflowTaskRoutes.get(
  "/tasks/collaboration/workflows/bootstrap",
  identityRequired,
  async (req, res) => {
    const identity = req.identity;
    if (!identity || !canManageWorkflow(identity.roleCode)) {
      return fail(res, "FORBIDDEN", "当前身份无权访问协同任务", 403);
    }

    const { operatorOrg, scopePath } = await loadOperatorContext(identity);
    const orgWhere = scopePath && identity.roleCode !== "DEV_ADMIN"
      ? { path: { startsWith: `${scopePath}/` } }
      : {};

    const [orgs, identities, tasks] = await Promise.all([
      prisma.orgUnit.findMany({
        where: { status: "active", ...orgWhere },
        select: { id: true, name: true, orgType: true, path: true, parentId: true },
        orderBy: [{ path: "asc" }],
      }),
      prisma.userIdentity.findMany({
        where: {
          status: "active",
          ...(scopePath && identity.roleCode !== "DEV_ADMIN"
            ? {
              OR: [
                { scopePath: { startsWith: `${scopePath}/` } },
                { scopePath },
              ],
            }
            : {}),
        },
        select: {
          id: true,
          userId: true,
          roleCode: true,
          orgId: true,
          org: { select: { id: true, name: true, path: true, orgType: true } },
          user: { select: { id: true, nickname: true, phone: true } },
          anchorProfile: { select: { id: true, douyinNo: true, nickname: true } },
        },
        orderBy: [{ grantedAt: "desc" }],
      }),
      listWorkflowTasks(),
    ]);

    const categoryPriority: AssigneeCategory[] = ["subordinate_anchor", "subordinate_manager", "peer_manager"];
    const assignees = new Map<string, AssigneeOption>();

    function classifyIdentity(item: typeof identities[number]): AssigneeCategory | null {
      if (identity!.roleCode === "DEV_ADMIN") return item.roleCode === "ANCHOR" ? "subordinate_anchor" : "subordinate_manager";
      const itemPath = item.org?.path ?? "";
      const isSameLevel = Boolean(scopePath && itemPath === scopePath);
      const isSubordinate = Boolean(scopePath && itemPath.startsWith(`${scopePath}/`));
      if (item.roleCode === "ANCHOR") return isSameLevel || isSubordinate ? "subordinate_anchor" : null;
      if (isSubordinate) return "subordinate_manager";
      if (isSameLevel) return "peer_manager";
      return null;
    }

    for (const item of identities) {
      const category = classifyIdentity(item);
      if (!category) continue;
      const existing = assignees.get(item.userId);
      if (existing) {
        if (!existing.roleCodes.includes(item.roleCode)) existing.roleCodes.push(item.roleCode);
        if (!existing.categories.includes(category)) existing.categories.push(category);
        existing.primaryCategory = categoryPriority.find((entry) => existing.categories.includes(entry)) ?? existing.primaryCategory;
        if (!existing.orgId && item.orgId) {
          existing.orgId = item.orgId;
          existing.orgName = item.org?.name ?? null;
          existing.orgPath = item.org?.path ?? null;
        }
        if (!existing.anchorDouyinNo && item.anchorProfile?.douyinNo) existing.anchorDouyinNo = item.anchorProfile.douyinNo;
        if (!existing.anchorNickname && item.anchorProfile?.nickname) existing.anchorNickname = item.anchorProfile.nickname;
        continue;
      }
      assignees.set(item.userId, {
        userId: item.userId,
        nickname: item.user.nickname,
        phone: item.user.phone,
        orgId: item.orgId,
        orgName: item.org?.name ?? null,
        orgPath: item.org?.path ?? null,
        roleCodes: [item.roleCode],
        categories: [category],
        primaryCategory: category,
        anchorDouyinNo: item.anchorProfile?.douyinNo ?? null,
        anchorNickname: item.anchorProfile?.nickname ?? null,
      });
    }

    return ok(res, {
      enabled: true,
      mode: "workflow",
      operator: {
        identityId: identity.id,
        orgId: identity.orgId ?? null,
        roleCode: identity.roleCode,
        scopePath,
        orgName: operatorOrg?.name ?? null,
      },
      rules: {
        publishScope: "downstream_only",
        notes: [
          "V1 仅实现流转模式，协同模式和群发任务后续逐步补充。",
          "触达按账号维度去重，同一账号多个身份只算一个执行人。",
          "仅允许管理员向自己的下级组织发放。",
        ],
      },
      orgOptions: orgs,
      assigneeOptions: Array.from(assignees.values()).sort((a, b) => `${a.primaryCategory}-${a.orgPath ?? ""}-${a.nickname}`.localeCompare(`${b.primaryCategory}-${b.orgPath ?? ""}-${b.nickname}`)),
      tasks,
    });
  }
);

workflowTaskRoutes.get(
  "/tasks/collaboration/workflows/assignees/search",
  identityRequired,
  async (req, res) => {
    const identity = req.identity;
    if (!identity || !canManageWorkflow(identity.roleCode)) {
      return fail(res, "FORBIDDEN", "当前身份无权搜索执行账号", 403);
    }

    const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
    if (!keyword) return ok(res, []);

    const digitsOnly = keyword.replace(/\D/g, "");
    const isPhoneSearch = /^\d+$/.test(keyword);
    if ((isPhoneSearch && digitsOnly.length < 5) || (!isPhoneSearch && keyword.length < 2)) {
      return ok(res, []);
    }

    const { scopePath } = await loadOperatorContext(identity);
    const identityWhere = scopePath && identity.roleCode !== "DEV_ADMIN"
      ? {
        OR: [
          { scopePath: { startsWith: `${scopePath}/` } },
          { scopePath },
        ],
      }
      : {};

    const identities = await prisma.userIdentity.findMany({
      where: {
        status: "active",
        ...identityWhere,
        OR: [
          { user: { nickname: { contains: keyword } } },
          { user: { phone: { contains: keyword } } },
          { org: { name: { contains: keyword } } },
          { anchorProfile: { douyinNo: { contains: keyword } } },
          { anchorProfile: { nickname: { contains: keyword } } },
        ],
      },
      select: {
        userId: true,
        roleCode: true,
        orgId: true,
        org: { select: { id: true, name: true, path: true } },
        user: { select: { id: true, nickname: true, phone: true } },
        anchorProfile: { select: { douyinNo: true, nickname: true } },
      },
      orderBy: [{ grantedAt: "desc" }],
      take: 60,
    });

    const categoryPriority: AssigneeCategory[] = ["subordinate_anchor", "subordinate_manager", "peer_manager"];
    const assignees = new Map<string, AssigneeOption>();

    function classifyIdentity(item: typeof identities[number]): AssigneeCategory | null {
      if (identity!.roleCode === "DEV_ADMIN") return item.roleCode === "ANCHOR" ? "subordinate_anchor" : "subordinate_manager";
      const itemPath = item.org?.path ?? "";
      const isSameLevel = Boolean(scopePath && itemPath === scopePath);
      const isSubordinate = Boolean(scopePath && itemPath.startsWith(`${scopePath}/`));
      if (item.roleCode === "ANCHOR") return isSameLevel || isSubordinate ? "subordinate_anchor" : null;
      if (isSubordinate) return "subordinate_manager";
      if (isSameLevel) return "peer_manager";
      return null;
    }

    for (const item of identities) {
      const category = classifyIdentity(item);
      if (!category) continue;
      const existing = assignees.get(item.userId);
      if (existing) {
        if (!existing.roleCodes.includes(item.roleCode)) existing.roleCodes.push(item.roleCode);
        if (!existing.categories.includes(category)) existing.categories.push(category);
        existing.primaryCategory = categoryPriority.find((entry) => existing.categories.includes(entry)) ?? existing.primaryCategory;
        if (!existing.orgId && item.orgId) {
          existing.orgId = item.orgId;
          existing.orgName = item.org?.name ?? null;
          existing.orgPath = item.org?.path ?? null;
        }
        if (!existing.anchorDouyinNo && item.anchorProfile?.douyinNo) existing.anchorDouyinNo = item.anchorProfile.douyinNo;
        if (!existing.anchorNickname && item.anchorProfile?.nickname) existing.anchorNickname = item.anchorProfile.nickname;
        continue;
      }
      assignees.set(item.userId, {
        userId: item.userId,
        nickname: item.user.nickname,
        phone: item.user.phone,
        orgId: item.orgId,
        orgName: item.org?.name ?? null,
        orgPath: item.org?.path ?? null,
        roleCodes: [item.roleCode],
        categories: [category],
        primaryCategory: category,
        anchorDouyinNo: item.anchorProfile?.douyinNo ?? null,
        anchorNickname: item.anchorProfile?.nickname ?? null,
      });
    }

    return ok(res, Array.from(assignees.values()).sort((a, b) => `${a.primaryCategory}-${a.orgPath ?? ""}-${a.nickname}`.localeCompare(`${b.primaryCategory}-${b.orgPath ?? ""}-${b.nickname}`)).slice(0, 20));
  }
);

workflowTaskRoutes.post(
  "/tasks/collaboration/workflows",
  identityRequired,
  async (req, res) => {
    const identity = req.identity;
    if (!identity || !canManageWorkflow(identity.roleCode)) {
      return fail(res, "FORBIDDEN", "当前身份无权创建协同任务", 403);
    }

    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    const dueAt = typeof req.body?.dueAt === "string" && req.body.dueAt.trim() ? req.body.dueAt.trim() : null;
    const stepInputs = Array.isArray(req.body?.steps) ? req.body.steps as WorkflowCreateStepInput[] : [];

    if (!title) return fail(res, "WORKFLOW_TITLE_REQUIRED", "请填写任务标题", 400);
    if (stepInputs.length < 1) return fail(res, "WORKFLOW_STEPS_REQUIRED", "请至少配置一个流转节点", 400);

    const { operatorOrg, operatorUser, scopePath } = await loadOperatorContext(identity);
    if (!scopePath || !operatorOrg) return fail(res, "WORKFLOW_SCOPE_REQUIRED", "当前身份缺少组织范围，无法发布协同任务", 400);

    const targetOrg = operatorOrg;

    const uniqueAssigneeIds = Array.from(new Set(stepInputs.map((item) => item.assigneeUserId?.trim()).filter(Boolean) as string[]));
    const assigneeUsers = uniqueAssigneeIds.length
      ? await prisma.user.findMany({ where: { id: { in: uniqueAssigneeIds }, status: "active" }, select: { id: true, nickname: true, phone: true } })
      : [];
    const assigneeUserMap = new Map(assigneeUsers.map((item) => [item.id, item]));

    const assigneeIdentities = uniqueAssigneeIds.length
      ? await prisma.userIdentity.findMany({
        where: {
          userId: { in: uniqueAssigneeIds },
          status: "active",
          ...(identity.roleCode !== "DEV_ADMIN"
            ? { OR: [{ scopePath: { startsWith: `${scopePath}/` } }, { scopePath }] }
            : {}),
        },
        include: { org: true },
        orderBy: [{ grantedAt: "desc" }],
      })
      : [];

    const assigneeContextMap = new Map<string, { orgId?: string | null; orgName?: string | null }>();
    for (const row of assigneeIdentities) {
      if (assigneeContextMap.has(row.userId)) continue;
      assigneeContextMap.set(row.userId, { orgId: row.orgId, orgName: row.org?.name ?? null });
    }

    const steps = stepInputs.map((item, index) => {
      const assigneeUserId = item.assigneeUserId?.trim() ?? "";
      const assigneeUser = assigneeUserMap.get(assigneeUserId);
      const assigneeContext = assigneeContextMap.get(assigneeUserId);
      const questions = Array.isArray(item.questions)
        ? item.questions.map((question) => ({
          title: question.title?.trim() ?? "",
          itemType: question.itemType ?? "FILL_BLANK",
          isRequired: question.isRequired !== false,
          options: ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.itemType ?? "")
            ? (Array.isArray(question.options) ? question.options.map((option) => String(option).trim()).filter(Boolean) : [])
            : [],
          linkUrl: question.itemType === "LINK" && typeof question.linkUrl === "string" && question.linkUrl.trim()
            ? question.linkUrl.trim()
            : undefined,
        }))
        : [];
      return {
        title: item.title?.trim() ?? `节点${index + 1}`,
        requirement: item.requirement?.trim() ?? questions.map((question) => question.title).filter(Boolean).join("；"),
        questions,
        assigneeUserId,
        assigneeName: assigneeUser?.nickname ?? "",
        assigneeOrgId: assigneeContext?.orgId ?? null,
        assigneeOrgName: assigneeContext?.orgName ?? null,
        order: index + 1,
        status: "active" as const,
      };
    });

    for (const step of steps) {
      if (!step.assigneeUserId || !assigneeUserMap.has(step.assigneeUserId)) {
        return fail(res, "WORKFLOW_ASSIGNEE_INVALID", "存在无效的执行账号，请重新选择", 400);
      }
      if (!step.questions.length) {
        return fail(res, "WORKFLOW_STEP_QUESTIONS_REQUIRED", "请至少为每个节点配置一个题目", 400);
      }
      if (step.questions.some((question) => !question.title)) {
        return fail(res, "WORKFLOW_STEP_QUESTION_TITLE_REQUIRED", "请完整填写每个节点题目内容", 400);
      }
      if (step.questions.some((question) => ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.itemType) && (question.options?.length ?? 0) < 2)) {
        return fail(res, "WORKFLOW_STEP_QUESTION_OPTIONS_REQUIRED", "单选题和多选题至少需要两个选项", 400);
      }
      if (!assigneeContextMap.has(step.assigneeUserId) && identity.roleCode !== "DEV_ADMIN") {
        return fail(res, "WORKFLOW_ASSIGNEE_SCOPE_FORBIDDEN", "执行账号不在当前身份可管理范围内", 400);
      }
    }

    const created = await createWorkflowTask({
      mode: "workflow",
      title,
      description: description || undefined,
      targetOrgId: targetOrg.id,
      targetOrgName: targetOrg.name,
      issuerOrgId: operatorOrg?.id ?? null,
      issuerOrgName: operatorOrg?.name ?? null,
      issuerScopePath: scopePath,
      createdByUserId: identity.userId,
      createdByIdentityId: identity.id,
      createdByName: operatorUser?.nickname ?? "管理员",
      dueAt,
      status: "in_progress",
      currentStepOrder: 1,
      steps,
    });

    return ok(res, created);
  }
);

// GET /tasks/collaboration/workflows/mine — 获取当前用户参与的流转任务
// 只需 authRequired，不需要管理员身份
workflowTaskRoutes.get(
  "/tasks/collaboration/workflows/mine",
  async (req, res) => {
    const userId = req.userId;
    if (!userId) return fail(res, "UNAUTHORIZED", "请先登录", 401);

    const tasks = await getWorkflowTasksForUser(userId);
    return ok(res, tasks);
  }
);

// POST /tasks/collaboration/workflows/:taskId/steps/:stepId/submit — 提交某节点的答案
workflowTaskRoutes.post(
  "/tasks/collaboration/workflows/:taskId/steps/:stepId/submit",
  async (req, res) => {
    const userId = req.userId;
    if (!userId) return fail(res, "UNAUTHORIZED", "请先登录", 401);

    const { taskId, stepId } = req.params;

    // 截止时间校验需要先读取任务
    const tasks = await getWorkflowTasksForUser(userId);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return fail(res, "TASK_NOT_FOUND", "任务不存在或无权访问", 404);

    if (task.dueAt && new Date(task.dueAt) < new Date()) {
      return fail(res, "TASK_OVERDUE", "任务已超过截止时间，无法再提交", 400);
    }

    const rawAnswers = Array.isArray(req.body?.answers) ? req.body.answers as unknown[] : [];
    const answers: WorkflowStepAnswer[] = rawAnswers.map((item) => {
      const a = item as Record<string, unknown>;
      return {
        questionId: typeof a.questionId === "string" ? a.questionId : "",
        answerText: typeof a.answerText === "string" ? a.answerText : undefined,
        answerOptions: Array.isArray(a.answerOptions) ? (a.answerOptions as string[]) : undefined,
        isLinkConfirmed: typeof a.isLinkConfirmed === "boolean" ? a.isLinkConfirmed : undefined,
      };
    }).filter((a) => a.questionId);

    const result = await submitWorkflowStep(taskId, stepId, userId, answers);
    if (!result.success) {
      const errorMessages: Record<string, string> = {
        TASK_NOT_FOUND: "任务不存在",
        STEP_NOT_FOUND: "节点不存在",
        FORBIDDEN: "您无权提交此节点",
        STEP_NOT_ACTIVE: "该节点不处于可提交状态",
      };
      return fail(res, result.error ?? "SUBMIT_FAILED", errorMessages[result.error ?? ""] ?? "提交失败", 400);
    }

    return ok(res, result.task);
  }
);

// GET /tasks/collaboration/workflows/issued — 发布者看板：查我发布的所有流转任务
workflowTaskRoutes.get(
  "/tasks/collaboration/workflows/issued",
  identityRequired,
  async (req, res) => {
    const identity = req.identity;
    if (!identity || !canManageWorkflow(identity.roleCode)) {
      return fail(res, "FORBIDDEN", "当前身份无权查看协同任务看板", 403);
    }
    const tasks = await getWorkflowTasksByIssuer(identity.userId);
    return ok(res, tasks);
  }
);

// GET /tasks/collaboration/workflows/:taskId — 发布者查单个任务详情（含全部答案）
// 鉴权原则：谁发布谁管理——只有任务的发布者（createdByUserId）才能查看详情；DEV_ADMIN 可查全部
workflowTaskRoutes.get(
  "/tasks/collaboration/workflows/:taskId",
  identityRequired,
  async (req, res) => {
    const identity = req.identity;
    if (!identity || !canManageWorkflow(identity.roleCode)) {
      return fail(res, "FORBIDDEN", "当前身份无权查看任务详情", 403);
    }
    const task = await getWorkflowTaskById(req.params.taskId);
    if (!task) return fail(res, "TASK_NOT_FOUND", "任务不存在", 404);

    // 非 DEV_ADMIN：只有发布者本人可查看详情
    if (identity.roleCode !== "DEV_ADMIN" && task.createdByUserId !== identity.userId) {
      return fail(res, "FORBIDDEN", "您无权查看他人发布的任务详情", 403);
    }

    return ok(res, task);
  }
);

// POST /tasks/collaboration/workflows/:taskId/steps/:stepId/answer — 保存单道题目答案（逐题提交，必填全满后自动完成节点）
workflowTaskRoutes.post(
  "/tasks/collaboration/workflows/:taskId/steps/:stepId/answer",
  async (req, res) => {
    const userId = req.userId;
    if (!userId) return fail(res, "UNAUTHORIZED", "请先登录", 401);

    const { taskId, stepId } = req.params;

    // 检查任务是否存在且截止时间未过
    const tasks = await getWorkflowTasksForUser(userId);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return fail(res, "TASK_NOT_FOUND", "任务不存在或无权访问", 404);

    if (task.dueAt && new Date(task.dueAt) < new Date()) {
      return fail(res, "TASK_OVERDUE", "任务已超过截止时间，无法再提交", 400);
    }

    const raw = req.body as Record<string, unknown>;
    const answer: WorkflowStepAnswer = {
      questionId: typeof raw.questionId === "string" ? raw.questionId : "",
      answerText: typeof raw.answerText === "string" ? raw.answerText : undefined,
      answerOptions: Array.isArray(raw.answerOptions) ? (raw.answerOptions as string[]) : undefined,
      isLinkConfirmed: typeof raw.isLinkConfirmed === "boolean" ? raw.isLinkConfirmed : undefined,
      attachmentUrls: Array.isArray(raw.attachmentUrls) ? (raw.attachmentUrls as string[]) : undefined,
    };

    if (!answer.questionId) return fail(res, "QUESTION_ID_REQUIRED", "缺少 questionId", 400);

    const result = await saveStepQuestionAnswer(taskId, stepId, userId, answer);
    if (!result.success) {
      const errorMessages: Record<string, string> = {
        TASK_NOT_FOUND: "任务不存在",
        STEP_NOT_FOUND: "节点不存在",
        FORBIDDEN: "您无权提交此节点",
        STEP_NOT_ACTIVE: "该节点不处于可提交状态",
        STEP_ALREADY_COMPLETED: "该节点已完成",
      };
      return fail(res, result.error ?? "SAVE_FAILED", errorMessages[result.error ?? ""] ?? "保存失败", 400);
    }

    return ok(res, { task: result.task, stepCompleted: result.stepCompleted ?? false });
  }
);

// POST /tasks/collaboration/workflows/attachments/upload — 流转任务附件上传（无需管理员身份）
workflowTaskRoutes.post(
  "/tasks/collaboration/workflows/attachments/upload",
  authRequired,
  (req: any, res: any, next: any) => {
    workflowUpload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") return fail(res, "FILE_TOO_LARGE", "文件不得超过 20MB", 400);
        if (err.message === "MIME_NOT_ALLOWED") return fail(res, "MIME_NOT_ALLOWED", "不支持该文件类型", 400);
        return fail(res, "UPLOAD_ERROR", "上传失败", 500);
      }
      next();
    });
  },
  async (req: any, res: any) => {
    if (!req.file) return fail(res, "NO_FILE", "请选择要上传的文件", 400);
    const relPath = req.file.path.replace(/\\/g, "/");
    const uploadsIdx = relPath.indexOf("uploads/");
    const fileUrl = "/" + relPath.slice(uploadsIdx);
    return ok(res, {
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    });
  }
);
