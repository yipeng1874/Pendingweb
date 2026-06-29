import { Router } from "express";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";
import { listAssignmentAudienceMembers, reconcileDailyAssignments } from "../assignment/daily-assignment.utils.js";
import { buildTemporarySubjectGroups, resolveTemporaryMode } from "../assignment/temporary-assignment.utils.js";
import { formatBeijingDate, getDailyTaskDayEnd, getDailyTaskSupplementDeadline, resolveTaskRecordStatus } from "../record/daily-record-time.utils.js";

type FeishuConfigRecord = {
  id: string;
  name: string;
  appId: string;
  appSecret: string;
  status: string;
};

type NotifyAudienceRow = {
  userId: string;
  nickname: string;
  phone: string;
  feishuConfigId: string | null;
  feishuOpenId: string | null;
  feishuUnionId: string | null;
  status: "pending" | "in_progress";
  totalCount: number;
  incompleteCount: number;
};

type TemporaryNotifyAudienceRow = {
  userId: string;
  nickname: string;
  phone: string;
  feishuConfigId: string | null;
  feishuOpenId: string | null;
  feishuUnionId: string | null;
  status: "pending" | "in_progress";
  subjectType: "USER" | "ORG";
  subjectKey: string;
  subjectName: string;
  assignmentId: string;
};

type BaseScopeOrg = {
  id: string;
  name: string;
  path: string;
  orgType: string;
};

type NotifySendResultRow = {
  feishuConfigId: string;
  configName: string;
  targetCount: number;
  successCount: number;
  invalidOpenIds: string[];
  messageId: string | null;
  error?: string;
};

type DailyNotifyIntervalOption = {
  intervalHours: 12 | 6 | 3 | 2 | 1;
  label: string;
  description: string;
};

const DAILY_NOTIFY_INTERVAL_OPTIONS: DailyNotifyIntervalOption[] = [
  { intervalHours: 12, label: "每天2次", description: "00:00、12:00" },
  { intervalHours: 6, label: "每天4次", description: "00:00、06:00、12:00、18:00" },
  { intervalHours: 3, label: "每天8次", description: "每3小时整点发送一次" },
  { intervalHours: 2, label: "每天12次", description: "每2小时整点发送一次" },
  { intervalHours: 1, label: "每天24次", description: "每小时整点发送一次" },
];

const DAILY_NOTIFY_INTERVAL_HOURS_SET = new Set<number>(DAILY_NOTIFY_INTERVAL_OPTIONS.map((item) => item.intervalHours));

const notifyRoutes = Router();
notifyRoutes.use(authRequired, identityRequired);

const t = (v: any): string => (typeof v === "string" ? v.trim() : "");

function canManageDailyNotify(roleCode?: string) {
  return ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(roleCode ?? "");
}

function canManageTemporaryNotify(roleCode?: string) {
  return ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(roleCode ?? "");
}

function isValidDailyNotifyIntervalHours(value: number): value is DailyNotifyIntervalOption["intervalHours"] {
  return DAILY_NOTIFY_INTERVAL_HOURS_SET.has(value);
}

function getDailyNotifyDefaultPrefix(baseOrgName: string) {
  return `来自${baseOrgName}提醒`;
}

function getDailyNotifySchedulePayload(
  baseOrg: BaseScopeOrg,
  schedule?: { enabled?: boolean; intervalHours?: number; prefix?: string; lastTriggeredSlot?: string | null } | null
) {
  return {
    scopeOrg: { id: baseOrg.id, name: baseOrg.name, orgType: baseOrg.orgType },
    enabled: schedule?.enabled ?? false,
    intervalHours: schedule?.intervalHours ?? 3,
    prefix: t(schedule?.prefix) || getDailyNotifyDefaultPrefix(baseOrg.name),
    prefixPlaceholder: getDailyNotifyDefaultPrefix(baseOrg.name),
    sharedByBase: true,
    lastTriggeredSlot: schedule?.lastTriggeredSlot ?? null,
    options: DAILY_NOTIFY_INTERVAL_OPTIONS,
  };
}

function getBeijingHour(date: Date) {
  return (date.getUTCHours() + 8) % 24;
}

function getBeijingMinute(date: Date) {
  return date.getUTCMinutes();
}

function getDailyNotifySlotKey(date: Date) {
  return `${formatBeijingDate(date)} ${String(getBeijingHour(date)).padStart(2, "0")}`;
}

async function getFeishuConfigDelegate() {
  return (prisma as any).feishuEnterpriseConfig as {
    findMany: (args: unknown) => Promise<FeishuConfigRecord[]>;
  } | undefined;
}

