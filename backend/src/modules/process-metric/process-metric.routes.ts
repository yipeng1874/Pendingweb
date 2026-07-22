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

export const processMetricRoutes = Router();
processMetricRoutes.use(authRequired, identityRequired);

/** GET /process-metric/config?scopeOrgId=xxx — 读取当前基地的参与团队配置 */
processMetricRoutes.get(
  "/process-metric/config",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch { return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403); }

    const config = await prisma.processMetricConfig.findUnique({ where: { baseOrgId: baseOrg.id } });
    let teamIds: string[] = [];
    if (config?.teamIds) {
      try { teamIds = JSON.parse(config.teamIds); } catch { /* ignore */ }
    }
    return ok(res, { baseOrgId: baseOrg.id, baseOrgName: baseOrg.name, teamIds });
  }
);

/** PUT /process-metric/config?scopeOrgId=xxx — 保存当前基地的参与团队配置 */
processMetricRoutes.put(
  "/process-metric/config",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权修改配置", 403);
    }

    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch { return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403); }

    const { teamIds } = req.body ?? {};
    if (!Array.isArray(teamIds)) return fail(res, "MISSING_PARAMS", "请提供 teamIds 数组", 400);

    await prisma.processMetricConfig.upsert({
      where: { baseOrgId: baseOrg.id },
      create: { baseOrgId: baseOrg.id, teamIds: JSON.stringify(teamIds), updatedBy: req.userId },
      update: { teamIds: JSON.stringify(teamIds), updatedBy: req.userId },
    });

    return ok(res, { baseOrgId: baseOrg.id, teamIds });
  }
);

/** POST /process-metric/upsert — 覆盖式写入（同团队+同厅+同日期） */
processMetricRoutes.post(
  "/process-metric/upsert",
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

    const { teamOrgId, teamOrgName, hallName, percentage, recordDate } = req.body ?? {};

    if (!teamOrgId || !teamOrgName) return fail(res, "MISSING_PARAMS", "请选择团队", 400);
    if (!hallName) return fail(res, "MISSING_PARAMS", "请填写厅名", 400);
    if (!recordDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(recordDate))) return fail(res, "INVALID_RECORD_DATE", "请提供有效日期（YYYY-MM-DD）", 400);
    if (percentage == null || isNaN(Number(percentage)) || Number(percentage) < 0 || Number(percentage) > 100) return fail(res, "INVALID_PERCENTAGE", "百分比应在 0-100 之间", 400);

    const uploader = await prisma.user.findUnique({ where: { id: req.userId }, select: { nickname: true } });

    const record = await prisma.processMetricDaily.upsert({
      where: { teamOrgId_hallName_recordDate: { teamOrgId: String(teamOrgId), hallName: String(hallName), recordDate: String(recordDate) } },
      create: {
        baseOrgId: baseOrg.id, baseOrgName: baseOrg.name,
        teamOrgId: String(teamOrgId), teamOrgName: String(teamOrgName),
        hallName: String(hallName), percentage: Number(percentage), recordDate: String(recordDate),
        uploadedBy: req.userId, uploaderName: uploader?.nickname ?? "未知",
      },
      update: {
        baseOrgName: baseOrg.name, teamOrgName: String(teamOrgName),
        percentage: Number(percentage),
        uploadedBy: req.userId, uploaderName: uploader?.nickname ?? "未知",
      },
    });
    return ok(res, record);
  }
);

/** POST /process-metric/upsert-batch — 批量覆盖写入 */
processMetricRoutes.post(
  "/process-metric/upsert-batch",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") return fail(res, "FORBIDDEN", "无权录入数据", 403);

    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      return fail(res, e.message, "基地鉴权失败", 403);
    }

    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) return fail(res, "MISSING_PARAMS", "请至少提交一条数据", 400);

    const uploader = await prisma.user.findUnique({ where: { id: req.userId }, select: { nickname: true } });
    const nickname = uploader?.nickname ?? "未知";
    let okCount = 0, failCount = 0;

    for (const item of items) {
      try {
        const { teamOrgId, teamOrgName, hallName, percentage, recordDate } = item;
        if (!teamOrgId || !hallName || !recordDate || percentage == null) { failCount++; continue; }
        await prisma.processMetricDaily.upsert({
          where: { teamOrgId_hallName_recordDate: { teamOrgId: String(teamOrgId), hallName: String(hallName), recordDate: String(recordDate) } },
          create: {
            baseOrgId: baseOrg.id, baseOrgName: baseOrg.name,
            teamOrgId: String(teamOrgId), teamOrgName: String(teamOrgName ?? ""),
            hallName: String(hallName), percentage: Number(percentage), recordDate: String(recordDate),
            uploadedBy: req.userId, uploaderName: nickname,
          },
          update: {
            teamOrgName: String(teamOrgName ?? ""), percentage: Number(percentage),
            uploadedBy: req.userId, uploaderName: nickname,
          },
        });
        okCount++;
      } catch { failCount++; }
    }
    return ok(res, { okCount, failCount });
  }
);

