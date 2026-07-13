import { fail, ok } from "../../../shared/response.js";
import { HallDailyAssignmentService, HallDailyLeaveService, HallDailyRecordService, HallDailyTemplateService } from "./hall-daily.service.js";

const t = (v: any): string => (typeof v === "string" ? v.trim() : "");

function handleHallDailyError(res: any, error: any) {
  const map: Record<string, [string, number]> = {
    HALL_DAILY_ROLE_FORBIDDEN:              ["当前身份无权维护厅管日常任务，需团队管理员及以上身份", 403],
    HALL_DAILY_TEAM_SCOPE_REQUIRED:         ["请先选择要管理的团队", 400],
    HALL_DAILY_TEAM_ORG_NOT_FOUND:          ["所选团队不存在或已停用", 404],
    HALL_DAILY_TEAM_ORG_REQUIRED:           ["归属组织必须是团队（TEAM）类型", 400],
    HALL_DAILY_FORBIDDEN:                   ["当前身份无权访问该团队下的任务", 403],
    HALL_DAILY_HALL_NOT_IN_TEAM:            ["所选厅不属于当前团队", 400],
    HALL_TASK_TEMPLATE_NOT_FOUND:           ["表单模板不存在", 404],
    HALL_TASK_TEMPLATE_IN_USE:              ["该模板已有生效或待生效任务，无法修改题目", 400],
    HALL_TASK_TEMPLATE_HAS_ASSIGNMENTS:     ["该模板存在已发布或已结束的任务记录，无法删除", 400],
    HALL_TASK_TEMPLATE_ARCHIVED:            ["该模板已归档，无法使用", 400],
    HALL_TASK_TEMPLATE_NO_ITEMS:            ["模板中至少需要一道题目才能发布", 400],
    HALL_TASK_TEMPLATE_TEAM_MISMATCH:       ["模板不属于当前团队", 400],
    HALL_TASK_LINK_URL_REQUIRED:            ["学习链接题型必须填写跳转地址", 400],
    HALL_TASK_LINK_URL_INVALID:             ["学习链接格式无效，请填写完整网址", 400],
    HALL_TASK_ASSIGNMENT_NOT_FOUND:         ["发布任务不存在", 404],
    HALL_TASK_ASSIGNMENT_NOT_DRAFT:         ["该任务不处于草稿状态", 400],
    HALL_TASK_ASSIGNMENT_TARGETS_REQUIRED:  ["请选择至少一个目标厅", 400],
    HALL_TASK_ASSIGNMENT_CANNOT_CLOSE:      ["只有生效中或待生效的任务才能结束", 400],
    HALL_TASK_ASSIGNMENT_SCHEDULED_EXISTS:  ["当前团队已有一个待生效任务，请先处理", 400],
    HALL_TASK_IDENTITY_REQUIRED:            ["当前身份没有关联直播厅", 403],
    HALL_TASK_RECORD_NOT_FOUND:             ["记录不存在或无权访问", 404],
    HALL_TASK_RECORD_ALREADY_SUBMITTED:     ["该任务已提交，不可重复提交", 400],
    HALL_TASK_RECORD_INCOMPLETE:            ["还有必填题目未完成，无法提交", 400],
    HALL_TASK_SUPPLEMENT_DEADLINE_PASSED:   ["已超过补录截止时间（次日 16:00）", 400],
    HALL_TASK_LEAVE_REASON_REQUIRED:         ["请填写请假原因", 400],
    HALL_TASK_LEAVE_NOT_ALLOWED:             ["当前任务状态不允许申请请假", 400],
    HALL_TASK_LEAVE_PENDING_EXISTS:          ["已有待审批的请假申请", 400],
    HALL_TASK_LEAVE_REQUEST_NOT_FOUND:       ["请假申请不存在或无权访问", 404],
    HALL_TASK_LEAVE_NOT_PENDING:             ["该请假申请已处理", 400],
    HALL_TASK_LEAVE_REVIEW_FORBIDDEN:        ["当前身份无权审批该请假申请", 403],
    HALL_TASK_LEAVE_COMMENT_REQUIRED:        ["请填写审批意见", 400],
  };

  const entry = map[error?.message];
  if (entry) return fail(res, error.message, entry[0], entry[1]);

  console.error("[hall-daily error]", error);
  return fail(res, "HALL_DAILY_ERROR", "操作失败，请稍后重试", 500);
}

// ─── 模板 Controller ──────────────────────────────────────────────────────────

