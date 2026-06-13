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
    const attachment = await prisma.taskItemAttachment.findUnique({ where: { id: req.params.id } });
    if (!attachment) return fail(res, "ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    if (attachment.uploadedBy !== req.userId) return fail(res, "FORBIDDEN", "无权删除该附件", 403);

    const filePath = path.join(process.cwd(), attachment.fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await prisma.taskItemAttachment.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  }
);
