import { Router } from "express";
import { Prisma } from "@prisma/client";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";
import { AssignmentService } from "../assignment/assignment.service.js";
import { reconcileDailyAssignments, listAssignmentAudienceMembers } from "../assignment/daily-assignment.utils.js";
import { addBeijingDays, formatBeijingDate, getDailyTaskContext, getDailyTaskDayEnd, getDailyTaskSupplementDeadline, resolveTaskRecordStatus } from "../record/daily-record-time.utils.js";

type DailyDashboardOrgNode = {
  orgId: string;
  orgName: string | null;
  orgType: string;
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  supplemented: number;
  exemptions: number;
  completionRate?: number;
  path?: string;
};

export const reportRoutes = Router();
reportRoutes.use(authRequired, identityRequired);

const t = (v: any): string => (typeof v === "string" ? v.trim() : "");

function parseContributionLines(rawText?: string | null) {
  if (!rawText?.trim()) return [] as Array<{ identityId: string; userId: string; createdAt: string; content: string }>;
  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const matched = /^\[(.+?)\|(.*?)\|(.*?)\]\s*(.*)$/.exec(line);
      if (!matched) return null;
      return {
        identityId: matched[1],
        userId: matched[2],
        createdAt: matched[3],
        content: matched[4],
      };
    })
    .filter((entry): entry is { identityId: string; userId: string; createdAt: string; content: string } => Boolean(entry));
}

function isRecordValid(record: any) {
  if (record.subjectType === "ORG") return true;
  return !record.user || record.user.status === "active";
}

function getEffectiveRecordStatus(record: any, now = new Date()) {
  return resolveTaskRecordStatus(
    {
      assignment: record.assignment,
      recordDate: record.recordDate,
      doneItems: record.doneItems,
      status: record.status,
    },
    now
  );
}

function canViewDailyDashboard(roleCode?: string) {
  return ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(roleCode ?? "");
}

function canViewTemporaryDashboard(roleCode?: string) {
  return ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(roleCode ?? "");
}

function canManageTemporaryNotify(roleCode?: string) {
  return ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(roleCode ?? "");
}

type TemporaryDashboardProgressFilter = "all" | "submitted" | "in_progress" | "pending" | "overdue";

type TemporaryDashboardSearchableRecord = {
  id: string;
  userId?: string | null;
  subjectType: string;
  subjectKey: string;
  subjectUserId?: string | null;
  subjectOrgId?: string | null;
  subjectName?: string | null;
  subjectOrgType?: string | null;
  user?: { id: string; nickname?: string | null; phone?: string | null; status?: string | null } | null;
  douyinNo?: string | null;
  douyinUid?: string | null;
  recordDate?: string | null;
  status: string;
  doneItems: number;
  totalItems: number;
  deadlineAt: Date;
  submittedAt?: Date | null;
  lastSubmittedByUserId?: string | null;
  lastSubmittedByIdentityId?: string | null;
  lastSubmittedAt?: Date | null;
  lastSubmittedByName?: string | null;
  publisherName?: string | null;
  publisherPhone?: string | null;
  participantCount?: number;
  submissionCount?: number;
  visibleIdentityNames?: string[];
  exemptionStatus?: string | null;
  exemptionReason?: string | null;
};

type AnchorDashboardOrgNode = {
  orgId: string;
  orgName: string;
  orgType: string;
  path: string;
  parentOrgId?: string | null;
  total: number;
  submitted: number;
  inProgress: number;
  pending: number;
  overdue: number;
  completionRate: number;
  hasChildren: boolean;
};

function normalizeTemporaryDashboardFilter(value?: string): TemporaryDashboardProgressFilter {
  if (value === "submitted" || value === "in_progress" || value === "pending" || value === "overdue") return value;
  return "all";
}

function matchesTemporaryDashboardKeyword(record: TemporaryDashboardSearchableRecord, keyword?: string) {
  const q = t(keyword).toLowerCase();
  if (!q) return true;
  const values = [
    record.subjectName,
    record.user?.nickname,
    record.user?.phone,
    record.douyinNo,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => value.includes(q));
}

function buildTemporaryDashboardRecord(record: any, anchorProfileMap: Map<string, { douyinNo?: string | null; douyinUid?: string | null }>, now = new Date()) {
  const anchorProfile = record.subjectUserId ? anchorProfileMap.get(record.subjectUserId) : undefined;
  const visibleIdentityLinks = record.visibleIdentityLinks ?? [];
  return {
    id: record.id,
    userId: record.userId,
    subjectType: record.subjectType,
    subjectKey: record.subjectKey,
    subjectUserId: record.subjectUserId,
    subjectOrgId: record.subjectOrgId,
    subjectName: record.subjectName,
    subjectOrgType: record.subjectOrgType,
    user: record.user,
    douyinNo: anchorProfile?.douyinNo ?? null,
    douyinUid: anchorProfile?.douyinUid ?? null,
    recordDate: record.recordDate,
    status: getEffectiveRecordStatus(record, now),
    doneItems: record.doneItems,
    totalItems: record.totalItems,
    deadlineAt: record.deadlineAt,
    submittedAt: record.submittedAt,
    lastSubmittedByUserId: record.lastSubmittedByUserId,
    lastSubmittedByIdentityId: record.lastSubmittedByIdentityId,
    lastSubmittedAt: record.lastSubmittedAt,
    lastSubmittedByName: record.lastSubmittedByName ?? null,
    publisherName: record.publisherName ?? null,
    publisherPhone: record.publisherPhone ?? null,
    participantCount: visibleIdentityLinks.length,
    submissionCount: Array.isArray(record.itemRecords) ? new Set(record.itemRecords.map((item: any) => item.taskItemId)).size : 0,
    visibleIdentityNames: visibleIdentityLinks.map((link: any) => link.userName ?? link.user?.nickname ?? link.identityId).filter(Boolean),
    exemptionStatus: record.exemption?.status ?? null,
    exemptionReason: record.exemption?.reason ?? null,
  };
}

function summarizeTemporaryRecords(records: Array<{ status: string }>) {
  const submitted = records.filter((record) => record.status === "submitted").length;
  const inProgress = records.filter((record) => record.status === "in_progress").length;
  const pending = records.filter((record) => record.status === "pending").length;
  const overdue = records.filter((record) => record.status === "overdue").length;
  const total = records.length;
  return {
    total,
    submitted,
    inProgress,
    pending,
    overdue,
    completionRate: total > 0 ? Math.round((submitted / total) * 100) : 0,
    overdueRate: total > 0 ? Math.round((overdue / total) * 100) : 0,
  };
}

function summarizeTemporaryOrgNodes(orgs: Array<{ id: string; name: string; orgType: string; path: string; parentId?: string | null }>, records: TemporaryDashboardSearchableRecord[], childOrgIds: Set<string>) {
  const recordMap = new Map<string, TemporaryDashboardSearchableRecord[]>();
  for (const record of records) {
    const key = record.subjectOrgId ?? "";
    if (!key) continue;
    const bucket = recordMap.get(key) ?? [];
    bucket.push(record);
    recordMap.set(key, bucket);
  }

  return orgs
    .map((org) => {
      const orgRecords = recordMap.get(org.id) ?? [];
      const summary = summarizeTemporaryRecords(orgRecords);
      return {
        orgId: org.id,
        orgName: org.name,
        orgType: org.orgType,
        path: org.path,
        parentOrgId: org.parentId ?? null,
        total: summary.total,
        submitted: summary.submitted,
        inProgress: summary.inProgress,
        pending: summary.pending,
        overdue: summary.overdue,
        completionRate: summary.completionRate,
        hasChildren: childOrgIds.has(org.id),
      } satisfies AnchorDashboardOrgNode;
    })
    .filter((node) => node.total > 0)
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function loadAnchorProfileSnapshotMapByUserIds(userIds: string[]) {
  if (!userIds.length) return new Map<string, { boundUserId: string; douyinNo?: string | null; douyinUid?: string | null }>();
  const anchorProfiles = await prisma.anchorProfile.findMany({
    where: { boundUserId: { in: userIds } },
    select: { boundUserId: true, douyinNo: true, douyinUid: true },
  });
  return new Map(anchorProfiles.filter((p) => p.boundUserId != null).map((profile) => [profile.boundUserId as string, profile]));
}

async function loadIdentityLabelMap(identityIds: string[]) {
  const ids = Array.from(new Set(identityIds.filter(Boolean)));
  if (!ids.length) return new Map<string, { nickname: string | null; phone: string | null }>();
  const identities = await prisma.userIdentity.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      user: { select: { nickname: true, phone: true } },
      anchorProfile: { select: { nickname: true } },
    },
  });
  return new Map(
    identities.map((identity) => [
      identity.id,
      {
        nickname: identity.anchorProfile?.nickname ?? identity.user?.nickname ?? null,
        phone: identity.user?.phone ?? null,
      },
    ])
  );
}