async function resolveBaseScopeOrg(scopeOrgId: string | undefined, identity: any) {
  const roleCode = identity?.roleCode;
  const scopePath = identity?.scopePath;
  const identityOrgId = identity?.orgId;

  if (roleCode === "HQ_ADMIN" || roleCode === "DEV_ADMIN") {
    if (!scopeOrgId) throw new Error("BASE_SCOPE_REQUIRED");
    const org = await prisma.orgUnit.findFirst({
      where: { id: scopeOrgId, status: "active", orgType: "BASE" },
      select: { id: true, name: true, path: true, orgType: true },
    });
    if (!org) throw new Error("SCOPE_ORG_NOT_FOUND");
    if (roleCode !== "DEV_ADMIN" && scopePath && !(org.path === scopePath || org.path.startsWith(`${scopePath}/`))) {
      throw new Error("SCOPE_ORG_FORBIDDEN");
    }
    return org;
  }

  if (!identityOrgId) throw new Error("SCOPE_ORG_NOT_FOUND");
  const org = await prisma.orgUnit.findFirst({
    where: { id: identityOrgId, status: "active" },
    select: { id: true, name: true, path: true, orgType: true },
  });
  if (!org) throw new Error("SCOPE_ORG_NOT_FOUND");

  const base = await prisma.orgUnit.findFirst({
    where: {
      status: "active",
      orgType: "BASE",
      path: { in: org.path.split("/").filter(Boolean).map((_, index, parts) => `/${parts.slice(0, index + 1).join("/")}`) },
    },
    orderBy: { depth: "desc" },
    select: { id: true, name: true, path: true, orgType: true },
  });
  if (!base) throw new Error("BASE_SCOPE_REQUIRED");
  return base;
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

async function buildDailyNotifyAudience(taskDate: string, baseOrg: { id: string; path: string }) {
  // 标准化日期格式，防止前端传 2026/06/17 等斜杠格式导致数据库查询返回空结果
  const normalizedDate = taskDate.replace(/\//g, "-");
  await reconcileDailyAssignments(baseOrg.path);
  const assignments = await prisma.taskAssignment.findMany({
    where: {
      category: "DAILY",
      targets: { some: { orgId: baseOrg.id } },
      status: { in: ["active"] },
      deletedAt: null,
      effectiveAt: { lte: getDailyTaskSupplementDeadline(normalizedDate) },
    },
    include: {
      targets: true,
      exclusions: true,
      template: {
        select: {
          id: true,
          items: { select: { id: true, isRequired: true } },
        },
      },
    },
    orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
  });

  // 与看板完全对齐：同一 subjectKey 只取第一个匹配的 assignment（按排序优先级，effectiveAt desc）
  // 这样可以确保 recordMap 查询时 assignmentId 与实际打卡记录对应
  const resolvedSubjectKeys = new Set<string>();
  const refs: Array<{ assignmentId: string; userId: string; subjectKey: string; requiredTotalItems: number }> = [];
  const assignmentIds = new Set<string>();

  for (const assignment of assignments) {
    const requiredTotalItems = assignment.template?.items?.filter((item: any) => item.isRequired !== false).length ?? 0;
    const audience = await listAssignmentAudienceMembers(prisma, assignment as any, normalizedDate);
    for (const member of audience) {
      // 与看板一致：同一 subjectKey 在当天只绑定到第一个 assignment，后续跳过
      if (resolvedSubjectKeys.has(member.subjectKey)) continue;
      resolvedSubjectKeys.add(member.subjectKey);
      assignmentIds.add(assignment.id);
      refs.push({
        assignmentId: assignment.id,
        userId: member.userId,
        subjectKey: member.subjectKey,
        requiredTotalItems,
      });
    }
  }

  const records = await prisma.taskRecord.findMany({
    where: {
      assignmentId: { in: Array.from(assignmentIds) },
      recordDate: normalizedDate,
    },
    select: {
      id: true,
      assignmentId: true,
      subjectKey: true,
      recordDate: true,
      doneItems: true,
      status: true,
      assignment: { select: { category: true } },
      itemRecords: {
        select: {
          status: true,
          taskItem: { select: { isRequired: true } },
        },
      },
      exemption: { select: { status: true } },
    },
  });
  // Key 格式与看板完全对齐：assignmentId:subjectKey:YYYY-MM-DD
  const recordMap = new Map(
    records.filter((r) => r.subjectKey).map((record) => [`${record.assignmentId}:${record.subjectKey}:${normalizedDate}`, record])
  );

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(new Set(refs.map((item) => item.userId))) }, status: "active" },
    select: {
      id: true,
      nickname: true,
      phone: true,
      feishuConfigId: true,
      feishuOpenId: true,
      feishuUnionId: true,
    },
  });
  const userMap = new Map(users.map((user) => [user.id, user]));
  const aggregateMap = new Map<string, NotifyAudienceRow>();

  for (const ref of refs) {
    const user = userMap.get(ref.userId);
    if (!user) continue;
    const record = recordMap.get(`${ref.assignmentId}:${ref.subjectKey}:${normalizedDate}`);

    // 被免除的任务，不纳入通知（与看板逻辑对齐）
    if (record?.exemption?.status === "approved" || record?.exemption?.status === "pending") continue;

    const totalCount = Math.max(ref.requiredTotalItems, 0);

    // 与看板 resolveDailyDashboardStatus 完全对齐：实时计算必填项完成数
    const requiredDoneItems = record?.itemRecords
      ? record.itemRecords.filter((ir: any) => ir.status === "done" && ir.taskItem?.isRequired !== false).length
      : 0;

    // 必填项全部完成，视为已完成，跳过通知（与看板判定逻辑完全一致）
    if (totalCount > 0 && requiredDoneItems >= totalCount) continue;

    // totalCount=0 时（无必填子任务），检查数据库状态兜底
    if (totalCount === 0) {
      const dbStatus = resolveTaskRecordStatus(
        {
          assignment: record?.assignment,
          recordDate: normalizedDate,
          doneItems: record?.doneItems ?? 0,
          status: record?.status ?? "pending",
        },
        new Date()
      );
      if (dbStatus !== "pending" && dbStatus !== "in_progress") continue;
    }

    // 计算未完成数：totalCount=0 时以 1 计，表示整条任务未完成；否则按实际差值
    const incompleteCount = totalCount > 0 ? Math.max(totalCount - requiredDoneItems, 0) : 1;
    if (incompleteCount === 0) continue;

    // 确定通知状态标签（用于前端统计展示）
    const status: "pending" | "in_progress" = requiredDoneItems > 0 ? "in_progress" : "pending";
    const existing = aggregateMap.get(user.id);

    if (existing) {
      existing.totalCount += totalCount;
      existing.incompleteCount += incompleteCount;
      if (existing.status !== "pending" && status === "pending") {
        existing.status = "pending";
      }
      continue;
    }

    aggregateMap.set(user.id, {
      userId: user.id,
      nickname: user.nickname,
      phone: user.phone,
      feishuConfigId: user.feishuConfigId,
      feishuOpenId: user.feishuOpenId,
      feishuUnionId: user.feishuUnionId,
      status,
      totalCount,
      incompleteCount,
    });
  }

  return Array.from(aggregateMap.values()).filter((item) => item.incompleteCount > 0);
}

