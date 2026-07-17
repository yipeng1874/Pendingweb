import { Router } from "express";
import { Prisma } from "@prisma/client";
import { authRequired } from "../../../middleware/authRequired.js";
import { identityRequired } from "../../../middleware/identityRequired.js";
import { permissionRequired } from "../../../middleware/permissionRequired.js";
import { prisma } from "../../../shared/prisma.js";
import { fail, ok } from "../../../shared/response.js";
import { AssignmentService } from "../assignment/assignment.service.js";
import { reconcileDailyAssignments, listAssignmentAudienceMembers } from "../assignment/daily-assignment.utils.js";
import { addBeijingDays, formatBeijingDate, getDailyTaskContext, getDailyTaskDayEnd, getDailyTaskSupplementDeadline, isDailyRecordOverdue, resolveTaskRecordStatus } from "../record/daily-record-time.utils.js";

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

type HallDailyReportStatus = "submitted" | "leave_approved" | "leave_pending" | "in_progress" | "overdue" | "pending";

type HallDailyRecordForStatus = {
  status: string;
  recordDate?: string | null;
  doneItems: number;
  leaveRequests?: Array<{ status: string; createdAt?: Date }>;
};

function getLatestHallDailyLeaveStatus(record?: HallDailyRecordForStatus | null) {
  const leaveRequests = record?.leaveRequests ?? [];
  const approved = leaveRequests.find((leave) => leave.status === "approved");
  if (approved) return "approved";
  const pending = leaveRequests.find((leave) => leave.status === "pending");
  if (pending) return "pending";
  return null;
}

function resolveHallDailyReportStatus(
  record: HallDailyRecordForStatus | null | undefined,
  taskDate: string,
  now = new Date()
): HallDailyReportStatus | null {
  if (!record) return null;
  if (record.status === "submitted") return "submitted";
  const leaveStatus = getLatestHallDailyLeaveStatus(record);
  if (leaveStatus === "approved") return "leave_approved";
  if (leaveStatus === "pending") return "leave_pending";
  if (isDailyRecordOverdue(record.recordDate ?? taskDate, now)) return "overdue";
  return record.doneItems > 0 ? "in_progress" : "pending";
}

