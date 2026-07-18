import { prisma } from "../../../shared/prisma.js";
import {
  assignmentDetailInclude,
  assignmentListInclude,
  endOtherActiveDailyAssignments,
  ensureTemplatePublished,
  isAssignmentAnchorExcluded,
  isAssignmentOrgExcluded,
  nextMidnight,
  parseDateTime,
  reconcileDailyAssignments,
  replaceAssignmentExclusions,
  replaceAssignmentTargets,
} from "./daily-assignment.utils.js";
import {
  buildTemporaryPreview,
  buildTemporarySubjectGroups,
  listTemporaryManagerOrgsWithoutManagers,
  normalizeTemporaryDraftInput,
  resolveTemporaryMode,
  resolveTemporaryRoleCodes,
  resolveTemporaryTargetUserIds,
} from "./temporary-assignment.utils.js";

type AssignmentScopeContext = {
  scopePath?: string;
  roleCode?: string;
  scopeOrgId?: string;
  userId?: string;
  identityId?: string;
};

function normalizeTemplateItems(items: any[] = []) {
  return items.map((item, index) => ({
    sortOrder: item.sortOrder ?? index,
    itemType: item.itemType,
    title: item.title,
    isRequired: Boolean(item.isRequired),
    linkUrl: item.linkUrl ?? null,
    options: (item.options ?? []).map((option: any, optionIndex: number) => ({
      sortOrder: option.sortOrder ?? optionIndex,
      label: option.label,
    })),
  }));
}

async function duplicateDailyTemplateAsDraft(tx: any, templateId: string, createdBy: string) {
  const source = await tx.taskTemplate.findUnique({
    where: { id: templateId },
    include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!source) throw new Error("TEMPLATE_NOT_FOUND");
  const normalizedItems = normalizeTemplateItems(source.items ?? []);
  return tx.taskTemplate.create({
    data: {
      title: `${source.title}（副本）`,
      description: source.description,
      category: source.category,
      orgId: source.orgId,
      createdBy,
      version: 1,
      status: "draft",
      items: {
        create: normalizedItems.map((item) => ({
          sortOrder: item.sortOrder,
          itemType: item.itemType,
          title: item.title,
          isRequired: item.isRequired,
          linkUrl: item.linkUrl,
          options: item.options.length
            ? { create: item.options.map((option: any) => ({ sortOrder: option.sortOrder, label: option.label })) }
            : undefined,
        })),
      },
    },
  });
}

async function buildScopeWhere(scopePath?: string, roleCode?: string) {
  if (!scopePath || roleCode === "DEV_ADMIN") return {};
  const orgs = await prisma.orgUnit.findMany({
    where: { path: { startsWith: scopePath } },
    select: { id: true },
  });
  return { createdByOrgId: { in: orgs.map((org: { id: string }) => org.id) } };
}

function dedupe(values: string[] = []) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function resolveTargetRoleType(mode: string) {
  if (mode === "ANCHOR") return "ANCHOR";
  if (mode === "MANAGER") return "ADMIN";
  return "ACCOUNT";
}

const temporaryAssignmentDetailInclude = {
  template: { include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } } },
  targets: { include: { org: true } },
  exclusions: { include: { anchorProfile: { include: { hallOrg: true, identities: { include: { user: true } } } } } },
  _count: { select: { records: true } },
} as const;