async function enrichTemporaryDashboardRecords(records: any[]) {
  const creatorIdentityIds = records.map((record) => record.assignment?.createdByIdentityId).filter((value): value is string => Boolean(value));
  const submitterIdentityIds = records.map((record) => record.lastSubmittedByIdentityId).filter((value): value is string => Boolean(value));
  const identityLabelMap = await loadIdentityLabelMap([...creatorIdentityIds, ...submitterIdentityIds]);

  return records.map((record) => {
    const publisherIdentity = record.assignment?.createdByIdentityId ? identityLabelMap.get(record.assignment.createdByIdentityId) : null;
    const submitterIdentity = record.lastSubmittedByIdentityId ? identityLabelMap.get(record.lastSubmittedByIdentityId) : null;
    return {
      ...record,
      publisherName: publisherIdentity?.nickname ?? record.assignment?.createdByIdentityId ?? record.assignment?.createdBy ?? null,
      publisherPhone: publisherIdentity?.phone ?? null,
      lastSubmittedByName: submitterIdentity?.nickname ?? null,
    };
  });
}

async function listTemporaryDashboardRecordsByWhere(where: Prisma.TaskRecordWhereInput) {
  const records = await prisma.taskRecord.findMany({
    where,
    include: {
      exemption: true,
      user: { select: { id: true, nickname: true, phone: true, status: true } },
      assignment: { select: { category: true, temporaryMode: true, temporarySubjectOrgType: true, createdByIdentityId: true, createdBy: true } },
      visibleIdentityLinks: { include: { user: { select: { id: true, nickname: true, phone: true } } } },
      itemRecords: { select: { taskItemId: true } },
    },
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "desc" }],
  });
  return enrichTemporaryDashboardRecords(records);
}

function resolveDailyDashboardStatus(record: { requiredDoneItems: number; requiredTotalItems: number; completedAt?: Date | null; recordDate?: string | null }) {
  const completed = record.requiredTotalItems > 0 && record.requiredDoneItems >= record.requiredTotalItems;
  const supplemented = completed && !!record.completedAt && !!record.recordDate && new Date(record.completedAt).getTime() > getDailyTaskDayEnd(record.recordDate).getTime();
  if (completed) return supplemented ? "supplemented" as const : "completed" as const;
  if (record.requiredDoneItems > 0) return "in_progress" as const;
  return "pending" as const;
}

async function loadDailyDashboardAudience(taskDate: string, baseOrg: { id: string; path: string }, viewerScopePath: string) {
  await reconcileDailyAssignments(baseOrg.path);
  const assignments = await prisma.taskAssignment.findMany({
    where: {
      category: "DAILY",
      targets: { some: { orgId: baseOrg.id } },
      status: { in: ["scheduled", "active", "ended"] },
      deletedAt: null,
      effectiveAt: { lte: getDailyTaskSupplementDeadline(taskDate) },
      OR: [{ endedAt: null }, { endedAt: { gte: getDailyTaskDayEnd(taskDate) } }],
    },
    include: {
      targets: true,
      exclusions: true,
      template: {
        select: {
          id: true,
          title: true,
          version: true,
          category: true,
          status: true,
          items: { select: { id: true, title: true, isRequired: true }, orderBy: { sortOrder: "asc" } },
        },
      },
    },
    orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
  });

  const refs: Array<{ assignmentId: string; userId: string; subjectKey: string; subjectName?: string | null; hallOrgId: string; hallOrgName: string; hallOrgPath: string; teamOrgId?: string | null; teamOrgName?: string | null; requiredTotalItems?: number; }> = [];
  const assignmentIds = new Set<string>();
  const resolvedSubjectKeys = new Set<string>();
  const assignmentRequiredItemCountMap = new Map<string, number>();
  // taskItemId -> { title, isRequired }
  const taskItemMetaMap = new Map<string, { title: string; isRequired: boolean }>();

  for (const assignment of assignments) {
    assignmentRequiredItemCountMap.set(assignment.id, assignment.template?.items?.filter((item: any) => item.isRequired !== false).length ?? 0);
    for (const item of (assignment.template?.items ?? []) as Array<{ id: string; title: string; isRequired: boolean }>) {
      if (!taskItemMetaMap.has(item.id)) {
        taskItemMetaMap.set(item.id, { title: item.title, isRequired: item.isRequired !== false });
      }
    }
    const audience = await listAssignmentAudienceMembers(prisma, assignment as any);
    for (const member of audience) {
      if (!member.hallOrgId || !member.hallOrgName || !member.hallOrgPath) continue;
      if (!(member.hallOrgPath === viewerScopePath || member.hallOrgPath.startsWith(`${viewerScopePath}/`) || viewerScopePath.startsWith(`${member.hallOrgPath}/`))) continue;
      const uniqueSubjectKey = `${member.subjectKey}:${taskDate}`;
      if (resolvedSubjectKeys.has(uniqueSubjectKey)) continue;
      resolvedSubjectKeys.add(uniqueSubjectKey);
      assignmentIds.add(assignment.id);
      refs.push({
        assignmentId: assignment.id,
        userId: member.userId,
        subjectKey: member.subjectKey,
        subjectName: member.subjectName ?? member.nickname,
        hallOrgId: member.hallOrgId,
        hallOrgName: member.hallOrgName,
        hallOrgPath: member.hallOrgPath,
        teamOrgId: member.teamOrgId,
        teamOrgName: member.teamOrgName,
        requiredTotalItems: assignmentRequiredItemCountMap.get(assignment.id) ?? 0,
      });
    }
  }

  const records = await prisma.taskRecord.findMany({
    where: { assignmentId: { in: Array.from(assignmentIds) }, recordDate: taskDate },
    select: {
      id: true,
      assignmentId: true,
      subjectKey: true,
      recordDate: true,
      itemRecords: {
        select: {
          taskItemId: true,
          status: true,
          doneAt: true,
          taskItem: { select: { id: true, isRequired: true } },
        },
      },
      exemption: {
        select: {
          id: true,
          status: true,
          reason: true,
          reviewedAt: true,
          reviewedBy: true,
        },
      },
    },
  });
  const recordMap = new Map(records.map((record) => {
    const requiredItemRecords = record.itemRecords.filter((item) => item.taskItem?.isRequired !== false);
    const doneRequiredItems = requiredItemRecords.filter((item) => item.status === "done");
    const completedAt = doneRequiredItems.length
      ? doneRequiredItems.reduce<Date | null>((latest, item) => {
          if (!item.doneAt) return latest;
          if (!latest) return item.doneAt;
          return item.doneAt.getTime() > latest.getTime() ? item.doneAt : latest;
        }, null)
      : null;
    // per-item done set: taskItemId -> done
    const doneItemIdSet = new Set(
      record.itemRecords.filter((ir) => ir.status === "done").map((ir) => ir.taskItemId)
    );
    return [`${record.assignmentId}:${record.subjectKey}:${taskDate}`, {
      id: record.id,
      assignmentId: record.assignmentId,
      subjectKey: record.subjectKey,
      recordDate: record.recordDate,
      requiredDoneItems: doneRequiredItems.length,
      completedAt,
      doneItemIdSet,
      exemption: record.exemption
        ? {
            id: record.exemption.id,
            status: record.exemption.status,
            reason: record.exemption.reason,
            reviewedAt: record.exemption.reviewedAt,
            reviewerName: record.exemption.reviewedBy ?? null,
          }
        : null,
    }];
  }));
  return { refs, recordMap, taskItemMetaMap };
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

reportRoutes.get("/tasks/report/assignments/:id/progress", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const assignmentId = req.params.id;
  const assignment = await AssignmentService.getById(
    assignmentId,
    req.identity?.scopePath,
    req.identity?.roleCode,
    undefined,
    req.userId,
    req.identity?.id
  );
  if (!assignment) return fail(res, "ASSIGNMENT_NOT_FOUND", "发放任务不存在", 404);

  const allRecords = await enrichTemporaryDashboardRecords(await prisma.taskRecord.findMany({
    where: { assignmentId },
    include: {
      exemption: true,
      user: { select: { id: true, nickname: true, phone: true, status: true } },
      assignment: { select: { category: true, temporaryMode: true, temporarySubjectOrgType: true, createdByIdentityId: true, createdBy: true } },
      visibleIdentityLinks: { include: { user: { select: { id: true, nickname: true, phone: true } } } },
      itemRecords: { select: { taskItemId: true } },
    },
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "desc" }],
  }));
  const subjectUserIds = Array.from(new Set(allRecords.map((record) => record.subjectUserId).filter(Boolean) as string[]));
  const anchorProfiles = subjectUserIds.length
    ? await prisma.anchorProfile.findMany({
        where: { boundUserId: { in: subjectUserIds } },
        select: { boundUserId: true, douyinNo: true, douyinUid: true },
      })
    : [];
  const anchorProfileMap = new Map(anchorProfiles.map((profile) => [profile.boundUserId, profile]));

  const now = new Date();
  const validRecords = allRecords.filter(isRecordValid).filter((record) => record.exemption?.status !== "approved");
  const submitted = validRecords.filter((record) => getEffectiveRecordStatus(record, now) === "submitted").length;
  const overdue = validRecords.filter((record) => getEffectiveRecordStatus(record, now) === "overdue").length;
  const pending = validRecords.filter((record) => getEffectiveRecordStatus(record, now) === "pending").length;
  const inProgress = validRecords.filter((record) => getEffectiveRecordStatus(record, now) === "in_progress").length;
  const total = validRecords.length;
  const completionRate = total > 0 ? Math.round((submitted / total) * 100) : 0;
  const overdueRate = total > 0 ? Math.round((overdue / total) * 100) : 0;

  return ok(res, {
    assignmentId,
    total,
    submitted,
    overdue,
    pending,
    inProgress,
    completionRate,
    overdueRate,
    exempted: allRecords.filter((record) => record.exemption?.status === "approved").length,
    records: allRecords.map((record) => ({
      id: record.id,
      userId: record.userId,
      subjectType: record.subjectType,
      subjectKey: record.subjectKey,
      subjectUserId: record.subjectUserId,
      subjectOrgId: record.subjectOrgId,
      subjectName: record.subjectName,
      subjectOrgType: record.subjectOrgType,
      user: record.user,
      recordDate: record.recordDate,
      status: getEffectiveRecordStatus(record, now),
      doneItems: record.doneItems,
      totalItems: record.totalItems,
      deadlineAt: record.deadlineAt,
      submittedAt: record.submittedAt,
      lastSubmittedByUserId: record.lastSubmittedByUserId,
      lastSubmittedByIdentityId: record.lastSubmittedByIdentityId,
      lastSubmittedAt: record.lastSubmittedAt,
      exemptionStatus: record.exemption?.status ?? null,
      exemptionReason: record.exemption?.reason ?? null,
    })),
  });
});

