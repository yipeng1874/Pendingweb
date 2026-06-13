import { Prisma, type OrgType } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof prisma;
import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { env } from "../../config/env.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

function isAncestorPath(ancestorPath?: string | null, targetPath?: string | null) {
  return Boolean(ancestorPath && targetPath && (ancestorPath === targetPath || targetPath.startsWith(`${ancestorPath}/`)));
}

async function syncOrganizationRelations(tx: DbClient, input: { orgId: string; orgType: OrgType; oldPath: string; newPath: string; oldDouyinUid?: string | null; newDouyinUid?: string | null }) {
  if (input.oldPath !== input.newPath) {
    await tx.userIdentity.updateMany({ where: { scopePath: { startsWith: input.oldPath } }, data: { scopePath: input.newPath } });
  }

  if (input.orgType === "HALL") {
    await tx.anchorProfile.updateMany({ where: { hallOrgId: input.orgId }, data: { hallOrgId: input.orgId } });

    const hallAnchorProfiles = await tx.anchorProfile.findMany({
      where: { hallOrgId: input.orgId },
      select: { id: true, boundUserId: true },
    });
    const boundUserIds = Array.from(new Set(hallAnchorProfiles.map((item) => item.boundUserId).filter(Boolean) as string[]));

    if (boundUserIds.length) {
      await tx.userIdentity.updateMany({
        where: { roleCode: "ANCHOR", userId: { in: boundUserIds } },
        data: { orgId: input.orgId, scopePath: input.newPath },
      });
    }

    if (input.oldDouyinUid && input.newDouyinUid && input.oldDouyinUid !== input.newDouyinUid) {
      await tx.taskRecord.updateMany({ where: { subjectOrgId: input.orgId, subjectKey: input.oldDouyinUid }, data: { subjectKey: input.newDouyinUid } });
    }
  }

  if (input.oldPath !== input.newPath) {
    const descendantOrgIds = await tx.orgUnit.findMany({ where: { path: { startsWith: `${input.newPath}/` } }, select: { id: true, path: true } });
    for (const org of descendantOrgIds) {
      await tx.userIdentity.updateMany({ where: { orgId: org.id }, data: { scopePath: org.path } });
    }
  }
}

export const organizationRoutes = Router();
organizationRoutes.use(authRequired, identityRequired);

const hallRequiredFields = [
  ["principalName", "负责人"],
  ["contactPhone", "联系电话"],
  ["douyinNo", "厅抖音号"],
  ["douyinUid", "厅抖音 UID"],
  ["brokerName", "运营经纪人"],
  ["remark", "备注"],
] as const;

