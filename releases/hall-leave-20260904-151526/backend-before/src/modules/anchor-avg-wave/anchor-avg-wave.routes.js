import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";
async function resolveBaseScopeOrg(scopeOrgId, identity) {
    const roleCode = identity?.roleCode;
    const scopePath = identity?.scopePath;
    const identityOrgId = identity?.orgId;
    if (roleCode === "HQ_ADMIN" || roleCode === "DEV_ADMIN") {
        if (!scopeOrgId) {
            const where = { status: "active", orgType: "BASE" };
            if (roleCode !== "DEV_ADMIN" && scopePath) {
                where.path = { startsWith: scopePath };
            }
            const fallback = await prisma.orgUnit.findFirst({ where, orderBy: { depth: "asc" } });
            if (fallback)
                return fallback;
            throw new Error("BASE_SCOPE_REQUIRED");
        }
        const org = await prisma.orgUnit.findFirst({
            where: { id: scopeOrgId, status: "active", orgType: "BASE" },
            select: { id: true, name: true, path: true, orgType: true },
        });
        if (!org)
            throw new Error("SCOPE_ORG_NOT_FOUND");
        if (roleCode !== "DEV_ADMIN" && scopePath && !(org.path === scopePath || org.path.startsWith(`${scopePath}/`))) {
            throw new Error("SCOPE_ORG_FORBIDDEN");
        }
        return org;
    }
    if (!identityOrgId)
        throw new Error("SCOPE_ORG_NOT_FOUND");
    const org = await prisma.orgUnit.findFirst({
        where: { id: identityOrgId, status: "active" },
        select: { id: true, name: true, path: true, orgType: true },
    });
    if (!org)
        throw new Error("SCOPE_ORG_NOT_FOUND");
    const base = await prisma.orgUnit.findFirst({
        where: { status: "active", orgType: "BASE", path: { in: org.path.split("/").filter(Boolean).map((_, i, a) => `/${a.slice(0, i + 1).join("/")}`) } },
        orderBy: { depth: "desc" },
        select: { id: true, name: true, path: true, orgType: true },
    });
    if (!base)
        throw new Error("BASE_SCOPE_REQUIRED");
    return base;
}
export const anchorAvgWaveRoutes = Router();
anchorAvgWaveRoutes.use(authRequired, identityRequired);
/** POST /anchor-avg-wave/upsert — 每日覆盖式写入 */
anchorAvgWaveRoutes.post("/anchor-avg-wave/upsert", permissionRequired("task:report:view"), async (req, res) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
        return fail(res, "FORBIDDEN", "无权录入人均音浪数据", 403);
    }
    let baseOrg;
    try {
        baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId, req.identity);
    }
    catch (e) {
        return fail(res, e.message, "基地鉴权失败", 403);
    }
    const { recordDate, avgWaveValue, totalWave, anchorCount, waveType } = req.body ?? {};
    const wt = String(waveType ?? "online");
    if (wt !== "online" && wt !== "offline" && wt !== "total") {
        return fail(res, "INVALID_WAVE_TYPE", "waveType 必须为 online、offline 或 total", 400);
    }
    if (!recordDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(recordDate))) {
        return fail(res, "INVALID_RECORD_DATE", "请提供有效的归属日期（YYYY-MM-DD）", 400);
    }
    if (avgWaveValue == null || typeof avgWaveValue !== "number") {
        return fail(res, "MISSING_PARAMS", "请填写人均音浪值", 400);
    }
    const uploader = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { nickname: true },
    });
    const record = await prisma.anchorAvgWaveDaily.upsert({
        where: {
            baseOrgId_recordDate_waveType: { baseOrgId: baseOrg.id, recordDate: String(recordDate), waveType: wt },
        },
        create: {
            baseOrgId: baseOrg.id,
            baseOrgName: baseOrg.name,
            recordDate: String(recordDate),
            waveType: wt,
            avgWaveValue,
            totalWave: totalWave ?? 0,
            anchorCount: anchorCount ?? 0,
            uploadedBy: req.userId,
            uploaderName: uploader?.nickname ?? "未知",
        },
        update: {
            baseOrgName: baseOrg.name,
            avgWaveValue,
            totalWave: totalWave ?? 0,
            anchorCount: anchorCount ?? 0,
            uploadedBy: req.userId,
            uploaderName: uploader?.nickname ?? "未知",
        },
    });
    return ok(res, record);
});
/** GET /anchor-avg-wave/latest?scopeOrgId=xxx */
anchorAvgWaveRoutes.get("/anchor-avg-wave/latest", permissionRequired("task:report:view"), async (req, res) => {
    let baseOrg;
    try {
        baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId, req.identity);
    }
    catch {
        return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403);
    }
    const online = await prisma.anchorAvgWaveDaily.findFirst({
        where: { baseOrgId: baseOrg.id, waveType: "online" },
        orderBy: { recordDate: "desc" },
    });
    const offline = await prisma.anchorAvgWaveDaily.findFirst({
        where: { baseOrgId: baseOrg.id, waveType: "offline" },
        orderBy: { recordDate: "desc" },
    });
    const total = await prisma.anchorAvgWaveDaily.findFirst({
        where: { baseOrgId: baseOrg.id, waveType: "total" },
        orderBy: { recordDate: "desc" },
    });
    return ok(res, { online: online ?? null, offline: offline ?? null, total: total ?? null });
});
/** GET /anchor-avg-wave/trend?scopeOrgId=xxx&days=7 */
anchorAvgWaveRoutes.get("/anchor-avg-wave/trend", permissionRequired("task:report:view"), async (req, res) => {
    let baseOrg;
    try {
        baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId, req.identity);
    }
    catch {
        return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403);
    }
    const rawDays = parseInt(req.query.days, 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 90) : 7;
    async function getTrendForType(waveType) {
        const allRaw = await prisma.anchorAvgWaveDaily.findMany({
            where: { baseOrgId: baseOrg.id, waveType },
            orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }],
        });
        const seen = new Set();
        const deduped = [];
        for (const r of allRaw) {
            if (seen.has(r.recordDate))
                continue;
            seen.add(r.recordDate);
            deduped.push(r);
            if (deduped.length >= days)
                break;
        }
        const records = deduped.reverse();
        const latest = records.length > 0 ? records[records.length - 1] : null;
        const prevDay = records.length > 1 ? records[records.length - 2] : null;
        const change = latest && prevDay ? latest.avgWaveValue - prevDay.avgWaveValue : 0;
        return {
            points: records.map((r) => ({ recordDate: r.recordDate, avgWaveValue: r.avgWaveValue })),
            latest: latest ? { id: latest.id, recordDate: latest.recordDate, avgWaveValue: latest.avgWaveValue, totalWave: latest.totalWave, anchorCount: latest.anchorCount, uploadedBy: latest.uploadedBy, uploaderName: latest.uploaderName } : null,
            prevDay: prevDay ? { recordDate: prevDay.recordDate, avgWaveValue: prevDay.avgWaveValue } : null,
            change,
        };
    }
    const [online, offline, total] = await Promise.all([
        getTrendForType("online"),
        getTrendForType("offline"),
        getTrendForType("total"),
    ]);
    return ok(res, {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        online,
        offline,
        total,
    });
});
