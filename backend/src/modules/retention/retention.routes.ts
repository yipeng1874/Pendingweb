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

export const retentionRoutes = Router();
retentionRoutes.use(authRequired, identityRequired);

/** POST /retention/upsert — 覆盖式写入（同团队+同月份 自动覆盖） */
retentionRoutes.post(
  "/retention/upsert",
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
      teamOrgId, teamOrgName, recordMonth,
      loss3Days, loss15Days, loss30Days, activeCount,
    } = req.body ?? {};

    if (!teamOrgId || !teamOrgName) {
      return fail(res, "MISSING_PARAMS", "请选择团队", 400);
    }
    if (!recordMonth || !/^\d{4}-\d{2}$/.test(String(recordMonth))) {
      return fail(res, "INVALID_RECORD_MONTH", "请提供有效的月份（YYYY-MM）", 400);
    }
    if (
      loss3Days == null || loss15Days == null || loss30Days == null ||
      activeCount == null
    ) {
      return fail(res, "MISSING_PARAMS", "请填写所有 4 个字段", 400);
    }

    const uploader = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { nickname: true },
    });

    const record = await prisma.retentionMonthly.upsert({
      where: {
        teamOrgId_recordMonth: { teamOrgId: String(teamOrgId), recordMonth: String(recordMonth) },
      },
      create: {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        teamOrgId: String(teamOrgId),
        teamOrgName: String(teamOrgName),
        recordMonth: String(recordMonth),
        loss3Days: Number(loss3Days),
        loss15Days: Number(loss15Days),
        loss30Days: Number(loss30Days),
        activeCount: Number(activeCount),
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
      },
      update: {
        baseOrgName: baseOrg.name,
        teamOrgName: String(teamOrgName),
        loss3Days: Number(loss3Days),
        loss15Days: Number(loss15Days),
        loss30Days: Number(loss30Days),
        activeCount: Number(activeCount),
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
      },
    });

    return ok(res, record);
  }
);

/** GET /retention/list?scopeOrgId=xxx — 获取基地下所有团队列表 */
retentionRoutes.get(
  "/retention/list",
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

/** GET /retention/by-month?scopeOrgId=xxx&months=6
 *  返回按月份聚合的数据，每个月份包含汇总指标 + 该月份各团队明细 */
retentionRoutes.get(
  "/retention/by-month",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch {
      return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403);
    }

    const rawMonths = parseInt(req.query.months as string, 10);
    const months = Number.isFinite(rawMonths) && rawMonths > 0 ? Math.min(rawMonths, 12) : 6;

    // 拉取基地下所有记录
    const allRecords = await prisma.retentionMonthly.findMany({
      where: { baseOrgId: baseOrg.id },
      orderBy: [{ recordMonth: "desc" }, { updatedAt: "desc" }],
    });

    // 按月份分组去重（同一个月同团队取最新 updatedAt），然后按月份聚合
    const monthMap = new Map<string, Map<string, any>>();
    for (const r of allRecords) {
      if (!monthMap.has(r.recordMonth)) {
        monthMap.set(r.recordMonth, new Map());
      }
      const teamMap = monthMap.get(r.recordMonth)!;
      if (!teamMap.has(r.teamOrgId)) {
        teamMap.set(r.teamOrgId, r);
      }
    }

    // 排序月份，取最近 months 个
    const sortedMonths = Array.from(monthMap.keys()).sort().reverse().slice(0, months).reverse();

    const monthEntries = sortedMonths.map((recordMonth) => {
      const teamMap = monthMap.get(recordMonth)!;
      const teamRecords = Array.from(teamMap.values());

      // 汇总聚合（四个字段都是人数，直接求和）
      const totalLoss3Days = teamRecords.reduce((s, r) => s + r.loss3Days, 0);
      const totalLoss15Days = teamRecords.reduce((s, r) => s + r.loss15Days, 0);
      const totalLoss30Days = teamRecords.reduce((s, r) => s + r.loss30Days, 0);
      const totalActiveCount = teamRecords.reduce((s, r) => s + r.activeCount, 0);

      const aggregated = {
        loss3Days: totalLoss3Days,
        loss15Days: totalLoss15Days,
        loss30Days: totalLoss30Days,
        activeCount: totalActiveCount,
      };

      const teams = teamRecords.map((r) => ({
        teamOrgId: r.teamOrgId,
        teamOrgName: r.teamOrgName,
        loss3Days: r.loss3Days,
        loss15Days: r.loss15Days,
        loss30Days: r.loss30Days,
        activeCount: r.activeCount,
      })).sort((a, b) => a.teamOrgName.localeCompare(b.teamOrgName));

      return { recordMonth, aggregated, teams };
    });

    return ok(res, {
      baseOrgId: baseOrg.id,
      baseOrgName: baseOrg.name,
      monthEntries,
    });
  }
);
