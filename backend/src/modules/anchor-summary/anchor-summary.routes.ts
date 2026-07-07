import { Router } from "express";
import multer from "multer";
import * as xlsx from "xlsx";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

// ---------- 工具函数 ----------

/** 将 Excel 序列号或字符串日期统一解析为 Date | null */
function parseExcelDate(val: unknown): Date | null {
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") {
    // Excel 以 1900-01-01 = 1 起算，并错误地把 1900-02-29 当作存在
    const d = new Date((val - 25567) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === "string") {
    const cleaned = val.replace(/\//g, "-").trim();
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isWithinDays(date: Date, days: number, referenceDate: Date): boolean {
  const diffMs = referenceDate.getTime() - date.getTime();
  const diffDays = diffMs / 86400000;
  return diffDays >= 0 && diffDays <= days;
}

/** 判断两个日期是否是同一天（用于当日新增） */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 解析 BASE 级别作用域（与 report.routes.ts 保持一致） */
async function resolveBaseScopeOrg(scopeOrgId: string | undefined, identity: any) {
  const roleCode = identity?.roleCode;
  const scopePath = identity?.scopePath;
  const identityOrgId = identity?.orgId;

  if (roleCode === "HQ_ADMIN" || roleCode === "DEV_ADMIN") {
    if (!scopeOrgId) throw new Error("BASE_SCOPE_REQUIRED");
    const org = await prisma.orgUnit.findFirst({
      where: { id: scopeOrgId, status: "active", orgType: "BASE" },
      select: { id: true, name: true, path: true, orgType: true },
    });
    if (!org) throw new Error("SCOPE_ORG_NOT_FOUND");
    if (
      roleCode !== "DEV_ADMIN" &&
      scopePath &&
      !(org.path === scopePath || org.path.startsWith(`${scopePath}/`))
    ) {
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
    where: {
      status: "active",
      orgType: "BASE",
      path: {
        in: org.path
          .split("/")
          .filter(Boolean)
          .map((_, index, parts) => `/${parts.slice(0, index + 1).join("/")}`),
      },
    },
    orderBy: { depth: "desc" },
    select: { id: true, name: true, path: true, orgType: true },
  });
  if (!base) throw new Error("BASE_SCOPE_REQUIRED");
  return base;
}

// ---------- multer（内存存储，不写磁盘） ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter(_req, file, cb) {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ];
    // 也兼容文件名后缀
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    if (allowed.includes(file.mimetype) || ext === "xlsx" || ext === "xls") {
      cb(null, true);
    } else {
      cb(new Error("ONLY_EXCEL_ALLOWED"));
    }
  },
});

// ---------- 必要列名 ----------

const REQUIRED_COLS = ["主播昵称", "所属基地", "所属运营", "主播类型"];

// 入职/加入日期列候选（兼容多种表头命名）
const JOIN_DATE_COL_CANDIDATES = ["入职日期", "加入时间", "入职时间", "加入日期"];

export type OperatorStat = {
  name: string;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  within7Days: number;
  within20Days: number;
  dailyNew: number;
};

// ---------- 路由 ----------

export const anchorSummaryRoutes = Router();
anchorSummaryRoutes.use(authRequired, identityRequired);

