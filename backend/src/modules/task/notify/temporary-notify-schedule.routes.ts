import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";
import { buildTemporarySubjectGroups } from "../assignment/temporary-assignment.utils.js";

// ─── 常量 ───────────────────────────────────────────────────────────────────

const TIER_LABELS = ["≤1天", "2-3天", "4-7天", "8-15天", ">15天"] as const;

/** 每档可选的每日次数 */
const VALID_DAILY_COUNTS = new Set([0, 1, 2, 4, 8, 12, 24]);

/**
 * 根据剩余天数返回档位索引 (0=tier1, 4=tier5)
 * daysLeft = ceil((deadlineAt - now) / 86400000)
 * tier1: ≤1天, tier2: 2-3天, tier3: 4-7天, tier4: 8-15天, tier5: >15天
 */
function getTierIndex(daysLeft: number): 0 | 1 | 2 | 3 | 4 {
  if (daysLeft <= 1) return 0;
  if (daysLeft <= 3) return 1;
  if (daysLeft <= 7) return 2;
  if (daysLeft <= 15) return 3;
  return 4;
}

/** 从 schedule 取某档的 dailyCount */
function getTierDailyCount(schedule: { tier1DailyCount: number; tier2DailyCount: number; tier3DailyCount: number; tier4DailyCount: number; tier5DailyCount: number }, tierIndex: 0 | 1 | 2 | 3 | 4) {
  const counts = [schedule.tier1DailyCount, schedule.tier2DailyCount, schedule.tier3DailyCount, schedule.tier4DailyCount, schedule.tier5DailyCount];
  return counts[tierIndex];
}

/** 根据 dailyCount 计算当天应触发的北京时整点列表 (0-23)  */
function getDailyTriggerHours(dailyCount: number): number[] {
  if (dailyCount <= 0) return [];
  if (dailyCount === 1) return [13];
  if (dailyCount === 2) return [10, 16];
  if (dailyCount === 4) return [9, 12, 15, 18];
  if (dailyCount === 8) return [8, 10, 12, 14, 15, 16, 18, 20];
  if (dailyCount === 12) return [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  // 24次：每小时整点
  return Array.from({ length: 24 }, (_, i) => i);
}

// ─── 时间工具 ────────────────────────────────────────────────────────────────

function getBeijingHour(date: Date) {
  return (date.getUTCHours() + 8) % 24;
}

function getBeijingMinute(date: Date) {
  return date.getUTCMinutes();
}

function formatBeijingDate(date: Date) {
  const utc8 = new Date(date.getTime() + 8 * 3600 * 1000);
  return utc8.toISOString().slice(0, 10);
}

function getTemporaryNotifySlotKey(date: Date) {
  return `${formatBeijingDate(date)} ${String(getBeijingHour(date)).padStart(2, "0")}`;
}

// ─── 飞书发送（复用逻辑）────────────────────────────────────────────────────

type FeishuConfigRecord = {
  id: string;
  name: string;
  appId: string;
  appSecret: string;
  status: string;
};

async function getFeishuConfigDelegate() {
  return (prisma as any).feishuEnterpriseConfig as {
    findMany: (args: unknown) => Promise<FeishuConfigRecord[]>;
  } | undefined;
}

async function getFeishuTenantAccessToken(config: FeishuConfigRecord) {
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  const json = (await resp.json()) as any;
  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(json.msg || "获取飞书 tenant_access_token 失败");
  }
  return json.tenant_access_token as string;
}

async function sendFeishuBatchMessage(config: FeishuConfigRecord, openIds: string[], text: string) {
  const tenantAccessToken = await getFeishuTenantAccessToken(config);
  const resp = await fetch("https://open.feishu.cn/open-apis/message/v4/batch_send/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      msg_type: "text",
      open_ids: openIds,
      content: { text },
    }),
  });
  const json = (await resp.json()) as any;
  if (json.code !== 0) {
    throw new Error(json.msg || "飞书批量发送失败");
  }
  return {
    messageId: json.data?.message_id ?? null,
    invalidOpenIds: Array.isArray(json.data?.invalid_open_ids) ? json.data.invalid_open_ids : [],
  };
}