const parentTypeMap: Record<OrgType, OrgType | undefined> = {
  HQ: undefined,
  BASE: "HQ",
  TEAM: "BASE",
  HALL: "TEAM",
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

/** 全局管理员不受 scopePath 限制，其余角色受限 */
function getWriteScopePath(req: import("express").Request): string | undefined {
  const roleCode = req.identity?.roleCode;
  if (roleCode === "DEV_ADMIN" || roleCode === "HQ_ADMIN") return undefined;
  return req.identity?.scopePath ?? undefined;
}

function missingHallFields(input: Record<string, unknown>) {
  return hallRequiredFields.filter(([key]) => !text(input[key])).map(([, label]) => label);
}

function normalizeDouyinNo(value: unknown) {
  return text(value).replace(/\s/g, "");
}

function normalizeDouyinUid(value: unknown) {
  return text(value).replace(/\s/g, "");
}

function makeHallOrgCode(douyinUid: string) {
  return `HALL-${douyinUid}`;
}

type OrgCodeResult = { orgCode: string; douyinUid?: string } | { error: readonly [string, string] };
type CreateOrgResult =
  | { org: Awaited<ReturnType<typeof prisma.orgUnit.create>> }
  | { error: { code: string; message: string } }
  | { retry: true };
type NormalizedHallRow = { row: Record<string, unknown>; douyinNo: string; douyinUid: string; orgCode: string };

function makeTeamSuffix(index: number) {
  const letterIndex = Math.floor(index / 9);
  const number = (index % 9) + 1;
  if (letterIndex >= 26) throw new Error("团队编码序号已超过 A1-Z9 范围");
  return `${String.fromCharCode(65 + letterIndex)}${number}`;
}

async function generateTeamOrgCode(tx: DbClient, baseOrgCode: string) {
  const teams = await tx.orgUnit.findMany({ where: { orgType: "TEAM", orgCode: { startsWith: baseOrgCode } }, select: { orgCode: true } });
  const used = new Set(teams.map((item) => item.orgCode));
  for (let index = 0; index < 26 * 9; index += 1) {
    const code = `${baseOrgCode}${makeTeamSuffix(index)}`;
    if (!used.has(code)) return code;
  }
  throw new Error("当前基地团队编码已用完");
}

async function resolveOrgCode(tx: DbClient, orgType: OrgType, parent: { orgType: OrgType; orgCode: string } | null, body: Record<string, unknown>): Promise<OrgCodeResult> {
  if (orgType === "TEAM") {
    if (!parent || parent.orgType !== "BASE") return { error: ["TEAM_PARENT_INVALID", "团队组织必须创建在基地下"] as const };
    return { orgCode: await generateTeamOrgCode(tx, parent.orgCode) };
  }
  if (orgType === "HALL") {
    if (!parent || parent.orgType !== "TEAM") return { error: ["HALL_PARENT_INVALID", "厅组织必须创建在团队下"] as const };
    const douyinUid = normalizeDouyinUid(body.douyinUid);
    if (!douyinUid) return { error: ["HALL_DOUYIN_UID_REQUIRED", "新建厅组织必须填写厅抖音 UID"] as const };
    return { orgCode: makeHallOrgCode(douyinUid), douyinUid };
  }
  const orgCode = text(body.orgCode).toUpperCase();
  if (!orgCode) return { error: ["ORG_CODE_REQUIRED", "请填写组织编码"] as const };
  return { orgCode };
}

function isUniqueConstraintError(error: unknown, field?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (!field) return true;
  const target = Array.isArray(error.meta?.target) ? error.meta?.target.map(String) : [];
  return target.includes(field);
}

async function assertHallIdentityUnique(input: { douyinNo?: string; douyinUid?: string; excludeOrgId?: string }) {
  const or: Array<Record<string, unknown>> = [];
  if (input.douyinNo) or.push({ douyinNo: input.douyinNo });
  if (input.douyinUid) or.push({ douyinUid: input.douyinUid });
  if (!or.length) return null;

  return prisma.orgUnit.findFirst({
    where: {
      orgType: "HALL",
      OR: or,
      ...(input.excludeOrgId ? { NOT: { id: input.excludeOrgId } } : {}),
    },
    select: { id: true, name: true, douyinNo: true, douyinUid: true, orgCode: true },
  });
}

function buildHallDuplicateMessage(input: { douyinNo?: string; douyinUid?: string }, duplicated: { douyinNo?: string | null; douyinUid?: string | null; orgCode: string }) {
  const conflicts: string[] = [];
  if (input.douyinNo && duplicated.douyinNo === input.douyinNo) conflicts.push(`厅抖音号 ${input.douyinNo}`);
  if (input.douyinUid && duplicated.douyinUid === input.douyinUid) conflicts.push(`厅抖音 UID ${input.douyinUid}`);
  const subject = conflicts.length ? conflicts.join("、") : `组织编码 ${duplicated.orgCode}`;
  return `${subject} 已存在`;
}

function getAncestorPaths(path: string): string[] {
  // path 格式为 "/QGCM001/HB2605A/HB2605AA1"，保留前缀斜杠
  const parts = path.split("/").filter(Boolean);
  const paths: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    paths.push("/" + parts.slice(0, i).join("/"));
  }
  return paths;
}

organizationRoutes.get("/orgs/tree", permissionRequired("org:view"), async (req, res) => {
  const scopePath = req.identity?.roleCode !== "DEV_ADMIN" ? req.identity?.scopePath ?? undefined : undefined;
  const where: Prisma.OrgUnitWhereInput = scopePath
    ? {
        OR: [
          { path: { startsWith: scopePath } },
          ...(getAncestorPaths(scopePath).length ? [{ path: { in: getAncestorPaths(scopePath) } }] : []),
        ],
      }
    : {};
  const orgs = await prisma.orgUnit.findMany({
    where,
    select: {
      id: true,
      orgCode: true,
      orgType: true,
      name: true,
      parentId: true,
      path: true,
      depth: true,
      principalName: true,
      contactPhone: true,
      douyinNo: true,
      douyinUid: true,
      brokerName: true,
      isVirtual: true,
      remark: true,
      status: true,
    },
    orderBy: [{ depth: "asc" }, { orgCode: "asc" }],
  });

  return ok(res, orgs);
});

