import { formatBeijingDate } from "../record/daily-record-time.utils.js";
import { prisma } from "../../../shared/prisma.js";
import { fail } from "../../../shared/response.js";
import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { TeamDailyAssignmentController, TeamDailyLeaveController, TeamDailyRecordController, TeamDailyTemplateController } from "./team-daily.controller.js";

export const teamDailyRoutes = Router();
teamDailyRoutes.use(authRequired, identityRequired);
teamDailyRoutes.use(async (req: any,res: any,next: any) => {
  if (!req.path.startsWith('/team-daily/')) return next();
  const execution = req.path.includes('/my-records') || req.path.endsWith('/item-records') || req.path.endsWith('/cancel');
  if (!execution) return next();
  try {
    const memberships = await prisma.userIdentity.findMany({ where: { userId: req.userId, roleCode: 'TEAM_ADMIN', status: 'active', org: { status: 'active' } }, select: { orgId: true } });
    const teamIds = memberships.map(item => item.orgId).filter((id): id is string => !!id);
    let recordId = req.body?.taskRecordId;
    const match = req.path.match(/\/my-records\/([^/]+)/);
    if (match) recordId = match[1];
    if (req.path.endsWith('/cancel')) {
      const id = req.path.split('/').at(-2);
      const leave = await prisma.teamTaskLeaveRequest.findUnique({where:{id}});
      if (!leave) return fail(res,'NOT_FOUND','记录不存在',404);
      recordId = leave.taskRecordId;
    }
    if (recordId) {
      const record=await prisma.teamTaskRecord.findFirst({where:{id:recordId,teamOrgId:{in:teamIds},teamOrg:{status:'active'}},include:{assignment:{select:{status:true}}}});
      if (!record) return fail(res,'NOT_FOUND','记录不存在或无权访问',404);
      if (record.recordDate === formatBeijingDate(new Date()) && record.assignment.status !== 'active') return fail(res,'TASK_ENDED','该任务已结束，请刷新待办',409);
    }
    next();
  } catch(error) { next(error); }
});

// ─── 团队管理日常任务：模板管理 ───────────────────────────────────────────────────
// GET    /api/team-daily/templates              列出模板（?baseOrgId=&status=）
// GET    /api/team-daily/templates/:id          查看单个模板
// POST   /api/team-daily/templates              新建模板
// PATCH  /api/team-daily/templates/:id          编辑模板
// DELETE /api/team-daily/templates/:id          删除模板（draft 状态）
// POST   /api/team-daily/templates/:id/copy     复制模板
// POST   /api/team-daily/templates/:id/archive  归档模板

teamDailyRoutes.get("/team-daily/templates", permissionRequired("task:assignment:view"), TeamDailyTemplateController.list);
teamDailyRoutes.get("/team-daily/templates/:id", permissionRequired("task:assignment:view"), TeamDailyTemplateController.getById);
teamDailyRoutes.post("/team-daily/templates", permissionRequired("task:template:manage"), TeamDailyTemplateController.create);
teamDailyRoutes.patch("/team-daily/templates/:id", permissionRequired("task:template:manage"), TeamDailyTemplateController.update);
teamDailyRoutes.delete("/team-daily/templates/:id", permissionRequired("task:template:manage"), TeamDailyTemplateController.remove);
teamDailyRoutes.post("/team-daily/templates/:id/copy", permissionRequired("task:template:manage"), TeamDailyTemplateController.copy);
teamDailyRoutes.post("/team-daily/templates/:id/archive", permissionRequired("task:template:manage"), TeamDailyTemplateController.archive);

// ─── 团队管理日常任务：发布管理 ───────────────────────────────────────────────────
// GET    /api/team-daily/assignments                         列出发布任务（?baseOrgId=&status=）
// POST   /api/team-daily/assignments/draft                   保存草稿（含目标团队选择）
// GET    /api/team-daily/assignments/:id/preview             发布预览
// POST   /api/team-daily/assignments/:id/publish             正式发布
// POST   /api/team-daily/assignments/:id/close               结束任务
// DELETE /api/team-daily/assignments/:id                     删除草稿

teamDailyRoutes.get("/team-daily/assignments", permissionRequired("task:assignment:view"), TeamDailyAssignmentController.list);
teamDailyRoutes.post("/team-daily/assignments/draft", permissionRequired("task:template:manage"), TeamDailyAssignmentController.saveDraft);
teamDailyRoutes.get("/team-daily/assignments/:id/preview", permissionRequired("task:assignment:view"), TeamDailyAssignmentController.getPublishPreview);
teamDailyRoutes.post("/team-daily/assignments/:id/publish", permissionRequired("task:template:manage"), TeamDailyAssignmentController.publish);
teamDailyRoutes.post("/team-daily/assignments/:id/close", permissionRequired("task:template:manage"), TeamDailyAssignmentController.close);
teamDailyRoutes.delete("/team-daily/assignments/:id", permissionRequired("task:template:manage"), TeamDailyAssignmentController.delete);

// ─── 团队管理日常任务：执行层（团队管理员填报）─────────────────────────────────────────
// GET    /api/team-daily/my-records                         获取当前团队今日+昨日可补录的记录
// POST   /api/team-daily/item-records                       单题作答
// POST   /api/team-daily/my-records/:id/submit              整条提交
// POST   /api/team-daily/my-records/:id/leave-requests      申请请假
// POST   /api/team-daily/leave-requests/:id/cancel          撤回请假
// POST   /api/team-daily/leave-requests/:id/approve         同意请假
// POST   /api/team-daily/leave-requests/:id/reject          拒绝请假

teamDailyRoutes.get("/team-daily/my-records", TeamDailyRecordController.getMyRecords);
teamDailyRoutes.post("/team-daily/item-records", TeamDailyRecordController.submitItemRecord);
teamDailyRoutes.post("/team-daily/my-records/:id/submit", TeamDailyRecordController.submitRecord);
teamDailyRoutes.post("/team-daily/my-records/:id/leave-requests", TeamDailyLeaveController.apply);
teamDailyRoutes.post("/team-daily/leave-requests/:id/cancel", TeamDailyLeaveController.cancel);
teamDailyRoutes.post("/team-daily/leave-requests/batch", permissionRequired("task:exemption:review"), TeamDailyLeaveController.batch);
teamDailyRoutes.post("/team-daily/leave-requests/:id/approve", permissionRequired("task:report:view"), TeamDailyLeaveController.approve);
teamDailyRoutes.post("/team-daily/leave-requests/:id/reject", permissionRequired("task:report:view"), TeamDailyLeaveController.reject);