function summarizeNotifyAudience(rows: NotifyAudienceRow[]) {
  const pendingCount = rows.filter((item) => item.status === "pending").length;
  const inProgressCount = rows.filter((item) => item.status === "in_progress").length;
  const boundRows = rows.filter((item) => item.feishuConfigId && item.feishuOpenId);
  const unboundRows = rows.filter((item) => !item.feishuConfigId || !item.feishuOpenId);
  const configSummaryMap = new Map<string, { feishuConfigId: string; total: number; pending: number; inProgress: number }>();

  for (const row of boundRows) {
    const key = row.feishuConfigId!;
    const current = configSummaryMap.get(key) ?? { feishuConfigId: key, total: 0, pending: 0, inProgress: 0 };
    current.total += 1;
    if (row.status === "pending") current.pending += 1;
    if (row.status === "in_progress") current.inProgress += 1;
    configSummaryMap.set(key, current);
  }

  return {
    total: rows.length,
    pendingCount,
    inProgressCount,
    boundCount: boundRows.length,
    unboundCount: unboundRows.length,
    configSummaries: Array.from(configSummaryMap.values()),
    unboundUsers: unboundRows.map((item) => ({ userId: item.userId, nickname: item.nickname, phone: item.phone, status: item.status })),
  };
}

export async function executeDailyNotifySend(taskDate: string, baseOrg: BaseScopeOrg, prefix: string) {
  const rows = await buildDailyNotifyAudience(taskDate, baseOrg);
  const summary = summarizeNotifyAudience(rows);
  const boundRows = rows.filter((item) => item.feishuConfigId && item.feishuOpenId);

  if (!boundRows.length) {
    return {
      taskDate,
      prefix,
      scopeOrg: { id: baseOrg.id, name: baseOrg.name, orgType: baseOrg.orgType },
      summary,
      results: [] as NotifySendResultRow[],
    };
  }

  const delegate = await getFeishuConfigDelegate();
  if (!delegate) throw new Error("FEISHU_CONFIG_UNAVAILABLE");

  const configIds = Array.from(new Set(boundRows.map((item) => item.feishuConfigId!).filter(Boolean)));
  const configs = await delegate.findMany({ where: { id: { in: configIds }, status: "active" } } as any);
  const configMap = new Map(configs.map((config) => [config.id, config]));

  const bucketMap = new Map<string, NotifyAudienceRow[]>();
  for (const row of boundRows) {
    if (!row.feishuConfigId || !row.feishuOpenId) continue;
    const bucket = bucketMap.get(row.feishuConfigId) ?? [];
    bucket.push(row);
    bucketMap.set(row.feishuConfigId, bucket);
  }

  const results: NotifySendResultRow[] = [];
  for (const [feishuConfigId, bucket] of bucketMap.entries()) {
    const config = configMap.get(feishuConfigId);
    if (!config) {
      results.push({ feishuConfigId, configName: "未找到配置", targetCount: bucket.length, successCount: 0, invalidOpenIds: [], messageId: null, error: "飞书企业配置不存在或已停用" });
      continue;
    }

    // 按"总数+未完成数"分组，保证同一批次内每人数值相同
    const groupMap = new Map<string, { openIds: string[]; totalCount: number; incompleteCount: number }>();
    for (const item of bucket) {
      if (!item.feishuOpenId) continue;
      const groupKey = `${item.totalCount}_${item.incompleteCount}`;
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, { openIds: [], totalCount: item.totalCount, incompleteCount: item.incompleteCount });
      }
      groupMap.get(groupKey)!.openIds.push(item.feishuOpenId);
    }

    for (const { openIds, totalCount, incompleteCount } of groupMap.values()) {
      const uniqueOpenIds = Array.from(new Set(openIds));
      const text = `${prefix}，日常任务共 ${totalCount} 项，您还有 ${incompleteCount} 项未完成。`;
      try {
        const sendResult = await sendFeishuBatchMessage(config, uniqueOpenIds, text);
        results.push({
          feishuConfigId,
          configName: config.name,
          targetCount: uniqueOpenIds.length,
          successCount: Math.max(uniqueOpenIds.length - sendResult.invalidOpenIds.length, 0),
          invalidOpenIds: sendResult.invalidOpenIds,
          messageId: sendResult.messageId,
        });
      } catch (error: any) {
        results.push({
          feishuConfigId,
          configName: config.name,
          targetCount: uniqueOpenIds.length,
          successCount: 0,
          invalidOpenIds: [],
          messageId: null,
          error: error?.message ?? "飞书发送失败",
        });
      }
    }
  }

  return {
    taskDate,
    prefix,
    scopeOrg: { id: baseOrg.id, name: baseOrg.name, orgType: baseOrg.orgType },
    summary,
    results,
  };
}

