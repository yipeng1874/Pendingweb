import { isAssignmentAnchorExcluded, isAssignmentOrgExcluded, parseDateTime } from "./daily-assignment.utils.js";
function dedupeStrings(values) {
    return Array.isArray(values)
        ? Array.from(new Set(values.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())))
        : [];
}
function isPathWithin(path, scopePath) {
    return path === scopePath || path.startsWith(`${scopePath}/`) || scopePath.startsWith(`${path}/`);
}
export function resolveTemporaryMode(assignment) {
    if (assignment.temporaryMode)
        return assignment.temporaryMode;
    const targetRoleCodes = resolveTemporaryRoleCodes(assignment);
    return targetRoleCodes.length === 1 && targetRoleCodes[0] === "ANCHOR" ? "ANCHOR" : "ACCOUNT";
}
export function resolveTemporaryRoleCodes(assignment) {
    const nextRoleCodes = dedupeStrings(assignment.targetRoleCodes);
    if (nextRoleCodes.length)
        return nextRoleCodes;
    if (assignment.targetRoleType === "ANCHOR")
        return ["ANCHOR"];
    const adminLevels = dedupeStrings(assignment.targetAdminLevels);
    if (adminLevels.length)
        return adminLevels;
    return assignment.targetRoleType && assignment.targetRoleType !== "ACCOUNT" ? [assignment.targetRoleType] : [];
}
export function resolveTemporaryTargetUserIds(assignment) {
    return dedupeStrings(assignment.targetUserIds);
}
export function normalizeTemporaryDraftInput(input) {
    const mode = input.mode ?? "ACCOUNT";
    const targetUserIds = mode === "ACCOUNT" ? dedupeStrings(input.targetUserIds) : [];
    const targetRoleCodes = dedupeStrings(input.targetRoleCodes);
    const nextRoleCodes = mode === "ACCOUNT"
        ? []
        : targetRoleCodes.length
            ? targetRoleCodes
            : mode === "ANCHOR"
                ? ["ANCHOR"]
                : [input.subjectOrgType === "HALL" ? "HALL_MANAGER" : input.subjectOrgType === "BASE" ? "BASE_ADMIN" : "TEAM_ADMIN"];
    return {
        assignmentId: input.assignmentId,
        templateId: input.templateId,
        orgIds: Array.from(new Set((input.orgIds ?? []).filter(Boolean))),
        excludedOrgIds: mode === "ACCOUNT" ? [] : Array.from(new Set((input.excludedOrgIds ?? []).filter(Boolean))),
        excludedAnchorProfileIds: mode === "ANCHOR" ? Array.from(new Set((input.excludedAnchorProfileIds ?? []).filter(Boolean))) : [],
        deadlineAt: input.deadlineAt ? parseDateTime(input.deadlineAt) : undefined,
        mode,
        targetRoleCodes: nextRoleCodes,
        targetUserIds,
        subjectOrgType: mode === "MANAGER" ? (input.subjectOrgType ?? "TEAM") : null,
        preDeadlineConfirmEnabled: input.preDeadlineConfirmEnabled === true,
    };
}
async function listIdentitiesByTargetPaths(tx, targetPaths, roleCodes) {
    if (!targetPaths.length || !roleCodes.length)
        return [];
    const orScopePath = targetPaths.map((path) => ({ scopePath: { startsWith: path } }));
    return tx.userIdentity.findMany({
        where: {
            status: "active",
            roleCode: { in: roleCodes },
            OR: orScopePath,
            user: { status: "active" },
        },
        include: {
            user: { select: { id: true, nickname: true, phone: true, status: true } },
            org: { select: { id: true, name: true, orgType: true, path: true } },
        },
        orderBy: [{ userId: "asc" }, { roleCode: "asc" }],
    });
}
async function listScopedUserIdsByTargetPaths(tx, targetPaths) {
    if (!targetPaths.length)
        return [];
    const rows = await tx.userIdentity.findMany({
        where: {
            status: "active",
            OR: targetPaths.map((path) => ({ scopePath: { startsWith: path } })),
            user: { status: "active" },
        },
        select: { userId: true },
        distinct: ["userId"],
        orderBy: { userId: "asc" },
    });
    return rows.map((row) => row.userId);
}
async function listActiveIdentitiesByUserIds(tx, userIds) {
    if (!userIds.length)
        return [];
    return tx.userIdentity.findMany({
        where: {
            status: "active",
            userId: { in: userIds },
            user: { status: "active" },
        },
        include: {
            user: { select: { id: true, nickname: true, phone: true, status: true } },
            org: { select: { id: true, name: true, orgType: true, path: true } },
        },
        orderBy: [{ userId: "asc" }, { roleCode: "asc" }],
    });
}
function filterExcludedIdentities(identities, exclusions) {
    return identities.filter((identity) => {
        if (isAssignmentOrgExcluded(identity.scopePath ?? undefined, exclusions))
            return false;
        if (isAssignmentAnchorExcluded(identity.anchorProfileId ?? undefined, exclusions))
            return false;
        return true;
    });
}
async function listSubjectOrgs(tx, targets, subjectOrgType, exclusions) {
    const targetPaths = Array.from(new Set(targets.map((item) => item.orgPathSnapshot).filter(Boolean)));
    if (!targetPaths.length)
        return [];
    const orgs = await tx.orgUnit.findMany({
        where: {
            status: "active",
            orgType: subjectOrgType,
            OR: targetPaths.map((path) => ({ path: { startsWith: path } })),
        },
        select: { id: true, name: true, orgType: true, path: true },
        orderBy: [{ depth: "asc" }, { path: "asc" }],
    });
    return orgs.filter((org) => !isAssignmentOrgExcluded(org.path, exclusions));
}
export async function buildTemporarySubjectGroups(tx, assignment) {
    const mode = resolveTemporaryMode(assignment);
    const exclusions = assignment.exclusions ?? [];
    const targetPaths = Array.from(new Set((assignment.targets ?? []).map((item) => item.orgPathSnapshot).filter(Boolean)));
    if (mode === "ACCOUNT") {
        const explicitUserIds = resolveTemporaryTargetUserIds(assignment);
        const scopedUserIds = await listScopedUserIdsByTargetPaths(tx, targetPaths);
        const userIds = Array.from(new Set([...explicitUserIds, ...scopedUserIds]));
        const identities = await listActiveIdentitiesByUserIds(tx, userIds);
        const grouped = new Map();
        identities.forEach((identity) => {
            const key = `USER:${identity.userId}`;
            const current = grouped.get(key) ?? {
                subjectType: "USER",
                subjectKey: key,
                subjectUserId: identity.userId,
                subjectName: identity.user.nickname,
                visibleIdentities: [],
                preferredIdentityId: identity.id,
                userId: identity.userId,
            };
            current.visibleIdentities.push(identity);
            grouped.set(key, current);
        });
        return Array.from(grouped.values());
    }
    const roleCodes = resolveTemporaryRoleCodes(assignment);
    const ownerScopePath = assignment.ownerScopePath ?? null;
    let identities = filterExcludedIdentities(await listIdentitiesByTargetPaths(tx, targetPaths, roleCodes), exclusions);
    // 层2：发起者权限范围收窄
    // 若 ownerScopePath 存在（非超级管理员），则只保留 scopePath 在发起者权限范围内的执行者
    // 这样 TEAM_ADMIN 用基地 orgId 发 ANCHOR/MANAGER 任务时，不会拉到其他团队的执行者
    if (ownerScopePath) {
        identities = identities.filter((identity) => {
            const sp = identity.scopePath;
            if (!sp)
                return false;
            return sp === ownerScopePath || sp.startsWith(`${ownerScopePath}/`);
        });
    }
    if (mode !== "MANAGER") {
        const grouped = new Map();
        identities.forEach((identity) => {
            const key = `USER:${identity.userId}`;
            const current = grouped.get(key) ?? {
                subjectType: "USER",
                subjectKey: key,
                subjectUserId: identity.userId,
                subjectName: identity.user.nickname,
                subjectOrgId: mode === "ANCHOR" && identity.org?.orgType === "HALL" ? identity.org.id : undefined,
                subjectOrgType: mode === "ANCHOR" && identity.org?.orgType === "HALL" ? identity.org.orgType : undefined,
                visibleIdentities: [],
                preferredIdentityId: identity.id,
                userId: identity.userId,
            };
            current.visibleIdentities.push(identity);
            if (!current.preferredIdentityId || identity.roleCode === "ANCHOR")
                current.preferredIdentityId = identity.id;
            if (mode === "ANCHOR" && !current.subjectOrgId && identity.org?.orgType === "HALL") {
                current.subjectOrgId = identity.org.id;
                current.subjectOrgType = identity.org.orgType;
            }
            grouped.set(key, current);
        });
        return Array.from(grouped.values());
    }
    const subjectOrgType = assignment.temporarySubjectOrgType ?? "TEAM";
    const subjectOrgs = await listSubjectOrgs(tx, assignment.targets, subjectOrgType, exclusions);
    const grouped = new Map();
    subjectOrgs.forEach((subjectOrg) => {
        const visibleIdentities = identities.filter((identity) => {
            const identityOrgPath = identity.org?.path ?? identity.scopePath ?? "";
            if (!identityOrgPath)
                return false;
            return identityOrgPath === subjectOrg.path;
        });
        if (!visibleIdentities.length)
            return;
        grouped.set(`ORG:${subjectOrg.id}`, {
            subjectType: "ORG",
            subjectKey: `ORG:${subjectOrg.id}`,
            subjectOrgId: subjectOrg.id,
            subjectName: subjectOrg.name,
            subjectOrgType: subjectOrg.orgType,
            visibleIdentities,
            preferredIdentityId: visibleIdentities[0]?.id,
        });
    });
    return Array.from(grouped.values());
}
export function buildTemporaryPreview(groups) {
    const visibleIdentityCount = groups.reduce((sum, group) => sum + group.visibleIdentities.length, 0);
    return {
        subjectCount: groups.length,
        userSubjectCount: groups.filter((group) => group.subjectType === "USER").length,
        orgSubjectCount: groups.filter((group) => group.subjectType === "ORG").length,
        visibleIdentityCount,
        subjectSummaries: groups.slice(0, 12).map((group) => ({
            subjectType: group.subjectType,
            subjectKey: group.subjectKey,
            subjectName: group.subjectName,
            subjectOrgType: group.subjectOrgType ?? null,
            visibleIdentityCount: group.visibleIdentities.length,
        })),
    };
}
export async function listTemporaryManagerOrgsWithoutManagers(tx, assignment) {
    const mode = resolveTemporaryMode(assignment);
    if (mode !== "MANAGER")
        return [];
    const exclusions = assignment.exclusions ?? [];
    const roleCodes = resolveTemporaryRoleCodes(assignment);
    const identities = filterExcludedIdentities(await listIdentitiesByTargetPaths(tx, Array.from(new Set((assignment.targets ?? []).map((item) => item.orgPathSnapshot).filter(Boolean))), roleCodes), exclusions);
    const subjectOrgType = assignment.temporarySubjectOrgType ?? "TEAM";
    const subjectOrgs = await listSubjectOrgs(tx, assignment.targets, subjectOrgType, exclusions);
    return subjectOrgs
        .filter((subjectOrg) => {
        const visibleIdentities = identities.filter((identity) => {
            const identityOrgPath = identity.org?.path ?? identity.scopePath ?? "";
            if (!identityOrgPath)
                return false;
            return isPathWithin(identityOrgPath, subjectOrg.path) && identity.org?.orgType === subjectOrg.orgType;
        });
        return visibleIdentities.length === 0;
    })
        .map((org) => ({ orgId: org.id, orgName: org.name, orgType: org.orgType }));
}