// ─── 受众构建（轻量版，仅需 openId 列表）────────────────────────────────────

type AudienceOpenIdRow = {
  feishuConfigId: string;
  feishuOpenId: string;
};

async function buildTemporaryNotifyOpenIds(assignmentId: string): Promise<AudienceOpenIdRow[]> {
  const assignment = await prisma.taskAssignment.findUnique({
    where: { id: assignmentId },
    include: { targets: true, exclusions: true, template: { select: { id: true, title: true } } },
  });
  if (!assignment || assignment.category !== "TEMPORARY") return [];
  if (assignment.status !== "active" || !assignment.isActive) return [];

  const groups = await buildTemporarySubjectGroups(prisma, assignment as any);
  if (!groups.length) return [];

  const records = await prisma.taskRecord.findMany({
    where: {
      assignmentId: assignment.id,
      status: { in: ["pending", "in_progress"] },
    },
    include: {
      visibleIdentityLinks: {
        select: {
          userId: true,
          identity: { select: { userId: true } },
        },
      },
    },
  });

  const groupMap = new Map(groups.map((group: any) => [group.subjectKey, group]));
  const userIdSet = new Set<string>();

  for (const record of records) {
    const group = groupMap.get(record.subjectKey);
    if (!group) continue;

    if ((group as any).subjectType === "USER") {
      const uid = record.userId ?? (group as any).subjectUserId;
      if (uid) userIdSet.add(uid);
    } else {
      record.visibleIdentityLinks.forEach((link: any) => {
        if (link.userId) userIdSet.add(link.userId);
        if (link.identity?.userId) userIdSet.add(link.identity.userId);
      });
      if (userIdSet.size === 0) {
        (group as any).visibleIdentities?.forEach((identity: any) => userIdSet.add(identity.userId));
      }
    }
  }

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIdSet) }, status: "active" },
    select: { id: true, feishuConfigId: true, feishuOpenId: true },
  });

  return users
    .filter((u) => u.feishuConfigId && u.feishuOpenId)
    .map((u) => ({ feishuConfigId: u.feishuConfigId!, feishuOpenId: u.feishuOpenId! }));
}

// ─── 二次投放：截止前已完成确认 ────────────────────────────────────────────────

type PreDeadlineConfirmAssignment = {
  id: string;
  deadlineAt: Date | null;
  template?: { title: string } | null;
};

type NotifyProcessedEntry = {
  identityId: string;
  assignmentId: string;
  status: string;
  [key: string]: unknown;
};

async function buildTemporaryReconfirmOpenIds(assignmentId: string): Promise<AudienceOpenIdRow[]> {
  const assignment = await prisma.taskAssignment.findUnique({
    where: { id: assignmentId },
    include: { targets: true, exclusions: true, template: { select: { id: true, title: true } } },
  });
  if (!assignment || assignment.category !== "TEMPORARY") return [];
  if (assignment.status !== "active" || !assignment.isActive) return [];

  const groups = await buildTemporarySubjectGroups(prisma, assignment as any);
  if (!groups.length) return [];

  const records = await prisma.taskRecord.findMany({
    where: {
      assignmentId: assignment.id,
      status: "submitted",
      reconfirmStatus: "pending",
    },
    include: {
      visibleIdentityLinks: {
        select: {
          userId: true,
          identity: { select: { userId: true } },
        },
      },
    },
  });

  const groupMap = new Map(groups.map((group: any) => [group.subjectKey, group]));
  const userIdSet = new Set<string>();

  for (const record of records) {
    const group = groupMap.get(record.subjectKey);
    if (!group) continue;
    if ((group as any).subjectType === "USER") {
      const uid = record.userId ?? (group as any).subjectUserId;
      if (uid) userIdSet.add(uid);
    } else {
      record.visibleIdentityLinks.forEach((link: any) => {
        if (link.userId) userIdSet.add(link.userId);
        if (link.identity?.userId) userIdSet.add(link.identity.userId);
      });
      if (userIdSet.size === 0) {
        (group as any).visibleIdentities?.forEach((identity: any) => userIdSet.add(identity.userId));
      }
    }
  }

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIdSet) }, status: "active" },
    select: { id: true, feishuConfigId: true, feishuOpenId: true },
  });

  return users
    .filter((u) => u.feishuConfigId && u.feishuOpenId)
    .map((u) => ({ feishuConfigId: u.feishuConfigId!, feishuOpenId: u.feishuOpenId! }));
}

