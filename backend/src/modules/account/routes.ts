import { Router } from "express";
import bcrypt from "bcryptjs";
import type { OrgType } from "@prisma/client";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { fail, ok } from "../../shared/response.js";
import { prisma } from "../../shared/prisma.js";

export const accountRoutes = Router();
accountRoutes.use(authRequired, identityRequired);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function textArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  const normalized = text(value);
  return normalized ? normalized.split(",").map((item) => text(item)).filter(Boolean) : [];
}

async function resolveScopedSearchPath(req: { identity?: { scopePath?: string | null; roleCode: string } }, scopeOrgId?: string) {
  if (!scopeOrgId) {
    if (req.identity?.roleCode === "DEV_ADMIN") return undefined;
    return req.identity?.scopePath ?? undefined;
  }
  const scopeOrg = await prisma.orgUnit.findFirst({ where: { id: scopeOrgId, status: "active" }, select: { path: true } });
  if (!scopeOrg) throw new Error("SCOPE_ORG_NOT_FOUND");
  if (req.identity?.roleCode !== "DEV_ADMIN" && req.identity?.scopePath && !isAncestorPath(req.identity.scopePath, scopeOrg.path)) {
    throw new Error("SCOPE_ORG_FORBIDDEN");
  }
  return scopeOrg.path;
}

function safeUser<T extends { passwordHash?: string }>(user: T) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

async function resolvePrimaryAnchorProfiles(tx: typeof prisma, userIds: string[]) {
  if (!userIds.length) return new Map<string, { id: string; nickname: string; douyinNo?: string | null; douyinUid?: string | null; status: string; hallOrgId: string }>();
  const identities = await tx.userIdentity.findMany({
    where: { userId: { in: userIds }, roleCode: "ANCHOR", anchorProfileId: { not: null } },
    include: { anchorProfile: true },
    orderBy: [{ grantedAt: "desc" }],
  });
  const map = new Map<string, { id: string; nickname: string; douyinNo?: string | null; douyinUid?: string | null; status: string; hallOrgId: string }>();
  for (const identity of identities) {
    if (!identity.anchorProfile || map.has(identity.userId)) continue;
    map.set(identity.userId, identity.anchorProfile);
  }
  return map;
}

function ensureDevAdmin(req: { identity?: { roleCode: string } }) {
  return req.identity?.roleCode === "DEV_ADMIN";
}

function isManagementRole(roleCode: string) {
  return roleCode !== "ANCHOR";
}

const orgTypeRoleMap: Record<OrgType, string> = {
  HQ: "HQ_ADMIN",
  BASE: "BASE_ADMIN",
  TEAM: "TEAM_ADMIN",
  HALL: "HALL_MANAGER",
};

function isRoleAllowedForOrg(roleCode: string, orgType: OrgType) {
  return orgTypeRoleMap[orgType] === roleCode;
}

function isAncestorPath(ancestorPath?: string | null, targetPath?: string | null) {
  return Boolean(ancestorPath && targetPath && (ancestorPath === targetPath || targetPath.startsWith(`${ancestorPath}/`)));
}

async function grantIdentity(tx: typeof prisma, input: { userId: string; roleCode: string; orgId?: string; anchorProfileId?: string; scopePath?: string; grantedBy?: string }) {
  const existing = await tx.userIdentity.findFirst({
    where: {
      userId: input.userId,
      roleCode: input.roleCode,
      orgId: input.orgId ?? null,
      anchorProfileId: input.anchorProfileId ?? null,
    },
  });
  if (existing) {
    return tx.userIdentity.update({
      where: { id: existing.id },
      data: { status: "active", expiredAt: null, scopePath: input.scopePath, grantedBy: input.grantedBy },
    });
  }
  return tx.userIdentity.create({
    data: {
      userId: input.userId,
      roleCode: input.roleCode,
      orgId: input.orgId,
      anchorProfileId: input.anchorProfileId,
      scopePath: input.scopePath,
      status: "active",
      grantedBy: input.grantedBy,
    },
  });
}

async function findManagementScopeConflicts(userId: string, org: { id: string; path: string }, ignoreIdentityId?: string) {
  const identities = await prisma.userIdentity.findMany({
    where: {
      userId,
      roleCode: { not: "ANCHOR" },
      ...(ignoreIdentityId ? { id: { not: ignoreIdentityId } } : {}),
    },
    include: { org: true },
  });

  const activeManagementIdentities = identities.filter((item) => item.status === "active" && item.orgId && item.scopePath);
  const sameChainConflicts = activeManagementIdentities.filter((item) => isAncestorPath(item.scopePath, org.path) || isAncestorPath(org.path, item.scopePath));

  return sameChainConflicts;
}

