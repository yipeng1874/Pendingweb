import { prisma } from "../../../shared/prisma.js";

export const assignmentListInclude = {
  template: { select: { id: true, title: true, category: true, status: true, version: true } },
  targets: { include: { org: { select: { id: true, name: true, orgType: true, path: true } } } },
  exclusions: {
    include: {
      org: { select: { id: true, name: true, orgType: true, path: true } },
      anchorProfile: {
        select: {
          id: true,
          nickname: true,
          douyinNo: true,
          hallOrgId: true,
          hallOrg: { select: { id: true, name: true } },
          identities: {
            where: { roleCode: "ANCHOR", status: "active" },
            take: 1,
            select: { user: { select: { phone: true } } },
          },
        },
      },
    },
  },
  _count: { select: { records: true } },
} as const;

export const assignmentDetailInclude = {
  template: {
    include: {
      items: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
    },
  },
  targets: { include: { org: { select: { id: true, name: true, orgType: true, path: true } } } },
  exclusions: {
    include: {
      org: { select: { id: true, name: true, orgType: true, path: true } },
      anchorProfile: {
        select: {
          id: true,
          nickname: true,
          douyinNo: true,
          hallOrgId: true,
          hallOrg: { select: { id: true, name: true } },
          identities: {
            where: { roleCode: "ANCHOR", status: "active" },
            take: 1,
            select: { user: { select: { phone: true } } },
          },
        },
      },
    },
  },
} as const;

export type AssignmentAudienceMember = {
  id: string;
  userId: string;
  scopePath: string | null;
  anchorProfileId: string | null;
  subjectKey: string;
  subjectName: string | null;
  nickname: string | null;
  hallOrgId: string | null;
  hallOrgName: string | null;
  hallOrgPath: string | null;
  teamOrgId: string | null;
  teamOrgName: string | null;
};

type AssignmentAudienceInput = {
  targetRoleType: string;
  targetAdminLevels?: unknown;
  targets: Array<{ orgPathSnapshot: string }>;
  exclusions?: Array<{ exclusionType: string; orgPathSnapshot: string | null; anchorProfileId: string | null }>;
};