async function processPreDeadlineReconfirmIfNeeded(
  schedule: { identityId: string; prefix: string },
  assignment: PreDeadlineConfirmAssignment,
  daysLeft: number,
  now: Date,
  processed: NotifyProcessedEntry[],
) {
  // Only trigger 1 day before deadline
  if (daysLeft !== 1) return;

  // Validate assignment-level flag
  const freshAssignment = await prisma.taskAssignment.findUnique({
    where: { id: assignment.id },
    select: { preDeadlineConfirmEnabled: true, status: true, isActive: true, deadlineAt: true },
  });
  if (!freshAssignment || !freshAssignment.preDeadlineConfirmEnabled) return;
  if (freshAssignment.status !== "active" || !freshAssignment.isActive) return;

  const confirmSlotKey = `reconfirm-${formatBeijingDate(now)}`;

  // Dedup check
  const existingLog = await (prisma as any).temporaryNotifyTriggerLog?.findUnique({
    where: { assignmentId_slotKey: { assignmentId: assignment.id, slotKey: confirmSlotKey } },
  });
  if (existingLog) return;

  // Bulk-mark submitted records as pending reconfirm (idempotent)
  const result = await prisma.taskRecord.updateMany({
    where: {
      assignmentId: assignment.id,
      status: "submitted",
      reconfirmStatus: null,
    },
    data: {
      reconfirmStatus: "pending",
      reconfirmSentAt: new Date(),
    },
  });

  if (result.count === 0) {
    processed.push({ identityId: schedule.identityId, assignmentId: assignment.id, status: "RECONFIRM_SKIPPED_NO_SUBMITTED" });
    // Still write log to avoid re-scanning
    await (prisma as any).temporaryNotifyTriggerLog?.create({ data: { assignmentId: assignment.id, slotKey: confirmSlotKey } });
    return;
  }

  // Send Feishu notification
  try {
    const openIdRows = await buildTemporaryReconfirmOpenIds(assignment.id);
    if (openIdRows.length > 0) {
      const delegate = await getFeishuConfigDelegate();
      if (delegate) {
        const configIds = Array.from(new Set(openIdRows.map((r) => r.feishuConfigId)));
        const configs = await delegate.findMany({ where: { id: { in: configIds }, status: "active" } } as any);
        const configMap = new Map(configs.map((c) => [c.id, c]));

        const bucketMap = new Map<string, string[]>();
        for (const row of openIdRows) {
          const bucket = bucketMap.get(row.feishuConfigId) ?? [];
          bucket.push(row.feishuOpenId);
          bucketMap.set(row.feishuConfigId, bucket);
        }

        const prefix = schedule.prefix || "来自系统提醒";
        const title = assignment.template?.title ?? "临时任务";
        const text = `${prefix}，「${title}」明天截止，请回顾确认你已提交的内容。`;

        let totalSuccess = 0;
        for (const [feishuConfigId, openIds] of bucketMap.entries()) {
          const config = configMap.get(feishuConfigId);
          if (!config) continue;
          const uniqueOpenIds = Array.from(new Set(openIds));
          const sendResult = await sendFeishuBatchMessage(config, uniqueOpenIds, text);
          totalSuccess += Math.max(uniqueOpenIds.length - sendResult.invalidOpenIds.length, 0);
        }

        processed.push({
          identityId: schedule.identityId,
          assignmentId: assignment.id,
          assignmentTitle: title,
          status: "RECONFIRM_SENT",
          daysLeft,
          slotKey: confirmSlotKey,
          markedCount: result.count,
          audienceCount: openIdRows.length,
          successCount: totalSuccess,
        });
      }
    }

    await (prisma as any).temporaryNotifyTriggerLog?.create({ data: { assignmentId: assignment.id, slotKey: confirmSlotKey } });
  } catch (error: any) {
    // Still write log on failure to avoid repeated retries
    await (prisma as any).temporaryNotifyTriggerLog?.create({ data: { assignmentId: assignment.id, slotKey: confirmSlotKey } }).catch(() => undefined);
    processed.push({
      identityId: schedule.identityId,
      assignmentId: assignment.id,
      status: "RECONFIRM_FAILED",
      slotKey: confirmSlotKey,
      error: error?.message ?? "发送失败",
    });
  }
}