reportRoutes.get("/tasks/report/assignments/:id/daily", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const assignmentId = req.params.id;
  const startDate = t(req.query.startDate);
  const endDate = t(req.query.endDate);

  const assignment = await AssignmentService.getById(
    assignmentId,
    req.identity?.scopePath,
    req.identity?.roleCode,
    undefined,
    req.userId,
    req.identity?.id
  );
  if (!assignment) return fail(res, "ASSIGNMENT_NOT_FOUND", "发放任务不存在", 404);

  const where: any = { assignmentId };

  if (startDate) where.recordDate = { gte: startDate };
  if (endDate) where.recordDate = { ...where.recordDate, lte: endDate };

  const records = await prisma.taskRecord.findMany({
    where,
    include: {
      exemption: true,
      user: { select: { id: true, nickname: true, status: true } },
      assignment: { select: { category: true } },
    },
    orderBy: { recordDate: "desc" },
  });

  const now = new Date();
  const byDate: Record<string, { date: string; total: number; submitted: number; overdue: number; exempted: number }> = {};
  for (const record of records) {
    const date = record.recordDate ?? "unknown";
    if (!byDate[date]) byDate[date] = { date, total: 0, submitted: 0, overdue: 0, exempted: 0 };
    if (record.exemption?.status === "approved") {
      byDate[date].exempted++;
      continue;
    }
    if (!isRecordValid(record)) continue;
    const effectiveStatus = getEffectiveRecordStatus(record, now);
    byDate[date].total++;
    if (effectiveStatus === "submitted") byDate[date].submitted++;
    if (effectiveStatus === "overdue") byDate[date].overdue++;
  }

  return ok(res, Object.values(byDate).sort((left, right) => right.date.localeCompare(left.date)));
});

