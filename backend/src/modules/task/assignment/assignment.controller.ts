import { fail, ok } from "../../../shared/response.js";
import { AssignmentService } from "./assignment.service.js";

const t = (v: any): string => (typeof v === "string" ? v.trim() : "");
const toArray = (value: unknown) => (Array.isArray(value) ? value.map((item) => t(item)).filter(Boolean) : []);
const isEffectMode = (value: string): value is "immediate" | "next_midnight" => value === "immediate" || value === "next_midnight";
const isTemporaryMode = (value: string): value is "ACCOUNT" | "ANCHOR" | "MANAGER" => ["ACCOUNT", "ANCHOR", "MANAGER"].includes(value);
const isTemporarySubjectOrgType = (value: string): value is "BASE" | "TEAM" | "HALL" => value === "BASE" || value === "TEAM" || value === "HALL";

function handleAssignmentError(res: any, error: any) {
  if (error.message === "TASK_MODULE_UNAVAILABLE") return fail(res, "TASK_MODULE_UNAVAILABLE", "当前任务模块源码未完整接入，请先修复任务模块后再操作该功能", 503);
  if (error.message === "TEMPLATE_NOT_FOUND") return fail(res, "TEMPLATE_NOT_FOUND", "表单不存在", 404);
  if (error.message === "TEMPLATE_ARCHIVED") return fail(res, "TEMPLATE_ARCHIVED", "归档表单不能用于发放", 400);
  if (error.message === "TEMPLATE_CATEGORY_MISMATCH") return fail(res, "TEMPLATE_CATEGORY_MISMATCH", "任务与表单分类不匹配", 400);
  if (error.message === "ASSIGNMENT_NOT_FOUND") return fail(res, "ASSIGNMENT_NOT_FOUND", "发放任务不存在", 404);
  if (error.message === "ASSIGNMENT_NOT_DRAFT") return fail(res, "ASSIGNMENT_NOT_DRAFT", "只有草稿任务可以继续编辑或执行发放", 400);
  if (error.message === "ASSIGNMENT_CATEGORY_INVALID") return fail(res, "ASSIGNMENT_CATEGORY_INVALID", "当前任务类型不支持该操作", 400);
  if (error.message === "ASSIGNMENT_TARGETS_REQUIRED") return fail(res, "ASSIGNMENT_TARGETS_REQUIRED", "请至少保留一个有效发放范围", 400);
  if (error.message === "TEMP_ASSIGNMENT_DEADLINE_REQUIRED") return fail(res, "TEMP_ASSIGNMENT_DEADLINE_REQUIRED", "临时任务必须设置完成截止时间", 400);
  if (error.message === "TEMP_ASSIGNMENT_OWNER_REQUIRED") return fail(res, "TEMP_ASSIGNMENT_OWNER_REQUIRED", "只有发起人可以继续处理、关闭或删除该临时任务", 403);
  if (error.message === "TEMP_ASSIGNMENT_AUDIENCE_EMPTY") return fail(res, "TEMP_ASSIGNMENT_AUDIENCE_EMPTY", "当前模式和范围下没有可触达的任务主体", 400);
  if (error.message === "INVALID_DEADLINE") return fail(res, "INVALID_DEADLINE", "截止时间格式不正确", 400);
  if (error.message === "ASSIGNMENT_DELETED") return fail(res, "ASSIGNMENT_DELETED", "已删除任务不可再编辑", 400);
  if (error.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "选择的管理基地不存在或已停用", 404);
  if (error.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权管理该基地", 403);
  if (error.message === "DAILY_SCOPE_BASE_REQUIRED") return fail(res, "DAILY_SCOPE_BASE_REQUIRED", "日常任务必须先选择一个基地后再管理", 400);
  if (error.message === "DAILY_ROLE_FORBIDDEN") return fail(res, "DAILY_ROLE_FORBIDDEN", "只有总公司和基地管理身份可以管理日常任务", 403);
  if (error.message === "DAILY_SCOPE_REQUIRED") return fail(res, "DAILY_SCOPE_REQUIRED", "日常任务操作前必须先选择基地", 400);
  if (error.message === "DAILY_SCHEDULED_EXISTS") return fail(res, "DAILY_SCHEDULED_EXISTS", "当前基地已有待生效日常任务，请先删除待生效任务后再发布新的日常任务", 400);
  const prismaCode = error?.code;
  if (prismaCode === "P2003") {
    console.error("Assignment operation foreign key constraint failed", error);
    return fail(res, "ASSIGNMENT_FOREIGN_KEY_CONFLICT", "任务存在关联记录，当前操作未能完成，请刷新后重试；若仍失败请联系开发排查外键约束", 409);
  }
  console.error(error);
  return fail(res, "ASSIGNMENT_OPERATION_FAILED", "任务操作失败，请稍后重试", 500);
}


function parseTemporaryPayload(req: any) {
  const mode = t(req.body.mode);
  const subjectOrgType = t(req.body.subjectOrgType);
  return {
    temporaryMode: isTemporaryMode(mode) ? mode : undefined,
    temporarySubjectOrgType: isTemporarySubjectOrgType(subjectOrgType) ? subjectOrgType : undefined,
    targetRoleCodes: toArray(req.body.targetRoleCodes),
    targetUserIds: toArray(req.body.targetUserIds),
  };
}


export const AssignmentController = {
  async list(req: any, res: any) {
    try {
      const data = await AssignmentService.list(
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.category),
        t(req.query.scopeOrgId) || undefined,
        req.userId,
        req.identity?.id,
        t(req.query.status) || undefined,
        Number(req.query.limit) || undefined,
        Number(req.query.offset) || undefined
      );
      return ok(res, data);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async getById(req: any, res: any) {
    try {
      const data = await AssignmentService.getById(
        req.params.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.scopeOrgId) || undefined,
        req.userId,
        req.identity?.id
      );
      if (!data) return fail(res, "ASSIGNMENT_NOT_FOUND", "发放任务不存在", 404);
      return ok(res, data);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async create(req: any, res: any) {
    const templateId = t(req.body.templateId);
    const category = t(req.body.category) as "DAILY" | "TEMPORARY";
    const targetRoleType = t(req.body.targetRoleType);
    const orgIds = toArray(req.body.orgIds);
    if (!templateId || !category || !targetRoleType || !orgIds.length) {
      return fail(res, "ASSIGNMENT_REQUIRED_FIELDS", "请填写模板、分类、触达角色和目标组织", 400);
    }

    try {
      const result = await AssignmentService.create({
        templateId,
        category,
        targetRoleType,
        targetAdminLevels: toArray(req.body.targetAdminLevels),
        deadlineAt: t(req.body.deadlineAt) || undefined,
        deadlinePolicy: category === "DAILY" ? "next_day_1600" : undefined,
        orgIds,
        excludedOrgIds: toArray(req.body.excludedOrgIds),
        excludedAnchorProfileIds: toArray(req.body.excludedAnchorProfileIds),
        createdBy: req.userId,
        createdByOrgId: req.identity?.orgId ?? "",
        createdByIdentityId: req.identity?.id,
        ownerScopePath: req.identity?.scopePath,
        currentOrgId: req.identity?.orgId,
        currentScopePath: req.identity?.scopePath,
        currentRoleCode: req.identity?.roleCode,
        scopeOrgId: t(req.body.scopeOrgId) || undefined,
        ...parseTemporaryPayload(req),
      });
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async saveTemporaryDraft(req: any, res: any) {
    const templateId = t(req.body.templateId);
    if (!templateId) {
      return fail(res, "TEMP_DRAFT_REQUIRED_FIELDS", "请先选择一个临时任务表单", 400);
    }

    try {
      const result = await AssignmentService.saveTemporaryDraft({
        assignmentId: t(req.body.assignmentId) || undefined,
        templateId,
        orgIds: toArray(req.body.orgIds),
        excludedOrgIds: toArray(req.body.excludedOrgIds),
        excludedAnchorProfileIds: toArray(req.body.excludedAnchorProfileIds),
        deadlineAt: t(req.body.deadlineAt) || undefined,
        scopeOrgId: t(req.body.scopeOrgId) || undefined,
        createdBy: req.userId,
        createdByOrgId: req.identity?.orgId ?? "",
        createdByIdentityId: req.identity?.id,
        ownerScopePath: req.identity?.scopePath,
        currentOrgId: req.identity?.orgId,
        currentScopePath: req.identity?.scopePath,
        currentRoleCode: req.identity?.roleCode,
        mode: parseTemporaryPayload(req).temporaryMode,
        targetRoleCodes: parseTemporaryPayload(req).targetRoleCodes,
        targetUserIds: parseTemporaryPayload(req).targetUserIds,
        subjectOrgType: parseTemporaryPayload(req).temporarySubjectOrgType,
      });
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async getTemporaryPublishPreview(req: any, res: any) {
    try {
      const result = await AssignmentService.getTemporaryPublishPreview(
        req.params.id,
        req.userId,
        req.identity?.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.scopeOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async publishTemporaryDraft(req: any, res: any) {
    try {
      const result = await AssignmentService.publishTemporaryDraft(
        req.params.id,
        req.userId,
        req.identity?.id,
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.body.scopeOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async saveDailyDraft(req: any, res: any) {
    const templateId = t(req.body.templateId);
    const orgIds = toArray(req.body.orgIds);
    const effectMode = t(req.body.effectMode) || "immediate";
    if (!templateId || !orgIds.length) {
      return fail(res, "DAILY_DRAFT_REQUIRED_FIELDS", "请先完成表单选择并保留至少一个发放范围", 400);
    }
    if (!isEffectMode(effectMode)) {
      return fail(res, "DAILY_EFFECT_MODE_INVALID", "生效方式不正确", 400);
    }

    try {
      const result = await AssignmentService.saveDailyDraft({
        assignmentId: t(req.body.assignmentId) || undefined,
        templateId,
        orgIds,
        excludedOrgIds: toArray(req.body.excludedOrgIds),
        excludedAnchorProfileIds: toArray(req.body.excludedAnchorProfileIds),
        effectMode,
        createdBy: req.userId,
        createdByOrgId: req.identity?.orgId ?? "",
        ownerScopePath: req.identity?.scopePath,
        currentOrgId: req.identity?.orgId,
        currentScopePath: req.identity?.scopePath,
        currentRoleCode: req.identity?.roleCode,
        scopeOrgId: t(req.body.scopeOrgId) || undefined,
        createdByIdentityId: req.identity?.id,
      });
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async getDailyPublishPreview(req: any, res: any) {
    try {
      const result = await AssignmentService.getDailyPublishPreview(req.params.id, req.identity?.scopePath, req.identity?.roleCode, t(req.query.scopeOrgId) || undefined);
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async publishDailyDraft(req: any, res: any) {
    const effectMode = t(req.body.effectMode) || "immediate";
    if (!isEffectMode(effectMode)) {
      return fail(res, "DAILY_EFFECT_MODE_INVALID", "请选择正确的生效方式", 400);
    }

    try {
      const result = await AssignmentService.publishDailyDraft(req.params.id, effectMode, req.identity?.scopePath, req.identity?.roleCode, t(req.body.scopeOrgId) || undefined);
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async update(req: any, res: any) {
    const payload = {
      templateId: t(req.body.templateId) || undefined,
      orgIds: req.body.orgIds !== undefined ? toArray(req.body.orgIds) : undefined,
      excludedOrgIds: req.body.excludedOrgIds !== undefined ? toArray(req.body.excludedOrgIds) : undefined,
      excludedAnchorProfileIds: req.body.excludedAnchorProfileIds !== undefined ? toArray(req.body.excludedAnchorProfileIds) : undefined,
      deadlineAt: t(req.body.deadlineAt) || undefined,
      effectMode: isEffectMode(t(req.body.effectMode)) ? (t(req.body.effectMode) as "immediate" | "next_midnight") : undefined,
      targetRoleCodes: req.body.targetRoleCodes !== undefined ? toArray(req.body.targetRoleCodes) : undefined,
      targetUserIds: req.body.targetUserIds !== undefined ? toArray(req.body.targetUserIds) : undefined,
      temporaryMode: isTemporaryMode(t(req.body.mode)) ? (t(req.body.mode) as "ACCOUNT" | "ANCHOR" | "MANAGER") : undefined,
      temporarySubjectOrgType: isTemporarySubjectOrgType(t(req.body.subjectOrgType)) ? (t(req.body.subjectOrgType) as "BASE" | "TEAM" | "HALL") : undefined,
    };

    if (!payload.templateId && !payload.orgIds && !payload.excludedOrgIds && !payload.excludedAnchorProfileIds && !payload.deadlineAt && !payload.effectMode && !payload.targetRoleCodes && !payload.targetUserIds && !payload.temporaryMode && payload.temporarySubjectOrgType === undefined) {

      return fail(res, "ASSIGNMENT_UPDATE_REQUIRED", "请至少提供一项更新内容", 400);
    }

    try {
      const result = await AssignmentService.update(
        req.params.id,
        payload,
        req.identity?.scopePath,
        req.identity?.roleCode,
        req.userId,
        req.identity?.id,
        t(req.body.scopeOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async remove(req: any, res: any) {
    try {
      const result = await AssignmentService.delete(
        req.params.id
      );
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async close(req: any, res: any) {
    try {
      const result = await AssignmentService.toggleActive(
        req.params.id,
        false,
        req.identity?.scopePath,
        req.identity?.roleCode,
        req.userId,
        req.identity?.id,
        t(req.body.scopeOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async reopen(req: any, res: any) {
    try {
      const result = await AssignmentService.toggleActive(
        req.params.id,
        true,
        req.identity?.scopePath,
        req.identity?.roleCode,
        req.userId,
        req.identity?.id,
        t(req.body.scopeOrgId) || undefined
      );
      return ok(res, result);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },

  async getTargetUsers(req: any, res: any) {
    try {
      const data = await AssignmentService.getTargetUsers(
        req.params.id
      );
      return ok(res, data);
    } catch (error: any) {
      return handleAssignmentError(res, error);
    }
  },
};
