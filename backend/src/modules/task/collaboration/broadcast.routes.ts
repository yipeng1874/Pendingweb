import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";
import { createBroadcastTask, getBroadcastTaskAnchorAnswers, getBroadcastTasksForAnchor, listBroadcastTasksByIssuerPaged, saveBroadcastAnswer } from "./broadcast.store.js";
import type { BroadcastQuestionType } from "./broadcast.store.js";

export const broadcastTaskRoutes = Router();
broadcastTaskRoutes.use(authRequired);

// ─────────────────────────────────────────────────────────────────────────────
// GET /tasks/collaboration/broadcast/bootstrap
// 仅 HALL_MANAGER 可用；返回本厅所有 active 主播列表
// ─────────────────────────────────────────────────────────────────────────────
broadcastTaskRoutes.get(
  "/tasks/collaboration/broadcast/bootstrap",
  identityRequired,
  async (req, res) => {
    const identity = req.identity;
    if (!identity) return fail(res, "UNAUTHORIZED", "请先登录", 401);

    // 高权限账号：提示移步临时任务
    if (
      ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(identity.roleCode)
    ) {
      return ok(res, {
        allowed: false,
        redirectHint: "您的权限范围超过单个厅，建议使用「任务发布 → 临时任务 → 主播式」向更大范围发放任务。",
        operator: {
          identityId: identity.id,
          roleCode: identity.roleCode,
          orgId: identity.orgId ?? null,
          orgName: null as string | null,
        },
        anchors: [],
      });
    }

    if (identity.roleCode !== "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "群发主播功能仅厅管账号可使用", 403);
    }

    // 加载厅信息
    const hallOrg = identity.orgId
      ? await prisma.orgUnit.findUnique({ where: { id: identity.orgId } })
      : null;

    if (!hallOrg) {
      return fail(res, "HALL_NOT_FOUND", "当前身份未关联有效厅组织，无法使用群发主播", 400);
    }

    // 查本厅下所有 active ANCHOR 身份（scopePath 前缀匹配 or 等于厅 path）
    const anchorIdentities = await prisma.userIdentity.findMany({
      where: {
        status: "active",
        roleCode: "ANCHOR",
        OR: [
          { scopePath: hallOrg.path },
          { scopePath: { startsWith: `${hallOrg.path}/` } },
        ],
      },
      select: {
        userId: true,
        orgId: true,
        org: { select: { id: true, name: true } },
        user: { select: { id: true, nickname: true, phone: true } },
        anchorProfile: { select: { id: true, douyinNo: true, douyinUid: true, nickname: true } },
      },
      orderBy: [{ grantedAt: "desc" }],
    });

    // 按 userId 聚合（一个账号可能有多个 ANCHOR 身份）
    type AnchorOption = {
      userId: string;
      nickname: string;
      phone: string;
      douyinNo?: string | null;
      douyinUid?: string | null;
      anchorNickname?: string | null;
      orgId?: string | null;
      orgName?: string | null;
    };

    const anchorMap = new Map<string, AnchorOption>();
    for (const row of anchorIdentities) {
      if (anchorMap.has(row.userId)) {
        const existing = anchorMap.get(row.userId)!;
        if (!existing.douyinNo && row.anchorProfile?.douyinNo) existing.douyinNo = row.anchorProfile.douyinNo;
        if (!existing.douyinUid && row.anchorProfile?.douyinUid) existing.douyinUid = row.anchorProfile.douyinUid;
        if (!existing.anchorNickname && row.anchorProfile?.nickname) existing.anchorNickname = row.anchorProfile.nickname;
        continue;
      }
      anchorMap.set(row.userId, {
        userId: row.userId,
        nickname: row.user.nickname,
        phone: row.user.phone,
        douyinNo: row.anchorProfile?.douyinNo ?? null,
        douyinUid: row.anchorProfile?.douyinUid ?? null,
        anchorNickname: row.anchorProfile?.nickname ?? null,
        orgId: row.orgId ?? null,
        orgName: row.org?.name ?? null,
      });
    }

    const anchors = Array.from(anchorMap.values()).sort((a, b) =>
      a.nickname.localeCompare(b.nickname),
    );

    return ok(res, {
      allowed: true,
      redirectHint: null,
      operator: {
        identityId: identity.id,
        roleCode: identity.roleCode,
        orgId: hallOrg.id,
        orgName: hallOrg.name,
      },
      anchors,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /tasks/collaboration/broadcast
// 创建群发主播任务
// ─────────────────────────────────────────────────────────────────────────────
broadcastTaskRoutes.post(
  "/tasks/collaboration/broadcast",
  identityRequired,
  async (req, res) => {
    const identity = req.identity;
    if (!identity) return fail(res, "UNAUTHORIZED", "请先登录", 401);
    if (identity.roleCode !== "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "群发主播功能仅厅管账号可使用", 403);
    }

    const hallOrg = identity.orgId
      ? await prisma.orgUnit.findUnique({ where: { id: identity.orgId } })
      : null;
    if (!hallOrg) return fail(res, "HALL_NOT_FOUND", "当前身份未关联有效厅组织", 400);

    const issuerUser = await prisma.user.findUnique({
      where: { id: identity.userId },
      select: { nickname: true },
    });

    // ── 参数校验 ──────────────────────────────────────────────────────────────
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) return fail(res, "TITLE_REQUIRED", "请填写任务标题", 400);

    const description =
      typeof req.body?.description === "string" ? req.body.description.trim() : undefined;
    const dueAt =
      typeof req.body?.dueAt === "string" && req.body.dueAt.trim()
        ? req.body.dueAt.trim()
        : null;

    const selectedAnchorUserIds: string[] = Array.isArray(req.body?.selectedAnchorUserIds)
      ? (req.body.selectedAnchorUserIds as unknown[])
          .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
          .map((v) => v.trim())
      : [];
    if (selectedAnchorUserIds.length === 0) {
      return fail(res, "ANCHOR_REQUIRED", "请至少选择一位主播", 400);
    }

    // ── 题目校验 ──────────────────────────────────────────────────────────────
    type RawQuestion = Record<string, unknown>;
    const rawQuestions: RawQuestion[] = Array.isArray(req.body?.questions)
      ? (req.body.questions as RawQuestion[])
      : [];
    if (rawQuestions.length === 0) {
      return fail(res, "QUESTIONS_REQUIRED", "请至少配置一道题目", 400);
    }

    const ALLOWED_TYPES: BroadcastQuestionType[] = [
      "QA", "FILL_BLANK", "SINGLE_CHOICE", "MULTI_CHOICE", "LINK", "ATTACHMENT",
    ];

    for (const q of rawQuestions) {
      if (!q.title || typeof q.title !== "string" || !q.title.trim()) {
        return fail(res, "QUESTION_TITLE_REQUIRED", "每道题目必须填写标题", 400);
      }
      const itemType = q.itemType as string;
      if (!ALLOWED_TYPES.includes(itemType as BroadcastQuestionType)) {
        return fail(res, "QUESTION_TYPE_INVALID", `不支持的题目类型：${itemType}`, 400);
      }
      if (
        (itemType === "SINGLE_CHOICE" || itemType === "MULTI_CHOICE") &&
        (!Array.isArray(q.options) || (q.options as string[]).filter(Boolean).length < 2)
      ) {
        return fail(res, "QUESTION_OPTIONS_REQUIRED", "单选/多选题至少需要两个选项", 400);
      }
      if (
        itemType === "LINK" &&
        (typeof q.linkUrl !== "string" || !q.linkUrl.trim())
      ) {
        return fail(res, "QUESTION_LINK_REQUIRED", "链接确认题型需要填写链接地址", 400);
      }
    }

    // ── 验证被选主播确实属于本厅 ──────────────────────────────────────────────
    const validAnchorIdentities = await prisma.userIdentity.findMany({
      where: {
        userId: { in: selectedAnchorUserIds },
        status: "active",
        roleCode: "ANCHOR",
        OR: [
          { scopePath: hallOrg.path },
          { scopePath: { startsWith: `${hallOrg.path}/` } },
        ],
      },
      select: {
        userId: true,
        orgId: true,
        org: { select: { id: true, name: true } },
        user: { select: { nickname: true, phone: true } },
        anchorProfile: { select: { douyinNo: true } },
      },
      orderBy: [{ grantedAt: "desc" }],
    });

    // 只取验证通过的 userId，并去重
    const validAnchorMap = new Map<
      string,
      { userId: string; nickname: string; phone: string; douyinNo?: string | null; orgId?: string | null; orgName?: string | null }
    >();
    for (const row of validAnchorIdentities) {
      if (validAnchorMap.has(row.userId)) continue;
      validAnchorMap.set(row.userId, {
        userId: row.userId,
        nickname: row.user.nickname,
        phone: row.user.phone,
        douyinNo: row.anchorProfile?.douyinNo ?? null,
        orgId: row.orgId ?? null,
        orgName: row.org?.name ?? null,
      });
    }

    const invalidIds = selectedAnchorUserIds.filter((id) => !validAnchorMap.has(id));
    if (invalidIds.length > 0) {
      return fail(res, "ANCHOR_SCOPE_INVALID", "存在不属于本厅的主播，请刷新后重试", 400);
    }

    // ── 组装题目 ──────────────────────────────────────────────────────────────
    const questions = rawQuestions.map((q) => ({
      title: (q.title as string).trim(),
      itemType: q.itemType as BroadcastQuestionType,
      isRequired: q.isRequired !== false,
      options:
        q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE"
          ? (q.options as string[]).map((o) => String(o).trim()).filter(Boolean)
          : [],
      linkUrl:
        q.itemType === "LINK" && typeof q.linkUrl === "string" && q.linkUrl.trim()
          ? q.linkUrl.trim()
          : null,
    }));

    // ── 创建任务 ──────────────────────────────────────────────────────────────
    const task = await createBroadcastTask({
      title,
      description,
      dueAt,
      createdByUserId: identity.userId,
      createdByIdentityId: identity.id,
      createdByName: issuerUser?.nickname ?? "厅管",
      hallOrgId: hallOrg.id,
      hallOrgName: hallOrg.name,
      questions,
      anchors: Array.from(validAnchorMap.values()),
    });

    return ok(res, task);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /tasks/collaboration/broadcast/mine
// 主播查看"我的群发主播任务"（任意登录用户，按 userId 匹配）
// ─────────────────────────────────────────────────────────────────────────────
broadcastTaskRoutes.get(
  "/tasks/collaboration/broadcast/mine",
  async (req, res) => {
    const userId = req.userId;
    if (!userId) return fail(res, "UNAUTHORIZED", "请先登录", 401);

    const tasks = await getBroadcastTasksForAnchor(userId);
    return ok(res, tasks);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /tasks/collaboration/broadcast/:taskId/answer
// 主播逐题保存答案（必填题全部填写后自动标记为 submitted）
// ─────────────────────────────────────────────────────────────────────────────
broadcastTaskRoutes.post(
  "/tasks/collaboration/broadcast/:taskId/answer",
  async (req, res) => {
    const userId = req.userId;
    if (!userId) return fail(res, "UNAUTHORIZED", "请先登录", 401);

    const { taskId } = req.params;
    const raw = req.body as Record<string, unknown>;

    const questionId = typeof raw.questionId === "string" ? raw.questionId.trim() : "";
    if (!questionId) return fail(res, "QUESTION_ID_REQUIRED", "缺少 questionId", 400);

    const answer = {
      questionId,
      answerText: typeof raw.answerText === "string" ? raw.answerText : undefined,
      answerOptions: Array.isArray(raw.answerOptions) ? (raw.answerOptions as string[]) : undefined,
      isLinkConfirmed: typeof raw.isLinkConfirmed === "boolean" ? raw.isLinkConfirmed : undefined,
      attachmentUrls: Array.isArray(raw.attachmentUrls) ? (raw.attachmentUrls as string[]) : undefined,
    };

    const result = await saveBroadcastAnswer(taskId, userId, answer);
    if (!result.success) {
      const msgs: Record<string, string> = {
        TASK_NOT_FOUND: "任务不存在",
        FORBIDDEN: "您不在该任务的受发范围内",
        ALREADY_SUBMITTED: "您已完成该任务",
        OVERDUE: "任务已逾期，无法继续填写",
      };
      return fail(res, result.error ?? "SAVE_FAILED", msgs[result.error ?? ""] ?? "保存失败", 400);
    }

    return ok(res, { task: result.task, recordCompleted: result.recordCompleted ?? false });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /tasks/collaboration/broadcast/issued
// 仅 HALL_MANAGER 可用；分页返回我发布的群发主播任务（不含答案，节省带宽）
// 查询参数：?page=1&pageSize=5
// ─────────────────────────────────────────────────────────────────────────────
broadcastTaskRoutes.get(
  "/tasks/collaboration/broadcast/issued",
  identityRequired,
  async (req, res) => {
    const identity = req.identity;
    if (!identity) return fail(res, "UNAUTHORIZED", "请先登录", 401);

    if (identity.roleCode !== "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "群发主播看板仅厅管账号可使用", 403);
    }

    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(20, Math.max(1, parseInt(String(req.query.pageSize ?? "5"), 10) || 5));

    const result = await listBroadcastTasksByIssuerPaged(req.userId!, { page, pageSize });
    return ok(res, result);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /tasks/collaboration/broadcast/issued/:taskId/anchor-answers
// 仅 HALL_MANAGER 可用；懒加载指定任务的所有主播答案
// ─────────────────────────────────────────────────────────────────────────────
broadcastTaskRoutes.get(
  "/tasks/collaboration/broadcast/issued/:taskId/anchor-answers",
  identityRequired,
  async (req, res) => {
    const identity = req.identity;
    if (!identity) return fail(res, "UNAUTHORIZED", "请先登录", 401);

    if (identity.roleCode !== "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "群发主播看板仅厅管账号可使用", 403);
    }

    const { taskId } = req.params;
    const anchorRecords = await getBroadcastTaskAnchorAnswers(taskId, req.userId!);
    if (!anchorRecords) return fail(res, "TASK_NOT_FOUND", "任务不存在或无权限", 404);

    return ok(res, { anchorRecords });
  },
);