export async function reconcileTemporaryAssignments(now = new Date()) {
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

async function replaceTargets(tx: any, assignmentId: string, orgIds: string[] = []) {
  await tx.taskAssignmentTarget.deleteMany({ where: { assignmentId } });
  const ids = dedupe(orgIds);
  if (!ids.length) return;
  const orgs = await tx.orgUnit.findMany({ where: { id: { in: ids } }, select: { id: true, path: true } });
  if (!orgs.length) return;
  await tx.taskAssignmentTarget.createMany({
    data: orgs.map((org: { id: string; path: string }) => ({
      assignmentId,
      orgId: org.id,
      orgPathSnapshot: org.path,
    })),
  });
}

async function replaceExclusions(tx: any, assignmentId: string, excludedOrgIds: string[] = [], excludedAnchorProfileIds: string[] = []) {
  await tx.taskAssignmentExclusion.deleteMany({ where: { assignmentId } });
  const orgRows = dedupe(excludedOrgIds).map((orgId) => ({ assignmentId, exclusionType: "ORG", orgId }));
  const anchorRows = dedupe(excludedAnchorProfileIds).map((anchorProfileId) => ({ assignmentId, exclusionType: "ANCHOR", anchorProfileId }));
  const rows = [...orgRows, ...anchorRows];
  if (!rows.length) return;
  await tx.taskAssignmentExclusion.createMany({ data: rows });
}

async function getTemporaryAssignmentById(tx: any, id: string) {
  return tx.taskAssignment.findUnique({
    where: { id },
    include: temporaryAssignmentDetailInclude,
  });
}

function assertTemporaryOwnership(assignment: any, context: AssignmentScopeContext) {
  if (context.scopeOrgId && assignment.createdByOrgId !== context.scopeOrgId) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (assignment.createdByIdentityId) {
    if (!context.identityId || assignment.createdByIdentityId !== context.identityId) throw new Error("TEMP_ASSIGNMENT_OWNER_REQUIRED");
    return;
  }
  if (!context.userId || assignment.createdBy !== context.userId) throw new Error("TEMP_ASSIGNMENT_OWNER_REQUIRED");
}

async function createTemporaryAssignment(data: any) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.taskTemplate.findUnique({ where: { id: data.templateId } });
    if (!template) throw new Error("TEMPLATE_NOT_FOUND");
    if (template.status !== "published") throw new Error("TEMPLATE_NOT_PUBLISHED");
    const assignment = await tx.taskAssignment.create({
      data: {
        templateId: data.templateId,
        templateVersion: template.version,
        category: data.category,
        status: "active",
        ownerScopePath: data.ownerScopePath ?? null,
        targetRoleType: data.targetRoleType,
        targetAdminLevels: data.targetAdminLevels ?? undefined,
        deadlineAt: data.deadlineAt ? new Date(data.deadlineAt) : null,
        deadlinePolicy: data.deadlinePolicy ?? null,
        isActive: true,
        effectiveAt: new Date(),
        publishedAt: new Date(),
        createdBy: data.createdBy,
        createdByOrgId: data.createdByOrgId,
      },
    });
    await replaceAssignmentTargets(tx, assignment.id, data.orgIds);
    await generateTemporaryRecords(tx, assignment.id);
    return tx.taskAssignment.findUnique({ where: { id: assignment.id }, include: assignmentDetailInclude });
  });
}