/** GET /process-metric/by-date?scopeOrgId=xxx&days=6 */
processMetricRoutes.get(
  "/process-metric/by-date",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch { return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403); }

    const rawDays = parseInt(req.query.days as string, 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 30) : 6;

    const allRecords = await prisma.processMetricDaily.findMany({
      where: { baseOrgId: baseOrg.id },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }],
    });

    // 按日期 → 团队 → 厅 分组
    const dateMap = new Map<string, Map<string, Map<string, any>>>();
    for (const r of allRecords) {
      if (!dateMap.has(r.recordDate)) dateMap.set(r.recordDate, new Map());
      const teamMap = dateMap.get(r.recordDate)!;
      if (!teamMap.has(r.teamOrgId)) teamMap.set(r.teamOrgId, new Map());
      const hallMap = teamMap.get(r.teamOrgId)!;
      if (!hallMap.has(r.hallName)) hallMap.set(r.hallName, r);
    }

    const sortedDates = Array.from(dateMap.keys()).sort().reverse().slice(0, days).reverse();

    const dateEntries = sortedDates.map((recordDate) => {
      const teamMap = dateMap.get(recordDate)!;
      const teams = Array.from(teamMap.entries()).map(([teamOrgId, hallMap]) => {
        const first = hallMap.values().next().value;
        const halls = Array.from(hallMap.values()).map((h: any) => ({
          hallName: h.hallName,
          percentage: h.percentage,
        })).sort((a, b) => a.hallName.localeCompare(b.hallName));
        return {
          teamOrgId,
          teamOrgName: first?.teamOrgName ?? "",
          halls,
        };
      }).sort((a, b) => a.teamOrgName.localeCompare(b.teamOrgName));

      return { recordDate, teams };
    });

    return ok(res, { baseOrgId: baseOrg.id, baseOrgName: baseOrg.name, dateEntries });
  }
);

/** GET /process-metric/latest-halls?scopeOrgId=xxx&teamOrgId=xxx — 获取某团队最近一次已上传的厅列表 */
processMetricRoutes.get(
  "/process-metric/latest-halls",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch { return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403); }

    const teamOrgId = req.query.teamOrgId as string | undefined;
    const latest = await prisma.processMetricDaily.findFirst({
      where: { baseOrgId: baseOrg.id, ...(teamOrgId ? { teamOrgId } : {}) },
      orderBy: { recordDate: "desc" },
    });
    if (!latest) return ok(res, { halls: [] });

    const records = await prisma.processMetricDaily.findMany({
      where: { baseOrgId: baseOrg.id, recordDate: latest.recordDate, ...(teamOrgId ? { teamOrgId } : {}) },
      select: { teamOrgId: true, teamOrgName: true, hallName: true, percentage: true },
      orderBy: { hallName: "asc" },
    });

    // 按团队分组
    const teamMap = new Map<string, { teamOrgId: string; teamOrgName: string; halls: { hallName: string; percentage: number }[] }>();
    for (const r of records) {
      if (!teamMap.has(r.teamOrgId)) teamMap.set(r.teamOrgId, { teamOrgId: r.teamOrgId, teamOrgName: r.teamOrgName, halls: [] });
      teamMap.get(r.teamOrgId)!.halls.push({ hallName: r.hallName, percentage: r.percentage });
    }
    return ok(res, { teams: Array.from(teamMap.values()) });
  }
);

/** DELETE /process-metric?scopeOrgId=xxx&teamOrgId=xxx&hallName=xxx&recordDate=xxx — 删除某条记录 */
processMetricRoutes.delete(
  "/process-metric",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权删除数据", 403);
    }

    let baseOrg: { id: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch { return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403); }

    const { teamOrgId, hallName, recordDate } = req.query;
    if (!teamOrgId || !hallName || !recordDate) {
      return fail(res, "MISSING_PARAMS", "请提供 teamOrgId / hallName / recordDate", 400);
    }

    const existing = await prisma.processMetricDaily.findFirst({
      where: { baseOrgId: baseOrg.id, teamOrgId: String(teamOrgId), hallName: String(hallName), recordDate: String(recordDate) },
    });
    if (!existing) return fail(res, "NOT_FOUND", "记录不存在", 404);

    await prisma.processMetricDaily.delete({ where: { id: existing.id } });
    return ok(res, { deleted: true });
  }
);
