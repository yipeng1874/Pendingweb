import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";
import { readStatisticsGroups } from "./statistics-groups.js";

export const statisticsGroupRoutes = Router();
statisticsGroupRoutes.use(authRequired, identityRequired, permissionRequired("org:update"));
statisticsGroupRoutes.use((req, res, next) => {
  if (!["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"].includes(req.identity?.roleCode ?? "")) return fail(res, "FORBIDDEN", "仅基地及以上管理员可以设置合并统计", 403);
  next();
});

async function allowedBase(req: import("express").Request, baseId: string) {
  const base = await prisma.orgUnit.findFirst({ where: { id: baseId, orgType: "BASE", status: "active" } });
  if (!base) return null;
  if (req.identity?.roleCode === "BASE_ADMIN") {
    const scope = req.identity.scopePath;
    if (!scope || !(base.path === scope || base.path.startsWith(`${scope}/`))) return null;
  }
  return base;
}

statisticsGroupRoutes.get("/organization-statistics-groups/:baseId", async (req, res, next) => {
  try {
    const base = await allowedBase(req, req.params.baseId);
    if (!base) return fail(res, "FORBIDDEN", "基地不存在或不在管理范围内", 403);
    return ok(res, await readStatisticsGroups(base.id));
  } catch (error) { next(error); }
});

const schema = z.object({
  revision: z.number().int().nonnegative(),
  groups: z.array(z.object({
    id: z.string().uuid(), name: z.string().trim().min(1).max(30), enabled: z.boolean(),
    teamIds: z.array(z.string().uuid()).max(200),
  }).strict()).max(100),
}).strict();

statisticsGroupRoutes.put("/organization-statistics-groups/:baseId", async (req, res, next) => {
  try {
    const base = await allowedBase(req, req.params.baseId);
    if (!base) return fail(res, "FORBIDDEN", "基地不存在或不在管理范围内", 403);
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, "INVALID_GROUPS", "请填写分组名称（最多30字），并检查团队选择", 400);
    const { groups, revision } = parsed.data;
    const ids = groups.flatMap((group) => group.teamIds);
    if (new Set(ids).size !== ids.length || new Set(groups.map((g) => g.id)).size !== groups.length || new Set(groups.map((g) => g.name)).size !== groups.length) {
      return fail(res, "DUPLICATE_GROUP", "分组名称不能重复，一个团队只能加入一个分组（含停用分组）", 400);
    }
    const teams = await prisma.orgUnit.findMany({ where: { parentId: base.id, orgType: "TEAM", id: { in: ids } }, select: { id: true } });
    if (teams.length !== ids.length) return fail(res, "INVALID_TEAMS", "成员必须为当前基地的团队，请刷新后重新选择", 400);
    await prisma.$transaction(async (tx) => {
      // An atomic revision comparison prevents lost updates from concurrent administrators.
      if (revision === 0) {
        await tx.$executeRaw`INSERT INTO organization_statistics_groups (base_org_id, groups_json, revision) VALUES (${base.id}, ${JSON.stringify(groups)}, 1)`;
      } else {
        const count = await tx.$executeRaw`UPDATE organization_statistics_groups SET groups_json = ${JSON.stringify(groups)}, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE base_org_id = ${base.id} AND revision = ${revision}`;
        if (count !== 1) throw new Error("GROUP_REVISION_CONFLICT");
      }
      await tx.auditLog.create({ data: { operatorUserId: req.userId!, operatorIdentityId: req.identity!.id,
        action: "STATISTICS_GROUPS_UPDATE", targetType: "BASE", targetId: base.id, ip: req.ip,
        detailJson: { previousRevision: revision, groups } } });
    });
    return ok(res, { groups, revision: revision + 1 });
  } catch (error: any) {
    if (error?.message === "GROUP_REVISION_CONFLICT" || error?.code === "P2002" || (error?.code === "P2010" && String(error.meta?.code) === "1062")) {
      return fail(res, "GROUP_REVISION_CONFLICT", "配置已被其他管理员修改，请刷新后重试", 409);
    }
    next(error);
  }
});