export async function runDailyNotifyScheduleTick(now = new Date()) {
  if (getBeijingMinute(now) >= 5) {
    return { checked: false, reason: "OUTSIDE_TOP_OF_HOUR_WINDOW", slotKey: getDailyNotifySlotKey(now), processed: [] as Array<Record<string, unknown>> };
  }

  const beijingHour = getBeijingHour(now);
  const slotKey = getDailyNotifySlotKey(now);
  const taskDate = formatBeijingDate(now);
  const schedules = await prisma.dailyNotifySchedule.findMany({
    where: { enabled: true },
    include: {
      baseOrg: {
        select: { id: true, name: true, path: true, orgType: true },
      },
    },
    orderBy: [{ intervalHours: "desc" }, { createdAt: "asc" }],
  });

  const processed: Array<{ baseOrgId: string; baseOrgName: string; intervalHours: number; status: string; targetCount?: number; successCount?: number; error?: string }> = [];

  for (const schedule of schedules) {
    if (beijingHour % schedule.intervalHours !== 0) {
      processed.push({ baseOrgId: schedule.baseOrgId, baseOrgName: schedule.baseOrg.name, intervalHours: schedule.intervalHours, status: "SKIPPED_INTERVAL" });
      continue;
    }
    if (schedule.lastTriggeredSlot === slotKey) {
      processed.push({ baseOrgId: schedule.baseOrgId, baseOrgName: schedule.baseOrg.name, intervalHours: schedule.intervalHours, status: "SKIPPED_DUPLICATE_SLOT" });
      continue;
    }

    const prefix = t(schedule.prefix) || getDailyNotifyDefaultPrefix(schedule.baseOrg.name);
    try {
      const result = await executeDailyNotifySend(taskDate, schedule.baseOrg, prefix);
      await prisma.dailyNotifySchedule.update({
        where: { id: schedule.id },
        data: { lastTriggeredSlot: slotKey, prefix },
      });
      processed.push({
        baseOrgId: schedule.baseOrgId,
        baseOrgName: schedule.baseOrg.name,
        intervalHours: schedule.intervalHours,
        status: "SENT",
        targetCount: result.summary.boundCount,
        successCount: result.results.reduce((sum, item) => sum + item.successCount, 0),
      });
    } catch (error: any) {
      processed.push({
        baseOrgId: schedule.baseOrgId,
        baseOrgName: schedule.baseOrg.name,
        intervalHours: schedule.intervalHours,
        status: "FAILED",
        error: error?.message ?? "自动通知发送失败",
      });
    }
  }

  return { checked: true, slotKey, taskDate, processed };
}