organizationRoutes.get("/orgs/children", permissionRequired("org:view"), async (req, res) => {
  const parentId = text(req.query.parentId) || undefined;
  const scopePath = req.identity?.roleCode !== "DEV_ADMIN" ? req.identity?.scopePath ?? undefined : undefined;
  const isAdmin = req.identity?.roleCode === "DEV_ADMIN" || req.identity?.roleCode === "HQ_ADMIN";

  let parent: null | { id: string; orgType: OrgType } = null;
  if (parentId) {
    parent = await prisma.orgUnit.findUnique({ where: { id: parentId }, select: { id: true, orgType: true } });
    if (!parent) return ok(res, []);
  }

  const rootWhere = !parentId && !isAdmin
    ? req.identity?.orgId
      ? { id: req.identity.orgId, status: "active" as const }
      : scopePath
        ? { path: scopePath, status: "active" as const }
        : null
    : null;

  const nextOrgTypes: Record<string, OrgType[]> = {
    ROOT: ["HQ", "BASE"],
    HQ: ["BASE"],
    BASE: ["TEAM"],
    TEAM: ["HALL"],
    HALL: [],
  };

  const allowedTypes: OrgType[] = parent
    ? nextOrgTypes[parent.orgType] ?? []
    : isAdmin
      ? ["HQ", "BASE"]
      : req.identity?.roleCode === "BASE_ADMIN"
        ? ["TEAM"]
        : req.identity?.roleCode === "TEAM_ADMIN"
          ? ["HALL"]
          : req.identity?.roleCode === "HALL_MANAGER"
            ? ["HALL"]
            : ["BASE", "TEAM", "HALL"];

  if (!rootWhere && !allowedTypes.length) return ok(res, []);

  const where: Prisma.OrgUnitWhereInput = rootWhere ?? {
    status: "active",
    orgType: { in: allowedTypes },
    ...(parent ? { parentId: parent.id } : { depth: { lte: 2 } }),
    ...(scopePath ? { path: { startsWith: scopePath } } : {}),
  };

  const orgs = await prisma.orgUnit.findMany({
    where,
    select: {
      id: true,
      orgCode: true,
      orgType: true,
      name: true,
      parentId: true,
      path: true,
      depth: true,
      principalName: true,
      contactPhone: true,
      douyinNo: true,
      douyinUid: true,
      brokerName: true,
      isVirtual: true,
      remark: true,
      status: true,
    },
    orderBy: [{ depth: "asc" }, { orgCode: "asc" }],
  });

  const childCounts = orgs.length
    ? await prisma.orgUnit.groupBy({ by: ["parentId"], where: { parentId: { in: orgs.map((item) => item.id) }, status: "active" }, _count: { _all: true } })
    : [];
  const childCountMap = new Map(childCounts.map((item) => [item.parentId ?? "", item._count._all]));

  return ok(res, orgs.map((org) => ({ ...org, hasChildren: (childCountMap.get(org.id) ?? 0) > 0, childCount: childCountMap.get(org.id) ?? 0 })));
});

organizationRoutes.post("/orgs", permissionRequired("org:create"), async (req, res) => {
  const orgType = req.body.orgType as OrgType;
  const parent = req.body.parentId ? await prisma.orgUnit.findUnique({ where: { id: req.body.parentId } }) : null;
  if (!text(req.body.name)) return fail(res, "ORG_NAME_REQUIRED", "请填写组织名称", 400);
  if (parentTypeMap[orgType] && parent?.orgType !== parentTypeMap[orgType]) return fail(res, "ORG_PARENT_INVALID", "上级组织层级不符合规则", 400);
  const writeScopePath = getWriteScopePath(req);
  if (writeScopePath && parent && !isAncestorPath(writeScopePath, parent.path) && parent.path !== writeScopePath) {
    return fail(res, "FORBIDDEN", "无权在该上级组织下创建子组织", 403);
  }

  const normalizedDouyinNo = normalizeDouyinNo(req.body.douyinNo);
  const normalizedDouyinUid = normalizeDouyinUid(req.body.douyinUid);

  if (orgType === "HALL") {
    const missing = missingHallFields(req.body);
    if (missing.length) return fail(res, "HALL_REQUIRED_FIELDS_MISSING", `新建厅组织必须填写：${missing.join("、")}`, 400);
    const duplicated = await assertHallIdentityUnique({ douyinNo: normalizedDouyinNo, douyinUid: normalizedDouyinUid });
    if (duplicated) return fail(res, "HALL_IDENTITY_EXISTS", buildHallDuplicateMessage({ douyinNo: normalizedDouyinNo, douyinUid: normalizedDouyinUid }, duplicated), 409);
  }

  const createOrg = async (): Promise<CreateOrgResult> => {
    const resolved = await resolveOrgCode(prisma, orgType, parent, req.body);
    if ("error" in resolved) {
      const [code, message] = resolved.error;
      return { error: { code, message } } as const;
    }

    const orgCode = resolved.orgCode;
    const douyinUid = "douyinUid" in resolved ? resolved.douyinUid : normalizedDouyinUid;

    try {
      const org = await prisma.$transaction(async (tx) => {
        const txResolved = await resolveOrgCode(tx, orgType, parent, req.body);
        if ("error" in txResolved) throw new Error(txResolved.error[1]);
        const nextOrgCode = txResolved.orgCode;
        const nextDouyinUid = "douyinUid" in txResolved ? txResolved.douyinUid : normalizedDouyinUid;

        return tx.orgUnit.create({
          data: {
            orgCode: nextOrgCode,
            orgType,
            name: text(req.body.name),
            parentId: parent?.id,
            path: parent ? `${parent.path}/${nextOrgCode}` : `/${nextOrgCode}`,
            depth: parent ? parent.depth + 1 : 1,
            principalName: text(req.body.principalName) || undefined,
            contactPhone: text(req.body.contactPhone) || undefined,
            douyinNo: normalizedDouyinNo || undefined,
            douyinUid: nextDouyinUid || undefined,
            brokerName: text(req.body.brokerName) || undefined,
            remark: text(req.body.remark) || undefined,
            status: "active",
          },
        });
      });
      return { org } as const;
    } catch (error) {
      if (orgType === "TEAM" && isUniqueConstraintError(error, "org_code")) return { retry: true } as const;
      if (isUniqueConstraintError(error, "douyin_no")) return { error: { code: "HALL_DOUYIN_NO_EXISTS", message: `厅抖音号 ${normalizedDouyinNo} 已存在` } } as const;
      if (isUniqueConstraintError(error, "douyin_uid")) return { error: { code: "HALL_DOUYIN_UID_EXISTS", message: `厅抖音 UID ${douyinUid} 已存在` } } as const;
      if (isUniqueConstraintError(error, "org_code")) return { error: { code: "ORG_CODE_EXISTS", message: `组织编码 ${orgCode} 已存在` } } as const;
      throw error;
    }
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await createOrg();
    if ("org" in result) return ok(res, result.org);
    if ("error" in result) {
      const { code, message } = result.error;
      return fail(res, code, message, 409);
    }
  }

  return fail(res, "ORG_CREATE_RETRY_EXCEEDED", "组织创建冲突，请重试", 409);
});