/** 上传接口：POST /anchor-summary/upload */
anchorSummaryRoutes.post(
  "/anchor-summary/upload",
  permissionRequired("task:report:view"),
  (req: any, res: any, next: any) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE")
          return fail(res, "FILE_TOO_LARGE", "文件不得超过 10MB", 400);
        if (err.message === "ONLY_EXCEL_ALLOWED")
          return fail(res, "MIME_NOT_ALLOWED", "只支持上传 xlsx / xls 格式文件", 400);
        return fail(res, "UPLOAD_ERROR", "上传失败", 500);
      }
      next();
    });
  },
  async (req: any, res: any) => {
    if (!req.file) return fail(res, "NO_FILE", "请选择要上传的 Excel 文件", 400);

    // 鉴权角色校验：TEAM_ADMIN / HALL_MANAGER 不允许上传
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权上传主播汇总表", 403);
    }

    // 解析作用域基地
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      const msgMap: Record<string, string> = {
        BASE_SCOPE_REQUIRED: "请先选择基地",
        SCOPE_ORG_NOT_FOUND: "基地不存在",
        SCOPE_ORG_FORBIDDEN: "无权访问该基地",
      };
      return fail(res, e.message, msgMap[e.message] ?? "鉴权失败", 403);
    }

    // recordDate 必填（格式 YYYY-MM-DD）
    const recordDate = (req.body?.recordDate ?? "").toString().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) {
      return fail(res, "INVALID_RECORD_DATE", "请提供有效的归属日期（YYYY-MM-DD）", 400);
    }

    // 解析 Excel
    let wb: xlsx.WorkBook;
    try {
      wb = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true });
    } catch {
      return fail(res, "PARSE_ERROR", "Excel 文件解析失败，请确认文件格式正确", 400);
    }

    const sheetName = wb.SheetNames[0];
    if (!sheetName) return fail(res, "EMPTY_FILE", "Excel 文件为空", 400);

    const sheet = wb.Sheets[sheetName];
    const rows: Record<string, unknown>[] = xlsx.utils.sheet_to_json(sheet, {
      raw: false,
      defval: "",
    });

    if (rows.length === 0) {
      return fail(res, "EMPTY_SHEET", "表格无数据行", 400);
    }

    // 校验列头
    const headers = Object.keys(rows[0]);
    const missing = REQUIRED_COLS.filter((col) => !headers.includes(col));
    if (missing.length > 0) {
      return fail(res, "MISSING_COLUMNS", `表格缺少必要列：${missing.join("、")}`, 400);
    }

    // 找入职日期列
    const joinDateCol = JOIN_DATE_COL_CANDIDATES.find((c) => headers.includes(c)) ?? null;

    // 使用 recordDate（归属日期）作为计算基准，而非今天
    const refDate = new Date(recordDate);
    refDate.setHours(0, 0, 0, 0);

    let totalCount = 0;
    let onlineCount = 0;
    let offlineCount = 0;
    let within7Days = 0;
    let within20Days = 0;
    let dailyNew = 0;

    const operatorMap = new Map<string, OperatorStat>();

    // 原始明细数据（每条主播的入职日期 + 类型），供前端动态试用期过滤
    const rawAnchors: { joinDate: string | null; isOnline: boolean }[] = [];

    for (const row of rows) {
      const operatorName = String(row["所属运营"] ?? "").trim() || "未知运营";
      // 直接用"主播类型"字段判断线上/线下
      const anchorType = String(row["主播类型"] ?? "").trim();
      const isOnline = anchorType === "线上";

      // 解析入职/加入日期
      const rawDateVal = joinDateCol ? row[joinDateCol] : undefined;
      let joinDate: Date | null = null;
      if (rawDateVal instanceof Date) {
        joinDate = rawDateVal;
      } else {
        joinDate = parseExcelDate(rawDateVal);
      }

      // 存原始明细
      rawAnchors.push({
        joinDate: joinDate ? joinDate.toISOString().slice(0, 10) : null,
        isOnline,
      });

      totalCount++;
      if (isOnline) onlineCount++;
      else offlineCount++;

      if (joinDate) {
        if (isWithinDays(joinDate, 7, refDate)) within7Days++;
        if (isWithinDays(joinDate, 20, refDate)) within20Days++;
        if (isSameDay(joinDate, refDate)) dailyNew++;
      }

      // 运营分组
      if (!operatorMap.has(operatorName)) {
        operatorMap.set(operatorName, {
          name: operatorName,
          totalCount: 0,
          onlineCount: 0,
          offlineCount: 0,
          within7Days: 0,
          within20Days: 0,
          dailyNew: 0,
        });
      }
      const opStat = operatorMap.get(operatorName)!;
      opStat.totalCount++;
      if (isOnline) opStat.onlineCount++;
      else opStat.offlineCount++;
      if (joinDate) {
        if (isWithinDays(joinDate, 7, refDate)) opStat.within7Days++;
        if (isWithinDays(joinDate, 20, refDate)) opStat.within20Days++;
        if (isSameDay(joinDate, refDate)) opStat.dailyNew++;
      }
    }

    const operatorStats: OperatorStat[] = Array.from(operatorMap.values()).sort((a, b) =>
      b.totalCount - a.totalCount
    );

    // 获取上传者昵称
    const uploader = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { nickname: true },
    });

    // upsert（按联合唯一键 baseOrgId + recordDate）
    const record = await prisma.anchorDailySummary.upsert({
      where: { baseOrgId_recordDate: { baseOrgId: baseOrg.id, recordDate } },
      create: {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        recordDate,
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
        totalCount,
        onlineCount,
        offlineCount,
        within7Days,
        within20Days,
        dailyNew,
        operatorStats,
        rawRowCount: rows.length,
        rawAnchors,
      },
      update: {
        baseOrgName: baseOrg.name,
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
        totalCount,
        onlineCount,
        offlineCount,
        within7Days,
        within20Days,
        dailyNew,
        operatorStats,
        rawRowCount: rows.length,
        rawAnchors,
      },
    });

    return ok(res, record);
  }
);

