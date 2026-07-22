import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

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

export const staffTurnoverRoutes = Router();
staffTurnoverRoutes.use(authRequired, identityRequired);

/** POST /staff-turnover/upsert — 覆盖式写入（同团队+同日期 自动覆盖） */
staffTurnoverRoutes.post(
  "/staff-turnover/upsert",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权录入数据", 403);
    }

    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      return fail(res, e.message, "基地鉴权失败", 403);
    }

    const {
      teamOrgId, teamOrgName, recordDate,
      lossCount, lossAvgWave,
      activeOnlineCount, activeOnlineAvgWave,
      activeOfflineCount, activeOfflineAvgWave,
    } = req.body ?? {};

    if (!teamOrgId || !teamOrgName) {
      return fail(res, "MISSING_PARAMS", "请选择团队", 400);
    }
    if (!recordDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(recordDate))) {
      return fail(res, "INVALID_RECORD_DATE", "请提供有效的日期（YYYY-MM-DD）", 400);
    }
    if (
      lossCount == null || lossAvgWave == null ||
      activeOnlineCount == null || activeOnlineAvgWave == null ||
      activeOfflineCount == null || activeOfflineAvgWave == null
    ) {
      return fail(res, "MISSING_PARAMS", "请填写所有 6 个字段", 400);
    }

    const uploader = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { nickname: true },
    });

    const record = await prisma.staffTurnoverDaily.upsert({
      where: {
        teamOrgId_recordDate: { teamOrgId: String(teamOrgId), recordDate: String(recordDate) },
      },
      create: {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        teamOrgId: String(teamOrgId),
        teamOrgName: String(teamOrgName),
        recordDate: String(recordDate),
        lossCount: Number(lossCount),
        lossAvgWave: Number(lossAvgWave),
        activeOnlineCount: Number(activeOnlineCount),
        activeOnlineAvgWave: Number(activeOnlineAvgWave),
        activeOfflineCount: Number(activeOfflineCount),
        activeOfflineAvgWave: Number(activeOfflineAvgWave),
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
      },
      update: {
        baseOrgName: baseOrg.name,
        teamOrgName: String(teamOrgName),
        lossCount: Number(lossCount),
        lossAvgWave: Number(lossAvgWave),
        activeOnlineCount: Number(activeOnlineCount),
        activeOnlineAvgWave: Number(activeOnlineAvgWave),
        activeOfflineCount: Number(activeOfflineCount),
        activeOfflineAvgWave: Number(activeOfflineAvgWave),
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
      },
    });

    return ok(res, record);
  }
);

/** GET /staff-turnover/list?scopeOrgId=xxx — 获取基地下所有团队列表 + 最新日期摘要 */
staffTurnoverRoutes.get(
  "/staff-turnover/list",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string; path: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch {
      return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403);
    }

    const teams = await prisma.orgUnit.findMany({
      where: { status: "active", orgType: "TEAM", path: { startsWith: baseOrg.path + "/" } },
      select: { id: true, name: true },
    });

    return ok(res, {
      baseOrgId: baseOrg.id,
      baseOrgName: baseOrg.name,
      teams,
    });
  }
);

/** GET /staff-turnover/by-date?scopeOrgId=xxx&days=12
 *  返回按日期聚合的数据，每个日期包含汇总指标 + 该日期各团队明细 */
staffTurnoverRoutes.get(
  "/staff-turnover/by-date",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch {
      return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403);
    }

    const rawDays = parseInt(req.query.days as string, 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 30) : 6;

    // 拉取基地下所有记录
    const allRecords = await prisma.staffTurnoverDaily.findMany({
      where: { baseOrgId: baseOrg.id },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }],
    });

    // 按日期分组去重（同一天同团队取最新 updatedAt），然后按日期聚合
    const dateMap = new Map<string, Map<string, any>>();
    for (const r of allRecords) {
      if (!dateMap.has(r.recordDate)) {
        dateMap.set(r.recordDate, new Map());
      }
      const teamMap = dateMap.get(r.recordDate)!;
      if (!teamMap.has(r.teamOrgId)) {
        teamMap.set(r.teamOrgId, r);
      }
    }

    // 排序日期，取最近 days 个
    const sortedDates = Array.from(dateMap.keys()).sort().reverse().slice(0, days).reverse();

    const dateEntries = sortedDates.map((recordDate) => {
      const teamMap = dateMap.get(recordDate)!;
      const teamRecords = Array.from(teamMap.values());

      // 汇总聚合（人数直接求和，音浪用加权平均 = Σ(人均×人数) / Σ人数）
      const totalLoss = teamRecords.reduce((s, r) => s + r.lossCount, 0);
      const totalOnline = teamRecords.reduce((s, r) => s + r.activeOnlineCount, 0);
      const totalOffline = teamRecords.reduce((s, r) => s + r.activeOfflineCount, 0);
      const totalActive = totalOnline + totalOffline;  // 线上+线下合计
      // 线上+线下音浪加权均值 = (线上音浪×线上人数 + 线下音浪×线下人数) / (线上+线下人数)
      const totalActiveWave = totalActive > 0
        ? teamRecords.reduce((s, r) => s
          + (r.activeOnlineAvgWave ?? 0) * (r.activeOnlineCount || 0)
          + (r.activeOfflineAvgWave ?? 0) * (r.activeOfflineCount || 0), 0) / totalActive
        : 0;

      const aggregated = {
        lossCount: totalLoss,
        lossAvgWave: totalLoss > 0
          ? teamRecords.reduce((s, r) => s + (r.lossAvgWave ?? 0) * (r.lossCount || 0), 0) / totalLoss
          : 0,
        activeOnlineCount: totalOnline,
        activeOnlineAvgWave: totalOnline > 0
          ? teamRecords.reduce((s, r) => s + (r.activeOnlineAvgWave ?? 0) * (r.activeOnlineCount || 0), 0) / totalOnline
          : 0,
        activeOfflineCount: totalOffline,
        activeOfflineAvgWave: totalOffline > 0
          ? teamRecords.reduce((s, r) => s + (r.activeOfflineAvgWave ?? 0) * (r.activeOfflineCount || 0), 0) / totalOffline
          : 0,
        activeTotalCount: totalActive,
        activeTotalAvgWave: totalActiveWave,
      };

      const teams = teamRecords.map((r) => {
        const activeTotal = (r.activeOnlineCount || 0) + (r.activeOfflineCount || 0);
        const activeTotalWave = activeTotal > 0
          ? ((r.activeOnlineAvgWave ?? 0) * (r.activeOnlineCount || 0) + (r.activeOfflineAvgWave ?? 0) * (r.activeOfflineCount || 0)) / activeTotal
          : 0;
        return {
          teamOrgId: r.teamOrgId,
          teamOrgName: r.teamOrgName,
          lossCount: r.lossCount,
          lossAvgWave: r.lossAvgWave,
          activeOnlineCount: r.activeOnlineCount,
          activeOnlineAvgWave: r.activeOnlineAvgWave,
          activeOfflineCount: r.activeOfflineCount,
          activeOfflineAvgWave: r.activeOfflineAvgWave,
          activeTotalCount: activeTotal,
          activeTotalAvgWave: activeTotalWave,
        };
      }).sort((a, b) => a.teamOrgName.localeCompare(b.teamOrgName));

      return { recordDate, aggregated, teams };
    });

    return ok(res, {
      baseOrgId: baseOrg.id,
      baseOrgName: baseOrg.name,
      dateEntries,
    });
  }
);