async function listReusableDailyDrafts(tx: any, data: any) {
  return tx.taskAssignment.findMany({
    where: {
      category: "DAILY",
      status: "draft",
      createdBy: data.createdBy,
      createdByOrgId: data.createdByOrgId,
      ownerScopePath: data.ownerScopePath ?? null,
    },
    select: { id: true, templateId: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

async function cleanupDuplicateDailyDrafts(tx: any, keepId: string, draftIds: string[]) {
  const duplicateIds = draftIds.filter((id) => id !== keepId);
  if (!duplicateIds.length) return;
  await tx.taskAssignmentExclusion.deleteMany({ where: { assignmentId: { in: duplicateIds } } });
  await tx.taskAssignmentTarget.deleteMany({ where: { assignmentId: { in: duplicateIds } } });
  await tx.taskAssignment.deleteMany({ where: { id: { in: duplicateIds } } });
}

async function saveTemporaryDraft(data: any) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.taskTemplate.findUnique({ where: { id: data.templateId } });
    if (!template) throw new Error("TEMPLATE_NOT_FOUND");
    if (template.category !== "TEMPORARY") throw new Error("TEMPLATE_CATEGORY_MISMATCH");
    if (template.status === "archived") throw new Error("TEMPLATE_ARCHIVED");

    const normalized = normalizeTemporaryDraftInput(data);
    const payloadBase = {
      category: "TEMPORARY" as const,
      status: "draft" as const,
      ownerScopePath: data.currentScopePath ?? data.ownerScopePath ?? null,
      createdBy: data.createdBy,
      createdByOrgId: data.scopeOrgId ?? data.createdByOrgId,
      createdByIdentityId: data.createdByIdentityId ?? null,
      targetRoleType: resolveTargetRoleType(normalized.mode),
      targetAdminLevels: normalized.mode === "MANAGER" ? normalized.targetRoleCodes.filter((role) => role !== "ANCHOR") : undefined,
      targetRoleCodes: normalized.mode === "ACCOUNT" ? [] : normalized.targetRoleCodes,
      targetUserIds: normalized.mode === "ACCOUNT" ? normalized.targetUserIds : [],
      temporaryMode: normalized.mode,
      temporarySubjectOrgType: normalized.mode === "MANAGER" ? normalized.subjectOrgType : null,
      deadlineAt: normalized.deadlineAt ?? null,
      deadlinePolicy: null,
      preDeadlineConfirmEnabled: normalized.preDeadlineConfirmEnabled === true,
      isActive: false,
    };

    let assignmentId = normalized.assignmentId;
    if (assignmentId) {
      const existing = await tx.taskAssignment.findUnique({ where: { id: assignmentId } });
      if (!existing) throw new Error("ASSIGNMENT_NOT_FOUND");
      if (existing.category !== "TEMPORARY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
      if (existing.status !== "draft") throw new Error("ASSIGNMENT_NOT_DRAFT");
      await tx.taskAssignment.update({ where: { id: assignmentId }, data: { ...payloadBase, templateId: data.templateId } });
    } else {
      const created = await tx.taskAssignment.create({ data: { ...payloadBase, templateId: data.templateId } });
      assignmentId = created.id;
    }

    const currentScopePath = data.currentScopePath as string | undefined;
    if (currentScopePath && (normalized.orgIds ?? []).length > 0) {
      const targetOrgs = await tx.orgUnit.findMany({
        where: { id: { in: normalized.orgIds } },
        select: { id: true, path: true },
      });
      // ANCHOR 模式：orgIds 是基地级别的范围锚点，TEAM_ADMIN 的 scopePath 在基地之下，
      // 因此允许 org.path 是 currentScopePath 的祖先（currentScopePath startsWith org.path）
      // 或者 org.path 在 currentScopePath 范围之内（org.path startsWith currentScopePath）
      const outOfScope = targetOrgs.filter((org: { id: string; path: string }) => {
        const isAncestor = currentScopePath.startsWith(`${org.path}/`) || currentScopePath === org.path;
        const isDescendant = org.path.startsWith(`${currentScopePath}/`) || org.path === currentScopePath;
        return !isAncestor && !isDescendant;
      });
      if (outOfScope.length > 0) throw new Error("ASSIGNMENT_TARGETS_OUT_OF_SCOPE");
    }

    await replaceTargets(tx, assignmentId, normalized.orgIds ?? []);
    await replaceExclusions(tx, assignmentId, normalized.excludedOrgIds ?? [], normalized.excludedAnchorProfileIds ?? []);
    return getTemporaryAssignmentById(tx, assignmentId);
  });
}

async function getTemporaryPublishPreview(id: string, userId?: string, identityId?: string, _scopePath?: string, _roleCode?: string, scopeOrgId?: string) {
  await reconcileTemporaryAssignments();
  const assignment = await prisma.taskAssignment.findUnique({
    where: { id },
    include: { targets: true, exclusions: true },
  });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (assignment.category !== "TEMPORARY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
  assertTemporaryOwnership(assignment, { scopeOrgId, userId, identityId });
  const groups = await buildTemporarySubjectGroups(prisma, assignment);
  if (!groups.length) throw new Error("TEMP_ASSIGNMENT_AUDIENCE_EMPTY");
  const missingManagerOrgs = await listTemporaryManagerOrgsWithoutManagers(prisma, assignment);
  return {
    assignmentId: assignment.id,
    mode: resolveTemporaryMode(assignment),
    targetRoleCodes: resolveTemporaryRoleCodes(assignment),
    targetUserIds: resolveTemporaryTargetUserIds(assignment),
    subjectOrgType: assignment.temporarySubjectOrgType ?? null,
    deadlineAt: assignment.deadlineAt,
    missingManagerOrgs,
    ...buildTemporaryPreview(groups),
  };
}

async function generateTemporaryRecords(tx: any, assignmentId: string) {
  const assignment = await tx.taskAssignment.findUnique({
    where: { id: assignmentId },
    include: { targets: true, exclusions: true },
  });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");

  const deadline = assignment.deadlineAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const itemCount = await tx.taskItem.count({ where: { templateId: assignment.templateId } });
  const groups = await buildTemporarySubjectGroups(tx, assignment);
  if (!groups.length) return;

  for (const group of groups) {
    const preferredIdentity = group.visibleIdentities.find((identity) => identity.id === group.preferredIdentityId) ?? group.visibleIdentities[0];
    if (!preferredIdentity) continue;

    const createPayload = {
      assignmentId: assignment.id,
      userId: group.subjectType === "USER" ? group.subjectUserId ?? preferredIdentity.userId : null,
      identityId: preferredIdentity.id,
      subjectType: group.subjectType,
      subjectKey: group.subjectKey,
      subjectUserId: group.subjectType === "USER" ? group.subjectUserId ?? preferredIdentity.userId : null,
      subjectOrgId: group.subjectType === "ORG" ? group.subjectOrgId ?? null : preferredIdentity.orgId ?? null,
      subjectName: group.subjectName,
      subjectOrgType: group.subjectType === "ORG" ? group.subjectOrgType ?? null : preferredIdentity.org?.orgType ?? null,
      templateVersion: assignment.templateVersion ?? 1,
      recordDate: null,
      deadlineAt: deadline,
      status: "pending",
      totalItems: itemCount,
      doneItems: 0,
    };

    const record = await tx.taskRecord.upsert({
      where: { assignmentId_subjectKey_recordDate: { assignmentId: assignment.id, subjectKey: group.subjectKey, recordDate: "" } },
      update: {
        deadlineAt: deadline,
        status: "pending",
        totalItems: itemCount,
        doneItems: 0,
        userId: createPayload.userId,
        identityId: createPayload.identityId,
        subjectUserId: createPayload.subjectUserId,
        subjectOrgId: createPayload.subjectOrgId,
        subjectName: createPayload.subjectName,
        subjectOrgType: createPayload.subjectOrgType,
      },
      create: createPayload,
    });

    for (const identity of group.visibleIdentities) {
      await tx.taskRecordIdentityLink.upsert({
        where: { taskRecordId_identityId: { taskRecordId: record.id, identityId: identity.id } },
        update: {
          userId: identity.userId,
          roleCode: identity.roleCode,
          orgId: identity.orgId ?? null,
          anchorProfileId: identity.anchorProfileId ?? null,
        },
        create: {
          taskRecordId: record.id,
          identityId: identity.id,
          userId: identity.userId,
          roleCode: identity.roleCode,
          orgId: identity.orgId ?? null,
          anchorProfileId: identity.anchorProfileId ?? null,
        },
      }).catch(() => undefined);
    }
  }
}

async function publishTemporaryDraft(id: string, userId?: string, identityId?: string, _scopePath?: string, _roleCode?: string, scopeOrgId?: string) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.taskAssignment.findUnique({ where: { id }, include: { targets: true, exclusions: true } });
    if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (assignment.category !== "TEMPORARY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
    assertTemporaryOwnership(assignment, { scopeOrgId, userId, identityId });
    if (assignment.status !== "draft") throw new Error("ASSIGNMENT_NOT_DRAFT");
    const groups = await buildTemporarySubjectGroups(tx, assignment);
    if (!groups.length) throw new Error("TEMP_ASSIGNMENT_AUDIENCE_EMPTY");
    const hasTargets = groups.length > 0;
    if (!hasTargets) throw new Error("ASSIGNMENT_TARGETS_REQUIRED");
    if (!assignment.deadlineAt) throw new Error("TEMP_ASSIGNMENT_DEADLINE_REQUIRED");
    const now = new Date();
    await tx.taskAssignment.update({
      where: { id },
      data: {
        publishedAt: now,
        effectiveAt: now,
        status: "active",
        isActive: true,
        deletedAt: null,
        endedAt: null,
      },
    });
    await generateTemporaryRecords(tx, id);
    return getTemporaryAssignmentById(tx, id);
  });
}

async function updateAssignment(id: string, data: any, scopePath?: string, roleCode?: string, userId?: string, identityId?: string, scopeOrgId?: string) {
  await reconcileTemporaryAssignments();
  const assignment = await prisma.taskAssignment.findUnique({ where: { id } });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");

  if (assignment.category === "TEMPORARY") {
    assertTemporaryOwnership(assignment, { scopeOrgId, userId, identityId });
    if (!data.deadlineAt) throw new Error("TEMP_ASSIGNMENT_DEADLINE_REQUIRED");
    return prisma.$transaction(async (tx) => {
      const nextDeadline = parseDateTime(data.deadlineAt);
      const reviveAssignment = assignment.status === "ended" && nextDeadline.getTime() > Date.now();
      const updated = await tx.taskAssignment.update({
        where: { id },
        data: {
          deadlineAt: nextDeadline,
          endedAt: reviveAssignment ? null : assignment.endedAt,
          isActive: assignment.status === "deleted" ? assignment.isActive : reviveAssignment ? true : assignment.isActive,
          status: assignment.status === "deleted" ? assignment.status : reviveAssignment ? "active" : assignment.status,
        },
        include: temporaryAssignmentDetailInclude,
      });
      await tx.taskRecord.updateMany({
        where: { assignmentId: id, recordDate: null, status: { in: ["pending", "in_progress"] } },
        data: { deadlineAt: nextDeadline },
      });
      const overdueRecords = await tx.taskRecord.findMany({
        where: { assignmentId: id, recordDate: null, status: "overdue" },
        select: { id: true, doneItems: true },
      });
      for (const record of overdueRecords) {
        await tx.taskRecord.update({
          where: { id: record.id },
          data: {
            deadlineAt: nextDeadline,
            status: record.doneItems > 0 ? "in_progress" : "pending",
          },
        });
      }
      return updated;
    });
  }

  return prisma.$transaction(async (tx) => {
    if (data.templateId) {
      const template = await tx.taskTemplate.findUnique({ where: { id: data.templateId } });
      if (!template) throw new Error("TEMPLATE_NOT_FOUND");
      if (template.category !== "DAILY") throw new Error("TEMPLATE_CATEGORY_MISMATCH");
      await tx.taskAssignment.update({ where: { id }, data: { templateId: data.templateId } });
    }
    if (data.orgIds?.length) await replaceAssignmentTargets(tx, id, data.orgIds);
    if (data.excludedOrgIds || data.excludedAnchorProfileIds) {
      await replaceAssignmentExclusions(tx, id, data.excludedOrgIds ?? [], data.excludedAnchorProfileIds ?? []);
    }
    if (data.effectMode && assignment.status === "draft") {
      await tx.taskAssignment.update({ where: { id }, data: { effectMode: data.effectMode } });
    }
    return tx.taskAssignment.findUnique({ where: { id }, include: assignmentDetailInclude });
  });
}

async function toggleAssignmentActive(id: string, isActive: boolean, _scopePath?: string, _roleCode?: string, userId?: string, identityId?: string, scopeOrgId?: string) {
  const assignment = await prisma.taskAssignment.findUnique({ where: { id } });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");

  if (assignment.category === "TEMPORARY") {
    assertTemporaryOwnership(assignment, { scopeOrgId, userId, identityId });
    return prisma.taskAssignment.update({
      where: { id },
      data: isActive
        ? {
            isActive: true,
            status: "active",
            deletedAt: null,
            endedAt: null,
          }
        : {
            isActive: false,
            status: "ended",
            endedAt: new Date(),
          },
      include: temporaryAssignmentDetailInclude,
    });
  }

  return prisma.$transaction(async (tx) => {
    if (!isActive) {
      return tx.taskAssignment.update({
        where: { id },
        data: { status: "ended", endedAt: new Date(), isActive: false },
      });
    }
    const targets = await tx.taskAssignmentTarget.findMany({ where: { assignmentId: id }, select: { orgId: true } });
    const targetOrgIds = targets.map((t: { orgId: string }) => t.orgId);
    await endOtherActiveDailyAssignments(tx, targetOrgIds, assignment.id, new Date());
    return tx.taskAssignment.update({
      where: { id },
      data: { status: "active", deletedAt: null, endedAt: null, isActive: true },
    });
  });
}

async function listAssignments(scopePath?: string, roleCode?: string, category?: string, scopeOrgId?: string, userId?: string, identityId?: string, status?: string, limit?: number, offset?: number) {
  await reconcileDailyAssignments(scopePath);
  await reconcileTemporaryAssignments();
  const where: any = { ...(await buildScopeWhere(scopePath, roleCode)) };
  if (category) where.category = category;
  if (scopeOrgId) {
    if (category === "DAILY") {
      where.targets = { some: { orgId: scopeOrgId } };
    } else {
      where.createdByOrgId = scopeOrgId;
    }
  }
  if (category === "TEMPORARY") {
    if (identityId) where.createdByIdentityId = identityId;
    else if (userId) where.createdBy = userId;
  }
  if (category === "DAILY") where.deletedAt = null;
  if (status) {
    const statusList = status.split(",").map((item) => item.trim()).filter(Boolean);
    if (!statusList.includes("deleted")) where.deletedAt = null;
    if (statusList.length === 1) where.status = statusList[0];
    else if (statusList.length > 1) where.status = { in: statusList };
  }
  return prisma.taskAssignment.findMany({
    where,
    include: assignmentListInclude,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    ...(typeof limit === "number" ? { take: limit } : {}),
    ...(typeof offset === "number" ? { skip: offset } : {}),
  });
}

async function getAssignmentById(id: string, _scopePath?: string, _roleCode?: string, scopeOrgId?: string, userId?: string, identityId?: string) {
  await reconcileDailyAssignments();
  await reconcileTemporaryAssignments();
  const assignment = await prisma.taskAssignment.findUnique({ where: { id }, include: assignmentDetailInclude });
  if (!assignment) return null;
  if (assignment.category === "TEMPORARY") {
    if (scopeOrgId && assignment.createdByOrgId !== scopeOrgId) return null;
    if (identityId && assignment.createdByIdentityId && assignment.createdByIdentityId !== identityId) return null;
    if (!assignment.createdByIdentityId && userId && assignment.createdBy !== userId) return null;
  }
  return assignment;
}

async function saveDailyDraft(data: any) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.taskTemplate.findUnique({ where: { id: data.templateId } });
    if (!template) throw new Error("TEMPLATE_NOT_FOUND");
    if (template.category !== "DAILY") throw new Error("TEMPLATE_CATEGORY_MISMATCH");
    if (template.status === "archived") throw new Error("TEMPLATE_ARCHIVED");
    const nextData = {
      ...data,
      createdByOrgId: data.scopeOrgId ?? data.createdByOrgId,
      ownerScopePath: data.currentScopePath ?? data.ownerScopePath ?? null,
    };
    const reusableDrafts = await listReusableDailyDrafts(tx, nextData);
    const matchedDraft = reusableDrafts.find((item: { templateId: string }) => item.templateId === nextData.templateId);
    let assignmentId = nextData.assignmentId || matchedDraft?.id;
    if (assignmentId) {
      const existing = await tx.taskAssignment.findUnique({ where: { id: assignmentId } });
      if (!existing) throw new Error("ASSIGNMENT_NOT_FOUND");
      if (existing.category !== "DAILY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
      if (existing.status !== "draft") throw new Error("ASSIGNMENT_NOT_DRAFT");
      await tx.taskAssignment.update({
        where: { id: assignmentId },
        data: {
          templateId: nextData.templateId,
          effectMode: nextData.effectMode ?? existing.effectMode,
          targetRoleType: "ANCHOR",
        },
      });
    } else {
      const created = await tx.taskAssignment.create({
        data: {
          templateId: nextData.templateId,
          category: "DAILY",
          status: "draft",
          effectMode: nextData.effectMode ?? "immediate",
          ownerScopePath: nextData.ownerScopePath ?? null,
          targetRoleType: "ANCHOR",
          deadlinePolicy: "next_day_1600",
          isActive: false,
          createdBy: nextData.createdBy,
          createdByOrgId: nextData.createdByOrgId,
        },
      });
      assignmentId = created.id;
    }
    await cleanupDuplicateDailyDrafts(tx, assignmentId, reusableDrafts.map((item: { id: string }) => item.id));
    await replaceAssignmentTargets(tx, assignmentId, nextData.orgIds);
    await replaceAssignmentExclusions(tx, assignmentId, nextData.excludedOrgIds ?? [], nextData.excludedAnchorProfileIds ?? []);
    return tx.taskAssignment.findUnique({ where: { id: assignmentId }, include: assignmentDetailInclude });
  });
}

