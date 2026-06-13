import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";

export const reminderRoutes = Router();
reminderRoutes.use(authRequired, identityRequired);

const t = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const BOOLEAN_TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const REMINDER_STATUS_VALUES = new Set(["active", "done"]);

/** 懒删除：清理 30 天前已完成 / 已逾期记录 */
async function purgeOldReminders(userId: string) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  try {
    await prisma.personalReminder.deleteMany({
      where: {
        userId,
        OR: [
          // 已完成且更新时间超过30天
          { status: "done", updatedAt: { lt: cutoff } },
          // 进行中但结束时间超过30天前（已逾期超30天）
          { status: "active", remindEnd: { lt: cutoff } },
        ],
      },
    });
  } catch {
    // 清理失败不影响正常响应
  }
}

function parseReminderDate(value: unknown) {
  const raw = t(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseImportantFlag(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return BOOLEAN_TRUE_VALUES.has(t(value).toLowerCase());
}

// 获取个人提醒列表
reminderRoutes.get("/tasks/reminders", permissionRequired("task:reminder:manage"), async (req: any, res: any) => {
  const statusParam = t(req.query.status);

  // 懒删除：每次拉取时清理30天前的旧记录
  void purgeOldReminders(req.userId);

  // overdue 是前端伪状态：进行中但已超过结束时间
  if (statusParam === "overdue") {
    const data = await prisma.personalReminder.findMany({
      where: {
        userId: req.userId,
        status: "active",
        remindEnd: { lt: new Date() },
      },
      orderBy: [{ isImportant: "desc" }, { remindEnd: "asc" }, { createdAt: "desc" }],
    });
    return ok(res, data);
  }

  const data = await prisma.personalReminder.findMany({
    where: { userId: req.userId, ...(statusParam && REMINDER_STATUS_VALUES.has(statusParam) ? { status: statusParam as any } : {}) },
    orderBy: [{ status: "asc" }, { isImportant: "desc" }, { remindEnd: "asc" }, { createdAt: "desc" }],
  });
  return ok(res, data);
});

// 创建提醒
reminderRoutes.post("/tasks/reminders", permissionRequired("task:reminder:manage"), async (req: any, res: any) => {
  const { title, note, remindAt, remindStart, remindEnd, isImportant } = req.body;
  const normalizedTitle = t(title);
  if (!normalizedTitle) return fail(res, "REMINDER_REQUIRED", "提醒标题不能为空", 400);

  const parsedEnd = parseReminderDate(remindEnd ?? remindStart ?? remindAt);
  if (!parsedEnd) return fail(res, "REMINDER_END_REQUIRED", "请选择有效的结束时间", 400);

  const reminder = await prisma.personalReminder.create({
    data: {
      userId: req.userId,
      title: normalizedTitle,
      note: t(note) || null,
      remindAt: null,
      remindStart: null,
      remindEnd: parsedEnd,
      repeatType: null,
      isImportant: parseImportantFlag(isImportant),
      status: "active",
    },
  });
  return ok(res, reminder);
});

// 更新提醒
reminderRoutes.patch("/tasks/reminders/:id", permissionRequired("task:reminder:manage"), async (req: any, res: any) => {
  const reminder = await prisma.personalReminder.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!reminder) return fail(res, "REMINDER_NOT_FOUND", "提醒不存在", 404);

  const data: any = {};

  if ("title" in req.body) {
    const normalizedTitle = t(req.body.title);
    if (!normalizedTitle) return fail(res, "REMINDER_REQUIRED", "提醒标题不能为空", 400);
    data.title = normalizedTitle;
  }

  if ("note" in req.body) {
    data.note = t(req.body.note) || null;
  }

  if ("remindEnd" in req.body || "remindStart" in req.body || "remindAt" in req.body) {
    const parsedEnd = parseReminderDate(req.body.remindEnd ?? req.body.remindStart ?? req.body.remindAt);
    if (!parsedEnd) return fail(res, "REMINDER_END_REQUIRED", "请选择有效的结束时间", 400);
    data.remindAt = null;
    data.remindStart = null;
    data.remindEnd = parsedEnd;
    data.repeatType = null;
  }

  if ("isImportant" in req.body) {
    data.isImportant = parseImportantFlag(req.body.isImportant);
  }

  if ("status" in req.body) {
    const status = t(req.body.status);
    if (!REMINDER_STATUS_VALUES.has(status)) return fail(res, "REMINDER_STATUS_INVALID", "提醒状态无效", 400);
    data.status = status;
  }

  const updated = await prisma.personalReminder.update({ where: { id: req.params.id }, data });
  return ok(res, updated);
});

// 删除提醒
reminderRoutes.delete("/tasks/reminders/:id", permissionRequired("task:reminder:manage"), async (req: any, res: any) => {
  const reminder = await prisma.personalReminder.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!reminder) return fail(res, "REMINDER_NOT_FOUND", "提醒不存在", 404);
  await prisma.personalReminder.delete({ where: { id: req.params.id } });
  return ok(res, { deleted: true });
});

// 标记完成
reminderRoutes.post("/tasks/reminders/:id/done", permissionRequired("task:reminder:manage"), async (req: any, res: any) => {
  const reminder = await prisma.personalReminder.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!reminder) return fail(res, "REMINDER_NOT_FOUND", "提醒不存在", 404);
  const updated = await prisma.personalReminder.update({ where: { id: req.params.id }, data: { status: "done" } });
  return ok(res, updated);
});