// ─── Tick 函数（每分钟调用）─────────────────────────────────────────────────

export async function runTemporaryNotifyScheduleTick(now = new Date()) {
  // 只在每小时前5分钟内执行（整点窗口）
  if (getBeijingMinute(now) >= 5) {
    return { checked: false, reason: "OUTSIDE_TOP_OF_HOUR_WINDOW", processed: [] as Array<Record<string, unknown>> };
  }

  const beijingHour = getBeijingHour(now);
  const slotKey = getTemporaryNotifySlotKey(now);

  // 查所有 enabled 的调度配置
  const schedules = await (prisma as any).temporaryNotifySchedule?.findMany({
    where: { enabled: true },
  }) as Array<{
    id: string;
    identityId: string;
    enabled: boolean;
    prefix: string;
    tier1DailyCount: number;
    tier2DailyCount: number;
    tier3DailyCount: number;
    tier4DailyCount: number;
    tier5DailyCount: number;
  }> | undefined;

  if (!schedules || schedules.length === 0) {
    return { checked: true, slotKey, processed: [] as Array<Record<string, unknown>> };
  }

  const processed: Array<Record<string, unknown>> = [];

  for (const schedule of schedules) {
    // 查该 identity 名下所有进行中的临时任务（未截止）
    const assignments = await prisma.taskAssignment.findMany({
      where: {
        category: "TEMPORARY",
        status: "active",
        isActive: true,
        deadlineAt: { gt: now },
        createdByIdentityId: schedule.identityId,
      },
      select: { id: true, deadlineAt: true, template: { select: { title: true } } },
    });

    if (!assignments.length) {
      processed.push({ identityId: schedule.identityId, status: "NO_ACTIVE_ASSIGNMENTS" });
      continue;
    }

    for (const assignment of assignments) {
      if (!assignment.deadlineAt) continue;

      const daysLeft = Math.ceil((assignment.deadlineAt.getTime() - now.getTime()) / (86400 * 1000));
      const tierIndex = getTierIndex(daysLeft);

      // ── 二次投放：截止前已完成确认 ───────────────────────────────
      await processPreDeadlineReconfirmIfNeeded(schedule, assignment, daysLeft, now, processed);

      const dailyCount = getTierDailyCount(schedule, tierIndex);
      if (dailyCount <= 0) {
        processed.push({ identityId: schedule.identityId, assignmentId: assignment.id, status: "SKIPPED_ZERO_COUNT", daysLeft, tierIndex });
        continue;
      }

      // 判断当前北京时是否命中触发时间点
      const triggerHours = getDailyTriggerHours(dailyCount);
      if (!triggerHours.includes(beijingHour)) {
        processed.push({ identityId: schedule.identityId, assignmentId: assignment.id, status: "SKIPPED_NOT_TRIGGER_HOUR", daysLeft, tierIndex, beijingHour, triggerHours });
        continue;
      }

      // 防重检查
      const existingLog = await (prisma as any).temporaryNotifyTriggerLog?.findUnique({
        where: { assignmentId_slotKey: { assignmentId: assignment.id, slotKey } },
      });
      if (existingLog) {
        processed.push({ identityId: schedule.identityId, assignmentId: assignment.id, status: "SKIPPED_DUPLICATE_SLOT", slotKey });
        continue;
      }

      // 构建受众并发送
      try {
        const openIdRows = await buildTemporaryNotifyOpenIds(assignment.id);
        if (!openIdRows.length) {
          processed.push({ identityId: schedule.identityId, assignmentId: assignment.id, status: "SKIPPED_NO_AUDIENCE" });
          // 仍写日志，避免重复查
          await (prisma as any).temporaryNotifyTriggerLog?.create({ data: { assignmentId: assignment.id, slotKey } });
          continue;
        }

        const delegate = await getFeishuConfigDelegate();
        if (!delegate) throw new Error("FEISHU_CONFIG_UNAVAILABLE");

        const configIds = Array.from(new Set(openIdRows.map((r) => r.feishuConfigId)));
        const configs = await delegate.findMany({ where: { id: { in: configIds }, status: "active" } } as any);
        const configMap = new Map(configs.map((c) => [c.id, c]));

        const bucketMap = new Map<string, string[]>();
        for (const row of openIdRows) {
          const bucket = bucketMap.get(row.feishuConfigId) ?? [];
          bucket.push(row.feishuOpenId);
          bucketMap.set(row.feishuConfigId, bucket);
        }

        const prefix = schedule.prefix || "来自系统提醒";
        const title = (assignment as any).template?.title ?? "临时任务";
        const text = `${prefix}，「${title}」还有 ${daysLeft} 天截止，请尽快完成。`;

        let totalSuccess = 0;
        for (const [feishuConfigId, openIds] of bucketMap.entries()) {
          const config = configMap.get(feishuConfigId);
          if (!config) continue;
          const uniqueOpenIds = Array.from(new Set(openIds));
          const result = await sendFeishuBatchMessage(config, uniqueOpenIds, text);
          totalSuccess += Math.max(uniqueOpenIds.length - result.invalidOpenIds.length, 0);
        }

        // 写防重日志
        await (prisma as any).temporaryNotifyTriggerLog?.create({ data: { assignmentId: assignment.id, slotKey } });

        processed.push({
          identityId: schedule.identityId,
          assignmentId: assignment.id,
          assignmentTitle: title,
          status: "SENT",
          daysLeft,
          tierIndex,
          slotKey,
          audienceCount: openIdRows.length,
          successCount: totalSuccess,
        });
      } catch (error: any) {
        processed.push({
          identityId: schedule.identityId,
          assignmentId: assignment.id,
          status: "FAILED",
          slotKey,
          error: error?.message ?? "发送失败",
        });
      }
    }
  }

  return { checked: true, slotKey, processed };
}

