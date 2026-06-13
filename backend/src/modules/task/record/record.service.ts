import { prisma } from "../../../shared/prisma.js";
import {
  assignmentDetailInclude,
  isAssignmentAnchorExcluded,
  isAssignmentOrgExcluded,
  reconcileDailyAssignments,
} from "../assignment/daily-assignment.utils.js";
import {
  getDailyTaskContext,
  getDailyTaskDayEnd,
  getDailyTaskSupplementDeadline,
  isDailyRecordCollectionClosed,
  resolveTaskRecordStatus,
} from "./daily-record-time.utils.js";

const recordInclude = {
  assignment: {
    include: {
      ...assignmentDetailInclude,
      template: { include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } } },
    },
  },
  itemRecords: { include: { attachments: true }, orderBy: { createdAt: "asc" } },
  exemption: true,
  visibleIdentityLinks: {
    include: {
      user: { select: { id: true, nickname: true, phone: true } },
      org: { select: { id: true, name: true, orgType: true } },
    },
  },
} as const;

async function ensureVisibleRecord(recordId: string, userId: string, identityId: string, include?: any) {
  const record = await prisma.taskRecord.findFirst({
    where: {
      id: recordId,
      OR: [
        { visibleIdentityLinks: { some: { identityId } } },
        { userId },
      ],
    },
    ...(include ? { include } : {}),
  });
  if (!record) throw new Error("RECORD_NOT_FOUND");
  return record;
}

function canReviewDailyExemption(identity: { roleCode?: string; scopePath?: string | null }, record: { user?: { status?: string | null; identities?: Array<{ scopePath?: string | null; roleCode?: string | null }> | null } | null }) {
  if (!identity.roleCode || !["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"].includes(identity.roleCode)) return false;
  if (identity.roleCode === "DEV_ADMIN") return true;
  const targetScopePaths = (record.user?.identities ?? []).map((item) => item.scopePath).filter((value): value is string => Boolean(value));
  if (!targetScopePaths.length || !identity.scopePath) return false;
  return targetScopePaths.some((scopePath) => scopePath === identity.scopePath || scopePath.startsWith(`${identity.scopePath}/`));
}

async function ensureIdentityLink(taskRecordId: string, identity: { id: string; userId: string; roleCode: string; orgId?: string | null; anchorProfileId?: string | null }) {
  await prisma.taskRecordIdentityLink.upsert({
    where: { taskRecordId_identityId: { taskRecordId, identityId: identity.id } },
    update: { userId: identity.userId, roleCode: identity.roleCode, orgId: identity.orgId ?? null, anchorProfileId: identity.anchorProfileId ?? null },
    create: {
      taskRecordId,
      identityId: identity.id,
      userId: identity.userId,
      roleCode: identity.roleCode,
      orgId: identity.orgId ?? null,
      anchorProfileId: identity.anchorProfileId ?? null,
    },
  });
}

