import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { HallDailyAssignmentController, HallDailyLeaveController, HallDailyRecordController, HallDailyTemplateController } from "./hall-daily.controller.js";

export const hallDailyRoutes = Router();
hallDailyRoutes.use(authRequired, identityRequired);

// ─── 厅管日常任务：模板管理 ───────────────────────────────────────────────────
// GET    /api/hall-daily/templates              列出模板（?teamOrgId=&status=）
// GET    /api/hall-daily/templates/:id          查看单个模板
// POST   /api/hall-daily/templates              新建模板
// PATCH  /api/hall-daily/templates/:id          编辑模板
// DELETE /api/hall-daily/templates/:id          删除模板（draft 状态）
// POST   /api/hall-daily/templates/:id/copy     复制模板
// POST   /api/hall-daily/templates/:id/archive  归档模板

hallDailyRoutes.get("/hall-daily/templates", permissionRequired("task:assignment:view"), HallDailyTemplateController.list);
hallDailyRoutes.get("/hall-daily/templates/:id", permissionRequired("task:assignment:view"), HallDailyTemplateController.getById);
hallDailyRoutes.post("/hall-daily/templates", permissionRequired("task:template:manage"), HallDailyTemplateController.create);
hallDailyRoutes.patch("/hall-daily/templates/:id", permissionRequired("task:template:manage"), HallDailyTemplateController.update);
hallDailyRoutes.delete("/hall-daily/templates/:id", permissionRequired("task:template:manage"), HallDailyTemplateController.remove);
hallDailyRoutes.post("/hall-daily/templates/:id/copy", permissionRequired("task:template:manage"), HallDailyTemplateController.copy);
hallDailyRoutes.post("/hall-daily/templates/:id/archive", permissionRequired("task:template:manage"), HallDailyTemplateController.archive);

// ─── 厅管日常任务：发布管理 ───────────────────────────────────────────────────
// GET    /api/hall-daily/assignments                         列出发布任务（?teamOrgId=&status=）
// POST   /api/hall-daily/assignments/draft                   保存草稿（含目标厅选择）
// GET    /api/hall-daily/assignments/:id/preview             发布预览
// POST   /api/hall-daily/assignments/:id/publish             正式发布
// POST   /api/hall-daily/assignments/:id/close               结束任务
// DELETE /api/hall-daily/assignments/:id                     删除草稿

hallDailyRoutes.get("/hall-daily/assignments", permissionRequired("task:assignment:view"), HallDailyAssignmentController.list);
hallDailyRoutes.post("/hall-daily/assignments/draft", permissionRequired("task:template:manage"), HallDailyAssignmentController.saveDraft);
hallDailyRoutes.get("/hall-daily/assignments/:id/preview", permissionRequired("task:assignment:view"), HallDailyAssignmentController.getPublishPreview);
hallDailyRoutes.post("/hall-daily/assignments/:id/publish", permissionRequired("task:template:manage"), HallDailyAssignmentController.publish);
hallDailyRoutes.post("/hall-daily/assignments/:id/close", permissionRequired("task:template:manage"), HallDailyAssignmentController.close);
hallDailyRoutes.delete("/hall-daily/assignments/:id", permissionRequired("task:template:manage"), HallDailyAssignmentController.delete);

// ─── 厅管日常任务：执行层（厅管填报）─────────────────────────────────────────
// GET    /api/hall-daily/my-records                         获取当前厅今日+昨日可补录的记录
// POST   /api/hall-daily/item-records                       单题作答
// POST   /api/hall-daily/my-records/:id/submit              整条提交
// POST   /api/hall-daily/my-records/:id/leave-requests      申请请假
// POST   /api/hall-daily/leave-requests/:id/cancel          撤回请假
// POST   /api/hall-daily/leave-requests/:id/approve         同意请假
// POST   /api/hall-daily/leave-requests/:id/reject          拒绝请假

hallDailyRoutes.get("/hall-daily/my-records", permissionRequired("task:record:submit"), HallDailyRecordController.getMyRecords);
hallDailyRoutes.post("/hall-daily/item-records", permissionRequired("task:record:submit"), HallDailyRecordController.submitItemRecord);
hallDailyRoutes.post("/hall-daily/my-records/:id/submit", permissionRequired("task:record:submit"), HallDailyRecordController.submitRecord);
hallDailyRoutes.post("/hall-daily/my-records/:id/leave-requests", permissionRequired("task:record:submit"), HallDailyLeaveController.apply);
hallDailyRoutes.post("/hall-daily/leave-requests/:id/cancel", permissionRequired("task:record:submit"), HallDailyLeaveController.cancel);
hallDailyRoutes.post("/hall-daily/leave-requests/:id/approve", permissionRequired("task:report:view"), HallDailyLeaveController.approve);
hallDailyRoutes.post("/hall-daily/leave-requests/:id/reject", permissionRequired("task:report:view"), HallDailyLeaveController.reject);