reportRoutes.get("/tasks/report/daily-dashboard", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewDailyDashboard(req.identity?.roleCode)) {
    return fail(res, "DAILY_DASHBOARD_FORBIDDEN", "当前身份无权查看日常任务看板", 403);
  }

  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先切换并选择基地后查看日常任务看板", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "DAILY_DASHBOARD_SCOPE_FAILED", "看板基地解析失败", 500);
  }

  const viewerScopePath = req.identity?.scopePath ?? baseOrg.path;
  const now = new Date();
  const today = formatBeijingDate(now);
  const phase = taskDate === today
    ? (now.getTime() <= getDailyTaskDayEnd(taskDate).getTime() ? "in_progress" : "supplement")
    : (now.getTime() < getDailyTaskSupplementDeadline(taskDate).getTime() ? "supplement" : "closed");

  const { refs: hallMemberRefs, recordMap, taskItemMetaMap } = await loadDailyDashboardAudience(taskDate, baseOrg, viewerScopePath);

  const nodes = new Map<string, {
    orgId: string;
    orgName: string;
    orgType: "BASE" | "TEAM" | "HALL";
    parentOrgId?: string;
    path: string;
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    supplemented: number;
    exemptions: number;
  }>();
  function ensureNode(data: { orgId: string; orgName: string; orgType: "BASE" | "TEAM" | "HALL"; parentOrgId?: string; path: string }) {
    const existing = nodes.get(data.orgId);
    if (existing) return existing;
    const created = { ...data, total: 0, completed: 0, inProgress: 0, pending: 0, supplemented: 0, exemptions: 0 };
    nodes.set(data.orgId, created);
    return created;
  }

  ensureNode({ orgId: baseOrg.id, orgName: baseOrg.name, orgType: "BASE", path: baseOrg.path });

  for (const ref of hallMemberRefs) {
    ensureNode({ orgId: ref.hallOrgId, orgName: ref.hallOrgName, orgType: "HALL", parentOrgId: ref.teamOrgId ?? baseOrg.id, path: ref.hallOrgPath });
    if (ref.teamOrgId && ref.teamOrgName) {
      const teamPath = ref.hallOrgPath.split("/").slice(0, -1).join("/") || baseOrg.path;
      ensureNode({ orgId: ref.teamOrgId, orgName: ref.teamOrgName, orgType: "TEAM", parentOrgId: baseOrg.id, path: teamPath });
    }
  }

  for (const ref of hallMemberRefs) {
    const record = recordMap.get(`${ref.assignmentId}:${ref.subjectKey}:${taskDate}`);
    const progress = {
      requiredDoneItems: record?.requiredDoneItems ?? 0,
      requiredTotalItems: ref.requiredTotalItems ?? 0,
      completedAt: record?.completedAt ?? null,
      recordDate: taskDate,
    };
    const status = resolveDailyDashboardStatus(progress);
    const hall = nodes.get(ref.hallOrgId);
    if (!hall) continue;
    const chain = [hall, hall.parentOrgId ? nodes.get(hall.parentOrgId) : undefined, nodes.get(baseOrg.id)].filter(Boolean) as typeof hall[];
    for (const node of chain) {
      node.total += 1;
      if (status === "completed") node.completed += 1;
      else if (status === "supplemented") {
        node.completed += 1;
        node.supplemented += 1;
      } else if (status === "in_progress") node.inProgress += 1;
      else node.pending += 1;
      if (record?.exemption?.status === "pending" || record?.exemption?.status === "approved") {
        node.exemptions += 1;
      }
    }
  }

  const teamNodes = Array.from(nodes.values())
    .filter((node) => node.orgType === "TEAM" && (node.path === viewerScopePath || node.path.startsWith(`${viewerScopePath}/`) || viewerScopePath.startsWith(`${node.path}/`)))
    .sort((left, right) => left.path.localeCompare(right.path));
  const hallNodes = Array.from(nodes.values())
    .filter((node) => node.orgType === "HALL" && (node.path === viewerScopePath || node.path.startsWith(`${viewerScopePath}/`) || viewerScopePath.startsWith(`${node.path}/`)))
    .sort((left, right) => left.path.localeCompare(right.path));
  const baseSummary = nodes.get(baseOrg.id) ?? { total: 0, completed: 0, inProgress: 0, pending: 0, supplemented: 0, exemptions: 0 };

  // 子任务（task item）完成人数统计（含按团队细分）
  const itemDoneCountMap = new Map<string, number>();
  // itemId -> teamOrgId -> { teamName, done, inProgress, pending, total }
  const itemTeamMap = new Map<string, Map<string, { teamName: string; done: number; inProgress: number; pending: number; total: number }>>();
  const totalPeople = hallMemberRefs.length;
  for (const ref of hallMemberRefs) {
    const record = recordMap.get(`${ref.assignmentId}:${ref.subjectKey}:${taskDate}`);
    const progress = {
      requiredDoneItems: record?.requiredDoneItems ?? 0,
      requiredTotalItems: ref.requiredTotalItems ?? 0,
      completedAt: record?.completedAt ?? null,
      recordDate: taskDate,
    };
    const memberStatus = resolveDailyDashboardStatus(progress);
    const teamOrgId = ref.teamOrgId ?? ref.hallOrgId;
    const teamName = ref.teamOrgName ?? ref.hallOrgName;
    // 遍历所有 required task items
    for (const [itemId, meta] of taskItemMetaMap.entries()) {
      if (!meta.isRequired) continue;
      // 该成员是否完成了该子任务（doneItemIdSet 是 Set<string>）
      const doneThisItem = record?.doneItemIdSet?.has(itemId) ?? false;
      // 整体 done count
      if (doneThisItem) {
        itemDoneCountMap.set(itemId, (itemDoneCountMap.get(itemId) ?? 0) + 1);
      }
      // 按团队统计
      if (!itemTeamMap.has(itemId)) itemTeamMap.set(itemId, new Map());
      const teamMap = itemTeamMap.get(itemId)!;
      if (!teamMap.has(teamOrgId)) {
        teamMap.set(teamOrgId, { teamName, done: 0, inProgress: 0, pending: 0, total: 0 });
      }
      const teamStat = teamMap.get(teamOrgId)!;
      teamStat.total += 1;
      if (doneThisItem) {
        teamStat.done += 1;
      } else if (memberStatus === "in_progress") {
        teamStat.inProgress += 1;
      } else {
        teamStat.pending += 1;
      }
    }
  }
  const subTaskSummaries = Array.from(taskItemMetaMap.entries())
    .filter(([, meta]) => meta.isRequired)
    .map(([itemId, meta]) => {
      const doneCount = itemDoneCountMap.get(itemId) ?? 0;
      const teamBreakdown = Array.from((itemTeamMap.get(itemId) ?? new Map()).entries()).map(([teamOrgId, stat]) => ({
        teamOrgId,
        teamName: stat.teamName,
        done: stat.done,
        inProgress: stat.inProgress,
        pending: stat.pending,
        total: stat.total,
        completionRate: stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0,
      })).sort((a, b) => a.teamName.localeCompare(b.teamName));
      return {
        taskItemId: itemId,
        title: meta.title,
        doneCount,
        total: totalPeople,
        completionRate: totalPeople > 0 ? Math.round((doneCount / totalPeople) * 100) : 0,
        teamBreakdown,
      };
    })
    .sort((a, b) => b.doneCount - a.doneCount);

  return ok(res, {
    taskDate,
    phase,
    baseOrg: { id: baseOrg.id, name: baseOrg.name, orgType: baseOrg.orgType },
    viewer: {
      roleCode: req.identity?.roleCode,
      scopeOrgId: req.identity?.orgId ?? null,
      scopePath: viewerScopePath,
    },
    summary: {
      total: baseSummary.total,
      completed: baseSummary.completed,
      inProgress: baseSummary.inProgress,
      pending: baseSummary.pending,
      supplemented: baseSummary.supplemented,
      exemptions: baseSummary.exemptions,
      completionRate: baseSummary.total ? Math.round((baseSummary.completed / baseSummary.total) * 100) : 0,
    },
    tree: {
      teams: teamNodes.map((team) => ({
        orgId: team.orgId,
        orgName: team.orgName,
        orgType: team.orgType,
        total: team.total,
        completed: team.completed,
        inProgress: team.inProgress,
        pending: team.pending,
        supplemented: team.supplemented,
        exemptions: team.exemptions,
        completionRate: team.total ? Math.round((team.completed / team.total) * 100) : 0,
        halls: hallNodes.filter((hall) => hall.parentOrgId === team.orgId).map((hall) => ({
          orgId: hall.orgId,
          orgName: hall.orgName,
          orgType: hall.orgType,
          total: hall.total,
          completed: hall.completed,
          inProgress: hall.inProgress,
          pending: hall.pending,
          supplemented: hall.supplemented,
          exemptions: hall.exemptions,
          completionRate: hall.total ? Math.round((hall.completed / hall.total) * 100) : 0,
        })),
      })),
      halls: req.identity?.roleCode === "HALL_MANAGER"
        ? hallNodes.filter((hall) => hall.path === viewerScopePath).map((hall) => ({
            orgId: hall.orgId,
            orgName: hall.orgName,
            orgType: hall.orgType,
            total: hall.total,
            completed: hall.completed,
            inProgress: hall.inProgress,
            pending: hall.pending,
            supplemented: hall.supplemented,
            exemptions: hall.exemptions,
            completionRate: hall.total ? Math.round((hall.completed / hall.total) * 100) : 0,
          }))
        : [],
    },
    quickRanges: {
      today,
      yesterday: addBeijingDays(today, -1),
      canSupplementYesterday: getDailyTaskContext(now).canSupplementYesterday,
    },
    subTaskSummaries,
  });
});