async function publishDailyDraft(id: string, effectMode: "immediate" | "next_midnight", _scopePath?: string, _roleCode?: string, scopeOrgId?: string) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.taskAssignment.findUnique({ where: { id }, include: { targets: true } });
    if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (assignment.category !== "DAILY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
    if (scopeOrgId && assignment.createdByOrgId !== scopeOrgId) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (assignment.status !== "draft") throw new Error("ASSIGNMENT_NOT_DRAFT");
    if (!assignment.targets.length) throw new Error("ASSIGNMENT_TARGETS_REQUIRED");
    const template = await ensureTemplatePublished(tx, assignment.templateId);
    const now = new Date();
    const effectiveAt = effectMode === "next_midnight" ? nextMidnight(now) : now;
    const nextStatus = effectMode === "next_midnight" ? "scheduled" : "active";
    const targetOrgIds = assignment.targets.map((t: { orgId: string }) => t.orgId);
    if (nextStatus === "scheduled") {
      const scheduledExists = await tx.taskAssignment.findFirst({
        where: {
          category: "DAILY",
          status: "scheduled",
          id: { not: assignment.id },
          targets: { some: { orgId: { in: targetOrgIds } } },
        },
        select: { id: true },
      });
      if (scheduledExists) throw new Error("DAILY_SCHEDULED_EXISTS");
    }
    if (nextStatus === "active") {
      await endOtherActiveDailyAssignments(tx, targetOrgIds, assignment.id, now);
    }
    await tx.taskAssignment.update({
      where: { id },
      data: {
        templateVersion: template.version,
        effectMode,
        effectiveAt,
        publishedAt: now,
        status: nextStatus,
        endedAt: null,
        deletedAt: null,
        isActive: nextStatus === "active",
      },
    });
    return tx.taskAssignment.findUnique({ where: { id }, include: assignmentDetailInclude });
  });
}

