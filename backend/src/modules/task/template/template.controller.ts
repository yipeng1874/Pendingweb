import { fail, ok } from "../../../shared/response.js";
import { TemplateService } from "./template.service.js";

const t = (v: any): string => (typeof v === "string" ? v.trim() : "");

function handleTemplateError(res: any, error: any) {
  if (error.message === "TEMPLATE_NOT_FOUND") return fail(res, "TEMPLATE_NOT_FOUND", "模板不存在", 404);
  if (error.message === "TEMPLATE_IN_USE") return fail(res, "TEMPLATE_IN_USE", "该模板已被正式任务或历史记录使用，不能直接修改", 400);
  if (error.message === "TEMPLATE_HAS_ASSIGNMENTS") return fail(res, "TEMPLATE_HAS_ASSIGNMENTS", "该模板已被正式任务或历史记录使用，暂不支持删除", 400);
  if (error.message === "TEMPLATE_ORG_NOT_FOUND") return fail(res, "TEMPLATE_ORG_NOT_FOUND", "模板所属组织不存在或已停用", 404);
  if (error.message === "TEMPLATE_FORBIDDEN") return fail(res, "TEMPLATE_FORBIDDEN", "当前身份无权访问该组织下的模板", 403);
  if (error.message === "TEMPLATE_SCOPE_MISMATCH") return fail(res, "TEMPLATE_SCOPE_MISMATCH", "当前操作基地下不存在该表单", 403);
  if (error.message === "DAILY_TEMPLATE_BASE_REQUIRED") return fail(res, "DAILY_TEMPLATE_BASE_REQUIRED", "日常表单必须归属具体基地后再创建", 400);
  if (error.message === "DAILY_TEMPLATE_ROLE_FORBIDDEN") return fail(res, "DAILY_TEMPLATE_ROLE_FORBIDDEN", "只有总公司和基地管理身份可以维护日常表单", 403);
  if (error.message === "DAILY_TEMPLATE_SCOPE_REQUIRED") return fail(res, "DAILY_TEMPLATE_SCOPE_REQUIRED", "维护日常表单前必须先选择基地", 400);
  if (error.message === "TEMPLATE_LINK_URL_REQUIRED") return fail(res, "TEMPLATE_LINK_URL_REQUIRED", "学习链接题型必须填写跳转地址", 400);
  if (error.message === "TEMPLATE_LINK_URL_INVALID") return fail(res, "TEMPLATE_LINK_URL_INVALID", "学习链接格式无效，请填写完整网址；未写协议时系统会自动补全 https://", 400);
  console.error(error);

  return fail(res, "TEMPLATE_OPERATION_FAILED", "表单操作失败，请稍后重试", 500);
}

export const TemplateController = {
  async list(req: any, res: any) {
    try {
      const data = await TemplateService.list(
        t(req.query.orgId),
        t(req.query.category),
        t(req.query.status),
        req.identity?.scopePath,
        req.identity?.roleCode,
        t(req.query.scopeOrgId) || undefined,
        Number(req.query.limit) || undefined,
        Number(req.query.offset) || undefined
      );
      return ok(res, data);
    } catch (error: any) {
      return handleTemplateError(res, error);
    }
  },

  async getById(req: any, res: any) {
    try {
      const template = await TemplateService.getById(req.params.id, req.identity?.scopePath, req.identity?.roleCode, t(req.query.scopeOrgId) || undefined);
      if (!template) return fail(res, "TEMPLATE_NOT_FOUND", "模板不存在", 404);
      return ok(res, template);
    } catch (error: any) {
      return handleTemplateError(res, error);
    }
  },

  async create(req: any, res: any) {
    const { title, description, category, orgId, items } = req.body;
    if (!title || !category || !orgId) return fail(res, "TEMPLATE_REQUIRED_FIELDS", "请填写标题、分类和所属组织", 400);
    if (!["DAILY", "TEMPORARY"].includes(category)) return fail(res, "INVALID_CATEGORY", "任务类型无效", 400);

    try {
      const template = await TemplateService.create({
        title: t(title),
        description: t(description) || undefined,
        category,
        orgId: t(orgId),
        createdBy: req.userId,
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
        scopeOrgId: t(req.body.scopeOrgId) || undefined,
        items: Array.isArray(items) ? items : [],
      });
      return ok(res, template);
    } catch (error: any) {
      return handleTemplateError(res, error);
    }
  },

  async update(req: any, res: any) {
    try {
      const result = await TemplateService.update(req.params.id, req.body, req.identity?.scopePath, req.identity?.roleCode, t(req.query.scopeOrgId) || undefined);
      return ok(res, result);
    } catch (error: any) {
      return handleTemplateError(res, error);
    }
  },

  async remove(req: any, res: any) {
    try {
      const result = await TemplateService.remove(req.params.id, req.identity?.scopePath, req.identity?.roleCode, t(req.query.scopeOrgId) || undefined);
      return ok(res, result);
    } catch (error: any) {
      return handleTemplateError(res, error);
    }
  },

  async copy(req: any, res: any) {
    try {
      const result = await TemplateService.copy(req.params.id, req.userId, req.identity?.scopePath, req.identity?.roleCode, t(req.query.scopeOrgId) || undefined);
      return ok(res, result);
    } catch (error: any) {
      return handleTemplateError(res, error);
    }
  },
};