reportRoutes.get("/tasks/report/daily-dashboard/teams/:teamOrgId/children", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewDailyDashboard(req.identity?.roleCode)) {
    return fail(res, "DAILY_DASHBOARD_FORBIDDEN", "当前身份无权查看日常任务看板", 403);
  }

  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;
  const teamOrgId = t(req.params.teamOrgId);
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先切换并选择基地后查看日常任务看板", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "DAILY_DASHBOARD_SCOPE_FAILED", "看板基地解析失败", 500);
  }

  const viewerScopePath = req.identity?.scopePath ?? baseOrg.path;
  const { refs, recordMap } = await loadDailyDashboardAudience(taskDate, baseOrg, viewerScopePath);
  const teamRefs = refs.filter((ref) => ref.teamOrgId === teamOrgId);
  if (!teamRefs.length) return fail(res, "TEAM_NOT_FOUND", "团队不存在或当前范围下无数据", 404);

  const teamName = teamRefs[0].teamOrgName ?? "团队";
  const hallMap = new Map<string, DailyDashboardOrgNode>();
  for (const ref of teamRefs) {
    const record = recordMap.get(`${ref.assignmentId}:${ref.subjectKey}:${taskDate}`);
    const progress = {
      requiredDoneItems: record?.requiredDoneItems ?? 0,
      requiredTotalItems: ref.requiredTotalItems ?? 0,
      completedAt: record?.completedAt ?? null,
      recordDate: taskDate,
    };
    const status = resolveDailyDashboardStatus(progress);
    const existing = hallMap.get(ref.hallOrgId) ?? {
      orgId: ref.hallOrgId,
      orgName: ref.hallOrgName,
      orgType: "HALL" as const,
      total: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      supplemented: 0,
      exemptions: 0,
      completionRate: 0,
    };
    existing.total += 1;
    if (status === "completed") existing.completed += 1;
    else if (status === "supplemented") {
      existing.completed += 1;
      existing.supplemented += 1;
    } else if (status === "in_progress") existing.inProgress += 1;
    else existing.pending += 1;
    if (record?.exemption?.status === "pending" || record?.exemption?.status === "approved") existing.exemptions += 1;
    existing.completionRate = existing.total ? Math.round((existing.completed / existing.total) * 100) : 0;
    hallMap.set(ref.hallOrgId, existing);
  }

  const halls = Array.from(hallMap.values()).sort((left, right) => (left.orgName ?? "").localeCompare(right.orgName ?? ""));
  const team = {
    orgId: teamOrgId,
    orgName: teamName,
    orgType: "TEAM" as const,
    total: halls.reduce((sum, hall) => sum + hall.total, 0),
    completed: halls.reduce((sum, hall) => sum + hall.completed, 0),
    inProgress: halls.reduce((sum, hall) => sum + hall.inProgress, 0),
    pending: halls.reduce((sum, hall) => sum + hall.pending, 0),
    supplemented: halls.reduce((sum, hall) => sum + hall.supplemented, 0),
    exemptions: halls.reduce((sum, hall) => sum + (hall.exemptions ?? 0), 0),
    completionRate: 0,
  };
  team.completionRate = team.total ? Math.round((team.completed / team.total) * 100) : 0;

  return ok(res, {
    taskDate,
    baseOrg: { id: baseOrg.id, name: baseOrg.name, orgType: baseOrg.orgType },
    team,
    halls,
  });
});

reportRoutes.get("/tasks/report/daily-dashboard/halls/:hallOrgId/details", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewDailyDashboard(req.identity?.roleCode)) {
    return fail(res, "DAILY_DASHBOARD_FORBIDDEN", "当前身份无权查看日常任务看板", 403);
  }

  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;
  const hallOrgId = t(req.params.hallOrgId);
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先切换并选择基地后查看日常任务看板", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "DAILY_DASHBOARD_SCOPE_FAILED", "看板基地解析失败", 500);
  }

  const viewerScopePath = req.identity?.scopePath ?? baseOrg.path;
  const hall = await prisma.orgUnit.findFirst({
    where: { id: hallOrgId, status: "active", orgType: "HALL" },
    select: { id: true, name: true, path: true },
  });
  if (!hall) return fail(res, "HALL_NOT_FOUND", "厅不存在或已停用", 404);
  if (!(hall.path === viewerScopePath || hall.path.startsWith(`${viewerScopePath}/`) || viewerScopePath.startsWith(`${hall.path}/`))) {
    return fail(res, "HALL_FORBIDDEN", "当前身份无权查看该厅", 403);
  }

  const { refs, recordMap } = await loadDailyDashboardAudience(taskDate, baseOrg, viewerScopePath);
  const details = refs
    .filter((ref) => ref.hallOrgId === hallOrgId)
    .map((ref) => {
      const record = recordMap.get(`${ref.assignmentId}:${ref.subjectKey}:${taskDate}`);
      const progress = {
        requiredDoneItems: record?.requiredDoneItems ?? 0,
        requiredTotalItems: ref.requiredTotalItems ?? 0,
        completedAt: record?.completedAt ?? null,
        recordDate: taskDate,
      };
      const status = resolveDailyDashboardStatus(progress);
      return {
        userId: ref.userId,
        subjectKey: ref.subjectKey,
        subjectName: ref.subjectName ?? ref.subjectKey,
        doneItems: progress.requiredDoneItems,
        totalItems: progress.requiredTotalItems,
        submittedAt: progress.completedAt?.toISOString() ?? null,
        lastSubmittedAt: progress.completedAt?.toISOString() ?? null,
        status,
        completionRate: progress.requiredTotalItems ? Math.round((progress.requiredDoneItems / progress.requiredTotalItems) * 100) : 0,
        exemptionStatus: record?.exemption?.status ?? null,
        exemptionReason: record?.exemption?.reason ?? null,
        taskRecordId: record?.id ?? null,
      };
    })
    .sort((left, right) => {
      const order = { pending: 0, in_progress: 1, supplemented: 2, completed: 3 } as const;
      if (order[left.status] !== order[right.status]) return order[left.status] - order[right.status];
      return left.subjectName.localeCompare(right.subjectName);
    });

  return ok(res, {
    taskDate,
    baseOrg: { id: baseOrg.id, name: baseOrg.name, orgType: baseOrg.orgType },
    hall: { id: hall.id, name: hall.name },
    summary: {
      total: details.length,
      completed: details.filter((item) => item.status === "completed" || item.status === "supplemented").length,
      inProgress: details.filter((item) => item.status === "in_progress").length,
      pending: details.filter((item) => item.status === "pending").length,
      supplemented: details.filter((item) => item.status === "supplemented").length,
      exemptions: details.filter((item) => item.exemptionStatus === "pending" || item.exemptionStatus === "approved").length,
    },
    details,
  });
});

reportRoutes.get("/tasks/report/daily-dashboard/halls/:hallOrgId/anchors/:userId/items", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewDailyDashboard(req.identity?.roleCode)) {
    return fail(res, "DAILY_DASHBOARD_FORBIDDEN", "当前身份无权查看日常任务看板", 403);
  }

  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;
  const hallOrgId = t(req.params.hallOrgId);
  const userId = t(req.params.userId);
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先切换并选择基地后查看日常任务看板", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "DAILY_DASHBOARD_SCOPE_FAILED", "看板基地解析失败", 500);
  }

  const viewerScopePath = req.identity?.scopePath ?? baseOrg.path;
  const hall = await prisma.orgUnit.findFirst({ where: { id: hallOrgId, status: "active", orgType: "HALL" }, select: { id: true, name: true, path: true } });
  if (!hall) return fail(res, "HALL_NOT_FOUND", "厅不存在或已停用", 404);
  if (!(hall.path === viewerScopePath || hall.path.startsWith(`${viewerScopePath}/`) || viewerScopePath.startsWith(`${hall.path}/`))) {
    return fail(res, "HALL_FORBIDDEN", "当前身份无权查看该厅", 403);
  }

  const { refs, recordMap } = await loadDailyDashboardAudience(taskDate, baseOrg, viewerScopePath);
  const ref = refs.find((item) => item.hallOrgId === hallOrgId && item.userId === userId);
  if (!ref) return fail(res, "ANCHOR_NOT_FOUND", "当前厅下未找到该主播任务记录", 404);

  const assignment = await prisma.taskAssignment.findUnique({
    where: { id: ref.assignmentId },
    include: {
      template: {
        include: {
          items: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!assignment?.template) return fail(res, "ASSIGNMENT_TEMPLATE_NOT_FOUND", "任务模板不存在", 404);

  const taskRecord = await prisma.taskRecord.findFirst({
    where: { assignmentId: ref.assignmentId, subjectKey: ref.subjectKey, recordDate: taskDate },
    include: {
      itemRecords: {
        include: { attachments: true },
      },
    },
  });

  const itemRecordMap = new Map((taskRecord?.itemRecords ?? []).map((item) => [item.taskItemId, item]));
  const recordProgress = recordMap.get(`${ref.assignmentId}:${ref.subjectKey}:${taskDate}`);
  const progress = {
    requiredDoneItems: recordProgress?.requiredDoneItems ?? 0,
    requiredTotalItems: ref.requiredTotalItems ?? 0,
    completedAt: recordProgress?.completedAt ?? null,
    recordDate: taskDate,
  };
  const status = resolveDailyDashboardStatus(progress);

  return ok(res, {
    taskDate,
    baseOrg: { id: baseOrg.id, name: baseOrg.name, orgType: baseOrg.orgType },
    hall: { id: hall.id, name: hall.name },
    anchor: {
      userId: ref.userId,
      subjectKey: ref.subjectKey,
      subjectName: ref.subjectName ?? ref.subjectKey,
      status,
      requiredDoneItems: progress.requiredDoneItems,
      requiredTotalItems: progress.requiredTotalItems,
      completedAt: progress.completedAt?.toISOString() ?? null,
      taskRecordId: recordProgress?.id ?? taskRecord?.id ?? null,
      exemptionStatus: recordProgress?.exemption?.status ?? null,
      exemptionReason: recordProgress?.exemption?.reason ?? null,
      exemptionReviewedAt: recordProgress?.exemption?.reviewedAt?.toISOString?.() ?? null,
      exemptionReviewerName: recordProgress?.exemption?.reviewerName ?? null,
    },
    items: assignment.template.items.map((item) => {
      const itemRecord = itemRecordMap.get(item.id);
      return {
        taskItemId: item.id,
        title: item.title,
        itemType: item.itemType,
        isRequired: item.isRequired,
        done: itemRecord?.status === "done",
        doneAt: itemRecord?.doneAt?.toISOString() ?? null,
        answerText: itemRecord?.answerText ?? null,
        answerOptions: Array.isArray(itemRecord?.answerOptions) ? itemRecord?.answerOptions : null,
        isLinkConfirmed: itemRecord?.isLinkConfirmed ?? false,
        attachments: (itemRecord?.attachments ?? []).map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
        })),
        options: item.options.map((option) => ({ id: option.id, label: option.label, sortOrder: option.sortOrder })),
      };
    }),
  });
});

