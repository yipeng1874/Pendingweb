import cors from "cors";
import express from "express";
import path from "path";
import { accountRoutes } from "./modules/account/routes.js";
import { anchorRoutes } from "./modules/anchor/routes.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { identityRoutes } from "./modules/identity/routes.js";
import { organizationRoutes } from "./modules/organization/routes.js";
import { assignmentRoutes } from "./modules/task/assignment/assignment.routes.js";
import { recordRoutes } from "./modules/task/record/record.routes.js";
import { reminderRoutes } from "./modules/task/reminder/reminder.routes.js";
import { reportRoutes } from "./modules/task/report/report.routes.js";
import { templateRoutes } from "./modules/task/template/template.routes.js";
import { uploadRoutes } from "./modules/task/upload/upload.routes.js";
import { notifyRoutes } from "./modules/task/notify/notify.routes.js";
import { temporaryNotifyScheduleRoutes } from "./modules/task/notify/temporary-notify-schedule.routes.js";
import { workflowTaskRoutes } from "./modules/task/collaboration/workflow.routes.js";
import { broadcastTaskRoutes } from "./modules/task/collaboration/broadcast.routes.js";
import { hallDailyRoutes } from "./modules/task/hall-daily/hall-daily.routes.js";
import { anchorSummaryRoutes } from "./modules/anchor-summary/anchor-summary.routes.js";
import { liveRoomCapacityRoutes } from "./modules/live-room-capacity/live-room-capacity.routes.js";
import { anchorAvgWaveRoutes } from "./modules/anchor-avg-wave/anchor-avg-wave.routes.js";
import { staffTurnoverRoutes } from "./modules/staff-turnover/staff-turnover.routes.js";
import { retentionRoutes } from "./modules/retention/retention.routes.js";
import { processMetricRoutes } from "./modules/process-metric/process-metric.routes.js";
import { fail } from "./shared/response.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // 静态文件服务（任务附件）
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
  app.use("/api/uploads", express.static(path.join(process.cwd(), "uploads")));

  app.get("/api/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));
  app.use("/api/auth", authRoutes);
  app.use("/api", anchorRoutes);
  app.use("/api", identityRoutes);
  app.use("/api", organizationRoutes);
  app.use("/api", accountRoutes);
  app.use("/api", auditRoutes);

  // 任务模块
  app.use("/api", templateRoutes);
  app.use("/api", assignmentRoutes);
  app.use("/api", recordRoutes);
  app.use("/api", uploadRoutes);
  app.use("/api", reminderRoutes);
  app.use("/api", reportRoutes);
  app.use("/api", notifyRoutes);
  app.use("/api", temporaryNotifyScheduleRoutes);
  app.use("/api", workflowTaskRoutes);
  app.use("/api", broadcastTaskRoutes);
  app.use("/api", hallDailyRoutes);
  app.use("/api", anchorSummaryRoutes);
  app.use("/api", liveRoomCapacityRoutes);
  app.use("/api", anchorAvgWaveRoutes);
  app.use("/api", staffTurnoverRoutes);
  app.use("/api", retentionRoutes);
  app.use("/api", processMetricRoutes);

  app.use((_req, res) => fail(res, "NOT_FOUND", "接口不存在", 404));

  // 全局错误兜底：把 Prisma P2003 / 已知业务错误转成 4xx，避免 500 冒到 Express 默认处理
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err && err.code === "P2003") {
      return fail(res, "FK_CONSTRAINT", `存在外键引用无法删除：${err.meta?.field_name ?? ""}`, 409);
    }
    if (err && err.code === "P2025") {
      return fail(res, "NOT_FOUND", "目标记录不存在", 404);
    }
    console.error("[unhandled-error]", err);
    return fail(res, "INTERNAL", "服务器内部错误", 500);
  });

  return app;
}
