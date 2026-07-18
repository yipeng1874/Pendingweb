import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

/** ── 通用：解析角色所属基地 ── */
async function resolveBaseScopeOrg(scopeOrgId: string | undefined, identity: any) {
  const roleCode = identity?.roleCode;
  const scopePath = identity?.scopePath;
  const identityOrgId = identity?.orgId;

  if (roleCode === "HQ_ADMIN" || roleCode === "DEV_ADMIN") {
    if (!scopeOrgId) {
      const where: any = { status: "active", orgType: "BASE" };
      if (roleCode !== "DEV_ADMIN" && scopePath) {
        where.path = { startsWith: scopePath };
      }
      const fallback = await prisma.orgUnit.findFirst({ where, orderBy: { depth: "asc" } });
      if (fallback) return fallback as any;
      throw new Error("BASE_SCOPE_REQUIRED");
    }
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
    where: { status: "active", orgType: "BASE", path: { in: org.path.split("/").filter(Boolean).map((_, i, a) => `/${a.slice(0, i + 1).join("/")}`) } },
    orderBy: { depth: "desc" },
    select: { id: true, name: true, path: true, orgType: true },
  });
  if (!base) throw new Error("BASE_SCOPE_REQUIRED");
  return base;
}

export const liveRoomCapacityRoutes = Router();
liveRoomCapacityRoutes.use(authRequired, identityRequired);

// ═══════════════════════════════════════════════════════
//  场地管理 CRUD
// ═══════════════════════════════════════════════════════

/** GET /live-room-sites?scopeOrgId=xxx — 获取基地下所有场地（按 sort 排序） */
liveRoomCapacityRoutes.get(
  "/live-room-sites",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch {
      return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403);
    }

    const sites = await prisma.liveRoomSite.findMany({
      where: { baseOrgId: baseOrg.id },
      orderBy: { sort: "asc" },
    });

    return ok(res, sites);
  }
);

/** POST /live-room-sites?scopeOrgId=xxx — 创建场地 */
liveRoomCapacityRoutes.post(
  "/live-room-sites",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权创建场地", 403);
    }

    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      return fail(res, e.message, "基地鉴权失败", 403);
    }

    const { name, sort } = req.body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return fail(res, "MISSING_PARAMS", "场地名称不能为空", 400);
    }

    // 检查同名
    const exist = await prisma.liveRoomSite.findFirst({
      where: { baseOrgId: baseOrg.id, name: name.trim() },
    });
    if (exist) {
      return fail(res, "DUPLICATE", "同基地下场地名称不可重复", 409);
    }

    const site = await prisma.liveRoomSite.create({
      data: {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        name: name.trim(),
        sort: typeof sort === "number" ? sort : 0,
      },
    });

    return res.status(201).json({ success: true, data: site });
  }
);

/** PUT /live-room-sites/:id — 修改场地名/排序 */
liveRoomCapacityRoutes.put(
  "/live-room-sites/:id",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权修改场地", 403);
    }

    const { id } = req.params;
    const existing = await prisma.liveRoomSite.findUnique({ where: { id } });
    if (!existing) {
      return fail(res, "NOT_FOUND", "场地不存在", 404);
    }

    const { name, sort } = req.body ?? {};
    const data: any = {};
    if (name !== undefined && typeof name === "string" && name.trim()) {
      // 检查同名（排除自身）
      const dup = await prisma.liveRoomSite.findFirst({
        where: { baseOrgId: existing.baseOrgId, name: name.trim(), id: { not: id } },
      });
      if (dup) {
        return fail(res, "DUPLICATE", "同基地下场地名称不可重复", 409);
      }
      data.name = name.trim();
    }
    if (typeof sort === "number") {
      data.sort = sort;
    }

    if (Object.keys(data).length === 0) {
      return fail(res, "MISSING_PARAMS", "至少提供 name 或 sort", 400);
    }

    const site = await prisma.liveRoomSite.update({ where: { id }, data });
    return ok(res, site);
  }
);

/** DELETE /live-room-sites/:id — 删除场地（次日 upsert 时自然从 capacity JSON 中消失） */
liveRoomCapacityRoutes.delete(
  "/live-room-sites/:id",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权删除场地", 403);
    }

    const { id } = req.params;
    const site = await prisma.liveRoomSite.findUnique({ where: { id } });
    if (!site) {
      return fail(res, "NOT_FOUND", "场地不存在", 404);
    }

    await prisma.liveRoomSite.delete({ where: { id } });
    return ok(res, { id });
  }
);

// ═══════════════════════════════════════════════════════
//  容量快照 读/写
// ═══════════════════════════════════════════════════════