async function resolveTemporaryAssignmentForNotify(assignmentId: string, scopeOrgId: string | undefined, userId?: string, identityId?: string) {
  const assignment = await prisma.taskAssignment.findUnique({
    where: { id: assignmentId },
    include: { targets: true, exclusions: true, template: { select: { id: true, title: true } } },
  });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (assignment.category !== "TEMPORARY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
  if (assignment.status !== "active" || !assignment.isActive) throw new Error("TEMP_ASSIGNMENT_NOT_ACTIVE");
  if (scopeOrgId && assignment.createdByOrgId !== scopeOrgId) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (assignment.createdByIdentityId) {
    if (!identityId || assignment.createdByIdentityId !== identityId) throw new Error("TEMP_ASSIGNMENT_OWNER_REQUIRED");
  } else if (!userId || assignment.createdBy !== userId) {
    throw new Error("TEMP_ASSIGNMENT_OWNER_REQUIRED");
  }
  return assignment;
}

async function buildTemporaryNotifyAudience(assignmentId: string, scopeOrgId: string | undefined, userId?: string, identityId?: string) {
  const assignment = await resolveTemporaryAssignmentForNotify(assignmentId, scopeOrgId, userId, identityId);
  const groups = await buildTemporarySubjectGroups(prisma, assignment as any);
  if (!groups.length) return { assignment, rows: [] as TemporaryNotifyAudienceRow[] };

  const records = await prisma.taskRecord.findMany({
    where: {
      assignmentId: assignment.id,
      status: { in: ["pending", "in_progress"] },
    },
    include: {
      visibleIdentityLinks: {
        select: {
          identityId: true,
          userId: true,
          roleCode: true,
          orgId: true,
          anchorProfileId: true,
          identity: {
            select: {
              id: true,
              userId: true,
              roleCode: true,
              orgId: true,
              scopePath: true,
              anchorProfileId: true,
            },
          },
        },
      },
    },
  });

  const groupMap = new Map(groups.map((group) => [group.subjectKey, group]));
  const directUserIds = new Set<string>();
  const visibleUserIds = new Set<string>();

  for (const record of records) {
    if (record.userId) directUserIds.add(record.userId);
    record.visibleIdentityLinks.forEach((link: any) => {
      if (link.userId) visibleUserIds.add(link.userId);
      if (link.identity?.userId) visibleUserIds.add(link.identity.userId);
    });
    const group = groupMap.get(record.subjectKey);
    group?.visibleIdentities.forEach((identity) => visibleUserIds.add(identity.userId));
  }

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(new Set([...directUserIds, ...visibleUserIds])) }, status: "active" },
    select: {
      id: true,
      nickname: true,
      phone: true,
      feishuConfigId: true,
      feishuOpenId: true,
      feishuUnionId: true,
    },
  });
  const userMap = new Map(users.map((user) => [user.id, user]));

  const rows: TemporaryNotifyAudienceRow[] = [];
  for (const record of records) {
    const group = groupMap.get(record.subjectKey);
    if (!group) continue;

    if (group.subjectType === "USER") {
      const targetUserId = record.userId ?? group.subjectUserId;
      if (!targetUserId) continue;
      const user = userMap.get(targetUserId);
      if (!user) continue;
      rows.push({
        assignmentId: assignment.id,
        userId: user.id,
        nickname: user.nickname,
        phone: user.phone,
        feishuConfigId: user.feishuConfigId,
        feishuOpenId: user.feishuOpenId,
        feishuUnionId: user.feishuUnionId,
        status: record.status as "pending" | "in_progress",
        subjectType: group.subjectType,
        subjectKey: group.subjectKey,
        subjectName: group.subjectName,
      });
      continue;
    }

    const recipientUserIds = new Set<string>();
    record.visibleIdentityLinks.forEach((link: any) => {
      if (link.userId) recipientUserIds.add(link.userId);
      if (link.identity?.userId) recipientUserIds.add(link.identity.userId);
    });
    if (recipientUserIds.size === 0) {
      group.visibleIdentities.forEach((identity) => recipientUserIds.add(identity.userId));
    }

    recipientUserIds.forEach((recipientUserId) => {
      const user = userMap.get(recipientUserId);
      if (!user) return;
      rows.push({
        assignmentId: assignment.id,
        userId: user.id,
        nickname: user.nickname,
        phone: user.phone,
        feishuConfigId: user.feishuConfigId,
        feishuOpenId: user.feishuOpenId,
        feishuUnionId: user.feishuUnionId,
        status: record.status as "pending" | "in_progress",
        subjectType: group.subjectType,
        subjectKey: group.subjectKey,
        subjectName: group.subjectName,
      });
    });
  }

  return { assignment, rows };
}

