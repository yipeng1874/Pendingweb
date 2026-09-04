import { Router } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";
import { withHallRecordLock } from "../hall-daily/hall-record-lock.js";

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

async function canAccessTaskItemRecord(taskItemRecordId: string, userId: string, identityId: string) {
  const itemRecord = await prisma.taskItemRecord.findFirst({
    where: { id: taskItemRecordId },
    include: {
      taskRecord: {
        select: {
          id: true,
          userId: true,
          exemption: { select: { status: true } },
          visibleIdentityLinks: { where: { identityId }, select: { id: true } },
        },
      },
    },
  });
  if (!itemRecord) return null;
  const hasIdentityLink = itemRecord.taskRecord.visibleIdentityLinks.length > 0;
  if (!hasIdentityLink && itemRecord.taskRecord.userId !== userId) return null;
  if (hasIdentityLink || itemRecord.taskRecord.userId === userId) return itemRecord;
  return null;
}

export const uploadRoutes = Router();
uploadRoutes.use(authRequired, identityRequired);

uploadRoutes.post(
  "/tasks/upload",
  permissionRequired("task:record:submit"),
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
    const taskItemRecordId = req.body?.taskItemRecordId;
    if (!taskItemRecordId) return fail(res, "ITEM_RECORD_REQUIRED", "请提供 taskItemRecordId", 400);

    const itemRecord = await canAccessTaskItemRecord(taskItemRecordId, req.userId, req.identity.id);
    if (!itemRecord) {
      fs.unlinkSync(req.file.path);
      return fail(res, "ITEM_RECORD_NOT_FOUND", "子任务执行记录不存在", 404);
    }
    if (itemRecord.taskRecord.exemption?.status === "approved") {
      fs.unlinkSync(req.file.path);
      return fail(res, "RECORD_EXEMPTED", "今日任务已豁免，当前不可上传附件", 409);
    }

    const relPath = req.file.path.replace(/\\/g, "/");
    const uploadsIdx = relPath.indexOf("uploads/");
    const fileUrl = "/" + relPath.slice(uploadsIdx);

    const attachment = await prisma.taskItemAttachment.create({
      data: {
        taskItemRecordId,
        fileName: req.file.originalname,
        fileUrl,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.userId,
      },
    });

    return ok(res, attachment);
  }
);

uploadRoutes.delete(
  "/tasks/attachments/:id",
  permissionRequired("task:record:submit"),
  async (req: any, res: any) => {
    const attachment = await prisma.taskItemAttachment.findUnique({
      where: { id: req.params.id },
      include: { taskItemRecord: { select: { taskRecord: { select: { exemption: { select: { status: true } } } } } } },
    });
    if (!attachment) return fail(res, "ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    if (attachment.uploadedBy !== req.userId) return fail(res, "FORBIDDEN", "无权删除该附件", 403);
    if (attachment.taskItemRecord.taskRecord.exemption?.status === "approved") return fail(res, "RECORD_EXEMPTED", "今日任务已豁免，当前不可删除附件", 409);

    const filePath = path.join(process.cwd(), attachment.fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await prisma.taskItemAttachment.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  }
);

// ── 厅管日常任务专用图片上传 ──────────────────────────────────────────────────

uploadRoutes.post(
  "/tasks/hall-daily/upload",
  permissionRequired("task:record:submit"),
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
    const hallTaskItemRecordId = req.body?.hallTaskItemRecordId;
    if (!hallTaskItemRecordId) return fail(res, "ITEM_RECORD_REQUIRED", "请提供 hallTaskItemRecordId", 400);

    // 校验 hallTaskItemRecord 归属：必须是当前用户身份所在厅的 record
    const itemRecord = await prisma.hallTaskItemRecord.findFirst({
      where: { id: hallTaskItemRecordId },
      include: {
        taskRecord: {
          select: {
            hallOrgId: true,
            assignment: {
              select: {
                targets: { select: { hallOrgId: true } },
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

    return withHallRecordLock(itemRecord.taskRecordId, async (prisma) => {
    const record = await prisma.hallTaskRecord.findUniqueOrThrow({ where: { id: itemRecord.taskRecordId }, include: { leaveRequests: { where: { status: "approved" } } } });
    const owner = await prisma.userIdentity.findFirst({ where: { userId: req.userId, roleCode: "HALL_MANAGER", status: "active", orgId: record.hallOrgId } });
    if (!owner || record.status === "submitted" || record.leaveRequests.length) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return fail(res, "HALL_TASK_LOCKED", "无权修改或任务已完成、已批准请假，不能上传附件", 409);
    }
    const attachment = await prisma.hallTaskItemAttachment.create({
      data: {
        hallTaskItemRecordId,
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

uploadRoutes.delete(
  "/tasks/hall-daily/attachments/:id",
  permissionRequired("task:record:submit"),
  async (req: any, res: any) => {
    const attachment = await prisma.hallTaskItemAttachment.findUnique({ where: { id: req.params.id }, include: { hallTaskItemRecord: true } });
    if (!attachment) return fail(res, "ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    if (attachment.uploadedBy !== req.userId) return fail(res, "FORBIDDEN", "无权删除该附件", 403);

    return withHallRecordLock(attachment.hallTaskItemRecord.taskRecordId, async (prisma) => {
    const record = await prisma.hallTaskRecord.findUniqueOrThrow({ where: { id: attachment.hallTaskItemRecord.taskRecordId }, include: { leaveRequests: { where: { status: "approved" } } } });
    if (record.status === "submitted" || record.leaveRequests.length) return fail(res, "HALL_TASK_LOCKED", "任务已完成或已批准请假，不能删除附件", 409);
    const filePath = path.join(process.cwd(), attachment.fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await prisma.hallTaskItemAttachment.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
    }).catch((error) => {
      console.error("[hall-attachment-delete]", error);
      return fail(res, "DELETE_ERROR", "删除失败，请稍后重试", 500);
    });
  }
);
