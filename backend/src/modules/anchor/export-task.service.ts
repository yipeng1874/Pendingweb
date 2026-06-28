import fs from "fs";
import path from "path";
import { prisma } from "../../shared/prisma.js";
import { AnchorService } from "./service.js";

const EXPORT_DIR = path.join(process.cwd(), "uploads", "exports");
const EXPIRES_DAYS = 7;

function ensureExportDir() {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }
}

function formatDateForFilename(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function buildCsvContent(rows: Array<Record<string, string>>) {
  const headers = ["身份分类", "状态", "基地名称", "基地代码", "团队名称", "团队代码", "厅名称", "厅UID", "主播昵称", "手机号", "抖音号", "抖音UID"];
  const keys = ["identityType", "profileStatus", "baseName", "baseCode", "teamName", "teamCode", "hallName", "hallDouyinUid", "nickname", "phone", "douyinNo", "douyinUid"];
  const escapeCell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((r) => keys.map((k) => escapeCell(r[k] ?? "")).join(",")),
  ];
  return "\uFEFF" + lines.join("\r\n");
}

const MAX_TASKS_PER_USER = 10;

async function cleanExpiredTasks() {
  const expired = await prisma.exportTask.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true, filePath: true },
  });
  for (const task of expired) {
    if (task.filePath) {
      const absPath = path.join(process.cwd(), task.filePath.replace(/^\//, ""));
      try { fs.unlinkSync(absPath); } catch { /* 文件已不存在，忽略 */ }
    }
  }
  if (expired.length > 0) {
    await prisma.exportTask.deleteMany({ where: { id: { in: expired.map((t) => t.id) } } });
  }
}

/** 保留每个用户最新 MAX_TASKS_PER_USER 条，超出的删除（含文件） */
async function trimUserTasks(creatorId: string) {
  const all = await prisma.exportTask.findMany({
    where: { creatorId, type: "anchor_profiles" },
    orderBy: { createdAt: "desc" },
    select: { id: true, filePath: true },
  });
  if (all.length <= MAX_TASKS_PER_USER) return;
  const toDelete = all.slice(MAX_TASKS_PER_USER);
  for (const task of toDelete) {
    if (task.filePath) {
      const absPath = path.join(process.cwd(), task.filePath.replace(/^\//, ""));
      try { fs.unlinkSync(absPath); } catch { /* 忽略 */ }
    }
  }
  await prisma.exportTask.deleteMany({ where: { id: { in: toDelete.map((t) => t.id) } } });
}

async function runTask(taskId: string) {
  await prisma.exportTask.update({ where: { id: taskId }, data: { status: "processing" } });

  try {
    const task = await prisma.exportTask.findUnique({ where: { id: taskId } });
    if (!task) return;

    const params = task.params as {
      keyword: string;
      orgId?: string;
      status: string;
      viewMode?: string;
      scopePath?: string;
      roleCode?: string;
    };

    const rows = await AnchorService.exportProfiles(params);
    const csvContent = buildCsvContent(rows as Array<Record<string, string>>);

    ensureExportDir();
    const orgIdShort = (params.orgId ?? "all").slice(-6);
    const dateStr = formatDateForFilename(new Date());
    const uniqueSuffix = taskId.slice(0, 8);
    const filename = `主播账号导出_${orgIdShort}_${dateStr}_${uniqueSuffix}.csv`;
    const filePath = path.join(EXPORT_DIR, filename);
    fs.writeFileSync(filePath, csvContent, "utf8");

    // 存储相对路径（相对于工作目录），便于静态服务访问
    const relPath = `/uploads/exports/${filename}`;

    await prisma.exportTask.update({
      where: { id: taskId },
      data: { status: "done", filePath: relPath, rowCount: rows.length },
    });
  } catch (error: any) {
    await prisma.exportTask.update({
      where: { id: taskId },
      data: { status: "failed", errorMsg: error?.message ?? "未知错误" },
    });
  }
}

export const ExportTaskService = {
  async createTask(input: {
    creatorId: string;
    keyword: string;
    orgId?: string;
    status: string;
    viewMode?: string;
    scopePath?: string;
    roleCode?: string;
  }) {
    // 检查是否有进行中的同类任务
    const inProgress = await prisma.exportTask.findFirst({
      where: {
        creatorId: input.creatorId,
        type: "anchor_profiles",
        status: { in: ["pending", "processing"] },
      },
    });
    if (inProgress) {
      const error = new Error("上次导出任务还在处理中，请稍后再试");
      (error as any).code = "EXPORT_TASK_IN_PROGRESS";
      throw error;
    }

    // 懒清理：删除过期任务 + 超出条数限制的旧任务
    setImmediate(() => {
      void cleanExpiredTasks();
      void trimUserTasks(input.creatorId);
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRES_DAYS * 24 * 60 * 60 * 1000);

    const task = await prisma.exportTask.create({
      data: {
        type: "anchor_profiles",
        status: "pending",
        params: {
          keyword: input.keyword,
          orgId: input.orgId,
          status: input.status,
          viewMode: input.viewMode ?? "current",
          scopePath: input.scopePath,
          roleCode: input.roleCode,
        },
        creatorId: input.creatorId,
        expiresAt,
      },
    });

    // 异步执行，立即返回 taskId
    setImmediate(() => void runTask(task.id));

    return { taskId: task.id, expiresAt };
  },

  async listMyTasks(creatorId: string) {
    const now = new Date();
    const tasks = await prisma.exportTask.findMany({
      where: {
        creatorId,
        type: "anchor_profiles",
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        rowCount: true,
        filePath: true,
        errorMsg: true,
        createdAt: true,
        expiresAt: true,
        params: true,
      },
    });
    return tasks;
  },

  async getTaskFile(taskId: string, creatorId: string) {
    const task = await prisma.exportTask.findUnique({ where: { id: taskId } });
    if (!task) {
      const error = new Error("导出任务不存在");
      (error as any).code = "EXPORT_TASK_NOT_FOUND";
      throw error;
    }
    if (task.creatorId !== creatorId) {
      const error = new Error("无权访问该导出文件");
      (error as any).code = "EXPORT_TASK_FORBIDDEN";
      throw error;
    }
    if (task.status !== "done" || !task.filePath) {
      const error = new Error("文件尚未生成或已失败");
      (error as any).code = "EXPORT_TASK_NOT_READY";
      throw error;
    }
    if (task.expiresAt < new Date()) {
      const error = new Error("导出文件已过期");
      (error as any).code = "EXPORT_TASK_EXPIRED";
      throw error;
    }
    // 返回绝对路径
    const absPath = path.join(process.cwd(), task.filePath.replace(/^\//, ""));
    return { absPath, filePath: task.filePath };
  },
};