function parseTargetAdminLevels(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export async function listAssignmentAudienceMembers(db: any, assignment: AssignmentAudienceInput): Promise<AssignmentAudienceMember[]> {
  const audience: AssignmentAudienceMember[] = [];
  const seenIdentityIds = new Set<string>();
  const adminLevels = parseTargetAdminLevels(assignment.targetAdminLevels);

  for (const target of assignment.targets ?? []) {
    const identities = await db.userIdentity.findMany({
      where: {
        status: "active",
        roleCode: assignment.targetRoleType === "ANCHOR" ? "ANCHOR" : { in: adminLevels },
        scopePath: { startsWith: target.orgPathSnapshot },
        user: { status: "active" },
        ...(assignment.targetRoleType === "ANCHOR" ? { anchorProfile: { status: { not: "inactive" } } } : {}),
      },
      select: {
        id: true,
        userId: true,
        scopePath: true,
        anchorProfileId: true,
        user: { select: { nickname: true } },
        anchorProfile: {
          select: {
            id: true,
            nickname: true,
            hallOrgId: true,
            hallOrg: {
              select: {
                id: true,
                name: true,
                path: true,
                parentId: true,
              },
            },
          },
        },
      },
    });

    for (const identity of identities) {
      if (seenIdentityIds.has(identity.id)) continue;
      if (isAssignmentOrgExcluded(identity.scopePath ?? undefined, assignment.exclusions ?? [])) continue;
      if (isAssignmentAnchorExcluded(identity.anchorProfileId ?? undefined, assignment.exclusions ?? [])) continue;
      seenIdentityIds.add(identity.id);
      let teamOrgId: string | null = identity.anchorProfile?.hallOrg?.parentId ?? null;
      let teamOrgName: string | null = null;

      if (teamOrgId) {
        const teamOrg = await db.orgUnit.findUnique({
          where: { id: teamOrgId },
          select: { id: true, name: true },
        });
        teamOrgName = teamOrg?.name ?? null;
      }

      audience.push({
        id: identity.id,
        userId: identity.userId,
        scopePath: identity.scopePath,
        anchorProfileId: identity.anchorProfileId,
        subjectKey: `USER:${identity.userId}`,
        subjectName: identity.anchorProfile?.nickname ?? identity.user?.nickname ?? null,
        nickname: identity.user?.nickname ?? null,
        hallOrgId: identity.anchorProfile?.hallOrgId ?? null,
        hallOrgName: identity.anchorProfile?.hallOrg?.name ?? null,
        hallOrgPath: identity.anchorProfile?.hallOrg?.path ?? null,
        teamOrgId,
        teamOrgName,
      });
    }
  }

  return audience;
}

export function parseDateTime(value: string) {

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_DEADLINE");
  return date;
}

export function nextMidnight(date = new Date()) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

export async function ensureDailyTemplateAvailable(tx: any, templateId: string) {
  const template = await tx.taskTemplate.findUnique({
    where: { id: templateId },
    include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!template) throw new Error("TEMPLATE_NOT_FOUND");
  if (template.category !== "DAILY") throw new Error("TEMPLATE_CATEGORY_MISMATCH");
  if (template.status === "archived") throw new Error("TEMPLATE_ARCHIVED");

  await tx.taskTemplateSnapshot.upsert({
    where: { templateId_version: { templateId, version: template.version } },
    update: { snapshotJson: template as any },
    create: { templateId, version: template.version, snapshotJson: template as any },
  });

  return template;
}

export const ensureTemplatePublished = ensureDailyTemplateAvailable;

export async function replaceAssignmentTargets(tx: any, assignmentId: string, orgIds: string[]) {
  const uniqueOrgIds = Array.from(new Set(orgIds.filter(Boolean)));
  const orgs = await tx.orgUnit.findMany({
    where: { id: { in: uniqueOrgIds }, status: "active" },
    select: { id: true, path: true },
  });
  if (!orgs.length) throw new Error("ASSIGNMENT_TARGETS_REQUIRED");

  await tx.taskAssignmentTarget.deleteMany({ where: { assignmentId } });
  await tx.taskAssignmentTarget.createMany({
    data: orgs.map((org: { id: string; path: string }) => ({ assignmentId, orgId: org.id, orgPathSnapshot: org.path })),
  });
  return orgs;
}

export async function replaceAssignmentExclusions(
  tx: any,
  assignmentId: string,
  excludedOrgIds: string[],
  excludedAnchorProfileIds: string[]
) {
  await tx.taskAssignmentExclusion.deleteMany({ where: { assignmentId } });

  const uniqueOrgIds = Array.from(new Set(excludedOrgIds.filter(Boolean)));
  const uniqueAnchorIds = Array.from(new Set(excludedAnchorProfileIds.filter(Boolean)));
  const orgs = uniqueOrgIds.length
    ? await tx.orgUnit.findMany({
        where: { id: { in: uniqueOrgIds }, status: "active" },
        select: { id: true, path: true },
      })
    : [];
  const anchors = uniqueAnchorIds.length
    ? await tx.anchorProfile.findMany({
        where: { id: { in: uniqueAnchorIds } },
        select: { id: true },
      })
    : [];

  const data = [
    ...orgs.map((org: { id: string; path: string }) => ({
      assignmentId,
      exclusionType: "ORG",
      orgId: org.id,
      orgPathSnapshot: org.path,
    })),
    ...anchors.map((anchor: { id: string }) => ({
      assignmentId,
      exclusionType: "ANCHOR",
      anchorProfileId: anchor.id,
    })),
  ];

  if (data.length) {
    await tx.taskAssignmentExclusion.createMany({ data });
  }
}

export async function endOtherActiveDailyAssignments(tx: any, ownerScopePath: string | undefined, keepId: string, endedAt: Date) {
  const scopeFilter = ownerScopePath ? { ownerScopePath } : { ownerScopePath: null };
  const rows = await tx.taskAssignment.findMany({
    where: {
      category: "DAILY",
      ...scopeFilter,
      status: "active",
      deletedAt: null,
      id: { not: keepId },
    },
    select: { id: true },
  });
  await tx.taskAssignment.updateMany({
    where: {
      id: { in: rows.map((row: { id: string }) => row.id) },
    },
    data: { status: "ended", endedAt, isActive: false },
  });
  return rows.map((row: { id: string }) => row.id);
}

export async function reconcileDailyAssignments(scopePath?: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const dueAssignments = await tx.taskAssignment.findMany({
      where: {
        category: "DAILY",
        status: "scheduled",
        deletedAt: null,
        effectiveAt: { lte: now },
        ...(scopePath ? { ownerScopePath: { startsWith: scopePath } } : {}),
      },
      select: { id: true, ownerScopePath: true },
      orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
    });

    for (const assignment of dueAssignments) {
      await endOtherActiveDailyAssignments(tx, assignment.ownerScopePath ?? undefined, assignment.id, now);
      await tx.taskAssignment.update({
        where: { id: assignment.id },
        data: { status: "active", isActive: true, endedAt: null },
      });
    }
  });
}

export function isAssignmentOrgExcluded(identityScopePath: string | undefined, exclusions: Array<{ exclusionType: string; orgPathSnapshot: string | null }>) {
  if (!identityScopePath) return false;
  return exclusions.some((exclusion) => exclusion.exclusionType === "ORG" && exclusion.orgPathSnapshot && identityScopePath.startsWith(exclusion.orgPathSnapshot));
}

export function isAssignmentAnchorExcluded(anchorProfileId: string | undefined, exclusions: Array<{ exclusionType: string; anchorProfileId: string | null }>) {
  if (!anchorProfileId) return false;
  return exclusions.some((exclusion) => exclusion.exclusionType === "ANCHOR" && exclusion.anchorProfileId === anchorProfileId);
}