accountRoutes.get("/accounts", permissionRequired("account:view"), async (req, res) => {
  const orgId = text(req.query.orgId);
  const keyword = text(req.query.keyword).toLowerCase();
  const roleCode = text(req.query.roleCode);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 100);

  const identityWhere = {
    ...(orgId ? { orgId } : {}),
    ...(roleCode ? { roleCode } : {}),
  };

  const scopeWhere = req.identity?.scopePath && req.identity.roleCode !== "DEV_ADMIN"
    ? { identities: { some: { scopePath: { startsWith: req.identity.scopePath } } } }
    : {};

  const keywordWhere = keyword
    ? {
        OR: [
          { nickname: { contains: keyword } },
          { phone: { contains: keyword } },
          { identities: { some: { anchorProfile: { douyinUid: { contains: keyword } } } } },
          { identities: { some: { anchorProfile: { douyinNo: { contains: keyword } } } } },
        ],
      }
    : {};

  const where = {
    ...scopeWhere,
    ...(orgId || roleCode ? { identities: { some: identityWhere } } : {}),
    ...keywordWhere,
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: {
        identities: {
          where: identityWhere,
          include: { org: true, anchorProfile: true },
          orderBy: [{ roleCode: "asc" }, { grantedAt: "desc" }],
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const anchorProfileMap = await resolvePrimaryAnchorProfiles(prisma, users.map((user) => user.id));
  return ok(res, {
    items: users.map((user) => ({ ...safeUser(user), anchorProfile: anchorProfileMap.get(user.id) ?? null })),
    total,
    page,
    pageSize,
  });
});

accountRoutes.get("/accounts/search", permissionRequired("account:view"), async (req, res) => {
  const keyword = text(req.query.keyword);
  const ids = textArray(req.query.ids);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 100);
  if (!keyword && !ids.length) return ok(res, { items: [], total: 0, page, pageSize });

  try {
    const scopePath = await resolveScopedSearchPath(req, text(req.query.scopeOrgId) || undefined);
    const where = {
      ...(ids.length
        ? { id: { in: ids } }
        : {
            OR: [
              { phone: { contains: keyword } },
              { nickname: { contains: keyword } },
              { identities: { some: { anchorProfile: { douyinUid: { contains: keyword } } } } },
              { identities: { some: { anchorProfile: { douyinNo: { contains: keyword } } } } },
            ],
          }),
      ...(scopePath ? { identities: { some: { scopePath: { startsWith: scopePath } } } } : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        include: {
          identities: {
            include: { org: true, anchorProfile: true },
            orderBy: [{ roleCode: "asc" }, { grantedAt: "desc" }],
          },
        },
        orderBy: { createdAt: "desc" },
        ...(ids.length ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
      }),
    ]);

    const anchorProfileMap = await resolvePrimaryAnchorProfiles(prisma, users.map((user) => user.id));
    return ok(res, {
      items: users.map((user) => ({ ...safeUser(user), anchorProfile: anchorProfileMap.get(user.id) ?? null })),
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    if (error.message === "SCOPE_ORG_NOT_FOUND") return fail(res, "SCOPE_ORG_NOT_FOUND", "选择的管理基地不存在或已停用", 404);
    if (error.message === "SCOPE_ORG_FORBIDDEN") return fail(res, "SCOPE_ORG_FORBIDDEN", "当前身份无权在该基地范围内搜索账号", 403);
    throw error;
  }
});

accountRoutes.get("/accounts/:id/detail", permissionRequired("account:view"), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      identities: {
        include: { org: true, anchorProfile: true },
        orderBy: [{ roleCode: "asc" }, { grantedAt: "desc" }],
      },
    },
  });
  if (!user) return fail(res, "ACCOUNT_NOT_FOUND", "账号不存在", 404);
  if (req.identity?.scopePath && req.identity.roleCode !== "DEV_ADMIN") {
    const visible = user.identities.some((identity) => identity.scopePath?.startsWith(req.identity!.scopePath || ""));
    if (!visible) return fail(res, "ACCOUNT_FORBIDDEN", "当前身份无权查看该账号", 403);
  }
  const anchorProfileMap = await resolvePrimaryAnchorProfiles(prisma, [user.id]);
  return ok(res, { ...safeUser(user), anchorProfile: anchorProfileMap.get(user.id) ?? null });
});