organizationRoutes.post("/orgs/halls/batch", permissionRequired("org:create"), async (req, res) => {
  const parent = await prisma.orgUnit.findUnique({ where: { id: req.body.parentId } });
  if (!parent || parent.orgType !== "TEAM") return fail(res, "HALL_PARENT_INVALID", "批量新建厅必须先选择团队作为上级组织", 400);
  const writeScopePath = getWriteScopePath(req);
  if (writeScopePath && !isAncestorPath(writeScopePath, parent.path) && parent.path !== writeScopePath) {
    return fail(res, "FORBIDDEN", "无权在该团队下批量创建厅", 403);
  }
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return fail(res, "BATCH_ROWS_EMPTY", "请至少上传一条厅组织数据", 400);

  const seenDouyinNos = new Set<string>();
  const seenDouyinUids = new Set<string>();
  const errors: Array<{ row: number; message: string }> = [];
  const normalizedRows: NormalizedHallRow[] = rows.map((row: Record<string, unknown>, index: number) => {
    const douyinNo = normalizeDouyinNo(row.douyinNo);
    const douyinUid = normalizeDouyinUid(row.douyinUid);
    const orgCode = makeHallOrgCode(douyinUid);
    const missing = [
      ...(!text(row.name) ? ["厅名称"] : []),
      ...missingHallFields(row),
    ];
    if (missing.length) errors.push({ row: index + 1, message: `缺少必填字段：${missing.join("、")}` });
    if (douyinNo && seenDouyinNos.has(douyinNo)) errors.push({ row: index + 1, message: `厅抖音号 ${douyinNo} 在表格内重复` });
    if (douyinUid && seenDouyinUids.has(douyinUid)) errors.push({ row: index + 1, message: `厅抖音 UID ${douyinUid} 在表格内重复` });
    if (douyinNo) seenDouyinNos.add(douyinNo);
    if (douyinUid) seenDouyinUids.add(douyinUid);
    return { row, douyinNo, douyinUid, orgCode };
  });
  if (errors.length) return fail(res, "BATCH_VALIDATION_FAILED", errors.map((item) => `第 ${item.row} 行${item.message}`).join("；"), 400);

  const douyinNos = normalizedRows.map((item) => item.douyinNo);
  const douyinUids = normalizedRows.map((item) => item.douyinUid);
  const orgCodes = normalizedRows.map((item) => item.orgCode);
  const [existingNos, existingUids, existingCodes] = await Promise.all([
    prisma.orgUnit.findMany({ where: { douyinNo: { in: douyinNos } }, select: { douyinNo: true } }),
    prisma.orgUnit.findMany({ where: { douyinUid: { in: douyinUids } }, select: { douyinUid: true } }),
    prisma.orgUnit.findMany({ where: { orgCode: { in: orgCodes } }, select: { orgCode: true } }),
  ]);
  if (existingNos.length) return fail(res, "HALL_DOUYIN_NO_EXISTS", `以下厅抖音号已存在：${existingNos.map((item) => item.douyinNo).join("、")}`, 409);
  if (existingUids.length) return fail(res, "HALL_DOUYIN_UID_EXISTS", `以下厅抖音 UID 已存在：${existingUids.map((item) => item.douyinUid).join("、")}`, 409);
  if (existingCodes.length) return fail(res, "ORG_CODE_EXISTS", `以下组织编码已存在：${existingCodes.map((item) => item.orgCode).join("、")}`, 409);

  try {
    const created = await prisma.$transaction(normalizedRows.map(({ row, douyinNo, douyinUid, orgCode }) => prisma.orgUnit.create({
      data: {
        orgCode,
        orgType: "HALL",
        name: text(row.name),
        parentId: parent.id,
        path: `${parent.path}/${orgCode}`,
        depth: parent.depth + 1,
        principalName: text(row.principalName),
        contactPhone: text(row.contactPhone),
        douyinNo,
        douyinUid,
        brokerName: text(row.brokerName),
        remark: text(row.remark),
        status: "active",
      },
    })));
    return ok(res, { count: created.length, items: created });
  } catch (error) {
    if (isUniqueConstraintError(error, "douyin_no")) return fail(res, "HALL_DOUYIN_NO_EXISTS", "批量创建失败：存在重复的厅抖音号", 409);
    if (isUniqueConstraintError(error, "douyin_uid")) return fail(res, "HALL_DOUYIN_UID_EXISTS", "批量创建失败：存在重复的厅抖音 UID", 409);
    if (isUniqueConstraintError(error, "org_code")) return fail(res, "ORG_CODE_EXISTS", "批量创建失败：存在重复的组织编码", 409);
    throw error;
  }
});