function canSupplementSubmitted(record: { subjectType: string; assignment?: { category?: string } | null }) {
  return record.assignment?.category === "TEMPORARY" && record.subjectType === "ORG";
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

async function enrichRecordDisplay(records: any[]) {
  const assignmentCreatorIdentityIds = records
    .map((record) => record.assignment?.createdByIdentityId)
    .filter((value): value is string => Boolean(value));
  const lastSubmittedIdentityIds = records
    .map((record) => record.lastSubmittedByIdentityId)
    .filter((value): value is string => Boolean(value));
  const itemCompletedIdentityIds = records
    .flatMap((record) => (record.itemRecords ?? []).map((item: any) => item.completedByIdentityId))
    .filter((value): value is string => Boolean(value));
  const identityLabelMap = await loadIdentityLabelMap([...assignmentCreatorIdentityIds, ...lastSubmittedIdentityIds, ...itemCompletedIdentityIds]);

  return records.map((record) => {
    const publisherIdentity = record.assignment?.createdByIdentityId ? identityLabelMap.get(record.assignment.createdByIdentityId) : null;
    const lastSubmittedIdentity = record.lastSubmittedByIdentityId ? identityLabelMap.get(record.lastSubmittedByIdentityId) : null;
    return {
      ...record,
      assignment: record.assignment
        ? {
            ...record.assignment,
            publisher: {
              label: publisherIdentity?.nickname ?? record.assignment.createdByIdentityId ?? record.assignment.createdBy ?? null,
              nickname: publisherIdentity?.nickname ?? null,
              phone: publisherIdentity?.phone ?? null,
            },
          }
        : record.assignment,
      lastSubmittedByName: lastSubmittedIdentity?.nickname ?? null,
      visibleIdentityLinks: (record.visibleIdentityLinks ?? []).map((link: any) => ({
        ...link,
        userName: link.user?.nickname ?? null,
        userPhone: link.user?.phone ?? null,
        orgName: link.org?.name ?? null,
        orgType: link.org?.orgType ?? null,
      })),
      itemRecords: (record.itemRecords ?? []).map((item: any) => ({
        ...item,
        completedByName: item.completedByIdentityId ? (identityLabelMap.get(item.completedByIdentityId)?.nickname ?? item.completedByIdentityId) : null,
      })),
    };
  });
}

function buildDailySubjectKey(userId: string) {
  return `USER:${userId}`;
}

function applyEffectiveStatus<T extends { assignment?: { category?: string | null } | null; recordDate?: string | null; doneItems: number; status: string }>(record: T, now = new Date()) {
  return {
    ...record,
    status: resolveTaskRecordStatus(record, now),
  };
}

function sortRecords(records: any[]) {
  return records.sort((left, right) => {
    const leftDeadline = new Date(left.deadlineAt).getTime();
    const rightDeadline = new Date(right.deadlineAt).getTime();
    if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function isAssignmentEffectiveAt(assignment: { effectiveAt?: Date | null; endedAt?: Date | null }, at: Date) {
  if (!assignment.effectiveAt) return false;
  const effectiveAt = new Date(assignment.effectiveAt).getTime();
  const endedAt = assignment.endedAt ? new Date(assignment.endedAt).getTime() : Number.POSITIVE_INFINITY;
  return effectiveAt <= at.getTime() && endedAt > at.getTime();
}

function matchesDailyAssignment(
  assignment: any,
  identity: { scopePath?: string | null; roleCode: string; anchorProfileId?: string | null }
) {
  const isInScope = assignment.targets.some((target: { orgPathSnapshot: string }) => {
    if (!identity.scopePath) return false;
    return identity.scopePath.startsWith(target.orgPathSnapshot) || target.orgPathSnapshot.startsWith(identity.scopePath);
  });
  const adminLevels = (assignment.targetAdminLevels as string[]) ?? [];
  const roleMatch = assignment.targetRoleType === identity.roleCode || adminLevels.includes(identity.roleCode);
  const orgExcluded = isAssignmentOrgExcluded(identity.scopePath ?? undefined, assignment.exclusions ?? []);
  const anchorExcluded = isAssignmentAnchorExcluded(identity.anchorProfileId ?? undefined, assignment.exclusions ?? []);
  return isInScope && roleMatch && !orgExcluded && !anchorExcluded;
}

function pickDailyAssignment(assignments: any[], identity: { scopePath?: string | null; roleCode: string; anchorProfileId?: string | null }, at: Date) {
  return assignments.find((assignment) => isAssignmentEffectiveAt(assignment, at) && matchesDailyAssignment(assignment, identity)) ?? null;
}

async function ensureDailyRecordForDate(data: {
  assignment: any;
  user: { id: string; nickname?: string | null };
  identity: { id: string; userId: string; roleCode: string; orgId?: string | null; anchorProfileId?: string | null };
  recordDate: string;
}) {
  const { assignment, user, identity, recordDate } = data;
  const subjectKey = buildDailySubjectKey(user.id);
  let record = await prisma.taskRecord.findFirst({
    where: { assignmentId: assignment.id, subjectKey, recordDate },
  });
  if (!record) {
    record = await prisma.taskRecord.create({
      data: {
        assignmentId: assignment.id,
        userId: user.id,
        identityId: identity.id,
        subjectType: "USER",
        subjectKey,
        subjectUserId: user.id,
        subjectName: user.nickname,
        templateVersion: assignment.templateVersion ?? assignment.template.version,
        recordDate,
        deadlineAt: getDailyTaskSupplementDeadline(recordDate),
        status: "pending",
        totalItems: assignment.template.items.length,
        doneItems: 0,
      },
    });
  }
  await ensureIdentityLink(record.id, identity);
  const fullRecord = await prisma.taskRecord.findUnique({ where: { id: record.id }, include: recordInclude });
  if (!fullRecord) throw new Error("RECORD_NOT_FOUND");
  return fullRecord;
}

function ensureDailyRecordEditable(record: { assignment?: { category?: string | null; status?: string | null } | null; recordDate?: string | null }, now = new Date()) {
  if (record.assignment?.category !== "DAILY") return;
  if (!record.recordDate) throw new Error("INVALID_RECORD_DATE");

  const context = getDailyTaskContext(now);
  if (record.recordDate === context.today) {
    if (record.assignment?.status !== "active") throw new Error("DAILY_RECORD_INACTIVE");
    return;
  }

  if (record.recordDate === context.yesterday && !isDailyRecordCollectionClosed(record.recordDate, now) && now.getTime() > getDailyTaskDayEnd(record.recordDate).getTime()) {
    return;
  }

  throw new Error("DAILY_RECORD_COLLECTION_CLOSED");
}

function resolveNextRecordStatus(record: { assignment?: { category?: string | null } | null; recordDate?: string | null }, doneItems: number, now = new Date()) {
  if (record.assignment?.category === "DAILY" && record.recordDate) {
    return resolveTaskRecordStatus({ assignment: record.assignment, recordDate: record.recordDate, doneItems, status: "pending" }, now);
  }
  return doneItems > 0 ? "in_progress" : "pending";
}

function itemRecordTextSnapshot(itemRecord?: { answerText?: string | null } | null) {
  if (!itemRecord?.answerText) return "";
  return itemRecord.answerText.endsWith("\n") ? itemRecord.answerText : `${itemRecord.answerText}\n`;
}

function isManagerContributionRecord(record: {
  subjectType?: string | null;
  assignment?: { category?: string | null; temporaryMode?: string | null } | null;
}) {
  return record.assignment?.category === "TEMPORARY" && record.assignment?.temporaryMode === "MANAGER" && record.subjectType === "ORG";
}

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

function getIncompleteRequiredItems(record: {
  assignment?: { template?: { items?: Array<{ id: string; isRequired?: boolean | null }> | null } | null } | null;
  itemRecords?: Array<{ taskItemId: string; status: string }> | null;
}) {
  const requiredItems = record.assignment?.template?.items?.filter((item) => item.isRequired) ?? [];
  return requiredItems.filter((item) => record.itemRecords?.find((entry) => entry.taskItemId === item.id)?.status !== "done");
}

async function buildManagerContributionSnapshot(recordId: string) {
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
      visibleIdentityLinks: {
        include: {
          user: { select: { id: true, nickname: true, phone: true } },
          org: { select: { id: true, name: true, orgType: true } },
        },
      },
      itemRecords: { include: { attachments: true } },
      exemption: true,
      user: { select: { id: true, nickname: true, phone: true, status: true } },
    },
  });
  if (!record) return null;
  const enriched = (await enrichRecordDisplay([record]))[0] ?? null;
  if (!enriched || !isManagerContributionRecord(enriched)) return enriched;
  const identityIds = parseContributionLines((enriched.itemRecords ?? []).map((item: any) => item.answerText ?? "").join("\n")).map((entry) => entry.identityId);
  const identityLabelMap = await loadIdentityLabelMap(identityIds);
  return {
    ...enriched,
    itemContributionSummaries: (enriched.assignment?.template?.items ?? []).map((item: any) => {
      const itemRecord = (enriched.itemRecords ?? []).find((entry: any) => entry.taskItemId === item.id);
      const contributions = parseContributionLines(itemRecord?.answerText).map((entry) => ({
        identityId: entry.identityId,
        userId: entry.userId,
        createdAt: entry.createdAt,
        content: entry.content,
        contributorName: identityLabelMap.get(entry.identityId)?.nickname ?? entry.identityId,
        contributorPhone: identityLabelMap.get(entry.identityId)?.phone ?? null,
      }));
      return {
        taskItemId: item.id,
        contributions,
      };
    }),
  };
}

function ensureRecordReadyForSubmit(record: {
  assignment?: { template?: { items?: Array<{ id: string; isRequired?: boolean | null }> | null } | null } | null;
  itemRecords?: Array<{ taskItemId: string; status: string }> | null;
}) {
  if (getIncompleteRequiredItems(record).length > 0) throw new Error("REQUIRED_ITEMS_INCOMPLETE");
}

async function reconcileTemporaryAssignments(now = new Date()) {
  await prisma.taskAssignment.updateMany({
    where: {
      category: "TEMPORARY",
      status: "active",
      isActive: true,
      deletedAt: null,
      deadlineAt: { not: null, lte: now },
    },
    data: {
      status: "ended",
      isActive: false,
      endedAt: now,
    },
  });
}

export const RecordService = {

  async getMyRecords(userId: string, identityId: string, scopePath?: string, _roleCode?: string) {
    await reconcileDailyAssignments(scopePath);
    await reconcileTemporaryAssignments();

    const user = await prisma.user.findFirst({ where: { id: userId, status: "active" } });
    if (!user) return [];

    const identity = await prisma.userIdentity.findFirst({
      where: { id: identityId, userId, status: "active" },
      select: { id: true, userId: true, scopePath: true, roleCode: true, anchorProfileId: true, orgId: true },
    });
    if (!identity) return [];

    // 若当前身份不是 ANCHOR，额外查该账号下所有活跃 ANCHOR 身份，融通主播日常任务
    const anchorIdentities = identity.roleCode === "ANCHOR"
      ? []
      : await prisma.userIdentity.findMany({
          where: { userId, roleCode: "ANCHOR", status: "active", id: { not: identityId } },
          select: { id: true, userId: true, scopePath: true, roleCode: true, anchorProfileId: true, orgId: true },
        });

    const identitiesToCheck = [identity, ...anchorIdentities];

    const now = new Date();
    const context = getDailyTaskContext(now);
    const dailyAssignments = await prisma.taskAssignment.findMany({
      where: {
        category: "DAILY",
        status: { in: ["scheduled", "active", "ended"] },
        deletedAt: null,
      },
      include: {
        targets: true,
        exclusions: true,
        template: { include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } } },
      },
      orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    });

    const dailyRecords: any[] = [];
    for (const idt of identitiesToCheck) {
      const todayAssignment = pickDailyAssignment(dailyAssignments, idt, now);
      if (todayAssignment) {
        const todayRecord = await ensureDailyRecordForDate({
          assignment: todayAssignment,
          user,
          identity: idt,
          recordDate: context.today,
        });
        dailyRecords.push(applyEffectiveStatus(todayRecord, now));
      }

      if (context.canSupplementYesterday) {
        const yesterdayAssignment = pickDailyAssignment(dailyAssignments, idt, getDailyTaskDayEnd(context.yesterday));
        if (yesterdayAssignment) {
          const yesterdayRecord = await ensureDailyRecordForDate({
            assignment: yesterdayAssignment,
            user,
            identity: idt,
            recordDate: context.yesterday,
          });
          const effectiveYesterdayRecord = applyEffectiveStatus(yesterdayRecord, now);
          if (effectiveYesterdayRecord.status !== "submitted") {
            dailyRecords.push(effectiveYesterdayRecord);
          }
        }
      }
    }

    // 额外查该账号下所有活跃管理身份（无论当前登录身份是何角色），融通管理式临时任务
    const managerRoleCodes = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"];
    const managerIdentities = await prisma.userIdentity.findMany({
      where: { userId, roleCode: { in: managerRoleCodes }, status: "active", id: { not: identityId } },
      select: { id: true },
    });

    const allIdentityIds = [identityId, ...anchorIdentities.map((i) => i.id), ...managerIdentities.map((i) => i.id)];
    const tempRecords = await prisma.taskRecord.findMany({
      where: {
        recordDate: null,
        assignment: { category: "TEMPORARY", isActive: true },
        OR: [
          { visibleIdentityLinks: { some: { identityId: { in: allIdentityIds } } } },
          { AND: [{ visibleIdentityLinks: { none: {} } }, { userId }] },
        ],
      },
      include: recordInclude,
    });

    const enrichedTemporaryRecords = await enrichRecordDisplay(tempRecords.map((record) => applyEffectiveStatus(record, now)));
    return sortRecords([
      ...dailyRecords.filter((record, index, list) => list.findIndex((entry) => entry.id === record.id) === index),
      ...enrichedTemporaryRecords,
    ]);
  },

  async getRecord(recordId: string, userId: string, identityId: string) {
    const enriched = await enrichRecordDisplay([applyEffectiveStatus(await ensureVisibleRecord(recordId, userId, identityId, recordInclude))]);
    return enriched[0];
  },

  async getById(recordId: string, userId: string, identityId: string) {
    await ensureVisibleRecord(recordId, userId, identityId);
    return await buildManagerContributionSnapshot(recordId);
  },

  async submitItemRecord(data: {
    taskRecordId: string;
    taskItemId: string;
    userId: string;
    identityId: string;
    answerText?: string;
    answerOptions?: string[];
    isLinkConfirmed?: boolean;
    done: boolean;
  }) {
    const now = new Date();
    const record = await ensureVisibleRecord(data.taskRecordId, data.userId, data.identityId, {
      assignment: { select: { category: true, status: true } },
    });
    const effectiveStatus = resolveTaskRecordStatus(record, now);
    if (effectiveStatus === "submitted" && !canSupplementSubmitted(record)) throw new Error("RECORD_SUBMITTED");
    ensureDailyRecordEditable(record, now);

    const user = await prisma.user.findFirst({ where: { id: data.userId, status: "active" } });
    if (!user) throw new Error("USER_INACTIVE");

    const keepSubmitted = effectiveStatus === "submitted" && canSupplementSubmitted(record);
    const nextDone = keepSubmitted ? true : data.done;
    const isManagerContribution = keepSubmitted && isManagerContributionRecord(record);
    const contributionPrefix = `[${data.identityId}|${data.userId}|${now.toISOString()}] `;
    const mergedAnswerText = isManagerContribution && data.answerText?.trim()
      ? `${itemRecordTextSnapshot(await prisma.taskItemRecord.findUnique({ where: { taskRecordId_taskItemId: { taskRecordId: data.taskRecordId, taskItemId: data.taskItemId } } }))}${contributionPrefix}${data.answerText.trim()}\n`
      : data.answerText ?? null;
    const itemRecord = await prisma.taskItemRecord.upsert({
      where: { taskRecordId_taskItemId: { taskRecordId: data.taskRecordId, taskItemId: data.taskItemId } },
      update: {
        status: nextDone ? "done" : "pending",
        answerText: mergedAnswerText,
        answerOptions: data.answerOptions ? (data.answerOptions as any) : null,
        isLinkConfirmed: data.isLinkConfirmed ?? false,
        doneAt: nextDone ? new Date() : null,
        completedByUserId: nextDone ? data.userId : null,
        completedByIdentityId: nextDone ? data.identityId : null,
        updatedAt: new Date(),
      },
      create: {
        taskRecordId: data.taskRecordId,
        taskItemId: data.taskItemId,
        status: nextDone ? "done" : "pending",
        answerText: mergedAnswerText,
        answerOptions: data.answerOptions ? (data.answerOptions as any) : null,
        isLinkConfirmed: data.isLinkConfirmed ?? false,
        doneAt: nextDone ? new Date() : null,
        completedByUserId: nextDone ? data.userId : null,
        completedByIdentityId: nextDone ? data.identityId : null,
      },
    });

    const doneCount = await prisma.taskItemRecord.count({ where: { taskRecordId: data.taskRecordId, status: "done" } });
    const submitted = keepSubmitted || doneCount >= record.totalItems;
    await prisma.taskRecord.update({
      where: { id: data.taskRecordId },
      data: {
        doneItems: doneCount,
        status: submitted ? "submitted" : resolveNextRecordStatus(record, doneCount, now),
        submittedAt: submitted ? record.submittedAt ?? new Date() : null,
        lastSubmittedByUserId: submitted ? data.userId : null,
        lastSubmittedByIdentityId: submitted ? data.identityId : null,
        lastSubmittedAt: submitted ? new Date() : null,
      },
    });

    if (isManagerContributionRecord(record)) {
      return (await buildManagerContributionSnapshot(data.taskRecordId)) ?? itemRecord;
    }
    return itemRecord;
  },

  async submitRecord(recordId: string, userId: string, identityId: string) {
    const now = new Date();
    const record = await ensureVisibleRecord(recordId, userId, identityId, {
      assignment: {
        select: {
          category: true,
          status: true,
          template: {
            select: {
              items: {
                select: {
                  id: true,
                  isRequired: true,
                },
              },
            },
          },
        },
      },
      itemRecords: {
        select: {
          taskItemId: true,
          status: true,
        },
      },
    });
    const effectiveStatus = resolveTaskRecordStatus(record, now);
    if (effectiveStatus === "submitted" && !canSupplementSubmitted(record)) throw new Error("RECORD_SUBMITTED");
    ensureDailyRecordEditable(record, now);
    ensureRecordReadyForSubmit(record as any);

    const user = await prisma.user.findFirst({ where: { id: userId, status: "active" } });
    if (!user) throw new Error("USER_INACTIVE");
    return prisma.taskRecord.update({
      where: { id: recordId },
      data: {
        status: "submitted",
        submittedAt: record.submittedAt ?? new Date(),
        lastSubmittedByUserId: userId,
        lastSubmittedByIdentityId: identityId,
        lastSubmittedAt: new Date(),
      },
    });
  },


  async applyExemption(taskRecordId: string, userId: string, identityId: string, reason: string) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error("EXEMPTION_REASON_REQUIRED");
    const record = await ensureVisibleRecord(taskRecordId, userId, identityId, {
      assignment: { select: { category: true } },
      exemption: true,
      user: { select: { id: true, status: true } },
    });
    const recordAny = record as any;
    if (recordAny.assignment?.category !== "DAILY" || !recordAny.recordDate) throw new Error("EXEMPTION_DAILY_ONLY");
    if (recordAny.status === "submitted") throw new Error("EXEMPTION_COMPLETED_FORBIDDEN");
    if (recordAny.exemption?.status === "pending" || recordAny.exemption?.status === "approved") throw new Error("EXEMPTION_EXISTS");

    return prisma.taskExemption.upsert({
      where: { taskRecordId },
      update: {
        reason: normalizedReason,
        status: "pending",
        userId,
        reviewedBy: null,
        reviewedAt: null,
      },
      create: { taskRecordId, userId, reason: normalizedReason, status: "pending" },
    });
  },

  async cancelExemption(taskRecordId: string, userId: string, identityId: string) {
    await ensureVisibleRecord(taskRecordId, userId, identityId);
    const existing = await prisma.taskExemption.findUnique({ where: { taskRecordId } });
    if (!existing) throw new Error("EXEMPTION_NOT_FOUND");
    if (!["pending", "approved"].includes(existing.status)) throw new Error("EXEMPTION_REVIEWED");
    await prisma.taskExemption.delete({ where: { id: existing.id } });
    return { cancelled: true, taskRecordId };
  },

  async reviewExemption(exemptionId: string, approved: boolean, reviewerId: string, identity: { roleCode?: string; scopePath?: string | null }) {
    const exemption = await prisma.taskExemption.findUnique({
      where: { id: exemptionId },
      include: {
        taskRecord: {
          include: {
            assignment: { select: { category: true } },
            user: { select: { id: true, status: true, identities: { select: { scopePath: true, roleCode: true } } } },
          },
        },
      },
    });
    if (!exemption) throw new Error("EXEMPTION_NOT_FOUND");
    if (exemption.status !== "pending") throw new Error("EXEMPTION_REVIEWED");
    if (exemption.taskRecord?.assignment?.category !== "DAILY") throw new Error("EXEMPTION_DAILY_ONLY");
    if (!canReviewDailyExemption(identity, exemption.taskRecord ?? {})) throw new Error("EXEMPTION_REVIEW_FORBIDDEN");

    return prisma.taskExemption.update({
      where: { id: exemptionId },
      data: {
        status: approved ? "approved" : "rejected",
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
  },

  async listExemptions(scopePath?: string, roleCode?: string, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (roleCode !== "DEV_ADMIN" && scopePath) {
      where.taskRecord = {
        user: {
          identities: {
            some: { scopePath: { startsWith: scopePath } },
          },
        },
      };
    }
    return prisma.taskExemption.findMany({
      where,
      include: {
        taskRecord: {
          include: {
            assignment: { include: { template: { select: { title: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },
};