function summarizeTemporaryNotifyAudience(rows: TemporaryNotifyAudienceRow[]) {
  const pendingCount = rows.filter((item) => item.status === "pending").length;
  const inProgressCount = rows.filter((item) => item.status === "in_progress").length;
  const boundRows = rows.filter((item) => item.feishuConfigId && item.feishuOpenId);
  const unboundRows = rows.filter((item) => !item.feishuConfigId || !item.feishuOpenId);
  const configSummaryMap = new Map<string, { feishuConfigId: string; total: number; pending: number; inProgress: number }>();

  for (const row of boundRows) {
    const key = row.feishuConfigId!;
    const current = configSummaryMap.get(key) ?? { feishuConfigId: key, total: 0, pending: 0, inProgress: 0 };
    current.total += 1;
    if (row.status === "pending") current.pending += 1;
    if (row.status === "in_progress") current.inProgress += 1;
    configSummaryMap.set(key, current);
  }

  return {
    total: rows.length,
    pendingCount,
    inProgressCount,
    boundCount: boundRows.length,
    unboundCount: unboundRows.length,
    distinctUserCount: new Set(rows.map((item) => item.userId)).size,
    modeSummary: {
      userSubjectCount: rows.filter((item) => item.subjectType === "USER").length,
      orgSubjectCount: rows.filter((item) => item.subjectType === "ORG").length,
    },
    configSummaries: Array.from(configSummaryMap.values()),
    unboundUsers: unboundRows.map((item) => ({ userId: item.userId, nickname: item.nickname, phone: item.phone, status: item.status, subjectName: item.subjectName })),
  };
}

notifyRoutes.get("/tasks/notify/daily-feishu/preview", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canManageDailyNotify(req.identity?.roleCode)) {
    return fail(res, "DAILY_NOTIFY_FORBIDDEN", "当前身份无权执行日常任务飞书通知", 403);
  }

  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先选择基地后再通知", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "DAILY_NOTIFY_SCOPE_FAILED", "通知基地解析失败", 500);
  }

  const rows = await buildDailyNotifyAudience(taskDate, baseOrg);
  return ok(res, {
    taskDate,
    scopeOrg: { id: baseOrg.id, name: baseOrg.name, orgType: baseOrg.orgType },
    prefixPlaceholder: getDailyNotifyDefaultPrefix(baseOrg.name),
    ...summarizeNotifyAudience(rows),
  });
});

notifyRoutes.post("/tasks/notify/daily-feishu/send", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canManageDailyNotify(req.identity?.roleCode)) {
    return fail(res, "DAILY_NOTIFY_FORBIDDEN", "当前身份无权执行日常任务飞书通知", 403);
  }

  const taskDate = t(req.body.taskDate) || formatBeijingDate(new Date());
  const scopeOrgId = t(req.body.scopeOrgId) || undefined;
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先选择基地后再通知", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "DAILY_NOTIFY_SCOPE_FAILED", "通知基地解析失败", 500);
  }

  const prefix = t(req.body.prefix) || getDailyNotifyDefaultPrefix(baseOrg.name);

  try {
    const result = await executeDailyNotifySend(taskDate, baseOrg, prefix);
    return ok(res, result);
  } catch (error: any) {
    if (error?.message === "FEISHU_CONFIG_UNAVAILABLE") {
      return fail(res, "FEISHU_CONFIG_UNAVAILABLE", "飞书配置能力不可用", 500);
    }
    return fail(res, "DAILY_NOTIFY_SEND_FAILED", error?.message ?? "日常任务通知发送失败", 500);
  }
});

notifyRoutes.get("/tasks/notify/daily-schedule", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canManageDailyNotify(req.identity?.roleCode)) {
    return fail(res, "DAILY_NOTIFY_FORBIDDEN", "当前身份无权查看自动通知配置", 403);
  }

  const scopeOrgId = t(req.query.scopeOrgId) || undefined;
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先选择基地后再查看配置", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "DAILY_NOTIFY_SCOPE_FAILED", "自动通知基地解析失败", 500);
  }

  const schedule = await prisma.dailyNotifySchedule.findUnique({
    where: { baseOrgId: baseOrg.id },
    select: { enabled: true, intervalHours: true, prefix: true, lastTriggeredSlot: true },
  });

  return ok(res, getDailyNotifySchedulePayload(baseOrg, schedule));
});

