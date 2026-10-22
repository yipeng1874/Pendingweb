import { fail, ok } from "../../../shared/response.js";
import { TeamDailyAssignmentService, TeamDailyLeaveService, TeamDailyRecordService, TeamDailyTemplateService } from "./team-daily.service.js";

const t = (v: any): string => (typeof v === "string" ? v.trim() : "");

function handleTeamDailyError(res: any, error: any) {
  const map: Record<string, [string, number]> = {
    TEAM_TASK_LEAVE_TODAY_ONLY: ["批量请假仅可操作北京时间当天", 400],
    TEAM_TASK_LEAVE_REASON_INVALID: ["请填写1至1000字符的操作原因", 400],
    TEAM_TASK_LEAVE_BATCH_INVALID: ["每次请选择1至100个团队任务", 400],
    TEAM_DAILY_ROLE_FORBIDDEN:              ["当前身份无权维护团队管理日常任务，需基地管理员及以上身份", 403],
    TEAM_DAILY_TEAM_SCOPE_REQUIRED:         ["请先选择要管理的基地", 400],
    TEAM_DAILY_TEAM_ORG_NOT_FOUND:          ["所选基地不存在或已停用", 404],
    TEAM_DAILY_TEAM_ORG_REQUIRED:           ["归属组织必须是基地（TEAM）类型", 400],
    TEAM_DAILY_FORBIDDEN:                   ["当前身份无权访问该基地下的任务", 403],
    TEAM_DAILY_HALL_NOT_IN_TEAM:            ["所选团队不属于当前基地", 400],
    TEAM_TASK_TEMPLATE_NOT_FOUND:           ["表单模板不存在", 404],
    TEAM_TASK_TEMPLATE_IN_USE:              ["该模板已有生效或待生效任务，无法修改题目", 400],
    TEAM_TASK_TEMPLATE_HAS_ASSIGNMENTS:     ["该模板存在已发布或已结束的任务记录，无法删除", 400],
    TEAM_TASK_TEMPLATE_ARCHIVED:            ["该模板已归档，无法使用", 400],
    TEAM_TASK_TEMPLATE_NO_ITEMS:            ["模板中至少需要一道题目才能发布", 400],
    TEAM_TASK_TEMPLATE_TEAM_MISMATCH:       ["模板不属于当前基地", 400],
    TEAM_TASK_LINK_URL_REQUIRED:            ["学习链接题型必须填写跳转地址", 400],
    TEAM_TASK_LINK_URL_INVALID:             ["学习链接格式无效，请填写完整网址", 400],
    TEAM_TASK_ASSIGNMENT_NOT_FOUND:         ["发布任务不存在", 404],
    TEAM_TASK_ASSIGNMENT_NOT_DRAFT:         ["该任务不处于草稿状态", 400],
    TEAM_TASK_ASSIGNMENT_TARGETS_REQUIRED:  ["请选择至少一个目标团队", 400],
    TEAM_TASK_ASSIGNMENT_CANNOT_CLOSE:      ["只有生效中或待生效的任务才能结束", 400],
    TEAM_TASK_ASSIGNMENT_SCHEDULED_EXISTS:  ["当前基地已有一个待生效任务，请先处理", 400],
    TEAM_TASK_IDENTITY_REQUIRED:            ["当前身份没有关联团队", 403],
    TEAM_TASK_RECORD_NOT_FOUND:             ["记录不存在或无权访问", 404],
    TEAM_TASK_RECORD_ALREADY_SUBMITTED:     ["该任务已提交，不可重复提交", 400],
    TEAM_TASK_RECORD_INCOMPLETE:            ["还有必填题目未完成，无法提交", 400],
    TEAM_TASK_SUPPLEMENT_DEADLINE_PASSED:   ["已超过补录截止时间（次日 16:00）", 400],
    TEAM_TASK_LEAVE_REASON_REQUIRED:         ["请填写请假原因", 400],
    TEAM_TASK_LEAVE_NOT_ALLOWED:             ["当前任务状态不允许申请请假", 400],
    TEAM_TASK_LEAVE_PENDING_EXISTS:          ["已有待审批的请假申请", 400],
    TEAM_TASK_LEAVE_REQUEST_NOT_FOUND:       ["请假申请不存在或无权访问", 404],
    TEAM_TASK_LEAVE_NOT_PENDING:             ["该请假申请已处理", 400],
    TEAM_TASK_LEAVE_REVIEW_FORBIDDEN:        ["当前身份无权审批该请假申请", 403],
    TEAM_TASK_LEAVE_COMMENT_REQUIRED:        ["请填写审批意见", 400],
  };

  const entry = map[error?.message];
  if (entry) return fail(res, error.message, entry[0], entry[1]);

  console.error("[team-daily error]", error);
  return fail(res, "TEAM_DAILY_ERROR", "操作失败，请稍后重试", 500);
}

// ─── 模板 Controller ──────────────────────────────────────────────────────────