function serializeHallDailyLeaveRequest(record?: { leaveRequests?: Array<any> } | null) {
  const leave = record?.leaveRequests?.find((item) => item.status === "approved")
    ?? record?.leaveRequests?.find((item) => item.status === "pending")
    ?? record?.leaveRequests?.find((item) => item.status === "rejected")
    ?? null;
  if (!leave) return null;
  return {
    id: leave.id,
    status: leave.status,
    applicantName: leave.applicantName,
    reason: leave.reason,
    reviewComment: leave.reviewComment,
    createdAt: leave.createdAt.toISOString(),
    reviewedAt: leave.reviewedAt?.toISOString() ?? null,
  };
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
    const audience = await listAssignmentAudienceMembers(prisma, assignment as any, taskDate);
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

// ── 新增：基地看板 — 历史待办完成率（范围统计） ─────────────────────────────
reportRoutes.get("/tasks/report/daily-range-stats", permissionRequired("task:report:view"), async (req: any, res: any) => {
  if (!canViewDailyDashboard(req.identity?.roleCode)) {
    return fail(res, "DAILY_DASHBOARD_FORBIDDEN", "当前身份无权查看日常任务看板", 403);
  }

  const startDate = t(req.query.startDate);
  const endDate = t(req.query.endDate);
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;

  if (!startDate || !endDate) {
    return fail(res, "MISSING_DATE_RANGE", "startDate 和 endDate 为必填项", 400);
  }
  if (startDate > endDate) {
    return fail(res, "INVALID_DATE_RANGE", "startDate 不能晚于 endDate", 400);
  }

  // 枚举日期范围内所有日期（最多31天）
  function enumerateDates(start: string, end: string): string[] {
    const result: string[] = [];
    const cur = new Date(`${start}T00:00:00Z`);
    const endD = new Date(`${end}T00:00:00Z`);
    let guard = 0;
    while (cur <= endD && guard < 32) {
      result.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
      guard++;
    }
    return result;
  }

  const dates = enumerateDates(startDate, endDate);
  if (dates.length === 0) {
    return fail(res, "INVALID_DATE_RANGE", "日期范围无效", 400);
  }

  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先切换并选择基地后查看", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "DAILY_RANGE_STATS_SCOPE_FAILED", "基地解析失败", 500);
  }

  const viewerScopePath = req.identity?.scopePath ?? baseOrg.path;

  // 1. 取日期范围内有效的 DAILY assignments（只读，不调用 reconcile）
  // 与 loadDailyDashboardAudience 对齐：只统计在指定日期范围内实际生效的 assignment
  const assignments = await prisma.taskAssignment.findMany({
    where: {
      category: "DAILY",
      targets: { some: { orgId: baseOrg.id } },
      status: { in: ["scheduled", "active", "ended"] },
      deletedAt: null,
      effectiveAt: { lte: getDailyTaskSupplementDeadline(endDate) },
      OR: [
        { endedAt: null },
        { endedAt: { gte: getDailyTaskDayEnd(startDate) } },
      ],
    },
    include: {
      targets: true,
      exclusions: true,
      template: {
        select: {
          id: true,
          items: { select: { id: true, isRequired: true }, orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  if (assignments.length === 0) {
    return ok(res, {
      startDate,
      endDate,
      effectiveDays: dates.length,
      baseOrg: { id: baseOrg.id, name: baseOrg.name },
      summary: { total: 0, completed: 0, exemptions: 0, completionRate: 0, exemptionRate: 0 },
      teams: [],
    });
  }

  // 2. 取一次 audience（今日配置作分母，只读）
  type AudienceMember = {
    subjectKey: string;
    userId: string;
    teamOrgId?: string | null;
    teamOrgName?: string | null;
    hallOrgId?: string | null;
    hallOrgName?: string | null;
    hallOrgPath?: string | null;
  };
  const audienceMembers: AudienceMember[] = [];
  const assignmentIds = new Set<string>();
  const resolvedSubjectKeys = new Set<string>();

  for (const assignment of assignments) {
    const audience = await listAssignmentAudienceMembers(prisma, assignment as any, endDate);
    for (const member of audience) {
      if (!member.hallOrgId || !member.hallOrgName || !member.hallOrgPath) continue;
      if (!(member.hallOrgPath === viewerScopePath || member.hallOrgPath.startsWith(`${viewerScopePath}/`) || viewerScopePath.startsWith(`${member.hallOrgPath}/`))) continue;
      if (resolvedSubjectKeys.has(member.subjectKey)) continue;
      resolvedSubjectKeys.add(member.subjectKey);
      assignmentIds.add(assignment.id);
      audienceMembers.push({
        subjectKey: member.subjectKey,
        userId: member.userId,
        teamOrgId: member.teamOrgId,
        teamOrgName: member.teamOrgName,
        hallOrgId: member.hallOrgId,
        hallOrgName: member.hallOrgName,
        hallOrgPath: member.hallOrgPath,
      });
    }
  }

  const audienceSize = audienceMembers.length;
  if (audienceSize === 0) {
    return ok(res, {
      startDate,
      endDate,
      effectiveDays: dates.length,
      baseOrg: { id: baseOrg.id, name: baseOrg.name },
      summary: { total: 0, completed: 0, exemptions: 0, completionRate: 0, exemptionRate: 0 },
      teams: [],
    });
  }

  // subjectKey -> teamOrgId / teamOrgName 映射
  const subjectTeamMap = new Map<string, { teamOrgId: string | null; teamOrgName: string | null }>();
  for (const m of audienceMembers) {
    subjectTeamMap.set(m.subjectKey, { teamOrgId: m.teamOrgId ?? null, teamOrgName: m.teamOrgName ?? null });
  }

  // 3. 一次性查所有历史 records
  // 修复：不按 assignmentId 过滤，改为按 subjectKey + recordDate 查询，
  // 避免 assignment 重新发布/版本更新后历史 record 因 assignmentId 变化而查不到。
  // 同时查出 assignmentId，用于去重时优先保留当前有效 assignment 的 record，
  // 防止旧 assignment 的历史完成 record 污染统计结果。
  const allRecordsRaw = await prisma.taskRecord.findMany({
    where: {
      subjectKey: { in: Array.from(resolvedSubjectKeys) },
      recordDate: { in: dates },
      assignment: { category: "DAILY", deletedAt: null },
    },
    select: {
      assignmentId: true,
      subjectKey: true,
      recordDate: true,
      submittedAt: true,
      itemRecords: {
        select: {
          status: true,
          taskItem: { select: { id: true, isRequired: true } },
        },
      },
      exemption: { select: { status: true } },
    },
  });

  // 4. 按 subjectKey + recordDate 去重：同一人同一天最多算一次。
  // 优先保留当前有效 assignmentIds 中的 record，其次保留最新提交的（有 exemption 优先）。
  type RawRecord = (typeof allRecordsRaw)[number];
  const recordDedupeMap = new Map<string, RawRecord>();
  for (const record of allRecordsRaw) {
    const key = `${record.subjectKey}:${record.recordDate}`;
    const existing = recordDedupeMap.get(key);
    if (!existing) {
      recordDedupeMap.set(key, record);
      continue;
    }
    // 优先级：当前有效 assignment > 其他；有豁免 > 没豁免；有提交时间 > 没提交时间
    const curIsValid = assignmentIds.has(record.assignmentId);
    const existIsValid = assignmentIds.has(existing.assignmentId);
    if (curIsValid && !existIsValid) {
      recordDedupeMap.set(key, record);
    } else if (curIsValid === existIsValid) {
      // 同优先级：有豁免优先，其次按提交时间降序
      const curHasExemption = !!record.exemption;
      const existHasExemption = !!existing.exemption;
      if (curHasExemption && !existHasExemption) {
        recordDedupeMap.set(key, record);
      } else if (!curHasExemption && !existHasExemption) {
        if ((record.submittedAt ?? 0) > (existing.submittedAt ?? 0)) {
          recordDedupeMap.set(key, record);
        }
      }
    }
  }
  const records = Array.from(recordDedupeMap.values());

  // teamOrgId -> { completed, exemptions }
  // 统计：
  //   completed = 当天所有必填 item 都是 done 的 record 数（豁免的不算完成）
  //   exemptions = exemption.status === "approved" 的 record 数
  //   total = audienceSize * dates.length

  type TeamStat = { teamOrgId: string; teamOrgName: string; completed: number; exemptions: number };
  const teamStatMap = new Map<string, TeamStat>();
  let totalCompleted = 0;
  let totalExemptions = 0;

  for (const record of records) {
    const teamInfo = subjectTeamMap.get(record.subjectKey);
    if (!teamInfo) continue; // 不在当前 audience 范围内，跳过

    const teamOrgId = teamInfo.teamOrgId ?? baseOrg.id;
    const teamOrgName = teamInfo.teamOrgName ?? baseOrg.name;

    if (!teamStatMap.has(teamOrgId)) {
      teamStatMap.set(teamOrgId, { teamOrgId, teamOrgName, completed: 0, exemptions: 0 });
    }
    const stat = teamStatMap.get(teamOrgId)!;

    const isExempted = record.exemption?.status === "approved";

    // 判断是否完成：所有必填 item 均已 done，且不是豁免记录
    if (!isExempted) {
      const requiredItems = record.itemRecords.filter((ir) => ir.taskItem?.isRequired !== false);
      const allDone = requiredItems.length > 0 && requiredItems.every((ir) => ir.status === "done");
      if (allDone) {
        stat.completed++;
        totalCompleted++;
      }
    }

    if (isExempted) {
      stat.exemptions++;
      totalExemptions++;
    }
  }

  // 5. 计算各团队分母：该团队的 audience 人数 × dates.length
  // audience 已经过日期范围过滤，只包含该时间段内实际有 assignment 的团队
  const teamAudienceCount = new Map<string, number>();
  const teamOrgNameMap = new Map<string, string>();
  for (const m of audienceMembers) {
    const teamOrgId = m.teamOrgId ?? baseOrg.id;
    const teamOrgName = m.teamOrgName ?? baseOrg.name;
    teamAudienceCount.set(teamOrgId, (teamAudienceCount.get(teamOrgId) ?? 0) + 1);
    if (!teamOrgNameMap.has(teamOrgId)) teamOrgNameMap.set(teamOrgId, teamOrgName);
  }

  const total = audienceMembers.length * dates.length;

  // 补全所有在 audience 中出现的团队（即使该日期范围内没有任何 record，也要显示）
  for (const [teamOrgId, teamOrgName] of teamOrgNameMap.entries()) {
    if (!teamStatMap.has(teamOrgId)) {
      teamStatMap.set(teamOrgId, { teamOrgId, teamOrgName, completed: 0, exemptions: 0 });
    }
  }

  const teams = Array.from(teamStatMap.values()).map((stat) => {
    const teamTotal = (teamAudienceCount.get(stat.teamOrgId) ?? 0) * dates.length;
    return {
      orgId: stat.teamOrgId,
      orgName: stat.teamOrgName,
      total: teamTotal,
      completed: stat.completed,
      exemptions: stat.exemptions,
      completionRate: teamTotal > 0 ? Math.round((stat.completed / teamTotal) * 100) : 0,
      exemptionRate: teamTotal > 0 ? Math.round((stat.exemptions / teamTotal) * 100) : 0,
    };
  }).sort((a, b) => a.orgName.localeCompare(b.orgName));

  return ok(res, {
    startDate,
    endDate,
    effectiveDays: dates.length,
    baseOrg: { id: baseOrg.id, name: baseOrg.name },
    summary: {
      total,
      completed: totalCompleted,
      exemptions: totalExemptions,
      completionRate: total > 0 ? Math.round((totalCompleted / total) * 100) : 0,
      exemptionRate: total > 0 ? Math.round((totalExemptions / total) * 100) : 0,
    },
    teams,
  });
});

// ── 厅管历史完成率：多日期范围统计 ─────────────────────────────────────────
reportRoutes.get("/tasks/report/hall-daily-range-stats", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const roleCode = req.identity?.roleCode;
  const allowedAdminRoles = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"];
  if (!allowedAdminRoles.includes(roleCode)) {
    return fail(res, "HALL_DAILY_RANGE_STATS_FORBIDDEN", "当前身份无权查看厅管日常任务历史数据", 403);
  }

  const startDate = t(req.query.startDate);
  const endDate = t(req.query.endDate);
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;

  if (!startDate || !endDate) {
    return fail(res, "MISSING_DATE_RANGE", "startDate 和 endDate 为必填项", 400);
  }
  if (startDate > endDate) {
    return fail(res, "INVALID_DATE_RANGE", "startDate 不能晚于 endDate", 400);
  }

  function enumerateHallDates(start: string, end: string): string[] {
    const result: string[] = [];
    const cur = new Date(`${start}T00:00:00Z`);
    const endD = new Date(`${end}T00:00:00Z`);
    let guard = 0;
    while (cur <= endD && guard < 32) {
      result.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
      guard++;
    }
    return result;
  }

  const dates = enumerateHallDates(startDate, endDate);
  if (dates.length === 0) {
    return fail(res, "INVALID_DATE_RANGE", "日期范围无效", 400);
  }

  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先选择基地后查看", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "HALL_DAILY_RANGE_STATS_SCOPE_FAILED", "基地解析失败", 500);
  }

  const viewerScopePath = req.identity?.scopePath ?? baseOrg.path;

  // 查询基地下所有 active 团队
  const allTeams = await prisma.orgUnit.findMany({
    where: { status: "active", orgType: "TEAM", path: { startsWith: `${baseOrg.path}/` } },
    select: { id: true, name: true, path: true },
    orderBy: { path: "asc" },
  });

  const scopedTeams = roleCode === "TEAM_ADMIN" && viewerScopePath
    ? allTeams.filter((t) => t.path === viewerScopePath || t.path.startsWith(`${viewerScopePath}/`))
    : allTeams;

  const scopedTeamIds = scopedTeams.map((t) => t.id);
  if (scopedTeamIds.length === 0) {
    return ok(res, {
      startDate, endDate, effectiveDays: dates.length,
      baseOrg: { id: baseOrg.id, name: baseOrg.name },
      summary: { total: 0, completed: 0, exemptions: 0, completionRate: 0, exemptionRate: 0 },
      teams: [],
    });
  }

  // 查询日期范围内有效的 HallTaskAssignment
  const assignments = await prisma.hallTaskAssignment.findMany({
    where: {
      teamOrgId: { in: scopedTeamIds },
      status: { in: ["active", "ended"] },
      effectiveAt: { lte: getDailyTaskSupplementDeadline(endDate) },
      OR: [
        { endedAt: null },
        { endedAt: { gte: getDailyTaskDayEnd(startDate) } },
      ],
    },
    include: {
      targets: { select: { hallOrgId: true } },
    },
  });

  // 收集目标 hallOrgId 并建立 team 映射
  const allHallTargetIds = new Set<string>();
  for (const assignment of assignments) {
    for (const target of assignment.targets) {
      allHallTargetIds.add(target.hallOrgId);
    }
  }

  const targetHallIds = Array.from(allHallTargetIds);
  if (targetHallIds.length === 0) {
    return ok(res, {
      startDate, endDate, effectiveDays: dates.length,
      baseOrg: { id: baseOrg.id, name: baseOrg.name },
      summary: { total: 0, completed: 0, exemptions: 0, completionRate: 0, exemptionRate: 0 },
      teams: [],
    });
  }

  // 查询涉及的厅详情 + scope 校验 + 建立 hallOrgId → team 映射
  const hallsWithInfo = await prisma.orgUnit.findMany({
    where: { id: { in: targetHallIds }, status: "active", orgType: "HALL" },
    select: { id: true, name: true, path: true, parentId: true },
  });

  const hallTeamMap = new Map<string, { teamOrgId: string; teamOrgName: string }>();
  const scopeFilteredHallIds = new Set<string>();

  for (const hall of hallsWithInfo) {
    if (!(hall.path === viewerScopePath || hall.path.startsWith(`${viewerScopePath}/`) || viewerScopePath.startsWith(`${hall.path}/`))) continue;
    scopeFilteredHallIds.add(hall.id);
    const teamInfo = scopedTeams.find((t) => t.id === hall.parentId);
    hallTeamMap.set(hall.id, {
      teamOrgId: hall.parentId ?? baseOrg.id,
      teamOrgName: teamInfo?.name ?? baseOrg.name,
    });
  }

  const scopeFilteredHallIdsArr = Array.from(scopeFilteredHallIds);
  const total = scopeFilteredHallIdsArr.length * dates.length;
  if (total === 0) {
    return ok(res, {
      startDate, endDate, effectiveDays: dates.length,
      baseOrg: { id: baseOrg.id, name: baseOrg.name },
      summary: { total: 0, completed: 0, exemptions: 0, completionRate: 0, exemptionRate: 0 },
      teams: [],
    });
  }

  // 批量查 HallTaskRecord
  const allRecordsRaw = await prisma.hallTaskRecord.findMany({
    where: {
      hallOrgId: { in: scopeFilteredHallIdsArr },
      recordDate: { in: dates },
      assignment: { status: { in: ["active", "ended"] }, teamOrgId: { in: scopedTeamIds } },
    },
    select: {
      assignmentId: true,
      hallOrgId: true,
      recordDate: true,
      status: true,
      submittedAt: true,
      leaveRequests: {
        orderBy: { createdAt: "desc" },
        select: { status: true },
      },
      assignment: { select: { status: true } },
    },
  });

  // 按 hallOrgId + recordDate 去重：active assignment 优先
  type HallRawRecord = (typeof allRecordsRaw)[number];
  const recordDedupeMap = new Map<string, HallRawRecord>();
  const activeAssignmentIds = new Set(assignments.filter((a) => a.status === "active").map((a) => a.id));

  for (const record of allRecordsRaw) {
    const key = `${record.hallOrgId}:${record.recordDate}`;
    const existing = recordDedupeMap.get(key);
    if (!existing) {
      recordDedupeMap.set(key, record);
      continue;
    }
    const curIsActive = activeAssignmentIds.has(record.assignmentId);
    const existIsActive = activeAssignmentIds.has(existing.assignmentId);
    if (curIsActive && !existIsActive) {
      recordDedupeMap.set(key, record);
    } else if (curIsActive === existIsActive) {
      if ((record.submittedAt ?? 0) > (existing.submittedAt ?? 0)) {
        recordDedupeMap.set(key, record);
      }
    }
  }

  // 统计：与 resolveHallDailyReportStatus 优先级一致 — submitted > leave_approved
  type TeamStat = { teamOrgId: string; teamOrgName: string; completed: number; exemptions: number };
  const teamStatMap = new Map<string, TeamStat>();
  let totalCompleted = 0;
  let totalExemptions = 0;

  for (const record of recordDedupeMap.values()) {
    const teamInfo = hallTeamMap.get(record.hallOrgId) ?? { teamOrgId: baseOrg.id, teamOrgName: baseOrg.name };

    if (!teamStatMap.has(teamInfo.teamOrgId)) {
      teamStatMap.set(teamInfo.teamOrgId, { teamOrgId: teamInfo.teamOrgId, teamOrgName: teamInfo.teamOrgName, completed: 0, exemptions: 0 });
    }
    const stat = teamStatMap.get(teamInfo.teamOrgId)!;

    const isSubmitted = record.status === "submitted";
    const hasApprovedLeave = record.leaveRequests?.some((l) => l.status === "approved") ?? false;

    // 与 resolveHallDailyReportStatus 一致：submitted 优先
    if (isSubmitted) {
      stat.completed++;
      totalCompleted++;
    } else if (hasApprovedLeave) {
      stat.exemptions++;
      totalExemptions++;
    }
  }

  // 计算各团队分母（该团队下有 scope 权限的厅数 × 天数）
  const teamHallCount = new Map<string, number>();
  for (const hallId of scopeFilteredHallIdsArr) {
    const ti = hallTeamMap.get(hallId) ?? { teamOrgId: baseOrg.id, teamOrgName: baseOrg.name };
    teamHallCount.set(ti.teamOrgId, (teamHallCount.get(ti.teamOrgId) ?? 0) + 1);
  }

  const teams = Array.from(teamStatMap.entries())
    .filter(([, stat]) => (teamHallCount.get(stat.teamOrgId) ?? 0) > 0)
    .map(([, stat]) => {
      const teamTotal = (teamHallCount.get(stat.teamOrgId) ?? 0) * dates.length;
      return {
        orgId: stat.teamOrgId,
        orgName: stat.teamOrgName,
        total: teamTotal,
        completed: stat.completed,
        exemptions: stat.exemptions,
        completionRate: teamTotal > 0 ? Math.round((stat.completed / teamTotal) * 100) : 0,
        exemptionRate: teamTotal > 0 ? Math.round((stat.exemptions / teamTotal) * 100) : 0,
      };
    })
    .sort((a, b) => a.orgName.localeCompare(b.orgName));

  return ok(res, {
    startDate,
    endDate,
    effectiveDays: dates.length,
    baseOrg: { id: baseOrg.id, name: baseOrg.name },
    summary: {
      total,
      completed: totalCompleted,
      exemptions: totalExemptions,
      completionRate: total > 0 ? Math.round((totalCompleted / total) * 100) : 0,
      exemptionRate: total > 0 ? Math.round((totalExemptions / total) * 100) : 0,
    },
    teams,
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

// ── 厅管日常任务看板 ──────────────────────────────────────────────────────────
reportRoutes.get("/tasks/report/hall-daily-dashboard", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const roleCode = req.identity?.roleCode;
  if (!canViewDailyDashboard(roleCode)) {
    return fail(res, "HALL_DAILY_DASHBOARD_FORBIDDEN", "当前身份无权查看厅管日常任务看板", 403);
  }
  if (roleCode !== "HALL_MANAGER") {
    return fail(res, "HALL_DAILY_DASHBOARD_ROLE_REQUIRED", "厅管日常任务看板仅厅管角色可使用本接口，管理员请使用 /hall-daily-dashboard/overview", 403);
  }

  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());
  const hallOrgId = req.identity?.orgId as string | undefined;
  if (!hallOrgId) {
    return fail(res, "HALL_ORG_NOT_FOUND", "当前厅管身份未绑定直播厅", 400);
  }

  const hall = await prisma.orgUnit.findFirst({
    where: { id: hallOrgId, status: "active", orgType: "HALL" },
    select: { id: true, name: true, path: true, parentId: true },
  });
  if (!hall) return fail(res, "HALL_NOT_FOUND", "当前直播厅不存在或已停用", 404);

  const now = new Date();
  const today = formatBeijingDate(now);
  const { canSupplementYesterday } = getDailyTaskContext(now);
  const phase = taskDate === today
    ? (now.getTime() <= getDailyTaskDayEnd(taskDate).getTime() ? "in_progress" : "supplement")
    : (now.getTime() < getDailyTaskSupplementDeadline(taskDate).getTime() ? "supplement" : "closed");

  // 查找当天该厅的所有活跃/已结束 HallTaskRecord（含日期范围内有效的任务）
  const records = await prisma.hallTaskRecord.findMany({
    where: {
      hallOrgId,
      recordDate: taskDate,
      assignment: {
        status: { in: ["active", "ended"] },
      },
    },
    include: {
      assignment: {
        include: {
          template: {
            include: {
              items: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, title: true, itemType: true, isRequired: true, sortOrder: true, linkUrl: true },
              },
            },
          },
          targets: { select: { hallOrgId: true } },
        },
      },
      itemRecords: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          taskItemId: true,
          status: true,
          answerText: true,
          answerOptions: true,
          isLinkConfirmed: true,
          doneAt: true,
          doneBy: true,
        },
      },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
      },
      hallOrg: { select: { id: true, name: true } },
    },
    orderBy: { recordDate: "desc" },
  });

  // 取最新的一条有效 record（active assignment 优先）
  const activeRecord = records.find((r) => r.assignment.status === "active") ?? records[0] ?? null;

  const summary = {
    status: resolveHallDailyReportStatus(activeRecord, taskDate, now),
    totalItems: activeRecord?.totalItems ?? 0,
    doneItems: activeRecord?.doneItems ?? 0,
    submittedAt: activeRecord?.submittedAt?.toISOString() ?? null,
    leaveRequest: serializeHallDailyLeaveRequest(activeRecord),
    completionRate: activeRecord?.totalItems
      ? Math.round((activeRecord.doneItems / activeRecord.totalItems) * 100)
      : 0,
  };

  return ok(res, {
    taskDate,
    phase,
    hall: { id: hall.id, name: hall.name },
    viewer: { roleCode, orgId: hallOrgId },
    quickRanges: {
      today,
      yesterday: addBeijingDays(today, -1),
      canSupplementYesterday,
    },
    summary,
    record: activeRecord
      ? {
          id: activeRecord.id,
          assignmentId: activeRecord.assignmentId,
          status: resolveHallDailyReportStatus(activeRecord, taskDate, now),
          totalItems: activeRecord.totalItems,
          doneItems: activeRecord.doneItems,
          submittedAt: activeRecord.submittedAt?.toISOString() ?? null,
          leaveRequest: serializeHallDailyLeaveRequest(activeRecord),
          templateTitle: activeRecord.assignment.template?.title ?? null,
          items: (activeRecord.assignment.template?.items ?? []).map((item) => {
            const ir = activeRecord.itemRecords.find((r) => r.taskItemId === item.id);
            return {
              taskItemId: item.id,
              title: item.title,
              itemType: item.itemType,
              isRequired: item.isRequired,
              sortOrder: item.sortOrder,
              linkUrl: item.linkUrl ?? null,
              done: ir?.status === "done",
              doneAt: ir?.doneAt?.toISOString() ?? null,
              answerText: ir?.answerText ?? null,
              answerOptions: Array.isArray(ir?.answerOptions) ? ir.answerOptions : null,
              isLinkConfirmed: ir?.isLinkConfirmed ?? false,
            };
          }),
        }
      : null,
  });
});

// ── 厅管日常任务看板：管理员总览（按基地→团队汇总）──────────────────────────
reportRoutes.get("/tasks/report/hall-daily-dashboard/overview", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const roleCode = req.identity?.roleCode;
  const allowedAdminRoles = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"];
  if (!allowedAdminRoles.includes(roleCode)) {
    return fail(res, "HALL_DAILY_OVERVIEW_FORBIDDEN", "当前身份无权查看厅管日常任务管理员看板", 403);
  }

  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());
  const scopeOrgId = t(req.query.scopeOrgId) || undefined;

  const baseOrg = await resolveBaseScopeOrg(scopeOrgId, req.identity).catch((error: Error) => error);
  if (baseOrg instanceof Error) {
    if (baseOrg.message === "BASE_SCOPE_REQUIRED") return fail(res, "BASE_SCOPE_REQUIRED", "请先选择基地后查看厅管日常任务看板", 400);
    if (baseOrg.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "当前基地不存在或已停用", 404);
    if (baseOrg.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该基地", 403);
    return fail(res, "HALL_DAILY_OVERVIEW_SCOPE_FAILED", "看板基地解析失败", 500);
  }

  const now = new Date();
  const today = formatBeijingDate(now);
  const { canSupplementYesterday } = getDailyTaskContext(now);
  const phase = taskDate === today
    ? (now.getTime() <= getDailyTaskDayEnd(taskDate).getTime() ? "in_progress" : "supplement")
    : (now.getTime() < getDailyTaskSupplementDeadline(taskDate).getTime() ? "supplement" : "closed");

  // TEAM_ADMIN scope 过滤
  const viewerScopePath = req.identity?.scopePath;

  // ① 查询基地下全量 active 团队（用于展示"未参与任务"的团队）
  const allTeams = await prisma.orgUnit.findMany({
    where: {
      status: "active",
      orgType: "TEAM",
      path: { startsWith: `${baseOrg.path}/` },
    },
    select: { id: true, name: true, path: true },
    orderBy: { path: "asc" },
  });

  // TEAM_ADMIN 只能看自己团队（精确匹配或子路径）
  const scopedTeams = roleCode === "TEAM_ADMIN" && viewerScopePath
    ? allTeams.filter((t) => t.path === viewerScopePath || t.path.startsWith(`${viewerScopePath}/`))
    : allTeams;

  // ② 查询基地下全量 active 厅（用于展示"未参与任务"的厅）
  const scopedTeamIds = scopedTeams.map((t) => t.id);
  const allHalls = scopedTeamIds.length ? await prisma.orgUnit.findMany({
    where: { status: "active", orgType: "HALL", parentId: { in: scopedTeamIds } },
    select: { id: true, name: true, path: true, parentId: true },
  }) : [];

  // ③ 直接查询 taskDate 当天有 HallTaskRecord 的厅（权威数据源，精确到日期）
  const allHallIdsArr = allHalls.map((h) => h.id);
  const records = allHallIdsArr.length ? await prisma.hallTaskRecord.findMany({
    where: {
      hallOrgId: { in: allHallIdsArr },
      recordDate: taskDate,
      assignment: {
        status: { in: ["active", "ended"] },
        teamOrgId: { in: scopedTeamIds },
      },
    },
    select: {
      id: true,
      hallOrgId: true,
      assignmentId: true,
      status: true,
      totalItems: true,
      doneItems: true,
      submittedAt: true,
      createdAt: true,
      assignment: {
        select: {
          status: true,
          teamOrgId: true,
          template: { select: { title: true } },
        },
      },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  }) : [];

  // 从 records 推导当天真实有任务的厅集合
  const assignedHallIds = new Set(records.map((r) => r.hallOrgId));

  // ④ 每个厅取当天最优一条 record：active assignment 优先，都是 ended 则取 createdAt 最晚的
  const hallRecordMap = new Map<string, typeof records[number]>();
  for (const rec of records) {
    const existing = hallRecordMap.get(rec.hallOrgId);
    if (!existing) {
      hallRecordMap.set(rec.hallOrgId, rec);
    } else if (rec.assignment.status === "active" && existing.assignment.status !== "active") {
      // active 优先
      hallRecordMap.set(rec.hallOrgId, rec);
    } else if (rec.assignment.status !== "active" && existing.assignment.status !== "active"
      && rec.createdAt > existing.createdAt) {
      // 同为 ended，取创建时间更晚的（即对应更晚生效的任务）
      hallRecordMap.set(rec.hallOrgId, rec);
    }
  }

  // teamOrgId -> templateTitle（从 hallRecordMap 取，确保对应当天实际显示的任务）
  const teamTemplateTitleMap = new Map<string, string>();
  for (const rec of hallRecordMap.values()) {
    const teamId = rec.assignment.teamOrgId;
    if (teamId && rec.assignment.template?.title && !teamTemplateTitleMap.has(teamId)) {
      teamTemplateTitleMap.set(teamId, rec.assignment.template.title);
    }
  }

  // ⑤ 统计每个团队（全量，包含无任务团队）
  const teamSummaries = scopedTeams.map((team) => {
    const teamAllHalls = allHalls.filter((h) => h.parentId === team.id);
    const teamAssignedHallIds = teamAllHalls.filter((h) => assignedHallIds.has(h.id)).map((h) => h.id);

    const totalHalls = teamAllHalls.length;      // 团队下全量厅数
    const assignedHalls = teamAssignedHallIds.length; // 参与任务的厅数
    const hasTask = assignedHalls > 0;

    let submittedCount = 0;
    let leaveApprovedCount = 0;
    let leavePendingCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;
    let noRecordCount = 0;

    for (const hallId of teamAssignedHallIds) {
      const rec = hallRecordMap.get(hallId);
      const displayStatus = resolveHallDailyReportStatus(rec, taskDate, now);
      if (!displayStatus) {
        noRecordCount += 1;
      } else if (displayStatus === "submitted") {
        submittedCount += 1;
      } else if (displayStatus === "leave_approved") {
        leaveApprovedCount += 1;
      } else if (displayStatus === "leave_pending") {
        leavePendingCount += 1;
      } else if (displayStatus === "in_progress") {
        inProgressCount += 1;
      } else if (displayStatus === "overdue") {
        overdueCount += 1;
      } else {
        pendingCount += 1;
      }
    }

    // 完成率 = 已提交 + 已请假 / 参与任务的厅（分母不排除 noRecord，保留透明度）
    const completionRate = assignedHalls > 0 ? Math.round(((submittedCount + leaveApprovedCount) / assignedHalls) * 100) : 0;

    return {
      teamOrgId: team.id,
      teamOrgName: team.name,
      hasTask,
      totalHalls,
      assignedHalls,
      submittedCount,
      leaveApprovedCount,
      leavePendingCount,
      inProgressCount,
      pendingCount,
      overdueCount,
      noRecordCount,
      completionRate,
      templateTitle: teamTemplateTitleMap.get(team.id) ?? null,
    };
  });

  // 基地整体汇总
  const baseTotalTeams = scopedTeams.length;
  const baseAssignedTeams = teamSummaries.filter((t) => t.hasTask).length;
  const baseTotalHalls = allHalls.length;
  const baseAssignedHalls = assignedHallIds.size;
  const baseSubmittedHalls = teamSummaries.reduce((s, t) => s + t.submittedCount, 0);
  const baseLeaveApprovedHalls = teamSummaries.reduce((s, t) => s + t.leaveApprovedCount, 0);
  const baseLeavePendingHalls = teamSummaries.reduce((s, t) => s + t.leavePendingCount, 0);
  const baseCompletionRate = baseAssignedHalls > 0 ? Math.round(((baseSubmittedHalls + baseLeaveApprovedHalls) / baseAssignedHalls) * 100) : 0;

  return ok(res, {
    taskDate,
    phase,
    baseOrg: { id: baseOrg.id, name: baseOrg.name },
    quickRanges: {
      today,
      yesterday: addBeijingDays(today, -1),
      canSupplementYesterday,
    },
    baseSummary: {
      totalTeams: baseTotalTeams,
      assignedTeams: baseAssignedTeams,
      totalHalls: baseTotalHalls,
      assignedHalls: baseAssignedHalls,
      submittedHalls: baseSubmittedHalls,
      leaveApprovedHalls: baseLeaveApprovedHalls,
      leavePendingHalls: baseLeavePendingHalls,
      completionRate: baseCompletionRate,
    },
    teams: teamSummaries,
  });
});

// ── 厅管日常任务看板：管理员-某团队下各厅进度列表 ─────────────────────────────
reportRoutes.get("/tasks/report/hall-daily-dashboard/teams/:teamOrgId/halls", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const roleCode = req.identity?.roleCode;
  const allowedAdminRoles = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"];
  if (!allowedAdminRoles.includes(roleCode)) {
    return fail(res, "HALL_DAILY_TEAM_HALLS_FORBIDDEN", "当前身份无权查看", 403);
  }

  const { teamOrgId } = req.params;
  const now = new Date();
  const taskDate = t(req.query.taskDate) || formatBeijingDate(now);

  const team = await prisma.orgUnit.findFirst({
    where: { id: teamOrgId, status: "active", orgType: "TEAM" },
    select: { id: true, name: true, path: true },
  });
  if (!team) return fail(res, "TEAM_ORG_NOT_FOUND", "团队不存在或已停用", 404);

  // scope 校验：TEAM_ADMIN 只能看自己团队
  const viewerScopePath = req.identity?.scopePath;
  if (roleCode === "TEAM_ADMIN" && viewerScopePath) {
    if (!(team.path === viewerScopePath || team.path.startsWith(`${viewerScopePath}/`))) {
      return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该团队", 403);
    }
  }

  // ① 查询团队下全量 active 厅
  const allTeamHalls = await prisma.orgUnit.findMany({
    where: { status: "active", orgType: "HALL", parentId: teamOrgId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // ② 直接查询 taskDate 当天有 HallTaskRecord 的厅（权威数据源，精确到日期）
  const allTeamHallIds = allTeamHalls.map((h) => h.id);
  const records = allTeamHallIds.length ? await prisma.hallTaskRecord.findMany({
    where: {
      hallOrgId: { in: allTeamHallIds },
      recordDate: taskDate,
      assignment: {
        status: { in: ["active", "ended"] },
        teamOrgId,
      },
    },
    select: {
      id: true,
      hallOrgId: true,
      status: true,
      totalItems: true,
      doneItems: true,
      submittedAt: true,
      assignmentId: true,
      createdAt: true,
      assignment: { select: { status: true } },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  }) : [];

  // 从 records 推导当天真实有任务的厅集合
  const assignedHallIds = new Set(records.map((r) => r.hallOrgId));

  // 每个厅取最优一条：active assignment 优先，都是 ended 则取 createdAt 最晚的（对应最后生效的任务）
  const hallRecordMap = new Map<string, typeof records[number]>();
  for (const rec of records) {
    const existing = hallRecordMap.get(rec.hallOrgId);
    if (!existing) {
      hallRecordMap.set(rec.hallOrgId, rec);
    } else if (rec.assignment.status === "active" && existing.assignment.status !== "active") {
      hallRecordMap.set(rec.hallOrgId, rec);
    } else if (rec.assignment.status !== "active" && existing.assignment.status !== "active"
      && rec.createdAt > existing.createdAt) {
      hallRecordMap.set(rec.hallOrgId, rec);
    }
  }

  // ④ 返回全量厅列表（有任务的含进度，无任务的 hasTask=false）
  const result = allTeamHalls.map((hall) => {
    const hasTask = assignedHallIds.has(hall.id);
    const rec = hasTask ? hallRecordMap.get(hall.id) : undefined;
    return {
      hallOrgId: hall.id,
      hallOrgName: hall.name,
      hasTask,
      status: resolveHallDailyReportStatus(rec, taskDate, now),
      totalItems: rec?.totalItems ?? 0,
      doneItems: rec?.doneItems ?? 0,
      completionRate: rec?.totalItems ? Math.round((rec.doneItems / rec.totalItems) * 100) : 0,
      submittedAt: rec?.submittedAt?.toISOString() ?? null,
      recordId: rec?.id ?? null,
    };
  });

  return ok(res, result);
});

// ── 厅管日常任务看板：管理员-某厅详情（只读）────────────────────────────────
reportRoutes.get("/tasks/report/hall-daily-dashboard/halls/:hallOrgId/detail", permissionRequired("task:report:view"), async (req: any, res: any) => {
  const roleCode = req.identity?.roleCode;
  const allowedAdminRoles = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"];
  if (!allowedAdminRoles.includes(roleCode)) {
    return fail(res, "HALL_DAILY_HALL_DETAIL_FORBIDDEN", "当前身份无权查看", 403);
  }

  const { hallOrgId } = req.params;
  const taskDate = t(req.query.taskDate) || formatBeijingDate(new Date());

  const hall = await prisma.orgUnit.findFirst({
    where: { id: hallOrgId, status: "active", orgType: "HALL" },
    select: { id: true, name: true, path: true, parentId: true },
  });
  if (!hall) return fail(res, "HALL_NOT_FOUND", "直播厅不存在或已停用", 404);

  // scope 校验
  const viewerScopePath = req.identity?.scopePath;
  if (viewerScopePath && roleCode !== "DEV_ADMIN") {
    const inScope = hall.path === viewerScopePath || hall.path.startsWith(`${viewerScopePath}/`);
    if (!inScope) return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权查看该直播厅", 403);
  }

  const now = new Date();
  const today = formatBeijingDate(now);
  const phase = taskDate === today
    ? (now.getTime() <= getDailyTaskDayEnd(taskDate).getTime() ? "in_progress" : "supplement")
    : (now.getTime() < getDailyTaskSupplementDeadline(taskDate).getTime() ? "supplement" : "closed");

  const records = await prisma.hallTaskRecord.findMany({
    where: {
      hallOrgId,
      recordDate: taskDate,
      assignment: { status: { in: ["active", "ended"] } },
    },
    include: {
      assignment: {
        include: {
          template: {
            include: {
              items: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, title: true, itemType: true, isRequired: true, sortOrder: true, linkUrl: true },
              },
            },
          },
        },
      },
      itemRecords: {
        orderBy: { id: "asc" },
        include: {
          attachments: {
            select: { id: true, fileName: true, fileUrl: true, fileSize: true, mimeType: true },
          },
        },
      },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // active assignment 优先；都是 ended 则取 createdAt 最晚的（对应最后生效的任务）
  const activeRecord = records.find((r) => r.assignment.status === "active")
    ?? records.reduce<typeof records[number] | null>((best, rec) => {
      if (!best) return rec;
      return rec.createdAt > best.createdAt ? rec : best;
    }, null);

  const summary = {
    status: resolveHallDailyReportStatus(activeRecord, taskDate, now),
    totalItems: activeRecord?.totalItems ?? 0,
    doneItems: activeRecord?.doneItems ?? 0,
    submittedAt: activeRecord?.submittedAt?.toISOString() ?? null,
    leaveRequest: serializeHallDailyLeaveRequest(activeRecord),
    completionRate: activeRecord?.totalItems
      ? Math.round((activeRecord.doneItems / activeRecord.totalItems) * 100)
      : 0,
  };

  return ok(res, {
    taskDate,
    phase,
    hall: { id: hall.id, name: hall.name },
    summary,
    record: activeRecord
      ? {
          id: activeRecord.id,
          assignmentId: activeRecord.assignmentId,
          status: resolveHallDailyReportStatus(activeRecord, taskDate, now),
          totalItems: activeRecord.totalItems,
          doneItems: activeRecord.doneItems,
          submittedAt: activeRecord.submittedAt?.toISOString() ?? null,
          leaveRequest: serializeHallDailyLeaveRequest(activeRecord),
          templateTitle: activeRecord.assignment.template?.title ?? null,
          items: (activeRecord.assignment.template?.items ?? []).map((item) => {
            const ir = activeRecord.itemRecords.find((r) => r.taskItemId === item.id);
            return {
              taskItemId: item.id,
              title: item.title,
              itemType: item.itemType,
              isRequired: item.isRequired,
              sortOrder: item.sortOrder,
              linkUrl: item.linkUrl ?? null,
              done: ir?.status === "done",
              doneAt: ir?.doneAt?.toISOString() ?? null,
              answerText: ir?.answerText ?? null,
              answerOptions: Array.isArray(ir?.answerOptions) ? ir.answerOptions : null,
              isLinkConfirmed: ir?.isLinkConfirmed ?? false,
              attachments: (ir?.attachments ?? []).map((a) => ({
                id: a.id,
                fileName: a.fileName,
                fileUrl: a.fileUrl,
                fileSize: a.fileSize,
                mimeType: a.mimeType,
              })),
            };
          }),
        }
      : null,
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