export const HallDailyTemplateController = {
  async list(req: any, res: any) {
    try {
      const data = await HallDailyTemplateService.list({
        teamOrgId: t(req.query.teamOrgId) || undefined,
        status: t(req.query.status) || undefined,
        neverPublished: req.query.neverPublished === "true" ? true : undefined,
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
        limit: Number(req.query.limit) || undefined,
        offset: Number(req.query.offset) || undefined,
      });
      return ok(res, data);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async getById(req: any, res: any) {
    try {
      const template = await HallDailyTemplateService.getById(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.teamOrgId) || undefined
      );
      return ok(res, template);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async create(req: any, res: any) {
    const { title, description, teamOrgId, items } = req.body;
    if (!title || !teamOrgId) return fail(res, "HALL_TASK_REQUIRED_FIELDS", "请填写标题和所属团队", 400);

    try {
      const template = await HallDailyTemplateService.create({
        title: t(title),
        description: t(description) || undefined,
        teamOrgId: t(teamOrgId),
        createdBy: req.userId,
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
        items: Array.isArray(items) ? items : [],
      });
      return ok(res, template);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async update(req: any, res: any) {
    try {
      const result = await HallDailyTemplateService.update(
        req.params.id,
        req.body,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.teamOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async remove(req: any, res: any) {
    try {
      const result = await HallDailyTemplateService.remove(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.teamOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async copy(req: any, res: any) {
    try {
      const result = await HallDailyTemplateService.copy(
        req.params.id,
        req.userId,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.teamOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async archive(req: any, res: any) {
    try {
      const result = await HallDailyTemplateService.archive(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.teamOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },
};

// ─── 发布任务 Controller ───────────────────────────────────────────────────────

export const HallDailyAssignmentController = {
  async list(req: any, res: any) {
    try {
      const data = await HallDailyAssignmentService.list({
        teamOrgId: t(req.query.teamOrgId) || undefined,
        status: t(req.query.status) || undefined,
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
        limit: Number(req.query.limit) || undefined,
        offset: Number(req.query.offset) || undefined,
      });
      return ok(res, data);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async saveDraft(req: any, res: any) {
    const { assignmentId, templateId, teamOrgId, hallOrgIds, effectMode } = req.body;
    if (!templateId || !teamOrgId) return fail(res, "HALL_TASK_REQUIRED_FIELDS", "请填写模板和团队", 400);

    try {
      const result = await HallDailyAssignmentService.saveDraft({
        assignmentId: assignmentId || undefined,
        templateId: t(templateId),
        teamOrgId: t(teamOrgId),
        hallOrgIds: Array.isArray(hallOrgIds) ? hallOrgIds : [],
        effectMode: effectMode || undefined,
        createdBy: req.userId,
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
      });
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async getPublishPreview(req: any, res: any) {
    try {
      const data = await HallDailyAssignmentService.getPublishPreview(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.teamOrgId) || undefined
      );
      return ok(res, data);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async publish(req: any, res: any) {
    const { effectMode } = req.body;
    if (!effectMode) return fail(res, "HALL_TASK_REQUIRED_FIELDS", "请指定生效方式", 400);

    try {
      const result = await HallDailyAssignmentService.publish(
        req.params.id,
        effectMode,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.body.teamOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async close(req: any, res: any) {
    try {
      const result = await HallDailyAssignmentService.close(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.body.teamOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async delete(req: any, res: any) {
    try {
      const result = await HallDailyAssignmentService.delete(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.teamOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },
};

// ─── 执行层 Controller（厅管填报） ────────────────────────────────────────────

export const HallDailyLeaveController = {
  async apply(req: any, res: any) {
    try {
      const result = await HallDailyLeaveService.apply({
        recordId: req.params.id,
        userId: req.userId,
        reason: t(req.body.reason),
      });
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async cancel(req: any, res: any) {
    try {
      const result = await HallDailyLeaveService.cancel(req.params.id, req.userId);
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async approve(req: any, res: any) {
    try {
      const result = await HallDailyLeaveService.review({
        leaveRequestId: req.params.id,
        reviewerUserId: req.userId,
        reviewerIdentity: req.identity,
        action: "approved",
        comment: t(req.body.comment) || undefined,
      });
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async reject(req: any, res: any) {
    try {
      const result = await HallDailyLeaveService.review({
        leaveRequestId: req.params.id,
        reviewerUserId: req.userId,
        reviewerIdentity: req.identity,
        action: "rejected",
        comment: t(req.body.comment),
      });
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },
};

export const HallDailyRecordController = {

  async getMyRecords(req: any, res: any) {
    try {
      const records = await HallDailyRecordService.getMyRecords(req.userId);
      return ok(res, records);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },

  async submitItemRecord(req: any, res: any) {
    try {
      const { taskRecordId, taskItemId, answerText, answerOptions, isLinkConfirmed, done } = req.body;
      const result = await HallDailyRecordService.submitItemRecord({
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
      return handleHallDailyError(res, error);
    }
  },

  async submitRecord(req: any, res: any) {
    try {
      const result = await HallDailyRecordService.submitRecord(req.params.id, req.userId);
      return ok(res, result);
    } catch (error: any) {
      return handleHallDailyError(res, error);
    }
  },
};