async function createAssignment(data: any) {
  if (data.category === "TEMPORARY") return createTemporaryAssignment(data);
  return prisma.$transaction(async (tx) => {
    const template = await ensureTemplatePublished(tx, data.templateId);
    const now = new Date();
    const orgIds: string[] = dedupe(data.orgIds ?? []);
    await endOtherActiveDailyAssignments(tx, orgIds, "", now);
    const assignment = await tx.taskAssignment.create({
      data: {
        templateId: data.templateId,
        templateVersion: template.version,
        category: "DAILY",
        status: "active",
        effectMode: "immediate",
        effectiveAt: now,
        publishedAt: now,
        ownerScopePath: data.ownerScopePath ?? null,
        targetRoleType: "ANCHOR",
        deadlinePolicy: "next_day_1600",
        isActive: true,
        createdBy: data.createdBy,
        createdByOrgId: data.createdByOrgId,
      },
    });
    await replaceAssignmentTargets(tx, assignment.id, data.orgIds);
    return tx.taskAssignment.findUnique({ where: { id: assignment.id }, include: assignmentDetailInclude });
  });
}

async function deleteAssignment(id: string) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.taskAssignment.findUnique({ where: { id } });
    if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (assignment.category === "DAILY" && assignment.status === "scheduled") {
      const draftTemplate = await duplicateDailyTemplateAsDraft(tx, assignment.templateId, assignment.createdBy);
      await tx.taskAssignmentExclusion.deleteMany({ where: { assignmentId: id } });
      await tx.taskAssignmentTarget.deleteMany({ where: { assignmentId: id } });
      await tx.taskAssignment.delete({ where: { id } });
      return { deleted: true, hardDeleted: true, revertedToDraft: true, id, templateId: draftTemplate.id };
    }
    if (assignment.status === "draft") {
      const recordCount = await tx.taskRecord.count({ where: { assignmentId: id } });
      if (recordCount === 0) {
        await tx.taskAssignmentExclusion.deleteMany({ where: { assignmentId: id } });
        await tx.taskAssignmentTarget.deleteMany({ where: { assignmentId: id } });
        await tx.taskAssignment.delete({ where: { id } });
        return { deleted: true, hardDeleted: true, id };
      }
    }
    if (assignment.category === "DAILY") {
      return tx.taskAssignment.update({
        where: { id },
        data: { status: "ended", endedAt: new Date(), deletedAt: null, isActive: false },
      });
    }
    await tx.taskAssignment.update({
      where: { id },
      data: {
        status: "deleted",
        deletedAt: new Date(),
        endedAt: assignment.endedAt ?? new Date(),
        isActive: false,
      },
    });
    return { deleted: true, hardDeleted: false, id };
  });
}

