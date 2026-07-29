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

/** TEAM_ADMIN 匹配：团队名与运营名至少 2 字相同即命中 */
function matchOperatorByChar(teamName: string, operatorName: string): boolean {
  const t = teamName.trim();
  const o = operatorName.trim();
  if (!t || !o) return false;
  let cnt = 0;
  for (const ch of t) {
    if (o.includes(ch)) cnt++;
    if (cnt >= 2) return true;
  }
  return false;
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
  within7DaysOnline: number;
  within7DaysOffline: number;
  within20Days: number;
  within20DaysOnline: number;
  within20DaysOffline: number;
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

    // 原始明细数据（每条主播的入职日期 + 类型 + 运营），供前端动态试用期过滤
    const rawAnchors: { joinDate: string | null; isOnline: boolean; operatorName: string }[] = [];

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
        operatorName,
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
          within7DaysOnline: 0,
          within7DaysOffline: 0,
          within20Days: 0,
          within20DaysOnline: 0,
          within20DaysOffline: 0,
          dailyNew: 0,
        });
      }
      const opStat = operatorMap.get(operatorName)!;
      opStat.totalCount++;
      if (isOnline) opStat.onlineCount++;
      else opStat.offlineCount++;
      if (joinDate) {
        if (isWithinDays(joinDate, 7, refDate)) {
          opStat.within7Days++;
          if (isOnline) opStat.within7DaysOnline++;
          else opStat.within7DaysOffline++;
        }
        if (isWithinDays(joinDate, 20, refDate)) {
          opStat.within20Days++;
          if (isOnline) opStat.within20DaysOnline++;
          else opStat.within20DaysOffline++;
        }
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

    // TEAM_ADMIN：根据团队名与运营名相似匹配过滤数据
    if (record && req.identity?.roleCode === "TEAM_ADMIN" && req.identity?.orgId) {
      const teamOrg = await prisma.orgUnit.findFirst({
        where: { id: req.identity.orgId, status: "active" },
        select: { name: true },
      });
      if (teamOrg) {
        const teamName = teamOrg.name;
        const origOps = (record.operatorStats as OperatorStat[]) ?? [];
        const filteredOps = origOps.filter(op => matchOperatorByChar(teamName, op.name));
        return ok(res, {
          ...record,
          totalCount: filteredOps.reduce((s, o) => s + o.totalCount, 0),
          onlineCount: filteredOps.reduce((s, o) => s + o.onlineCount, 0),
          offlineCount: filteredOps.reduce((s, o) => s + o.offlineCount, 0),
          within7Days: filteredOps.reduce((s, o) => s + (o.within7Days ?? 0), 0),
          within20Days: filteredOps.reduce((s, o) => s + (o.within20Days ?? 0), 0),
          dailyNew: filteredOps.reduce((s, o) => s + (o.dailyNew ?? 0), 0),
          operatorStats: filteredOps,
        });
      }
    }

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

    // TEAM_ADMIN：获取团队名称用于运营名相似匹配过滤
    let teamOrgName: string | null = null;
    if (req.identity?.roleCode === "TEAM_ADMIN" && req.identity?.orgId) {
      const teamOrg = await prisma.orgUnit.findFirst({
        where: { id: req.identity.orgId, status: "active" },
        select: { name: true },
      });
      teamOrgName = teamOrg?.name ?? null;
    }

    // 动态试用期过滤：对每条 record 重算 totalCount / onlineCount / offlineCount / operatorStats
    const points = records.map((r) => {
      let filteredTotal = r.totalCount;
      let filteredOnline = r.onlineCount;
      let filteredOffline = r.offlineCount;
      let probationExcluded = 0;

      // 试用期过滤后重新聚合的 operatorStats（按运营）
      let filteredOperatorStats: OperatorStat[] | null = null;

      // 始终从 rawAnchors 重新聚合 operatorStats，确保 7天/20天 线上线下字段始终有值
      // （旧数据中数据库 operatorStats 没有这 4 个新字段；试用期只影响过滤，不影响是否重算）
      if (r.rawAnchors) {
        const anchors = r.rawAnchors as { joinDate: string | null; isOnline: boolean; operatorName?: string }[];
        filteredTotal = 0;
        filteredOnline = 0;
        filteredOffline = 0;
        const refDate = new Date(r.recordDate);

        const opMap = new Map<string, OperatorStat>();

        for (const a of anchors) {
          // TEAM_ADMIN：过滤非本团队的运营
          //  - 有 operatorName：必须与团队名匹配
          //  - 没有 operatorName（旧数据）：无法归类到本团队，跳过
          if (teamOrgName) {
            const opName = (a.operatorName ?? "").trim();
            if (!opName || !matchOperatorByChar(teamOrgName, opName)) continue;
          }
          // 试用期内：跳过
          if (probationDays > 0 && a.joinDate) {
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

        // 按运营聚合：优先使用 rawAnchors 中的 operatorName（仅新版上传的数据含此字段）
        const hasOp = anchors.some((a) => typeof a.operatorName === "string" && a.operatorName.length > 0);
        if (hasOp) {
          for (const a of anchors) {
            const opName = (a.operatorName ?? "").trim() || "未知运营";
            // TEAM_ADMIN：过滤非本团队的运营
            if (teamOrgName && !matchOperatorByChar(teamOrgName, opName)) continue;
            // 试用期内：跳过
            if (probationDays > 0 && a.joinDate) {
              const diffMs = refDate.getTime() - new Date(a.joinDate).getTime();
              const diffDays = diffMs / 86400000;
              if (diffDays >= 0 && diffDays < probationDays) continue;
            }
            if (!opMap.has(opName)) {
              opMap.set(opName, {
                name: opName,
                totalCount: 0,
                onlineCount: 0,
                offlineCount: 0,
                within7Days: 0,
                within7DaysOnline: 0,
                within7DaysOffline: 0,
                within20Days: 0,
                within20DaysOnline: 0,
                within20DaysOffline: 0,
                dailyNew: 0,
              });
            }
            const op = opMap.get(opName)!;
            op.totalCount++;
            if (a.isOnline) op.onlineCount++;
            else op.offlineCount++;
            if (a.joinDate) {
              const diffMs = refDate.getTime() - new Date(a.joinDate).getTime();
              const diffDays = diffMs / 86400000;
              if (diffDays >= 0 && diffDays < 7) {
                op.within7Days++;
                if (a.isOnline) op.within7DaysOnline++;
                else op.within7DaysOffline++;
              }
              if (diffDays >= 0 && diffDays < 20) {
                op.within20Days++;
                if (a.isOnline) op.within20DaysOnline++;
                else op.within20DaysOffline++;
              }
            }
          }
          filteredOperatorStats = Array.from(opMap.values()).sort((a, b) => b.totalCount - a.totalCount);
        } else {
          // 旧数据：rawAnchors 中无 operatorName，对原 operatorStats 做比例缩放，保证浮窗合计 ≈ 卡片总数
          // 新字段（within7DaysOnline 等）旧数据中一定是 0/null，统一用 inferSplit 按 online/offline 比例推算
          const orig = r.operatorStats as OperatorStat[];
          const origTotal = r.totalCount;
          if (orig && origTotal > 0) {
            const scale = filteredTotal / origTotal;
            const inferSplit = (total7: number, totalAll: number, split: number) => {
              if (totalAll <= 0) return 0;
              return Math.round(total7 * (split / totalAll));
            };
            filteredOperatorStats = orig.map((op) => {
              const scaledTotal = Math.round(op.totalCount * scale);
              const scaledOnline = Math.round(op.onlineCount * scale);
              const scaledOffline = Math.round(op.offlineCount * scale);
              const w7Scaled = Math.round((op.within7Days ?? 0) * scale);
              const w20Scaled = Math.round((op.within20Days ?? 0) * scale);
              return {
                ...op,
                totalCount: scaledTotal,
                onlineCount: scaledOnline,
                offlineCount: scaledOffline,
                within7Days: w7Scaled,
                within7DaysOnline: inferSplit(w7Scaled, scaledTotal, scaledOnline),
                within7DaysOffline: inferSplit(w7Scaled, scaledTotal, scaledOffline),
                within20Days: w20Scaled,
                within20DaysOnline: inferSplit(w20Scaled, scaledTotal, scaledOnline),
                within20DaysOffline: inferSplit(w20Scaled, scaledTotal, scaledOffline),
              };
            });
          }
        }

        // TEAM_ADMIN：对旧数据（rawAnchors 中无 operatorName）也按运营名过滤
        if (teamOrgName && filteredOperatorStats) {
          filteredOperatorStats = filteredOperatorStats.filter(op => matchOperatorByChar(teamOrgName, op.name));
        }
      }

      // TEAM_ADMIN：从过滤后的 operatorStats 重算聚合数据
      const pointWithin7Days = (teamOrgName && filteredOperatorStats)
        ? filteredOperatorStats.reduce((s, o) => s + (o.within7Days ?? 0), 0)
        : r.within7Days;
      const pointWithin20Days = (teamOrgName && filteredOperatorStats)
        ? filteredOperatorStats.reduce((s, o) => s + (o.within20Days ?? 0), 0)
        : r.within20Days;
      const pointDailyNew = (teamOrgName && filteredOperatorStats)
        ? filteredOperatorStats.reduce((s, o) => s + (o.dailyNew ?? 0), 0)
        : r.dailyNew;

      return {
        recordDate: r.recordDate,
        totalCount: filteredTotal,
        onlineCount: filteredOnline,
        offlineCount: filteredOffline,
        within7Days: pointWithin7Days,
        within20Days: pointWithin20Days,
        dailyNew: pointDailyNew,
        probationDays: probationDays,
        probationExcluded,
        operatorStats: filteredOperatorStats ?? (r.operatorStats as OperatorStat[]),
      };
    });

    // latest 也用过滤后的最新一条
    const latest = latestRaw ? points[points.length - 1] : null;

    return ok(res, {
      baseOrgId: baseOrg.id,
      baseOrgName: baseOrg.name,
      teamOrgName: teamOrgName,
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
            within7Days: latest?.within7Days ?? latestRaw.within7Days,
            within20Days: latest?.within20Days ?? latestRaw.within20Days,
            dailyNew: latest?.dailyNew ?? latestRaw.dailyNew,
            operatorStats: latest?.operatorStats ?? (latestRaw.operatorStats as OperatorStat[]),
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
