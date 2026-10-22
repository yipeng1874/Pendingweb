import { isDailyRecordCollectionClosed } from "../record/daily-record-time.utils.js";
import { Router } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";

import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";
import { withTeamRecordLock } from "../team-daily/team-record-lock.js";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE = 1 * 1024 * 1024;

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const dir = path.join(process.cwd(), "uploads", "tasks", String(year), month);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error("MIME_NOT_ALLOWED"));
  },
});


export const teamDailyUploadRoutes = Router();
teamDailyUploadRoutes.use(authRequired, identityRequired);

teamDailyUploadRoutes.post(
  "/tasks/team-daily/upload",
  (req: any, res: any, next: any) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") return fail(res, "FILE_TOO_LARGE", "图片不得超过1MB", 400);
        if (err.message === "MIME_NOT_ALLOWED") return fail(res, "MIME_NOT_ALLOWED", "只支持上传 JPG/PNG/GIF/WebP 格式图片", 400);
        return fail(res, "UPLOAD_ERROR", "上传失败", 500);
      }
      next();
    });
  },
  async (req: any, res: any) => {
    if (!req.file) return fail(res, "NO_FILE", "请选择要上传的图片", 400);
    const teamTaskItemRecordId = req.body?.teamTaskItemRecordId;
    if (!teamTaskItemRecordId) return fail(res, "ITEM_RECORD_REQUIRED", "请提供 teamTaskItemRecordId", 400);

    // 校验 teamTaskItemRecord 归属：必须是当前用户身份所在厅的 record
    const itemRecord = await prisma.teamTaskItemRecord.findFirst({
      where: { id: teamTaskItemRecordId },
      include: {
        taskRecord: {
          select: {
            teamOrgId: true,
            assignment: {
              select: {
                targets: { select: { teamOrgId: true } },
              },
            },
          },
        },
      },
    });
    if (!itemRecord) {
      fs.unlinkSync(req.file.path);
      return fail(res, "ITEM_RECORD_NOT_FOUND", "题目记录不存在", 404);
    }

    const relPath = req.file.path.replace(/\\/g, "/");
    const uploadsIdx = relPath.indexOf("uploads/");
    const fileUrl = "/" + relPath.slice(uploadsIdx);

    return withTeamRecordLock(itemRecord.taskRecordId, async (prisma) => {
    const record = await prisma.teamTaskRecord.findUniqueOrThrow({ where: { id: itemRecord.taskRecordId }, include: { leaveRequests: { where: { status: "approved" } } } });
    const owner = await prisma.userIdentity.findFirst({ where: { userId: req.userId, roleCode: "TEAM_ADMIN", status: "active", orgId: record.teamOrgId, org: { status: "active" } } });
    if (!owner || isDailyRecordCollectionClosed(record.recordDate) || record.status === "submitted" || record.leaveRequests.length) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return fail(res, "TEAM_TASK_LOCKED", "无权修改或任务已完成、已批准请假，不能上传附件", 409);
    }
    const attachment = await prisma.teamTaskItemAttachment.create({
      data: {
        teamTaskItemRecordId,
        fileName: req.file.originalname,
        fileUrl,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.userId,
      },
    });

    return ok(res, attachment);
    }).catch((error) => {
      console.error("[hall-upload]", error);
      return fail(res, "UPLOAD_ERROR", "上传失败，请稍后重试", 500);
    });
  }
);

teamDailyUploadRoutes.delete(
  "/tasks/team-daily/attachments/:id",
  async (req: any, res: any) => {
    const attachment = await prisma.teamTaskItemAttachment.findUnique({ where: { id: req.params.id }, include: { teamTaskItemRecord: true } });
    if (!attachment) return fail(res, "ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    if (attachment.uploadedBy !== req.userId) return fail(res, "FORBIDDEN", "无权删除该附件", 403);

    return withTeamRecordLock(attachment.teamTaskItemRecord.taskRecordId, async (prisma) => {
    const record = await prisma.teamTaskRecord.findUniqueOrThrow({ where: { id: attachment.teamTaskItemRecord.taskRecordId }, include: { leaveRequests: { where: { status: "approved" } } } });
    const owner = await prisma.userIdentity.findFirst({ where: { userId: req.userId, roleCode: "TEAM_ADMIN", status: "active", orgId: record.teamOrgId, org: { status: "active" } } });
    if (!owner || isDailyRecordCollectionClosed(record.recordDate) || record.status === "submitted" || record.leaveRequests.length) return fail(res, "TEAM_TASK_LOCKED", "任务已完成或已批准请假，不能删除附件", 409);
    const filePath = path.join(process.cwd(), attachment.fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await prisma.teamTaskItemAttachment.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
    }).catch((error) => {
      console.error("[hall-attachment-delete]", error);
      return fail(res, "DELETE_ERROR", "删除失败，请稍后重试", 500);
    });
  }
);