async function getTargetUsers(assignmentId: string) {
  await reconcileDailyAssignments();
  await reconcileTemporaryAssignments();
  const assignment = await prisma.taskAssignment.findUnique({
    where: { id: assignmentId },
    include: { targets: true, exclusions: true },
  });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
  const result = [];
  const seenIdentityIds = new Set();
  for (const target of assignment.targets) {
    const identities = await prisma.userIdentity.findMany({
      where: {
        status: "active",
        roleCode: assignment.targetRoleType === "ANCHOR" ? "ANCHOR" : { in: (assignment.targetAdminLevels ?? []) as string[] },
        scopePath: { startsWith: target.orgPathSnapshot },
        user: { status: "active" },
      },
      include: {
        user: { select: { id: true, nickname: true, phone: true, status: true } },
        anchorProfile: { include: { hallOrg: { select: { id: true, name: true } } } },
        org: { select: { id: true, name: true, orgType: true } },
      },
    });
    for (const identity of identities) {
      if (seenIdentityIds.has(identity.id)) continue;
      if (isAssignmentOrgExcluded(identity.scopePath ?? undefined, assignment.exclusions ?? [])) continue;
      if (isAssignmentAnchorExcluded(identity.anchorProfileId ?? undefined, assignment.exclusions ?? [])) continue;
      seenIdentityIds.add(identity.id);
      result.push(identity);
    }
  }
  return result;
}

