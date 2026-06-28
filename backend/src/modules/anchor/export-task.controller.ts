import fs from "fs";
import { fail, ok } from "../../shared/response.js";
import { ExportTaskService } from "./export-task.service.js";
import { text } from "./utils.js";

export const ExportTaskController = {
  async createTask(req: any, res: any) {
    const orgId = text(req.body.orgId) || undefined;
    if (!orgId) return fail(res, "EXPORT_TASK_ORG_REQUIRED", "请先选择组织", 400);

    try {
      const result = await ExportTaskService.createTask({
        creatorId: req.userId,
        keyword: text(req.body.keyword),
        orgId,
        status: text(req.body.status),
        viewMode: text(req.body.viewMode) || "current",
        scopePath: req.identity?.scopePath,
        roleCode: req.identity?.roleCode,
      });
      return ok(res, result);
    } catch (error: any) {
      if (error?.code === "EXPORT_TASK_IN_PROGRESS") {
        return fail(res, error.code, error.message, 429);
      }
      throw error;
    }
  },

  async listMyTasks(req: any, res: any) {
    const tasks = await ExportTaskService.listMyTasks(req.userId);
    return ok(res, tasks);
  },

  async downloadFile(req: any, res: any) {
    try {
      const { absPath, filePath } = await ExportTaskService.getTaskFile(req.params.id, req.userId);
      if (!fs.existsSync(absPath)) {
        return fail(res, "EXPORT_FILE_MISSING", "文件已被清理，请重新导出", 404);
      }
      const filename = filePath.split("/").pop() ?? "export.csv";
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      fs.createReadStream(absPath).pipe(res);
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        EXPORT_TASK_NOT_FOUND: 404,
        EXPORT_TASK_FORBIDDEN: 403,
        EXPORT_TASK_NOT_READY: 400,
        EXPORT_TASK_EXPIRED: 410,
      };
      if (error?.code && statusMap[error.code]) {
        return fail(res, error.code, error.message, statusMap[error.code]);
      }
      throw error;
    }
  },
};