notifyRoutes.put("/tasks/notify/daily-schedule", permissionRequired("task:report:view"), async (req: any, res: any) => {
  try {
    if (!canManageDailyNotify(req.identity?.roleCode)) {
      return fail(res, "DAILY_NOTIFY_FORBIDDEN", "当前身份无权维护自动通知配置", 403);
    }

    const scopeOrgId = t(req.body.scopeOrgId) || undefined;
    const enabledValue = typeof req.body.enabled === "boolean" ? req.body.enabled : null;
    const intervalHours = Number(req.body.intervalHours);
    const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
    if (baseOrg instanceof Error) {
      if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先选择基地后再保存配置", 400);
      if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
      if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
      return fail(res, "DAILY_NOTIFY_SCOPE_FAILED", "自动通知基地解析失败", 500);
    }

    if (enabledValue === null) {
      return fail(res, "DAILY_NOTIFY_ENABLED_INVALID", "请提供有效的启用状态", 400);
    }
    if (!Number.isInteger(intervalHours) || !isValidDailyNotifyIntervalHours(intervalHours)) {
      return fail(res, "DAILY_NOTIFY_INTERVAL_INVALID", "通知频率仅支持每天2次、4次、8次、12次、24次", 400);
    }

    const prefix = t(req.body.prefix) || getDailyNotifyDefaultPrefix(baseOrg.name);
    const schedule = await prisma.dailyNotifySchedule.upsert({
      where: { baseOrgId: baseOrg.id },
      update: { enabled: enabledValue, intervalHours, prefix },
      create: { baseOrgId: baseOrg.id, enabled: enabledValue, intervalHours, prefix },
      select: { enabled: true, intervalHours: true, prefix: true, lastTriggeredSlot: true },
    });

    return ok(res, getDailyNotifySchedulePayload(baseOrg, schedule));
  } catch (error: any) {
    console.error("自动通知配置保存失败", error);
    return fail(res, "DAILY_NOTIFY_SCHEDULE_SAVE_FAILED", error?.message ?? "自动通知配置保存失败", 500);
  }
});


notifyRoutes.post("/tasks/notify/daily-schedule/test", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canManageDailyNotify(req.identity?.roleCode)) {
    return fail(res, "DAILY_NOTIFY_FORBIDDEN", "当前身份无权测试自动通知", 403);
  }

  const taskDate = t(req.body.taskDate) || formatBeijingDate(new Date());
  const scopeOrgId = t(req.body.scopeOrgId) || undefined;
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先选择基地后再测试发送", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "DAILY_NOTIFY_SCOPE_FAILED", "自动通知基地解析失败", 500);
  }

  const stored = await prisma.dailyNotifySchedule.findUnique({
    where: { baseOrgId: baseOrg.id },
    select: { enabled: true, intervalHours: true, prefix: true, lastTriggeredSlot: true },
  });
  const prefix = t(req.body.prefix) || t(stored?.prefix) || getDailyNotifyDefaultPrefix(baseOrg.name);

  try {
    const result = await executeDailyNotifySend(taskDate, baseOrg, prefix);
    return ok(res, {
      ...result,
      testMode: true,
      schedule: getDailyNotifySchedulePayload(baseOrg, stored),
    });
  } catch (error: any) {
    if (error?.message === "FEISHU_CONFIG_UNAVAILABLE") {
      return fail(res, "FEISHU_CONFIG_UNAVAILABLE", "飞书配置能力不可用", 500);
    }
    return fail(res, "DAILY_NOTIFY_TEST_FAILED", error?.message ?? "自动通知测试发送失败", 500);
  }
});

notifyRoutes.get("/tasks/notify/temporary-feishu/preview", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canManageTemporaryNotify(req.identity?.roleCode)) {
    return fail(res, "TEMP_NOTIFY_FORBIDDEN", "当前身份无权执行临时任务飞书通知", 403);
  }

  const assignmentId = t(req.query.assignmentId);
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;
  if (!assignmentId) {
    return fail(res, "TEMP_NOTIFY_ASSIGNMENT_REQUIRED", "请先选择一条进行中的临时任务", 400);
  }

  try {
    const { assignment, rows } = await buildTemporaryNotifyAudience(assignmentId, scopeOrgId, req.userId, req.identity?.id);
    return ok(res, {
      assignmentId: assignment.id,
      mode: resolveTemporaryMode(assignment as any),
      scopeOrgId: assignment.createdByOrgId,
      prefixPlaceholder: "来自系统提醒",
      templateTitle: assignment.template?.title ?? "",
      ...summarizeTemporaryNotifyAudience(rows),
    });
  } catch (error: any) {
    if (error.message === "ASSIGNMENT_NOT_FOUND") return fail(res, "ASSIGNMENT_NOT_FOUND", "临时任务不存在", 404);
    if (error.message === "ASSIGNMENT_CATEGORY_INVALID") return fail(res, "ASSIGNMENT_CATEGORY_INVALID", "当前任务不是临时任务", 400);
    if (error.message === "TEMP_ASSIGNMENT_NOT_ACTIVE") return fail(res, "TEMP_ASSIGNMENT_NOT_ACTIVE", "仅支持通知进行中的临时任务", 400);
    if (error.message === "TEMP_ASSIGNMENT_OWNER_REQUIRED") return fail(res, "TEMP_ASSIGNMENT_OWNER_REQUIRED", "仅任务发起人可发送临时任务通知", 403);
    return fail(res, "TEMP_NOTIFY_PREVIEW_FAILED", error?.message ?? "临时任务通知预览失败", 500);
  }
});