reportRoutes.get("/tasks/report/temporary-dashboard/active-mode-counts", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewTemporaryDashboard(req.identity?.roleCode)) {
    return fail(res, "TEMPORARY_DASHBOARD_FORBIDDEN", "当前身份无权查看临时任务看板", 403);
  }

  const scopeOrgId = t(req.query.scopeOrgId) || undefined;
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先切换并选择基地后查看临时任务看板", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "TEMPORARY_DASHBOARD_SCOPE_FAILED", "看板基地解析失败", 500);
  }

  const identityFilter = req.identity?.id
    ? { createdByIdentityId: req.identity.id }
    : req.userId
      ? { createdBy: req.userId }
      : {};

  const modes = ["ACCOUNT", "ANCHOR", "MANAGER"] as const;
  const counts = await Promise.all(
    modes.map((mode) =>
      prisma.taskAssignment.count({
        where: {
          category: "TEMPORARY",
          createdByOrgId: baseOrg.id,
          temporaryMode: mode,
          status: { in: ["active"] },
          deletedAt: null,
          ...identityFilter,
        },
      })
    )
  );

  return ok(res, {
    ACCOUNT: counts[0],
    ANCHOR: counts[1],
    MANAGER: counts[2],
  });
});

reportRoutes.get("/tasks/report/temporary-dashboard/assignments", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewTemporaryDashboard(req.identity?.roleCode)) {
    return fail(res, "TEMPORARY_DASHBOARD_FORBIDDEN", "当前身份无权查看临时任务看板", 403);
  }

  const scopeOrgId = t(req.query.scopeOrgId) || undefined;
  const mode = t(req.query.mode) || "ACCOUNT";
  const lifecycle = t(req.query.lifecycle) || "active";
  const limit = Math.min(Number(req.query.limit) || 5, 20);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先切换并选择基地后查看临时任务看板", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "TEMPORARY_DASHBOARD_SCOPE_FAILED", "看板基地解析失败", 500);
  }

  const statusWhere = lifecycle === "ended" ? { in: ["ended", "deleted"] as Prisma.EnumTaskAssignmentStatusFilter["in"] } : { in: ["active"] as Prisma.EnumTaskAssignmentStatusFilter["in"] };
  const rows = await prisma.taskAssignment.findMany({
    where: {
      category: "TEMPORARY",
      createdByOrgId: baseOrg.id,
      temporaryMode: mode as Prisma.EnumTemporaryTaskModeNullableFilter["equals"],
      status: statusWhere,
      deletedAt: null,
      ...(req.identity?.id
        ? { createdByIdentityId: req.identity.id }
        : req.userId
          ? { createdBy: req.userId }
          : {}),
    },
    include: {
      template: { select: { id: true, title: true, category: true, status: true, version: true } },
      _count: { select: { records: true } },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    skip: offset,
    take: limit,
  });

  return ok(res, {
    items: rows,
    hasMore: rows.length === limit,
    scopeOrg: { id: baseOrg.id, name: baseOrg.name, orgType: baseOrg.orgType },
  });
});

reportRoutes.get("/tasks/report/temporary-dashboard/assignments/:id/summary", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewTemporaryDashboard(req.identity?.roleCode)) {
    return fail(res, "TEMPORARY_DASHBOARD_FORBIDDEN", "当前身份无权查看临时任务看板", 403);
  }

  const assignmentId = t(req.params.id);
  const assignment = await AssignmentService.getById(
    assignmentId,
    req.identity?.scopePath,
    req.identity?.roleCode,
    undefined,
    req.userId,
    req.identity?.id,
  );
  if (!assignment || assignment.category !== "TEMPORARY") return fail(res, "ASSIGNMENT_NOT_FOUND", "临时任务不存在", 404);

  const allRecords = await prisma.taskRecord.findMany({
    where: { assignmentId },
    include: {
      exemption: true,
      user: { select: { id: true, nickname: true, phone: true, status: true } },
      assignment: { select: { category: true, temporaryMode: true, temporarySubjectOrgType: true, createdByIdentityId: true, createdBy: true } },
    },
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "desc" }],
  });
  const subjectUserIds = Array.from(new Set(allRecords.map((record) => record.subjectUserId).filter(Boolean) as string[]));
  const anchorProfiles = subjectUserIds.length
    ? await prisma.anchorProfile.findMany({
        where: { boundUserId: { in: subjectUserIds } },
        select: { boundUserId: true, douyinNo: true, douyinUid: true },
      })
    : [];
  const anchorProfileMap = new Map(anchorProfiles.map((profile) => [profile.boundUserId, profile]));

  const now = new Date();
  const validRecords = allRecords.filter(isRecordValid).filter((record) => record.exemption?.status !== "approved");
  const normalizedRecords = validRecords.map((record) => ({ status: getEffectiveRecordStatus(record, now) }));
  const summary = summarizeTemporaryRecords(normalizedRecords);

  return ok(res, {
    assignmentId,
    total: summary.total,
    submitted: summary.submitted,
    overdue: summary.overdue,
    pending: summary.pending,
    inProgress: summary.inProgress,
    completionRate: summary.completionRate,
    overdueRate: summary.overdueRate,
    exempted: allRecords.filter((record) => record.exemption?.status === "approved").length,
  });
});

reportRoutes.get("/tasks/report/temporary-dashboard/assignments/:id/records", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewTemporaryDashboard(req.identity?.roleCode)) {
    return fail(res, "TEMPORARY_DASHBOARD_FORBIDDEN", "当前身份无权查看临时任务看板", 403);
  }

  const assignmentId = t(req.params.id);
  const filter = normalizeTemporaryDashboardFilter(t(req.query.filter));
  const keyword = t(req.query.keyword);
  const limit = Math.min(Number(req.query.limit) || 10, 30);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const assignment = await AssignmentService.getById(
    assignmentId,
    req.identity?.scopePath,
    req.identity?.roleCode,
    undefined,
    req.userId,
    req.identity?.id,
  );
  if (!assignment || assignment.category !== "TEMPORARY") return fail(res, "ASSIGNMENT_NOT_FOUND", "临时任务不存在", 404);

  const allRecords = await prisma.taskRecord.findMany({
    where: { assignmentId },
    include: {
      exemption: true,
      user: { select: { id: true, nickname: true, phone: true, status: true } },
      assignment: { select: { category: true, temporaryMode: true, temporarySubjectOrgType: true } },
    },
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "desc" }],
  });
  const subjectUserIds = Array.from(new Set(allRecords.map((record) => record.subjectUserId).filter(Boolean) as string[]));
  const anchorProfiles = subjectUserIds.length
    ? await prisma.anchorProfile.findMany({
        where: { boundUserId: { in: subjectUserIds } },
        select: { boundUserId: true, douyinNo: true, douyinUid: true },
      })
    : [];
  const anchorProfileMap = new Map(anchorProfiles.filter((p) => p.boundUserId != null).map((profile) => [profile.boundUserId as string, profile]));

  const now = new Date();
  const validRecords = allRecords
    .filter(isRecordValid)
    .filter((record) => record.exemption?.status !== "approved")
    .map((record) => buildTemporaryDashboardRecord(record, anchorProfileMap, now));

  const filteredByStatus = filter === "all" ? validRecords : validRecords.filter((record) => record.status === filter);
  const filtered = filteredByStatus.filter((record) => matchesTemporaryDashboardKeyword(record, keyword));
  const pageRows = filtered.slice(offset, offset + limit);

  return ok(res, {
    assignmentId,
    filter,
    keyword,
    total: filtered.length,
    items: pageRows,
    hasMore: offset + limit < filtered.length,
  });
});

