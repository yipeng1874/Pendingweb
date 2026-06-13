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

  app.use((_req, res) => fail(res, "NOT_FOUND", "接口不存在", 404));
  return app;
}
