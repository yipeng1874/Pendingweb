import { fail, ok } from "../../../shared/response.js";
import { RecordService } from "./record.service.js";
const t = (v) => (typeof v === "string" ? v.trim() : "");
function handleRecordError(res, error) {
    if (error.message === "RECORD_NOT_FOUND")
        return fail(res, "RECORD_NOT_FOUND", "执行记录不存在", 404);
    if (error.message === "RECORD_SUBMITTED")
        return fail(res, "RECORD_SUBMITTED", "该任务已提交，不可修改", 400);
    if (error.message === "RECORD_EXEMPTED")
        return fail(res, "RECORD_EXEMPTED", "今日任务已豁免，当前不可填写或提交", 409);
    if (error.message === "USER_INACTIVE")
        return fail(res, "USER_INACTIVE", "账号已停用，无法提交", 403);
    if (error.message === "REQUIRED_ITEMS_INCOMPLETE")
        return fail(res, "REQUIRED_ITEMS_INCOMPLETE", "请先完成所有必填子任务后再提交", 400);
    if (error.message === "DAILY_RECORD_INACTIVE")
        return fail(res, "DAILY_RECORD_INACTIVE", "当前日常任务已被新的配置替换，无法继续填写", 400);
    if (error.message === "DAILY_RECORD_COLLECTION_CLOSED")
        return fail(res, "DAILY_RECORD_COLLECTION_CLOSED", "该日常任务已超过次日16:00补录截止时间", 400);
    if (error.message === "INVALID_RECORD_DATE")
        return fail(res, "INVALID_RECORD_DATE", "当前日常任务日期异常，请刷新后重试", 400);
    if (error.message === "EXEMPTION_EXISTS")
        return fail(res, "EXEMPTION_EXISTS", "已存在待处理或已通过的豁免申请", 400);
    if (error.message === "EXEMPTION_NOT_FOUND")
        return fail(res, "EXEMPTION_NOT_FOUND", "豁免记录不存在", 404);
    if (error.message === "EXEMPTION_REVIEWED")
        return fail(res, "EXEMPTION_REVIEWED", "该豁免已审批", 400);
    if (error.message === "EXEMPTION_DAILY_ONLY")
        return fail(res, "EXEMPTION_DAILY_ONLY", "仅日常任务支持豁免申请", 400);
    if (error.message === "EXEMPTION_COMPLETED_FORBIDDEN")
        return fail(res, "EXEMPTION_COMPLETED_FORBIDDEN", "已完成任务不可申请豁免", 400);
    if (error.message === "EXEMPTION_REASON_REQUIRED")
        return fail(res, "EXEMPTION_REASON_REQUIRED", "请填写豁免原因", 400);
    if (error.message === "EXEMPTION_REVIEW_FORBIDDEN")
        return fail(res, "EXEMPTION_REVIEW_FORBIDDEN", "当前身份无权审核该豁免", 403);
    if (error.message === "EXEMPTION_CANCEL_FORBIDDEN")
        return fail(res, "EXEMPTION_CANCEL_FORBIDDEN", "当前身份无权撤回或取消该豁免", 403);
    if (error.message === "EXEMPTION_DIRECT_FORBIDDEN")
        return fail(res, "EXEMPTION_DIRECT_FORBIDDEN", "当前身份无权为所选组织或主播设置豁免", 403);
    if (error.message === "EXEMPTION_TODAY_ONLY")
        return fail(res, "EXEMPTION_TODAY_ONLY", "仅支持开启或关闭当天任务豁免", 400);
    if (error.message === "EXEMPTION_TARGET_REQUIRED")
        return fail(res, "EXEMPTION_TARGET_REQUIRED", "请选择需要设置豁免的组织或主播", 400);
    if (error.message === "EXEMPTION_BASE_REQUIRED")
        return fail(res, "EXEMPTION_BASE_REQUIRED", "请先选择有效基地", 400);
    if (error.message === "RECONFIRM_NOT_PENDING")
        return fail(res, "RECONFIRM_NOT_PENDING", "当前任务无需二次确认或已完成确认", 400);
    if (error.message === "RECONFIRM_FORBIDDEN")
        return fail(res, "RECONFIRM_FORBIDDEN", "当前身份无权确认该任务", 403);
    throw error;
}
export const RecordController = {
    async getMyRecords(req, res) {
        const data = await RecordService.getMyRecords(req.userId, req.identity.id, req.identity?.scopePath, req.identity?.roleCode);
        return ok(res, data);
    },
    async getRecord(req, res) {
        try {
            const data = await RecordService.getRecord(req.params.id, req.userId, req.identity.id);
            return ok(res, data);
        }
        catch (error) {
            return handleRecordError(res, error);
        }
    },
    async submitItemRecord(req, res) {
        const { taskRecordId, taskItemId, answerText, answerOptions, isLinkConfirmed, done } = req.body;
        if (!taskRecordId || !taskItemId)
            return fail(res, "ITEM_RECORD_REQUIRED", "请提供执行记录ID和子任务ID", 400);
        try {
            const result = await RecordService.submitItemRecord({
                taskRecordId: t(taskRecordId),
                taskItemId: t(taskItemId),
                userId: req.userId,
                identityId: req.identity.id,
                answerText: t(answerText) || undefined,
                answerOptions: Array.isArray(answerOptions) ? answerOptions : undefined,
                isLinkConfirmed: Boolean(isLinkConfirmed),
                done: Boolean(done),
            });
            return ok(res, result);
        }
        catch (error) {
            return handleRecordError(res, error);
        }
    },
    async submitRecord(req, res) {
        try {
            const result = await RecordService.submitRecord(req.params.id, req.userId, req.identity.id);
            return ok(res, result);
        }
        catch (error) {
            return handleRecordError(res, error);
        }
    },
    async applyExemption(req, res) {
        if (req.identity?.roleCode === "ANCHOR")
            return fail(res, "EXEMPTION_FLOW_REPLACED", "主播豁免现由厅及以上管理直接开启", 403);
        const { taskRecordId, reason } = req.body;
        if (!taskRecordId || !reason)
            return fail(res, "EXEMPTION_REQUIRED", "请填写豁免原因", 400);
        try {
            const result = await RecordService.applyExemption(t(taskRecordId), req.userId, req.identity.id, t(reason));
            return ok(res, result);
        }
        catch (error) {
            return handleRecordError(res, error);
        }
    },
    async listExemptions(req, res) {
        const data = await RecordService.listExemptions(req.identity?.scopePath, req.identity?.roleCode, t(req.query.status));
        return ok(res, data);
    },
    async cancelExemption(req, res) {
        if (req.identity?.roleCode === "ANCHOR")
            return fail(res, "EXEMPTION_FLOW_REPLACED", "主播豁免现由厅及以上管理直接关闭", 403);
        try {
            const result = await RecordService.cancelExemption(req.params.taskRecordId, req.userId, req.identity.id);
            return ok(res, result);
        }
        catch (error) {
            return handleRecordError(res, error);
        }
    },
    async reviewExemption(req, res) {
        const { approved } = req.body;
        try {
            const result = await RecordService.reviewExemption(req.params.id, Boolean(approved), req.userId, {
                roleCode: req.identity?.roleCode,
                scopePath: req.identity?.scopePath,
            });
            return ok(res, result);
        }
        catch (error) {
            return handleRecordError(res, error);
        }
    },
    async directEnableExemptions(req, res) {
        try {
            const result = await RecordService.directEnableExemptions({
                taskDate: t(req.body.taskDate),
                scopeOrgId: t(req.body.scopeOrgId) || undefined,
                orgIds: Array.isArray(req.body.orgIds) ? req.body.orgIds.map(t).filter(Boolean) : [],
                anchorUserIds: Array.isArray(req.body.anchorUserIds) ? req.body.anchorUserIds.map(t).filter(Boolean) : [],
                reason: t(req.body.reason),
            }, req.userId, req.identity);
            return ok(res, result);
        }
        catch (error) {
            return handleRecordError(res, error);
        }
    },
    async directDisableExemptions(req, res) {
        try {
            const result = await RecordService.directDisableExemptions({
                taskDate: t(req.body.taskDate),
                scopeOrgId: t(req.body.scopeOrgId) || undefined,
                orgIds: Array.isArray(req.body.orgIds) ? req.body.orgIds.map(t).filter(Boolean) : [],
                anchorUserIds: Array.isArray(req.body.anchorUserIds) ? req.body.anchorUserIds.map(t).filter(Boolean) : [],
            }, req.identity);
            return ok(res, result);
        }
        catch (error) {
            return handleRecordError(res, error);
        }
    },
    async reconfirmRecord(req, res) {
        try {
            const result = await RecordService.reconfirmRecord(req.params.id, req.userId, req.identity.id);
            return ok(res, result);
        }
        catch (error) {
            return handleRecordError(res, error);
        }
    },
};