// ─── 厅管日常任务：草稿保存 ────────────────────────────────────────────────
async function saveHallDailyDraft(data: any) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.taskTemplate.findUnique({ where: { id: data.templateId } });
    if (!template) throw new Error("TEMPLATE_NOT_FOUND");
    if (template.category !== "HALL_DAILY") throw new Error("TEMPLATE_CATEGORY_MISMATCH");
    if (template.status === "archived") throw new Error("TEMPLATE_ARCHIVED");

    const nextData = {
      ...data,
      createdByOrgId: data.scopeOrgId ?? data.createdByOrgId,
      ownerScopePath: data.currentScopePath ?? data.ownerScopePath ?? null,
    };

    // 复用同一团队管理下相同模板的草稿
    const reusableDrafts = await tx.taskAssignment.findMany({
      where: {
        category: "HALL_DAILY",
        status: "draft",
        createdBy: nextData.createdBy,
        createdByOrgId: nextData.createdByOrgId,
        ownerScopePath: nextData.ownerScopePath ?? null,
      },
      select: { id: true, templateId: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    const matchedDraft = reusableDrafts.find((item: { templateId: string }) => item.templateId === nextData.templateId);
    let assignmentId = nextData.assignmentId || matchedDraft?.id;

    if (assignmentId) {
      const existing = await tx.taskAssignment.findUnique({ where: { id: assignmentId } });
      if (!existing) throw new Error("ASSIGNMENT_NOT_FOUND");
      if (existing.category !== "HALL_DAILY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
      if (existing.status !== "draft") throw new Error("ASSIGNMENT_NOT_DRAFT");
      await tx.taskAssignment.update({
        where: { id: assignmentId },
        data: {
          templateId: nextData.templateId,
          effectMode: nextData.effectMode ?? existing.effectMode,
          targetRoleType: "ADMIN",
        },
      });
    } else {
      const created = await tx.taskAssignment.create({
        data: {
          templateId: nextData.templateId,
          category: "HALL_DAILY",
          status: "draft",
          effectMode: nextData.effectMode ?? "immediate",
          ownerScopePath: nextData.ownerScopePath ?? null,
          targetRoleType: "ADMIN",
          deadlinePolicy: "next_day_1600",
          isActive: false,
          createdBy: nextData.createdBy,
          createdByOrgId: nextData.createdByOrgId,
        },
      });
      assignmentId = created.id;
    }

    // 清理重复草稿
    const duplicateIds = reusableDrafts.filter((item: { id: string }) => item.id !== assignmentId).map((item: { id: string }) => item.id);
    if (duplicateIds.length) {
      await tx.taskAssignmentExclusion.deleteMany({ where: { assignmentId: { in: duplicateIds } } });
      await tx.taskAssignmentTarget.deleteMany({ where: { assignmentId: { in: duplicateIds } } });
      await tx.taskAssignment.deleteMany({ where: { id: { in: duplicateIds } } });
    }

    await replaceAssignmentTargets(tx, assignmentId, nextData.orgIds ?? []);
    return tx.taskAssignment.findUnique({ where: { id: assignmentId }, include: assignmentDetailInclude });
  });
}

// ─── 厅管日常任务：发布预览 ───────────────────────────────────────────────
async function getHallDailyPublishPreview(id: string, scopeOrgId?: string) {
  const assignment = await prisma.taskAssignment.findUnique({
    where: { id },
    include: {
      template: { select: { id: true, title: true, version: true, category: true, status: true } },
      targets: { include: { org: { select: { id: true, name: true, path: true, orgType: true } } } },
    },
  });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (assignment.category !== "HALL_DAILY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
  if (scopeOrgId && assignment.createdByOrgId !== scopeOrgId) throw new Error("ASSIGNMENT_NOT_FOUND");
  return {
    assignmentId: assignment.id,
    templateId: assignment.templateId,
    templateTitle: assignment.template?.title ?? "未命名厅管日常任务",
    effectMode: assignment.effectMode ?? "next_midnight",
    targetOrgCount: assignment.targets?.length ?? 0,
    targetOrgs: (assignment.targets ?? []).map((t: any) => ({ id: t.orgId, name: t.org?.name ?? t.orgId })),
    overlappingAssignments: [] as any[],
  };
}

// ─── 厅管日常任务：正式发布 ───────────────────────────────────────────────
async function publishHallDailyDraft(id: string, effectMode: "immediate" | "next_midnight", scopeOrgId?: string) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.taskAssignment.findUnique({ where: { id }, include: { targets: true } });
    if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (assignment.category !== "HALL_DAILY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
    if (scopeOrgId && assignment.createdByOrgId !== scopeOrgId) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (assignment.status !== "draft") throw new Error("ASSIGNMENT_NOT_DRAFT");
    if (!assignment.targets.length) throw new Error("ASSIGNMENT_TARGETS_REQUIRED");

    const template = await ensureTemplatePublished(tx, assignment.templateId);
    const now = new Date();
    const effectiveAt = effectMode === "next_midnight" ? nextMidnight(now) : now;
    const nextStatus = effectMode === "next_midnight" ? "scheduled" : "active";

    if (nextStatus === "scheduled") {
      const scheduledExists = await tx.taskAssignment.findFirst({
        where: {
          category: "HALL_DAILY",
          ownerScopePath: assignment.ownerScopePath ?? null,
          status: "scheduled",
          id: { not: assignment.id },
        },
        select: { id: true },
      });
      if (scheduledExists) throw new Error("DAILY_SCHEDULED_EXISTS");
    }

    if (nextStatus === "active") {
      // 结束同 ownerScopePath 下其他生效中的厅管日常任务
      await tx.taskAssignment.updateMany({
        where: {
          category: "HALL_DAILY",
          ownerScopePath: assignment.ownerScopePath ?? null,
          status: "active",
          id: { not: assignment.id },
        },
        data: { status: "ended", isActive: false, endedAt: now },
      });
    }

    await tx.taskAssignment.update({
      where: { id },
      data: {
        templateVersion: template.version,
        effectMode,
        effectiveAt,
        publishedAt: now,
        status: nextStatus,
        endedAt: null,
        deletedAt: null,
        isActive: nextStatus === "active",
      },
    });
    return tx.taskAssignment.findUnique({ where: { id }, include: assignmentDetailInclude });
  });
}