organizationRoutes.patch("/orgs/:id", permissionRequired("org:update"), async (req, res) => {
  const org = await prisma.orgUnit.findUnique({ where: { id: req.params.id } });
  if (!org) return fail(res, "ORG_NOT_FOUND", "组织不存在", 404);
  const writeScopePath = getWriteScopePath(req);
  if (writeScopePath && !isAncestorPath(writeScopePath, org.path) && org.path !== writeScopePath) {
    return fail(res, "FORBIDDEN", "无权编辑该组织", 403);
  }

  const allowed = ["name", "principalName", "contactPhone", "brokerName", "remark"] as const;
  const data: Record<string, string> = Object.fromEntries(allowed.filter((key) => key in req.body).map((key) => [key, text(req.body[key])]));

  if (org.orgType === "HALL") {
    const nextDouyinNo = "douyinNo" in req.body ? normalizeDouyinNo(req.body.douyinNo) : normalizeDouyinNo(org.douyinNo);
    const nextDouyinUid = "douyinUid" in req.body ? normalizeDouyinUid(req.body.douyinUid) : normalizeDouyinUid(org.douyinUid);
    if (!nextDouyinNo) return fail(res, "HALL_DOUYIN_NO_REQUIRED", "厅抖音号不能为空", 400);
    if (!nextDouyinUid) return fail(res, "HALL_DOUYIN_UID_REQUIRED", "厅抖音 UID 不能为空", 400);

    const duplicated = await assertHallIdentityUnique({ douyinNo: nextDouyinNo, douyinUid: nextDouyinUid, excludeOrgId: org.id });
    if (duplicated) return fail(res, "HALL_IDENTITY_EXISTS", buildHallDuplicateMessage({ douyinNo: nextDouyinNo, douyinUid: nextDouyinUid }, duplicated), 409);

    const orgCode = makeHallOrgCode(nextDouyinUid);
    const oldPath = org.path;
    const newPath = org.parentId ? `${oldPath.split("/").slice(0, -1).join("/")}/${orgCode}` : `/${orgCode}`;
    const descendants = await prisma.orgUnit.findMany({ where: { path: { startsWith: `${oldPath}/` } } });

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const item = await tx.orgUnit.update({ where: { id: org.id }, data: { ...data, douyinNo: nextDouyinNo, douyinUid: nextDouyinUid, orgCode, path: newPath } });
        for (const child of descendants) {
          const childPath = child.path.replace(oldPath, newPath);
          await tx.orgUnit.update({ where: { id: child.id }, data: { path: childPath, depth: childPath.split("/").filter(Boolean).length } });
        }
        await syncOrganizationRelations(tx, { orgId: org.id, orgType: org.orgType, oldPath, newPath, oldDouyinUid: org.douyinUid, newDouyinUid: nextDouyinUid });
        return item;
      });
      return ok(res, updated);
    } catch (error) {
      if (isUniqueConstraintError(error, "douyin_no")) return fail(res, "HALL_DOUYIN_NO_EXISTS", `厅抖音号 ${nextDouyinNo} 已存在`, 409);
      if (isUniqueConstraintError(error, "douyin_uid") || isUniqueConstraintError(error, "org_code")) return fail(res, "HALL_DOUYIN_UID_EXISTS", `厅抖音 UID ${nextDouyinUid} 已存在`, 409);
      throw error;
    }
  }

  if ("douyinNo" in req.body || "douyinUid" in req.body) {
    return fail(res, "ORG_FIELD_FORBIDDEN", "只有厅组织才能维护抖音号与抖音 UID", 400);
  }

  const updated = await prisma.orgUnit.update({ where: { id: org.id }, data });
  return ok(res, updated);
});

organizationRoutes.post("/orgs/:id/pause", permissionRequired("org:pause"), async (req, res) => {
  const org = await prisma.orgUnit.findUnique({ where: { id: req.params.id } });
  if (!org) return fail(res, "ORG_NOT_FOUND", "组织不存在", 404);
  const writeScopePath = getWriteScopePath(req);
  if (writeScopePath && !isAncestorPath(writeScopePath, org.path) && org.path !== writeScopePath) {
    return fail(res, "FORBIDDEN", "无权暂停该组织", 403);
  }
  const updated = await prisma.orgUnit.update({ where: { id: req.params.id }, data: { status: "paused" } });
  return ok(res, updated);
});

organizationRoutes.post("/orgs/:id/restore", permissionRequired("org:restore"), async (req, res) => {
  const org = await prisma.orgUnit.findUnique({ where: { id: req.params.id } });
  if (!org) return fail(res, "ORG_NOT_FOUND", "组织不存在", 404);
  const writeScopePath = getWriteScopePath(req);
  if (writeScopePath && !isAncestorPath(writeScopePath, org.path) && org.path !== writeScopePath) {
    return fail(res, "FORBIDDEN", "无权恢复该组织", 403);
  }
  const updated = await prisma.orgUnit.update({ where: { id: req.params.id }, data: { status: "active" } });
  return ok(res, updated);
});