/** POST /live-room-capacity/upsert — 覆盖式写入 siteDetails */
liveRoomCapacityRoutes.post(
  "/live-room-capacity/upsert",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权录入直播间空余数据", 403);
    }

    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      return fail(res, e.message, "基地鉴权失败", 403);
    }

    const { siteDetails } = req.body ?? {};
    if (!Array.isArray(siteDetails)) {
      return fail(res, "MISSING_PARAMS", "siteDetails 必须为数组", 400);
    }

    // 获取该基地所有现存场地 ID 用于校验
    const validSites = await prisma.liveRoomSite.findMany({
      where: { baseOrgId: baseOrg.id },
    });
    const validIds = new Set(validSites.map((s) => s.id));

    // 校验
    for (const sd of siteDetails) {
      if (!sd.siteId || typeof sd.siteId !== "string") {
        return fail(res, "INVALID_PARAM", "每个场地必须提供 siteId", 400);
      }
      if (!validIds.has(sd.siteId)) {
        return fail(res, "INVALID_PARAM", `场地 ${sd.siteId} 不存在`, 400);
      }
      if (!Array.isArray(sd.rooms)) {
        return fail(res, "INVALID_PARAM", `场地 ${sd.siteName || sd.siteId} 的 rooms 必须为数组`, 400);
      }
      const seenTypes = new Set<string>();
      for (const r of sd.rooms) {
        if (!r.typeName || typeof r.typeName !== "string" || !r.typeName.trim()) {
          return fail(res, "INVALID_PARAM", `场地 ${sd.siteName || sd.siteId} 存在空的类型名`, 400);
        }
        if (seenTypes.has(r.typeName.trim())) {
          return fail(res, "INVALID_PARAM", `场地 ${sd.siteName || sd.siteId} 类型 "${r.typeName}" 重复`, 400);
        }
        seenTypes.add(r.typeName.trim());
        if (!Number.isInteger(r.used) || r.used < 0) {
          return fail(res, "INVALID_PARAM", `"${r.typeName}" 的已使用数需为非负整数`, 400);
        }
        if (!Number.isInteger(r.total) || r.total < 0) {
          return fail(res, "INVALID_PARAM", `"${r.typeName}" 的总数需为非负整数`, 400);
        }
        // 校验 allocations（可选字段）
        if (r.allocations !== undefined) {
          if (!Array.isArray(r.allocations)) {
            return fail(res, "INVALID_PARAM", `"${r.typeName}" 的 allocations 需为数组`, 400);
          }
          for (const a of r.allocations) {
            if (!a.orgId || typeof a.orgId !== "string") {
              return fail(res, "INVALID_PARAM", `"${r.typeName}" 的团队分配缺少 orgId`, 400);
            }
            if (!a.orgName || typeof a.orgName !== "string") {
              return fail(res, "INVALID_PARAM", `"${r.typeName}" 的团队分配缺少 orgName`, 400);
            }
            if (!Number.isInteger(a.used) || a.used < 0) {
              return fail(res, "INVALID_PARAM", `"${r.typeName}" 的团队 "${a.orgName}" 占用数需为非负整数`, 400);
            }
          }
        }
      }
    }

    const uploader = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { nickname: true },
    });

    // 补全 siteName（前端可能在提交时没带）
    const siteMap = new Map(validSites.map((s) => [s.id, s.name]));
    const normalized = siteDetails.map((sd: any) => ({
      siteId: sd.siteId,
      siteName: sd.siteName || siteMap.get(sd.siteId) || sd.siteId,
      rooms: (sd.rooms ?? []).map((r: any) => {
        const room: any = {
          typeName: r.typeName.trim(),
          used: r.used,
          total: r.total,
        };
        // 保留 allocations（如果存在且非空）
        if (Array.isArray(r.allocations) && r.allocations.length > 0) {
          room.allocations = r.allocations
            .filter((a: any) => a.used > 0)
            .map((a: any) => ({
              orgId: a.orgId,
              orgName: a.orgName,
              used: a.used,
            }));
        }
        return room;
      }),
    }));

    const record = await prisma.liveRoomCapacity.upsert({
      where: { baseOrgId: baseOrg.id },
      create: {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        siteDetails: normalized,
        updatedBy: req.userId,
        updaterName: uploader?.nickname ?? "未知",
      },
      update: {
        baseOrgName: baseOrg.name,
        siteDetails: normalized,
        updatedBy: req.userId,
        updaterName: uploader?.nickname ?? "未知",
      },
    });

    return ok(res, record);
  }
);

/** GET /live-room-capacity/latest?scopeOrgId=xxx */
liveRoomCapacityRoutes.get(
  "/live-room-capacity/latest",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch {
      return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403);
    }

    const record = await prisma.liveRoomCapacity.findFirst({
      where: { baseOrgId: baseOrg.id },
    });

    return ok(res, record ?? null);
  }
);