export const AssignmentService = {
  list: listAssignments,
  getById: getAssignmentById,
  create: createAssignment,
  saveTemporaryDraft,
  getTemporaryPublishPreview,
  publishTemporaryDraft,
  saveDailyDraft,
  saveHallDailyDraft,
  getHallDailyPublishPreview,
  publishHallDailyDraft,
  getDailyPublishPreview: async (id: string, _scopePath?: string, _roleCode?: string, scopeOrgId?: string) => {
    const assignment = await prisma.taskAssignment.findUnique({
      where: { id },
      include: {
        template: { select: { id: true, title: true, version: true, category: true, status: true } },
        targets: { include: { org: { select: { id: true, name: true, path: true, orgType: true } } } },
        exclusions: {
          include: {
            org: { select: { id: true, name: true, path: true, orgType: true } },
            anchorProfile: { select: { id: true, nickname: true, douyinNo: true, douyinUid: true, boundUserId: true } },
          },
        },
      },
    });

    if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (assignment.category !== "DAILY") throw new Error("ASSIGNMENT_CATEGORY_INVALID");
    if (scopeOrgId && assignment.createdByOrgId !== scopeOrgId) throw new Error("ASSIGNMENT_NOT_FOUND");

    return {
      assignmentId: assignment.id,
      templateId: assignment.templateId,
      templateTitle: assignment.template?.title ?? "未命名日常任务",
      effectMode: assignment.effectMode ?? "next_midnight",
      targetOrgCount: assignment.targets?.length ?? 0,
      excludedOrgCount: assignment.exclusions?.filter((item: any) => item.exclusionType === "ORG").length ?? 0,
      excludedAnchorCount: assignment.exclusions?.filter((item: any) => item.exclusionType === "ANCHOR").length ?? 0,
      affectedAssignmentCount: 0,
      affectedAnchorCount: 0,
      autoEndedAssignmentCount: 0,
      overlappingAssignments: [],
    };
  },
  publishDailyDraft,
  update: updateAssignment,
  delete: deleteAssignment,
  toggleActive: toggleAssignmentActive,
  getTargetUsers,
};
