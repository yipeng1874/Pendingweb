import { prisma } from "../../../shared/prisma.js";
import { formatBeijingDate, getDailyTaskDayEnd, getDailyTaskDayStart } from "../record/daily-record-time.utils.js";
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
};
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
};
function parseTargetAdminLevels(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
}
export async function listAssignmentAudienceMembers(db, assignment, taskDate) {
    const audience = [];
    const seenIdentityIds = new Set();
    const adminLevels = parseTargetAdminLevels(assignment.targetAdminLevels);
    const isHistoricalTaskDate = Boolean(taskDate && taskDate < formatBeijingDate(new Date()));
    const taskDayStart = taskDate ? getDailyTaskDayStart(taskDate) : null;
    const taskDayEnd = taskDate ? getDailyTaskDayEnd(taskDate) : null;
    for (const target of assignment.targets ?? []) {
        const identities = await db.userIdentity.findMany({
            where: {
                roleCode: assignment.targetRoleType === "ANCHOR" ? "ANCHOR" : { in: adminLevels },
                scopePath: { startsWith: target.orgPathSnapshot },
                ...(taskDayEnd ? { grantedAt: { lte: taskDayEnd } } : {}),
                ...(isHistoricalTaskDate && taskDayStart
                    ? { OR: [{ status: "active" }, { status: "disabled", expiredAt: { gte: taskDayStart } }] }
                    : {
                        status: "active",
                        user: { status: "active" },
                        ...(assignment.targetRoleType === "ANCHOR" ? { anchorProfile: { status: { not: "inactive" } } } : {}),
                    }),
            },
            orderBy: [{ grantedAt: "asc" }, { expiredAt: "asc" }],
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
                        status: true,
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
            if (seenIdentityIds.has(identity.id))
                continue;
            if (isAssignmentOrgExcluded(identity.scopePath ?? undefined, assignment.exclusions ?? []))
                continue;
            if (isAssignmentAnchorExcluded(identity.anchorProfileId ?? undefined, assignment.exclusions ?? []))
                continue;
            seenIdentityIds.add(identity.id);
            let teamOrgId = identity.anchorProfile?.hallOrg?.parentId ?? null;
            let teamOrgName = null;
            if (teamOrgId) {
                const teamOrg = await db.orgUnit.findUnique({
                    where: { id: teamOrgId },
                    select: { id: true, name: true },
                });
                teamOrgName = teamOrg?.name ?? null;
            }
            const isMigratedHistory = identity.anchorProfile?.status === "inactive"
                && /back-\d{6,8}(?:-\d{9})?$/i.test(identity.anchorProfile.nickname ?? "");
            audience.push({
                id: identity.id,
                userId: identity.userId,
                scopePath: identity.scopePath,
                anchorProfileId: identity.anchorProfileId,
                subjectKey: `USER:${identity.userId}`,
                subjectName: isMigratedHistory ? (identity.user?.nickname ?? null) : (identity.anchorProfile?.nickname ?? identity.user?.nickname ?? null),
                nickname: identity.user?.nickname ?? null,
                hallOrgId: identity.anchorProfile?.hallOrgId ?? null,
                hallOrgName: identity.anchorProfile?.hallOrg?.name ?? null,
                hallOrgPath: identity.anchorProfile?.hallOrg?.path ?? null,
                teamOrgId,
                teamOrgName,
            });
        }
    }
    if (!taskDate || assignment.targetRoleType !== "ANCHOR")
        return audience;
    // Migration creates a second identity on the same day. Since identities are
    // ordered by grantedAt, the identity present at the start of that day wins.
    const seenSubjectKeys = new Set();
    return audience.filter((member) => {
        if (seenSubjectKeys.has(member.subjectKey))
            return false;
        seenSubjectKeys.add(member.subjectKey);
        return true;
    });
}
export function parseDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        throw new Error("INVALID_DEADLINE");
    return date;
}
export function nextMidnight(date = new Date()) {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    return next;
}
export async function ensureDailyTemplateAvailable(tx, templateId) {
    const template = await tx.taskTemplate.findUnique({
        where: { id: templateId },
        include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!template)
        throw new Error("TEMPLATE_NOT_FOUND");
    if (template.category !== "DAILY")
        throw new Error("TEMPLATE_CATEGORY_MISMATCH");
    if (template.status === "archived")
        throw new Error("TEMPLATE_ARCHIVED");
    await tx.taskTemplateSnapshot.upsert({
        where: { templateId_version: { templateId, version: template.version } },
        update: { snapshotJson: template },
        create: { templateId, version: template.version, snapshotJson: template },
    });
    return template;
}
export const ensureTemplatePublished = ensureDailyTemplateAvailable;
export async function replaceAssignmentTargets(tx, assignmentId, orgIds) {
    const uniqueOrgIds = Array.from(new Set(orgIds.filter(Boolean)));
    const orgs = await tx.orgUnit.findMany({
        where: { id: { in: uniqueOrgIds }, status: "active" },
        select: { id: true, path: true },
    });
    if (!orgs.length)
        throw new Error("ASSIGNMENT_TARGETS_REQUIRED");
    await tx.taskAssignmentTarget.deleteMany({ where: { assignmentId } });
    await tx.taskAssignmentTarget.createMany({
        data: orgs.map((org) => ({ assignmentId, orgId: org.id, orgPathSnapshot: org.path })),
    });
    return orgs;
}
export async function replaceAssignmentExclusions(tx, assignmentId, excludedOrgIds, excludedAnchorProfileIds) {
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
        ...orgs.map((org) => ({
            assignmentId,
            exclusionType: "ORG",
            orgId: org.id,
            orgPathSnapshot: org.path,
        })),
        ...anchors.map((anchor) => ({
            assignmentId,
            exclusionType: "ANCHOR",
            anchorProfileId: anchor.id,
        })),
    ];
    if (data.length) {
        await tx.taskAssignmentExclusion.createMany({ data });
    }
}
export async function endOtherActiveDailyAssignments(tx, targetOrgIds, keepId, endedAt) {
    if (!targetOrgIds.length)
        return [];
    const rows = await tx.taskAssignment.findMany({
        where: {
            category: "DAILY",
            status: "active",
            deletedAt: null,
            id: keepId ? { not: keepId } : undefined,
            targets: { some: { orgId: { in: targetOrgIds } } },
        },
        select: { id: true },
    });
    await tx.taskAssignment.updateMany({
        where: {
            id: { in: rows.map((row) => row.id) },
        },
        data: { status: "ended", endedAt, isActive: false },
    });
    return rows.map((row) => row.id);
}
export async function reconcileDailyAssignments(scopePath) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
        const dueAssignments = await tx.taskAssignment.findMany({
            where: {
                category: "DAILY",
                status: "scheduled",
                deletedAt: null,
                effectiveAt: { lte: now },
                ...(scopePath ? { targets: { some: { orgPathSnapshot: { startsWith: scopePath } } } } : {}),
            },
            select: { id: true, targets: { select: { orgId: true } } },
            orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
        });
        for (const assignment of dueAssignments) {
            const targetOrgIds = assignment.targets.map((t) => t.orgId);
            await endOtherActiveDailyAssignments(tx, targetOrgIds, assignment.id, now);
            await tx.taskAssignment.update({
                where: { id: assignment.id },
                data: { status: "active", isActive: true, endedAt: null },
            });
        }
    });
}
export function isAssignmentOrgExcluded(identityScopePath, exclusions) {
    if (!identityScopePath)
        return false;
    return exclusions.some((exclusion) => exclusion.exclusionType === "ORG" && exclusion.orgPathSnapshot && identityScopePath.startsWith(exclusion.orgPathSnapshot));
}
export function isAssignmentAnchorExcluded(anchorProfileId, exclusions) {
    if (!anchorProfileId)
        return false;
    return exclusions.some((exclusion) => exclusion.exclusionType === "ANCHOR" && exclusion.anchorProfileId === anchorProfileId);
}