reportRoutes.get("/tasks/report/temporary-dashboard/assignments/:id/anchor-team-nodes", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewTemporaryDashboard(req.identity?.roleCode)) {
    return fail(res, "TEMPORARY_DASHBOARD_FORBIDDEN", "当前身份无权查看临时任务看板", 403);
  }

  const assignmentId = t(req.params.id);
  const assignment = await AssignmentService.getById(
    assignmentId,
    req.identity?.scopePath,
    req.identity?.roleCode,
    undefined,
    req.userId,
    req.identity?.id,
  );
  if (!assignment || assignment.category !== "TEMPORARY") return fail(res, "ASSIGNMENT_NOT_FOUND", "临时任务不存在", 404);
  if (assignment.temporaryMode !== "ANCHOR") return fail(res, "TEMPORARY_DASHBOARD_MODE_INVALID", "仅主播式任务支持团队-厅钻取", 400);

  const rawRecords = await listTemporaryDashboardRecordsByWhere({ assignmentId, subjectOrgId: { not: null } });
  const hallIds = Array.from(new Set(rawRecords.map((record) => record.subjectOrgId).filter(Boolean) as string[]));
  const halls = hallIds.length
    ? await prisma.orgUnit.findMany({ where: { id: { in: hallIds } }, select: { id: true, name: true, orgType: true, path: true, parentId: true } })
    : [];
  const subjectUserIds = Array.from(new Set(rawRecords.map((record) => record.subjectUserId).filter(Boolean) as string[]));
  const anchorProfileMap = await loadAnchorProfileSnapshotMapByUserIds(subjectUserIds);
  const now = new Date();
  const validRecords = rawRecords.filter(isRecordValid).filter((record) => record.exemption?.status !== "approved").map((record) => buildTemporaryDashboardRecord(record, anchorProfileMap, now));
  const teamIds = Array.from(new Set(halls.map((org) => org.parentId).filter(Boolean) as string[]));
  const teams = teamIds.length
    ? await prisma.orgUnit.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true, orgType: true, path: true, parentId: true } })
    : [];

  const hallTeamMap = new Map(halls.map((hall) => [hall.id, hall.parentId]));
  const childOrgIds = new Set(teams.map((team) => team.id));
  const recordsWithTeam = validRecords.map((record) => ({ ...record, subjectOrgId: record.subjectOrgId ? hallTeamMap.get(record.subjectOrgId) ?? record.subjectOrgId : record.subjectOrgId }));
  const summaryNodes = summarizeTemporaryOrgNodes(teams, recordsWithTeam, childOrgIds);

  return ok(res, {
    assignmentId,
    items: summaryNodes,
  });
});

reportRoutes.get("/tasks/report/temporary-dashboard/assignments/:id/anchor-teams/:teamOrgId/hall-nodes", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewTemporaryDashboard(req.identity?.roleCode)) {
    return fail(res, "TEMPORARY_DASHBOARD_FORBIDDEN", "当前身份无权查看临时任务看板", 403);
  }

  const assignmentId = t(req.params.id);
  const teamOrgId = t(req.params.teamOrgId);
  const assignment = await AssignmentService.getById(
    assignmentId,
    req.identity?.scopePath,
    req.identity?.roleCode,
    undefined,
    req.userId,
    req.identity?.id,
  );
  if (!assignment || assignment.category !== "TEMPORARY") return fail(res, "ASSIGNMENT_NOT_FOUND", "临时任务不存在", 404);
  if (assignment.temporaryMode !== "ANCHOR") return fail(res, "TEMPORARY_DASHBOARD_MODE_INVALID", "仅主播式任务支持团队-厅钻取", 400);

  const halls = await prisma.orgUnit.findMany({ where: { parentId: teamOrgId, orgType: "HALL" }, select: { id: true, name: true, orgType: true, path: true, parentId: true } });
  const hallIds = halls.map((hall) => hall.id);
  const rawRecords = hallIds.length ? await listTemporaryDashboardRecordsByWhere({ assignmentId, subjectOrgId: { in: hallIds } }) : [];
  const subjectUserIds = Array.from(new Set(rawRecords.map((record) => record.subjectUserId).filter(Boolean) as string[]));
  const anchorProfileMap = await loadAnchorProfileSnapshotMapByUserIds(subjectUserIds);
  const now = new Date();
  const validRecords = rawRecords.filter(isRecordValid).filter((record) => record.exemption?.status !== "approved").map((record) => buildTemporaryDashboardRecord(record, anchorProfileMap, now));
  const childOrgIds = new Set<string>();
  const summaryNodes = summarizeTemporaryOrgNodes(halls, validRecords, childOrgIds);

  return ok(res, {
    assignmentId,
    teamOrgId,
    items: summaryNodes,
  });
});

reportRoutes.get("/tasks/report/temporary-dashboard/assignments/:id/anchor-halls/:hallOrgId/records", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewTemporaryDashboard(req.identity?.roleCode)) {
    return fail(res, "TEMPORARY_DASHBOARD_FORBIDDEN", "当前身份无权查看临时任务看板", 403);
  }

  const assignmentId = t(req.params.id);
  const hallOrgId = t(req.params.hallOrgId);
  const filter = normalizeTemporaryDashboardFilter(t(req.query.filter));
  const keyword = t(req.query.keyword);
  const limit = Math.min(Number(req.query.limit) || 10, 30);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const assignment = await AssignmentService.getById(
    assignmentId,
    req.identity?.scopePath,
    req.identity?.roleCode,
    undefined,
    req.userId,
    req.identity?.id,
  );
  if (!assignment || assignment.category !== "TEMPORARY") return fail(res, "ASSIGNMENT_NOT_FOUND", "临时任务不存在", 404);
  if (assignment.temporaryMode !== "ANCHOR") return fail(res, "TEMPORARY_DASHBOARD_MODE_INVALID", "仅主播式任务支持组织树钻取", 400);

  const allRecords = await prisma.taskRecord.findMany({
    where: { assignmentId, subjectOrgId: hallOrgId },
    include: {
      exemption: true,
      user: { select: { id: true, nickname: true, phone: true, status: true } },
      assignment: { select: { category: true, temporaryMode: true, temporarySubjectOrgType: true } },
    },
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "desc" }],
  });
  const subjectUserIds = Array.from(new Set(allRecords.map((record) => record.subjectUserId).filter(Boolean) as string[]));
  const anchorProfiles = subjectUserIds.length
    ? await prisma.anchorProfile.findMany({
        where: { boundUserId: { in: subjectUserIds } },
        select: { boundUserId: true, douyinNo: true, douyinUid: true },
      })
    : [];
  const anchorProfileMap = new Map(anchorProfiles.filter((p) => p.boundUserId != null).map((profile) => [profile.boundUserId as string, profile]));
  const now = new Date();
  const validRecords = allRecords
    .filter(isRecordValid)
    .filter((record) => record.exemption?.status !== "approved")
    .map((record) => buildTemporaryDashboardRecord(record, anchorProfileMap, now));
  const filteredByStatus = filter === "all" ? validRecords : validRecords.filter((record) => record.status === filter);
  const filtered = filteredByStatus.filter((record) => matchesTemporaryDashboardKeyword(record, keyword));
  const pageRows = filtered.slice(offset, offset + limit);

  return ok(res, {
    assignmentId,
    hallOrgId,
    filter,
    keyword,
    total: filtered.length,
    items: pageRows,
    hasMore: offset + limit < filtered.length,
  });
});