// ─── 路由 ────────────────────────────────────────────────────────────────────

const temporaryNotifyScheduleRoutes = Router();
temporaryNotifyScheduleRoutes.use(authRequired, identityRequired);

const t = (v: any): string => (typeof v === "string" ? v.trim() : "");

function canManageTemporaryNotify(roleCode?: string) {
  return ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(roleCode ?? "");
}

/** GET /tasks/notify/temporary-schedule — 获取当前 identity 的自动催办配置 */
temporaryNotifyScheduleRoutes.get(
  "/tasks/notify/temporary-schedule",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    if (!canManageTemporaryNotify(req.identity?.roleCode)) {
      return fail(res, "TEMP_SCHEDULE_FORBIDDEN", "当前身份无权查看自动催办配置", 403);
    }
    const identityId = req.identity?.id as string;
    if (!identityId) return fail(res, "IDENTITY_REQUIRED", "身份未识别", 401);

    const schedule = await (prisma as any).temporaryNotifySchedule?.findUnique({
      where: { identityId },
    });

    return ok(res, {
      enabled: schedule?.enabled ?? false,
      prefix: schedule?.prefix ?? "来自系统提醒",
      tier1DailyCount: schedule?.tier1DailyCount ?? 2,
      tier2DailyCount: schedule?.tier2DailyCount ?? 1,
      tier3DailyCount: schedule?.tier3DailyCount ?? 1,
      tier4DailyCount: schedule?.tier4DailyCount ?? 0,
      tier5DailyCount: schedule?.tier5DailyCount ?? 0,
      tierLabels: TIER_LABELS,
      validDailyCounts: Array.from(VALID_DAILY_COUNTS).sort((a, b) => a - b),
    });
  }
);