/** 查询接口：GET /anchor-summary/latest?scopeOrgId=xxx */
anchorSummaryRoutes.get(
  "/anchor-summary/latest",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      const msgMap: Record<string, string> = {
        BASE_SCOPE_REQUIRED: "请先选择基地",
        SCOPE_ORG_NOT_FOUND: "基地不存在",
        SCOPE_ORG_FORBIDDEN: "无权访问该基地",
      };
      return fail(res, e.message, msgMap[e.message] ?? "鉴权失败", 403);
    }

    // 查最新一条记录（按 recordDate 降序）
    const record = await prisma.anchorDailySummary.findFirst({
      where: { baseOrgId: baseOrg.id },
      orderBy: { recordDate: "desc" },
    });

    return ok(res, record ?? null);
  }
);

/** 趋势接口：GET /anchor-summary/trend?scopeOrgId=xxx&days=7&probationDays=5 */
anchorSummaryRoutes.get(
  "/anchor-summary/trend",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      const msgMap: Record<string, string> = {
        BASE_SCOPE_REQUIRED: "请先选择基地",
        SCOPE_ORG_NOT_FOUND: "基地不存在",
        SCOPE_ORG_FORBIDDEN: "无权访问该基地",
      };
      return fail(res, e.message, msgMap[e.message] ?? "鉴权失败", 403);
    }

    const rawDays = parseInt(req.query.days as string, 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 90) : 7;

    const probationDays = parseInt(req.query.probationDays as string, 10) || 0;

    // 取最近 N 天的数据（按 recordDate 降序再升序）
    const records = await prisma.anchorDailySummary.findMany({
      where: { baseOrgId: baseOrg.id },
      orderBy: { recordDate: "desc" },
      take: days,
    });

    // 转为升序便于前端画趋势图
    records.reverse();

    // 最新一条作为 summary 信息
    const latestRaw = records.length > 0 ? records[records.length - 1] : null;

    // 动态试用期过滤：对每条 record 重算 totalCount / onlineCount / offlineCount
    const points = records.map((r) => {
      let filteredTotal = r.totalCount;
      let filteredOnline = r.onlineCount;
      let filteredOffline = r.offlineCount;
      let probationExcluded = 0;

      if (probationDays > 0 && r.rawAnchors) {
        const anchors = r.rawAnchors as { joinDate: string | null; isOnline: boolean }[];
        filteredTotal = 0;
        filteredOnline = 0;
        filteredOffline = 0;
        const refDate = new Date(r.recordDate);

        for (const a of anchors) {
          // 试用期内：跳过
          if (a.joinDate) {
            const diffMs = refDate.getTime() - new Date(a.joinDate).getTime();
            const diffDays = diffMs / 86400000;
            if (diffDays >= 0 && diffDays < probationDays) {
              probationExcluded++;
              continue;
            }
          }
          filteredTotal++;
          if (a.isOnline) filteredOnline++;
          else filteredOffline++;
        }
      }

      return {
        recordDate: r.recordDate,
        totalCount: filteredTotal,
        onlineCount: filteredOnline,
        offlineCount: filteredOffline,
        within7Days: r.within7Days,
        within20Days: r.within20Days,
        dailyNew: r.dailyNew,
        probationDays: probationDays,
        probationExcluded,
      };
    });

    // latest 也用过滤后的最新一条
    const latest = latestRaw ? points[points.length - 1] : null;

    return ok(res, {
      baseOrgId: baseOrg.id,
      baseOrgName: baseOrg.name,
      points,
      latest: latestRaw
        ? {
            id: latestRaw.id,
            recordDate: latestRaw.recordDate,
            uploadedBy: latestRaw.uploadedBy,
            uploaderName: latestRaw.uploaderName,
            totalCount: latest?.totalCount ?? latestRaw.totalCount,
            onlineCount: latest?.onlineCount ?? latestRaw.onlineCount,
            offlineCount: latest?.offlineCount ?? latestRaw.offlineCount,
            within7Days: latestRaw.within7Days,
            within20Days: latestRaw.within20Days,
            dailyNew: latestRaw.dailyNew,
            operatorStats: latestRaw.operatorStats,
            rawRowCount: latestRaw.rawRowCount,
            createdAt: latestRaw.createdAt,
            updatedAt: latestRaw.updatedAt,
            probationDays: probationDays,
            probationExcluded: latest?.probationExcluded ?? 0,
          }
        : null,
    });
  }
);