organizationRoutes.post("/orgs/:id/move", permissionRequired("org:update"), async (req, res) => {
  const org = await prisma.orgUnit.findUnique({ where: { id: req.params.id } });
  const newParent = await prisma.orgUnit.findUnique({ where: { id: req.body.parentId } });
  if (!org || !newParent) return fail(res, "ORG_NOT_FOUND", "组织或新上级不存在", 404);
  const writeScopePath = getWriteScopePath(req);
  if (writeScopePath) {
    const orgInScope = isAncestorPath(writeScopePath, org.path) || org.path === writeScopePath;
    const newParentInScope = isAncestorPath(writeScopePath, newParent.path) || newParent.path === writeScopePath;
    if (!orgInScope) return fail(res, "FORBIDDEN", "无权迁移该组织", 403);
    if (!newParentInScope) return fail(res, "FORBIDDEN", "无权迁移到该上级组织", 403);
  }
  if (org.orgType === "HQ") return fail(res, "ORG_MOVE_FORBIDDEN", "公司总部不能迁移", 400);
  if (newParent.path.startsWith(`${org.path}/`) || newParent.id === org.id) return fail(res, "ORG_MOVE_INVALID", "不能迁移到自身或下级组织", 400);
  const expectedParentType = org.orgType === "BASE" ? "HQ" : org.orgType === "TEAM" ? "BASE" : org.orgType === "HALL" ? "TEAM" : undefined;
  if (newParent.orgType !== expectedParentType) return fail(res, "ORG_MOVE_INVALID_PARENT", "新上级层级不符合组织规则", 400);

  const oldPath = org.path;
  const newPath = `${newParent.path}/${org.orgCode}`;
  const descendants = await prisma.orgUnit.findMany({ where: { path: { startsWith: `${oldPath}/` } } });
  const moved = await prisma.$transaction(async (tx) => {
    const updated = await tx.orgUnit.update({ where: { id: org.id }, data: { parentId: newParent.id, path: newPath, depth: newParent.depth + 1 } });
    for (const child of descendants) {
      const childPath = child.path.replace(oldPath, newPath);
      const depthDelta = childPath.split("/").filter(Boolean).length;
      await tx.orgUnit.update({ where: { id: child.id }, data: { path: childPath, depth: depthDelta } });
    }
    await syncOrganizationRelations(tx, { orgId: org.id, orgType: org.orgType, oldPath, newPath, oldDouyinUid: org.douyinUid, newDouyinUid: org.douyinUid });
    return updated;
  });
  return ok(res, moved);
});

organizationRoutes.delete("/orgs/:id", permissionRequired("org:update"), async (req, res) => {
  const org = await prisma.orgUnit.findUnique({ where: { id: req.params.id } });
  if (!org) return fail(res, "ORG_NOT_FOUND", "组织不存在", 404);
  if (org.orgType === "HQ") return fail(res, "ORG_DELETE_FORBIDDEN", "公司总部不能删除", 400);
  const writeScopePath = getWriteScopePath(req);
  if (writeScopePath && !isAncestorPath(writeScopePath, org.path) && org.path !== writeScopePath) {
    return fail(res, "FORBIDDEN", "无权删除该组织", 403);
  }

  const [children, identities, anchors, taskTemplates, assignmentTargets, taskRecords, feishuConfigs, registrationApplications] = await Promise.all([
    prisma.orgUnit.count({ where: { parentId: org.id } }),
    prisma.userIdentity.count({ where: { orgId: org.id } }),
    prisma.anchorProfile.count({ where: { hallOrgId: org.id } }),
    prisma.taskTemplate.count({ where: { orgId: org.id } }),
    prisma.taskAssignmentTarget.count({ where: { orgId: org.id } }),
    prisma.taskRecord.count({ where: { subjectOrgId: org.id } }),
    ((prisma as any).feishuEnterpriseConfig?.count
      ? (prisma as any).feishuEnterpriseConfig.count({ where: { OR: [{ baseOrgId: org.id }, { teamOrgId: org.id }] } })
      : Promise.resolve(0)) as Promise<number>,
    prisma.anchorRegistrationApplication.count({ where: { targetHallOrgId: org.id } }),
  ]);

  const blockedReasons: string[] = [];
  if (children) blockedReasons.push(`下级组织 ${children} 条`);
  if (identities) blockedReasons.push(`身份数据 ${identities} 条`);
  if (anchors) blockedReasons.push(`主播数据 ${anchors} 条`);
  if (taskTemplates) blockedReasons.push(`任务模板 ${taskTemplates} 条`);
  if (assignmentTargets) blockedReasons.push(`任务分配目标 ${assignmentTargets} 条`);
  if (taskRecords) blockedReasons.push(`任务记录 ${taskRecords} 条`);
  if (feishuConfigs) blockedReasons.push(`飞书企业配置 ${feishuConfigs} 条`);
  if (registrationApplications) blockedReasons.push(`主播注册申请 ${registrationApplications} 条`);

  if (blockedReasons.length) {
    return fail(res, "ORG_DELETE_BLOCKED", `该组织存在关联数据，暂不允许删除：${blockedReasons.join("、")}。请先迁移或解绑后再删除`, 400);
  }

  try {
    await prisma.orgUnit.delete({ where: { id: org.id } });
    return ok(res, { deleted: true });
  } catch (error) {
    console.error("组织删除被数据库约束拦截", { orgId: org.id, error });
    return fail(res, "ORG_DELETE_BLOCKED", "该组织仍存在其他关联数据，系统暂不允许删除。请先迁移或解绑相关数据后再重试", 400);
  }
});