/** PUT /tasks/notify/temporary-schedule — 保存自动催办配置 */
temporaryNotifyScheduleRoutes.put(
  "/tasks/notify/temporary-schedule",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    if (!canManageTemporaryNotify(req.identity?.roleCode)) {
      return fail(res, "TEMP_SCHEDULE_FORBIDDEN", "当前身份无权修改自动催办配置", 403);
    }
    const identityId = req.identity?.id as string;
    if (!identityId) return fail(res, "IDENTITY_REQUIRED", "身份未识别", 401);

    const { enabled, prefix, tier1DailyCount, tier2DailyCount, tier3DailyCount, tier4DailyCount, tier5DailyCount } = req.body;

    // 参数校验
    const dailyCounts = [tier1DailyCount, tier2DailyCount, tier3DailyCount, tier4DailyCount, tier5DailyCount];
    for (const count of dailyCounts) {
      if (count !== undefined && (!Number.isInteger(count) || !VALID_DAILY_COUNTS.has(count))) {
        return fail(res, "INVALID_DAILY_COUNT", `每日次数只能是 ${Array.from(VALID_DAILY_COUNTS).sort((a, b) => a - b).join("、")} 之一`, 400);
      }
    }

    const data = {
      identityId,
      enabled: typeof enabled === "boolean" ? enabled : undefined,
      prefix: t(prefix) || undefined,
      tier1DailyCount: tier1DailyCount !== undefined ? Number(tier1DailyCount) : undefined,
      tier2DailyCount: tier2DailyCount !== undefined ? Number(tier2DailyCount) : undefined,
      tier3DailyCount: tier3DailyCount !== undefined ? Number(tier3DailyCount) : undefined,
      tier4DailyCount: tier4DailyCount !== undefined ? Number(tier4DailyCount) : undefined,
      tier5DailyCount: tier5DailyCount !== undefined ? Number(tier5DailyCount) : undefined,
    };

    // 过滤掉 undefined 字段
    const cleanData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

    const schedule = await (prisma as any).temporaryNotifySchedule?.upsert({
      where: { identityId },
      create: {
        identityId,
        enabled: cleanData.enabled ?? false,
        prefix: cleanData.prefix ?? "来自系统提醒",
        tier1DailyCount: cleanData.tier1DailyCount ?? 2,
        tier2DailyCount: cleanData.tier2DailyCount ?? 1,
        tier3DailyCount: cleanData.tier3DailyCount ?? 1,
        tier4DailyCount: cleanData.tier4DailyCount ?? 0,
        tier5DailyCount: cleanData.tier5DailyCount ?? 0,
      },
      update: cleanData,
    });

    return ok(res, {
      enabled: schedule?.enabled ?? false,
      prefix: schedule?.prefix ?? "来自系统提醒",
      tier1DailyCount: schedule?.tier1DailyCount ?? 2,
      tier2DailyCount: schedule?.tier2DailyCount ?? 1,
      tier3DailyCount: schedule?.tier3DailyCount ?? 1,
      tier4DailyCount: schedule?.tier4DailyCount ?? 0,
      tier5DailyCount: schedule?.tier5DailyCount ?? 0,
    });
  }
);

export { temporaryNotifyScheduleRoutes };