notifyRoutes.post("/tasks/notify/temporary-feishu/send", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canManageTemporaryNotify(req.identity?.roleCode)) {
    return fail(res, "TEMP_NOTIFY_FORBIDDEN", "当前身份无权执行临时任务飞书通知", 403);
  }

  const assignmentId = t(req.body.assignmentId);
  const scopeOrgId = t(req.body.scopeOrgId) || undefined;
  const prefix = t(req.body.prefix) || "来自系统提醒";
  if (!assignmentId) {
    return fail(res, "TEMP_NOTIFY_ASSIGNMENT_REQUIRED", "请先选择一条进行中的临时任务", 400);
  }

  try {
    const { assignment, rows } = await buildTemporaryNotifyAudience(assignmentId, scopeOrgId, req.userId, req.identity?.id);
    const summary = summarizeTemporaryNotifyAudience(rows);
    const boundRows = rows.filter((item) => item.feishuConfigId && item.feishuOpenId);
    const delegate = await getFeishuConfigDelegate();
    if (!delegate) return fail(res, "FEISHU_CONFIG_UNAVAILABLE", "飞书配置能力不可用", 500);
    const configIds = Array.from(new Set(boundRows.map((item) => item.feishuConfigId!).filter(Boolean)));
    const configs = await delegate.findMany({ where: { id: { in: configIds }, status: "active" } } as any);
    const configMap = new Map(configs.map((config) => [config.id, config]));

    const results: NotifySendResultRow[] = [];
    const bucketMap = new Map<string, TemporaryNotifyAudienceRow[]>();
    for (const row of boundRows) {
      if (!row.feishuConfigId || !row.feishuOpenId) continue;
      const bucket = bucketMap.get(row.feishuConfigId) ?? [];
      bucket.push(row);
      bucketMap.set(row.feishuConfigId, bucket);
    }

    for (const [feishuConfigId, bucket] of bucketMap.entries()) {
      const config = configMap.get(feishuConfigId);
      if (!config) {
        results.push({ feishuConfigId, configName: "未找到配置", targetCount: bucket.length, successCount: 0, invalidOpenIds: [], messageId: null, error: "飞书企业配置不存在或已停用" });
        continue;
      }

      const uniqueRecipients = Array.from(new Set(bucket.map((item) => item.feishuOpenId!).filter(Boolean)));
      const text = `${prefix}，临时任务共 ${bucket.length} 件，您还有 ${bucket.length} 件没完成。`;
      try {
        const sendResult = await sendFeishuBatchMessage(config, uniqueRecipients, text);
        results.push({
          feishuConfigId,
          configName: config.name,
          targetCount: uniqueRecipients.length,
          successCount: Math.max(uniqueRecipients.length - sendResult.invalidOpenIds.length, 0),
          invalidOpenIds: sendResult.invalidOpenIds,
          messageId: sendResult.messageId,
        });
      } catch (error: any) {
        results.push({
          feishuConfigId,
          configName: config.name,
          targetCount: uniqueRecipients.length,
          successCount: 0,
          invalidOpenIds: [],
          messageId: null,
          error: error?.message ?? "飞书发送失败",
        });
      }
    }

    return ok(res, {
      assignmentId: assignment.id,
      mode: resolveTemporaryMode(assignment as any),
      prefix,
      summary,
      results,
    });
  } catch (error: any) {
    if (error.message === "ASSIGNMENT_NOT_FOUND") return fail(res, "ASSIGNMENT_NOT_FOUND", "临时任务不存在", 404);
    if (error.message === "ASSIGNMENT_CATEGORY_INVALID") return fail(res, "ASSIGNMENT_CATEGORY_INVALID", "当前任务不是临时任务", 400);
    if (error.message === "TEMP_ASSIGNMENT_NOT_ACTIVE") return fail(res, "TEMP_ASSIGNMENT_NOT_ACTIVE", "仅支持通知进行中的临时任务", 400);
    if (error.message === "TEMP_ASSIGNMENT_OWNER_REQUIRED") return fail(res, "TEMP_ASSIGNMENT_OWNER_REQUIRED", "仅任务发起人可发送临时任务通知", 403);
    return fail(res, "TEMP_NOTIFY_SEND_FAILED", error?.message ?? "临时任务通知发送失败", 500);
  }
});

export { notifyRoutes };