organizationRoutes.get("/org/feishu-base-options", permissionRequired("org:view"), async (req, res) => {
  const scopePath = req.identity?.roleCode !== "DEV_ADMIN" ? req.identity?.scopePath ?? undefined : undefined;
  const bases = await prisma.orgUnit.findMany({
    where: {
      orgType: "BASE",
      status: "active",
      ...(scopePath ? { path: { startsWith: scopePath } } : {}),
    },
    select: {
      id: true,
      orgCode: true,
      orgType: true,
      name: true,
      parentId: true,
      path: true,
      depth: true,
      principalName: true,
      contactPhone: true,
      douyinNo: true,
      douyinUid: true,
      brokerName: true,
      isVirtual: true,
      remark: true,
      status: true,
    },
    orderBy: [{ orgCode: "asc" }, { name: "asc" }],
  });
  return ok(res, bases);
});

organizationRoutes.get("/org/feishu-team-options", permissionRequired("org:view"), async (req, res) => {
  const baseOrgId = text(req.query.baseOrgId);
  if (!baseOrgId) return fail(res, "FEISHU_CONFIG_BASE_REQUIRED", "请选择基地后再加载团队", 400);

  const scopePath = req.identity?.roleCode !== "DEV_ADMIN" ? req.identity?.scopePath ?? undefined : undefined;
  const teams = await prisma.orgUnit.findMany({
    where: {
      orgType: "TEAM",
      parentId: baseOrgId,
      status: "active",
      ...(scopePath ? { path: { startsWith: scopePath } } : {}),
    },
    select: {
      id: true,
      orgCode: true,
      orgType: true,
      name: true,
      parentId: true,
      path: true,
      depth: true,
      principalName: true,
      contactPhone: true,
      douyinNo: true,
      douyinUid: true,
      brokerName: true,
      isVirtual: true,
      remark: true,
      status: true,
    },
    orderBy: [{ orgCode: "asc" }, { name: "asc" }],
  });
  return ok(res, teams);
});

organizationRoutes.get("/org/feishu-configs", permissionRequired("org:view"), async (req, res) => {
  const feishuConfigModel = (prisma as any).feishuEnterpriseConfig;
  if (!feishuConfigModel) {
    return ok(res, []);
  }

  const baseOrgId = text(req.query.baseOrgId);
  const teamOrgId = text(req.query.teamOrgId);
  const status = text(req.query.status);
  const scopePath = req.identity?.roleCode !== "DEV_ADMIN" ? req.identity?.scopePath ?? undefined : undefined;
  const configs = await feishuConfigModel.findMany({
    where: {
      ...(scopePath ? {
        OR: [
          { baseOrg: { path: { startsWith: scopePath } } },
          { teamOrg: { path: { startsWith: scopePath } } },
        ],
      } : {}),
      ...(baseOrgId ? { baseOrgId } : {}),
      ...(teamOrgId ? { teamOrgId } : {}),
      ...(["active", "paused"].includes(status) ? { status } : {}),
    },
    include: {
      baseOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
      teamOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
    },
    orderBy: [{ baseOrgId: "asc" }, { teamOrgId: "asc" }, { name: "asc" }],
  });
  return ok(res, configs);
});