export const TeamDailyTemplateController = {
  async list(req: any, res: any) {
    try {
      const data = await TeamDailyTemplateService.list({
        baseOrgId: t(req.query.baseOrgId) || undefined,
        status: t(req.query.status) || undefined,
        neverPublished: req.query.neverPublished === "true" ? true : undefined,
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
        limit: Number(req.query.limit) || undefined,
        offset: Number(req.query.offset) || undefined,
      });
      return ok(res, data);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async getById(req: any, res: any) {
    try {
      const template = await TeamDailyTemplateService.getById(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.baseOrgId) || undefined
      );
      return ok(res, template);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async create(req: any, res: any) {
    const { title, description, baseOrgId, items } = req.body;
    if (!title || !baseOrgId) return fail(res, "TEAM_TASK_REQUIRED_FIELDS", "请填写标题和所属基地", 400);

    try {
      const template = await TeamDailyTemplateService.create({
        title: t(title),
        description: t(description) || undefined,
        baseOrgId: t(baseOrgId),
        createdBy: req.userId,
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
        items: Array.isArray(items) ? items : [],
      });
      return ok(res, template);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async update(req: any, res: any) {
    try {
      const result = await TeamDailyTemplateService.update(
        req.params.id,
        req.body,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.baseOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async remove(req: any, res: any) {
    try {
      const result = await TeamDailyTemplateService.remove(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.baseOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async copy(req: any, res: any) {
    try {
      const result = await TeamDailyTemplateService.copy(
        req.params.id,
        req.userId,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.baseOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async archive(req: any, res: any) {
    try {
      const result = await TeamDailyTemplateService.archive(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.baseOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },
};

// ─── 发布任务 Controller ───────────────────────────────────────────────────────

export const TeamDailyAssignmentController = {
  async list(req: any, res: any) {
    try {
      const data = await TeamDailyAssignmentService.list({
        baseOrgId: t(req.query.baseOrgId) || undefined,
        status: t(req.query.status) || undefined,
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
        limit: Number(req.query.limit) || undefined,
        offset: Number(req.query.offset) || undefined,
      });
      return ok(res, data);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async saveDraft(req: any, res: any) {
    const { assignmentId, templateId, baseOrgId, teamOrgIds, effectMode } = req.body;
    if (!templateId || !baseOrgId) return fail(res, "TEAM_TASK_REQUIRED_FIELDS", "请填写模板和基地", 400);

    try {
      const result = await TeamDailyAssignmentService.saveDraft({
        assignmentId: assignmentId || undefined,
        templateId: t(templateId),
        baseOrgId: t(baseOrgId),
        teamOrgIds: Array.isArray(teamOrgIds) ? teamOrgIds : [],
        effectMode: effectMode || undefined,
        createdBy: req.userId,
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
      });
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async getPublishPreview(req: any, res: any) {
    try {
      const data = await TeamDailyAssignmentService.getPublishPreview(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.baseOrgId) || undefined
      );
      return ok(res, data);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async publish(req: any, res: any) {
    const { effectMode } = req.body;
    if (!effectMode) return fail(res, "TEAM_TASK_REQUIRED_FIELDS", "请指定生效方式", 400);

    try {
      const result = await TeamDailyAssignmentService.publish(
        req.params.id,
        effectMode,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.body.baseOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async close(req: any, res: any) {
    try {
      const result = await TeamDailyAssignmentService.close(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.body.baseOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async delete(req: any, res: any) {
    try {
      const result = await TeamDailyAssignmentService.delete(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.baseOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },
};

// ─── 执行层 Controller（团队管理员填报） ────────────────────────────────────────────

export const TeamDailyLeaveController = {
  async batch(req: any, res: any) {
    if (!["approve", "cancel"].includes(req.body.action)) return fail(res, "INVALID_ACTION", "操作类型无效", 400);
    try {
      return ok(res, await TeamDailyLeaveService.batch({
        recordIds: Array.isArray(req.body.recordIds) ? req.body.recordIds.map(t).filter(Boolean) : [],
        taskDate: t(req.body.taskDate), action: req.body.action, reason: t(req.body.reason),
        operatorUserId: req.userId, identity: req.identity,
      }));
    } catch (error) { return handleTeamDailyError(res, error); }
  },
  async apply(req: any, res: any) {
    try {
      const result = await TeamDailyLeaveService.apply({
        recordId: req.params.id,
        userId: req.userId,
        reason: t(req.body.reason),
      });
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async cancel(req: any, res: any) {
    try {
      const result = await TeamDailyLeaveService.cancel(req.params.id, req.userId);
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async approve(req: any, res: any) {
    try {
      const result = await TeamDailyLeaveService.review({
        leaveRequestId: req.params.id,
        reviewerUserId: req.userId,
        reviewerIdentity: req.identity,
        action: "approved",
        comment: t(req.body.comment) || undefined,
      });
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async reject(req: any, res: any) {
    try {
      const result = await TeamDailyLeaveService.review({
        leaveRequestId: req.params.id,
        reviewerUserId: req.userId,
        reviewerIdentity: req.identity,
        action: "rejected",
        comment: t(req.body.comment),
      });
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },
};

export const TeamDailyRecordController = {

  async getMyRecords(req: any, res: any) {
    try {
      const records = await TeamDailyRecordService.getMyRecords(req.userId);
      return ok(res, records);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async submitItemRecord(req: any, res: any) {
    try {
      const { taskRecordId, taskItemId, answerText, answerOptions, isLinkConfirmed, done } = req.body;
      const result = await TeamDailyRecordService.submitItemRecord({
        taskRecordId,
        taskItemId,
        userId: req.userId,
        answerText: typeof answerText === "string" ? answerText : undefined,
        answerOptions: Array.isArray(answerOptions) ? answerOptions : undefined,
        isLinkConfirmed: typeof isLinkConfirmed === "boolean" ? isLinkConfirmed : undefined,
        done: Boolean(done),
      });
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },

  async submitRecord(req: any, res: any) {
    try {
      const result = await TeamDailyRecordService.submitRecord(req.params.id, req.userId);
      return ok(res, result);
    } catch (error: any) {
      return handleTeamDailyError(res, error);
    }
  },
};