reportRoutes.get("/tasks/report/temporary-dashboard/records/:recordId/detail", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewTemporaryDashboard(req.identity?.roleCode)) {
    return fail(res, "TEMPORARY_DASHBOARD_FORBIDDEN", "当前身份无权查看临时任务看板", 403);
  }

  const recordId = t(req.params.recordId);
  const record = await prisma.taskRecord.findUnique({
    where: { id: recordId },
    include: {
      assignment: {
        include: {
          template: {
            include: {
              items: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      itemRecords: { include: { attachments: true } },
      visibleIdentityLinks: {
        include: {
          user: { select: { id: true, nickname: true, phone: true } },
          identity: {
            include: {
              anchorProfile: true,
            },
          },
          org: { select: { id: true, name: true, orgType: true } },
        },
      },
      user: { select: { id: true, nickname: true, phone: true, status: true } },
      exemption: true,
    },
  });
  const [enrichedRecord] = await enrichTemporaryDashboardRecords(record ? [record] : []);
  if (!record || record.assignment.category !== "TEMPORARY" || !enrichedRecord) return fail(res, "RECORD_NOT_FOUND", "主体记录不存在", 404);

  const assignment = await AssignmentService.getById(
    record.assignmentId,
    req.identity?.scopePath,
    req.identity?.roleCode,
    undefined,
    req.userId,
    req.identity?.id,
  );
  if (!assignment) return fail(res, "RECORD_FORBIDDEN", "当前身份无权查看该主体记录", 403);

  const itemRecordMap = new Map((record.itemRecords ?? []).map((item) => [item.taskItemId, item]));
  const contributionIdentityIds = record.assignment.temporaryMode === "MANAGER"
    ? Array.from(new Set([
        ...(record.itemRecords ?? []).flatMap((item) => parseContributionLines(item.answerText).map((entry) => entry.identityId)),
        ...(record.itemRecords ?? []).map((item) => item.completedByIdentityId).filter(Boolean) as string[],
      ]))
    : [];
  const contributionIdentityLabelMap = await loadIdentityLabelMap(contributionIdentityIds);
  const itemContributionSummaries = record.assignment.temporaryMode === "MANAGER"
    ? (record.assignment.template?.items.map((item) => {
        const itemRecord = itemRecordMap.get(item.id);
        const existingContributions = parseContributionLines(itemRecord?.answerText).map((entry) => ({
          identityId: entry.identityId,
          userId: entry.userId,
          createdAt: entry.createdAt,
          content: entry.content,
          contributorName: contributionIdentityLabelMap.get(entry.identityId)?.nickname ?? entry.identityId,
          contributorPhone: contributionIdentityLabelMap.get(entry.identityId)?.phone ?? null,
        }));
        const completionContribution = itemRecord?.completedByIdentityId && itemRecord?.doneAt
          ? [{
              identityId: itemRecord.completedByIdentityId,
              userId: itemRecord.completedByUserId ?? "",
              createdAt: itemRecord.doneAt.toISOString(),
              content: itemRecord.answerText ?? (Array.isArray(itemRecord.answerOptions) ? itemRecord.answerOptions.join("、") : itemRecord.attachments?.length ? `上传附件 ${itemRecord.attachments.length} 个` : "完成了该子任务"),
              contributorName: contributionIdentityLabelMap.get(itemRecord.completedByIdentityId)?.nickname ?? itemRecord.completedByIdentityId,
              contributorPhone: contributionIdentityLabelMap.get(itemRecord.completedByIdentityId)?.phone ?? null,
            }]
          : [];
        const contributions = existingContributions.length ? existingContributions : completionContribution;
        return { taskItemId: item.id, contributions };
      }) ?? [])
    : [];

  return ok(res, {
    record: {
      id: record.id,
      assignmentId: record.assignmentId,
      subjectType: record.subjectType,
      subjectKey: record.subjectKey,
      subjectName: record.subjectName,
      subjectOrgId: record.subjectOrgId,
      subjectOrgType: record.subjectOrgType,
      status: record.status,
      doneItems: record.doneItems,
      totalItems: record.totalItems,
      deadlineAt: record.deadlineAt,
      submittedAt: record.submittedAt,
      lastSubmittedAt: record.lastSubmittedAt,
      lastSubmittedByUserId: record.lastSubmittedByUserId,
      lastSubmittedByIdentityId: record.lastSubmittedByIdentityId,
      lastSubmittedByName: enrichedRecord.lastSubmittedByName ?? null,
      publisherName: enrichedRecord.publisherName ?? null,
      publisherPhone: enrichedRecord.publisherPhone ?? null,
      participantCount: enrichedRecord.participantCount ?? 0,
      submissionCount: enrichedRecord.submissionCount ?? 0,
      visibleIdentityNames: enrichedRecord.visibleIdentityNames ?? [],
      user: record.user,
      exemptionStatus: record.exemption?.status ?? null,
      exemptionReason: record.exemption?.reason ?? null,
      visibleIdentities: record.visibleIdentityLinks.map((link) => ({
        id: link.id,
        identityId: link.identityId,
        userId: link.userId,
        roleCode: link.roleCode,
        userName: link.identity?.anchorProfile?.nickname ?? link.user?.nickname ?? null,
        phone: link.user?.phone ?? null,
        orgName: link.org?.name ?? null,
        orgType: link.org?.orgType ?? null,
      })),
    },
    items: record.assignment.template?.items.map((item) => {
      const itemRecord = itemRecordMap.get(item.id);
      const contributionSummary = itemContributionSummaries.find((entry: any) => entry.taskItemId === item.id);
      return {
        taskItemId: item.id,
        title: item.title,
        itemType: item.itemType,
        isRequired: item.isRequired,
        done: itemRecord?.status === "done",
        doneAt: itemRecord?.doneAt?.toISOString() ?? null,
        answerText: itemRecord?.answerText ?? null,
        answerOptions: Array.isArray(itemRecord?.answerOptions) ? itemRecord?.answerOptions : null,
        isLinkConfirmed: itemRecord?.isLinkConfirmed ?? false,
        completedByUserId: itemRecord?.completedByUserId ?? null,
        completedByIdentityId: itemRecord?.completedByIdentityId ?? null,
        completedByName: itemRecord?.completedByIdentityId ? (contributionIdentityLabelMap.get(itemRecord.completedByIdentityId)?.nickname ?? itemRecord.completedByIdentityId) : null,
        attachments: (itemRecord?.attachments ?? []).map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
        })),
        options: item.options.map((option) => ({ id: option.id, label: option.label, sortOrder: option.sortOrder })),
        contributions: contributionSummary?.contributions ?? [],
      };
    }) ?? [],
  });
});

reportRoutes.get("/tasks/report/summary", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const scopePath = req.identity?.scopePath;
  const roleCode = req.identity?.roleCode;
  await reconcileDailyAssignments(scopePath);

  const orgFilter = scopePath && roleCode !== "DEV_ADMIN"
    ? { createdByOrgId: { in: (await prisma.orgUnit.findMany({ where: { path: { startsWith: scopePath } }, select: { id: true } })).map((org) => org.id) } }
    : {};

  const templateOrgWhere = Array.isArray((orgFilter as any).createdByOrgId?.in)
    ? { orgId: { in: (orgFilter as any).createdByOrgId.in } }
    : {};

  const temporaryOwnerWhere = req.identity?.id
    ? {
        OR: [
          { createdByIdentityId: req.identity.id },
          { createdByIdentityId: null, createdBy: req.userId },
        ],
      }
    : { createdBy: req.userId };

  const temporaryScopeWhere = scopePath ? { ownerScopePath: { startsWith: scopePath } } : {};

  const [activeAssignments, totalTemplates, pendingExemptions] = await Promise.all([
    prisma.taskAssignment.count({
      where: {
        OR: [
          { category: "DAILY", status: "active", deletedAt: null, ...orgFilter },
          { category: "TEMPORARY", isActive: true, deletedAt: null, ...temporaryOwnerWhere, ...temporaryScopeWhere },
        ],
      },
    }),
    prisma.taskTemplate.count({ where: { status: "published", ...templateOrgWhere } }),
    prisma.taskExemption.count({ where: { status: "pending" } }),
  ]);

  return ok(res, { activeAssignments, totalTemplates, pendingExemptions });
});