accountRoutes.post("/accounts/:id/identities", permissionRequired("identity:grant"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return fail(res, "ACCOUNT_NOT_FOUND", "账号不存在", 404);

  const roleCode = text(req.body.roleCode);
  const orgId = text(req.body.orgId) || undefined;
  const anchorProfileId = text(req.body.anchorProfileId) || undefined;
  const org = orgId ? await prisma.orgUnit.findUnique({ where: { id: orgId } }) : null;
  const anchorProfile = anchorProfileId ? await prisma.anchorProfile.findUnique({ where: { id: anchorProfileId } }) : null;

  if (isManagementRole(roleCode)) {
    if (!org) return fail(res, "ORG_REQUIRED", "管理身份必须选择组织", 400);
    if (!isRoleAllowedForOrg(roleCode, org.orgType)) {
      return fail(res, "ROLE_ORG_TYPE_MISMATCH", "当前组织层级与授权角色不匹配，请选择对应层级的管理角色", 400);
    }
    const sameChainConflicts = await findManagementScopeConflicts(user.id, org);
    if (sameChainConflicts.length) {
      return res.status(409).json({
        success: false,
        error: {
          code: "ORG_SCOPE_CONFLICT",
          message: "该账号在当前组织链下已有管理权限，请先停用或调整原权限后再授权",
          details: sameChainConflicts.map((item) => ({ id: item.id, roleCode: item.roleCode, orgId: item.orgId, orgName: item.org?.name, orgCode: item.org?.orgCode })),
        },
      });
    }
  }

  if (roleCode === "ANCHOR" && !anchorProfile) return fail(res, "ANCHOR_PROFILE_REQUIRED", "主播身份必须选择主播档案", 400);

  const identity = await grantIdentity(prisma, {
    userId: req.params.id,
    roleCode,
    orgId,
    anchorProfileId,
    scopePath: org?.path,
    grantedBy: req.userId,
  });

  if (roleCode === "ANCHOR" && anchorProfile) {
    await prisma.anchorProfile.update({ where: { id: anchorProfile.id }, data: { boundUserId: req.params.id, status: "bound" } });
  }

  return ok(res, identity);
});

accountRoutes.patch("/accounts/:id/status", permissionRequired("account:create"), async (req, res) => {
  const status = req.body.status === "disabled" ? "disabled" : "active";
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { status } });
  if (status === "disabled") {
    await prisma.userIdentity.updateMany({ where: { userId: req.params.id, status: "active" }, data: { status: "disabled", expiredAt: new Date() } });
  }
  return ok(res, safeUser(user));
});

accountRoutes.post("/accounts/:id/reset-password", permissionRequired("account:create"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return fail(res, "ACCOUNT_NOT_FOUND", "账号不存在", 404);
  const passwordHash = await bcrypt.hash("123456", 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, status: "active" } });
  return ok(res, { reset: true, password: "123456" });
});

accountRoutes.patch("/accounts/identities/:id/status", permissionRequired("identity:grant"), async (req, res) => {
  const current = await prisma.userIdentity.findUnique({ where: { id: req.params.id }, include: { org: true } });
  if (!current) return fail(res, "IDENTITY_NOT_FOUND", "身份不存在", 404);

  const status = req.body.status === "active" ? "active" : "disabled";
  if (status === "active" && isManagementRole(current.roleCode) && current.org) {
    const sameChainConflicts = await findManagementScopeConflicts(current.userId, current.org, current.id);
    if (sameChainConflicts.length) {
      return fail(res, "ORG_SCOPE_CONFLICT", "该账号在当前组织链下已有其他管理权限，请先停用或调整原权限后再启用此权限", 400);
    }
  }

  const data: { status: "active" | "disabled"; expiredAt?: Date | null } = { status };
  if (status === "disabled") data.expiredAt = new Date();
  if (status === "active") data.expiredAt = null;

  const identity = await prisma.userIdentity.update({ where: { id: req.params.id }, data });
  if (identity.roleCode === "ANCHOR" && identity.anchorProfileId) {
    await prisma.anchorProfile.update({
      where: { id: identity.anchorProfileId },
      data: status === "disabled" ? { boundUserId: null, status: "unbound" } : { boundUserId: identity.userId, status: "bound" },
    });
  }
  return ok(res, identity);
});

accountRoutes.delete("/accounts/:id", async (req, res) => {
  if (!ensureDevAdmin(req)) return fail(res, "FORBIDDEN", "仅总公司开发管理员可强制删除账号", 403);
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { identities: true } });
  if (!user) return fail(res, "ACCOUNT_NOT_FOUND", "账号不存在", 404);
  await prisma.$transaction(async (tx) => {
    for (const identity of user.identities) {
      if (identity.roleCode === "ANCHOR" && identity.anchorProfileId) {
        await tx.anchorProfile.update({ where: { id: identity.anchorProfileId }, data: { boundUserId: null, status: "unbound" } });
      }
    }
    await tx.userIdentity.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });
  return ok(res, { deleted: true });
});

accountRoutes.delete("/accounts/identities/:id", async (req, res) => {
  if (!ensureDevAdmin(req)) return fail(res, "FORBIDDEN", "仅总公司开发管理员可强制删除身份", 403);
  const identity = await prisma.userIdentity.findUnique({ where: { id: req.params.id } });
  if (!identity) return fail(res, "IDENTITY_NOT_FOUND", "身份不存在", 404);
  if (identity.roleCode === "ANCHOR" && identity.anchorProfileId) {
    await prisma.anchorProfile.update({ where: { id: identity.anchorProfileId }, data: { boundUserId: null, status: "unbound" } });
  }
  await prisma.userIdentity.delete({ where: { id: identity.id } });
  return ok(res, { deleted: true });
});