organizationRoutes.post("/org/feishu-configs", permissionRequired("org:update"), async (req, res) => {
  const feishuConfigModel = (prisma as any).feishuEnterpriseConfig;
  if (!feishuConfigModel) {
    return fail(res, "FEISHU_CONFIG_MODEL_UNAVAILABLE", "当前 Prisma Client 尚未包含飞书企业配置模型，请先执行 prisma generate / migrate", 500);
  }

  const name = text(req.body.name);
  const appId = text(req.body.appId);
  const appSecret = text(req.body.appSecret);
  const baseOrgId = text(req.body.baseOrgId);
  const teamOrgId = text(req.body.teamOrgId);

  if (!name) return fail(res, "FEISHU_CONFIG_NAME_REQUIRED", "请填写飞书企业名称", 400);
  if (!appId) return fail(res, "FEISHU_CONFIG_APP_ID_REQUIRED", "请填写 App ID", 400);
  if (!appSecret) return fail(res, "FEISHU_CONFIG_APP_SECRET_REQUIRED", "请填写 App Secret", 400);
  if (!env.FEISHU_REDIRECT_URI) return fail(res, "FEISHU_CONFIG_REDIRECT_URI_REQUIRED", "系统未配置统一回调地址，请先设置 FEISHU_REDIRECT_URI", 400);
  if (!baseOrgId) return fail(res, "FEISHU_CONFIG_BASE_REQUIRED", "请选择基地", 400);
  if (!teamOrgId) return fail(res, "FEISHU_CONFIG_TEAM_REQUIRED", "请选择团队", 400);

  const [baseOrg, teamOrg] = await Promise.all([
    prisma.orgUnit.findUnique({ where: { id: baseOrgId } }),
    prisma.orgUnit.findUnique({ where: { id: teamOrgId } }),
  ]);
  if (!baseOrg || baseOrg.orgType !== "BASE") return fail(res, "FEISHU_CONFIG_BASE_INVALID", "所选基地不存在", 400);
  if (!teamOrg || teamOrg.orgType !== "TEAM") return fail(res, "FEISHU_CONFIG_TEAM_INVALID", "所选团队不存在", 400);
  if (teamOrg.parentId !== baseOrg.id) return fail(res, "FEISHU_CONFIG_ORG_MISMATCH", "所选团队不属于当前基地", 400);

  try {
    const config = await feishuConfigModel.create({
      data: { name, appId, appSecret, baseOrgId, teamOrgId, status: "active" },
      include: {
        baseOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
        teamOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
      },
    });
    return ok(res, config);
  } catch (error) {
    if (isUniqueConstraintError(error, "app_id")) return fail(res, "FEISHU_CONFIG_APP_ID_EXISTS", `App ID ${appId} 已存在`, 409);
    return fail(res, "FEISHU_CONFIG_CREATE_FAILED", error instanceof Error ? error.message : "飞书企业配置创建失败", 400);
  }
});

organizationRoutes.patch("/org/feishu-configs/:id", permissionRequired("org:update"), async (req, res) => {
  const feishuConfigModel = (prisma as any).feishuEnterpriseConfig;
  if (!feishuConfigModel) {
    return fail(res, "FEISHU_CONFIG_MODEL_UNAVAILABLE", "当前 Prisma Client 尚未包含飞书企业配置模型，请先执行 prisma generate / migrate", 500);
  }

  const existed = await feishuConfigModel.findUnique({ where: { id: req.params.id } });
  if (!existed) return fail(res, "FEISHU_CONFIG_NOT_FOUND", "飞书企业配置不存在", 404);

  const name = "name" in req.body ? text(req.body.name) : existed.name;
  const appId = "appId" in req.body ? text(req.body.appId) : existed.appId;
  const appSecret = "appSecret" in req.body ? text(req.body.appSecret) : existed.appSecret;
  const baseOrgId = "baseOrgId" in req.body ? text(req.body.baseOrgId) : existed.baseOrgId;
  const teamOrgId = "teamOrgId" in req.body ? text(req.body.teamOrgId) : existed.teamOrgId;

  const [baseOrg, teamOrg] = await Promise.all([
    prisma.orgUnit.findUnique({ where: { id: baseOrgId } }),
    prisma.orgUnit.findUnique({ where: { id: teamOrgId } }),
  ]);
  if (!baseOrg || baseOrg.orgType !== "BASE") return fail(res, "FEISHU_CONFIG_BASE_INVALID", "所选基地不存在", 400);
  if (!teamOrg || teamOrg.orgType !== "TEAM") return fail(res, "FEISHU_CONFIG_TEAM_INVALID", "所选团队不存在", 400);
  if (teamOrg.parentId !== baseOrg.id) return fail(res, "FEISHU_CONFIG_ORG_MISMATCH", "所选团队不属于当前基地", 400);

  try {
    const config = await feishuConfigModel.update({
      where: { id: req.params.id },
      data: { name, appId, appSecret, baseOrgId, teamOrgId },
      include: {
        baseOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
        teamOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
      },
    });
    return ok(res, config);
  } catch (error) {
    if (isUniqueConstraintError(error, "app_id")) return fail(res, "FEISHU_CONFIG_APP_ID_EXISTS", `App ID ${appId} 已存在`, 409);
    return fail(res, "FEISHU_CONFIG_UPDATE_FAILED", error instanceof Error ? error.message : "飞书企业配置更新失败", 400);
  }
});

organizationRoutes.patch("/org/feishu-configs/:id/status", permissionRequired("org:update"), async (req, res) => {
  const feishuConfigModel = (prisma as any).feishuEnterpriseConfig;
  if (!feishuConfigModel) {
    return fail(res, "FEISHU_CONFIG_MODEL_UNAVAILABLE", "当前 Prisma Client 尚未包含飞书企业配置模型，请先执行 prisma generate / migrate", 500);
  }

  const status = text(req.body.status);
  if (!["active", "paused"].includes(status)) return fail(res, "FEISHU_CONFIG_STATUS_INVALID", "状态仅支持 active 或 paused", 400);
  const existed = await feishuConfigModel.findUnique({ where: { id: req.params.id } });
  if (!existed) return fail(res, "FEISHU_CONFIG_NOT_FOUND", "飞书企业配置不存在", 404);
  const updated = await feishuConfigModel.update({
    where: { id: req.params.id },
    data: { status: status as any },
    include: {
      baseOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
      teamOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
    },
  });
  return ok(res, updated);
});
