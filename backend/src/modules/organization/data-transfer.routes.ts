import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

export const organizationDataTransferRoutes = Router();
organizationDataTransferRoutes.use(authRequired, identityRequired);

const ALLOWED_ROLES = new Set(["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"]);

function value(input: unknown) {
  return String(input ?? "").trim();
}

function isInsideScope(scopePath: string | undefined, targetPath: string) {
  return !scopePath || targetPath === scopePath || targetPath.startsWith(`${scopePath}/`);
}

function ensureRole(req: Request) {
  return Boolean(req.identity?.roleCode && ALLOWED_ROLES.has(req.identity.roleCode));
}

async function loadTransferContext(hallOrgId: string, targetTeamOrgId: string) {
  const [hall, targetTeam] = await Promise.all([
    prisma.orgUnit.findUnique({ where: { id: hallOrgId } }),
    prisma.orgUnit.findUnique({ where: { id: targetTeamOrgId } }),
  ]);
  const sourceTeam = hall?.parentId ? await prisma.orgUnit.findUnique({ where: { id: hall.parentId } }) : null;
  const [sourceBase, targetBase] = await Promise.all([
    sourceTeam?.parentId ? prisma.orgUnit.findUnique({ where: { id: sourceTeam.parentId } }) : Promise.resolve(null),
    targetTeam?.parentId ? prisma.orgUnit.findUnique({ where: { id: targetTeam.parentId } }) : Promise.resolve(null),
  ]);
  return { hall, targetTeam, sourceTeam, sourceBase, targetBase };
}

function validateContext(req: Request, context: Awaited<ReturnType<typeof loadTransferContext>>) {
  const { hall, targetTeam } = context;
  if (!hall || hall.orgType !== "HALL") return ["TRANSFER_HALL_NOT_FOUND", "待转移的厅不存在"] as const;
  if (hall.status !== "active") return ["TRANSFER_HALL_INACTIVE", "暂停的厅不能执行数据转移"] as const;
  if (!targetTeam || targetTeam.orgType !== "TEAM") return ["TRANSFER_TARGET_TEAM_NOT_FOUND", "目标团队不存在"] as const;
  if (targetTeam.status !== "active") return ["TRANSFER_TARGET_TEAM_INACTIVE", "目标团队已暂停，不能接收数据"] as const;
  if (hall.parentId === targetTeam.id) return ["TRANSFER_SAME_TEAM", "该厅已经属于目标团队"] as const;

  const roleCode = req.identity?.roleCode;
  const scopePath = roleCode === "DEV_ADMIN" || roleCode === "HQ_ADMIN" ? undefined : req.identity?.scopePath;
  if (!isInsideScope(scopePath, hall.path) || !isInsideScope(scopePath, targetTeam.path)) {
    return ["TRANSFER_SCOPE_FORBIDDEN", "只能在当前身份管理范围内转移组织数据"] as const;
  }
  return null;
}

async function buildPreview(hallOrgId: string, targetTeamOrgId: string) {
  const context = await loadTransferContext(hallOrgId, targetTeamOrgId);
  const { hall, targetTeam } = context;
  if (!hall || !targetTeam) return { context, preview: null };

  const [anchorCount, identityCount, taskRecordCount, hallTaskRecordCount, pendingLeaveCount, registrationCount, oldTargets, targetAssignments] = await Promise.all([
    prisma.anchorProfile.count({ where: { hallOrgId } }),
    prisma.userIdentity.count({ where: { OR: [{ orgId: hallOrgId }, { scopePath: { startsWith: hall.path } }] } }),
    prisma.taskRecord.count({ where: { subjectOrgId: hallOrgId } }),
    prisma.hallTaskRecord.count({ where: { hallOrgId } }),
    prisma.hallTaskLeaveRequest.count({ where: { status: "pending", taskRecord: { hallOrgId } } }),
    prisma.anchorRegistrationApplication.count({ where: { targetHallOrgId: hallOrgId } }),
    prisma.hallTaskAssignmentTarget.findMany({
      where: { hallOrgId, assignment: { status: { in: ["active", "scheduled"] }, teamOrgId: { not: targetTeamOrgId } } },
      select: { id: true, assignmentId: true, assignment: { select: { status: true, teamOrgId: true, template: { select: { title: true } } } } },
    }),
    prisma.hallTaskAssignment.findMany({
      where: { teamOrgId: targetTeamOrgId, status: { in: ["active", "scheduled"] } },
      select: { id: true, status: true, template: { select: { title: true } }, targets: { where: { hallOrgId }, select: { id: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const activeCount = targetAssignments.filter((item) => item.status === "active").length;
  const scheduledCount = targetAssignments.filter((item) => item.status === "scheduled").length;
  const blockers: string[] = [];
  if (activeCount > 1) blockers.push("目标团队存在多个生效中的厅管日常任务，请先整理任务配置");
  if (scheduledCount > 1) blockers.push("目标团队存在多个待生效厅管日常任务，请先整理任务配置");

  const warnings: string[] = [
    "转移后，全部历史数据按该厅当前归属计入目标团队，原团队立即失去访问权。",
    "仅保存团队汇总且没有厅或主播标识的数据无法拆分，仍保留在原团队；厅级和主播级明细全部跟随。",
  ];
  if (!targetAssignments.length) warnings.push("目标团队当前没有生效或待生效的厅管日常任务；转移后不会自动生成新的厅管日常任务。");
  if (pendingLeaveCount) warnings.push(`存在 ${pendingLeaveCount} 条待审批请假，转移后由目标团队接管。`);

  return {
    context,
    preview: {
      revision: hall.updatedAt.toISOString(),
      source: {
        hall: { id: hall.id, name: hall.name, orgCode: hall.orgCode },
        team: context.sourceTeam ? { id: context.sourceTeam.id, name: context.sourceTeam.name } : null,
        base: context.sourceBase ? { id: context.sourceBase.id, name: context.sourceBase.name } : null,
      },
      target: {
        team: { id: targetTeam.id, name: targetTeam.name },
        base: context.targetBase ? { id: context.targetBase.id, name: context.targetBase.name } : null,
      },
      affected: { anchorCount, identityCount, taskRecordCount, hallTaskRecordCount, pendingLeaveCount, registrationCount },
      hallDaily: {
        detachedAssignments: oldTargets.map((item) => ({ id: item.assignmentId, title: item.assignment.template.title, status: item.assignment.status })),
        attachedAssignments: targetAssignments.map((item) => ({ id: item.id, title: item.template.title, status: item.status, alreadyAttached: item.targets.length > 0 })),
      },
      warnings,
      blockers,
      canExecute: blockers.length === 0,
    },
  };
}

organizationDataTransferRoutes.post(
  "/organization-data-transfer/preview",
  permissionRequired("org:data-transfer"),
  async (req, res) => {
    if (!ensureRole(req)) return fail(res, "TRANSFER_ROLE_FORBIDDEN", "仅开发管理员、总部管理员或基地管理员可以转移组织数据", 403);
    const hallOrgId = value(req.body.hallOrgId);
    const targetTeamOrgId = value(req.body.targetTeamOrgId);
    if (!hallOrgId || !targetTeamOrgId) return fail(res, "TRANSFER_FIELDS_REQUIRED", "请选择待转移厅和目标团队", 400);
    const result = await buildPreview(hallOrgId, targetTeamOrgId);
    const validation = validateContext(req, result.context);
    if (validation) return fail(res, validation[0], validation[1], validation[0].includes("FORBIDDEN") ? 403 : 400);
    return ok(res, result.preview);
  }
);

organizationDataTransferRoutes.post(
  "/organization-data-transfer/execute",
  permissionRequired("org:data-transfer"),
  async (req, res) => {
    if (!ensureRole(req)) return fail(res, "TRANSFER_ROLE_FORBIDDEN", "仅开发管理员、总部管理员或基地管理员可以转移组织数据", 403);
    const hallOrgId = value(req.body.hallOrgId);
    const targetTeamOrgId = value(req.body.targetTeamOrgId);
    const expectedRevision = value(req.body.expectedRevision);
    const confirmationText = value(req.body.confirmationText);
    if (!hallOrgId || !targetTeamOrgId || !expectedRevision) return fail(res, "TRANSFER_FIELDS_REQUIRED", "迁移参数不完整，请重新预检", 400);

    const previewResult = await buildPreview(hallOrgId, targetTeamOrgId);
    const validation = validateContext(req, previewResult.context);
    if (validation) return fail(res, validation[0], validation[1], validation[0].includes("FORBIDDEN") ? 403 : 400);
    if (!previewResult.preview?.canExecute) return fail(res, "TRANSFER_PREFLIGHT_BLOCKED", previewResult.preview?.blockers.join("；") || "迁移预检未通过", 409);
    if (confirmationText !== previewResult.context.hall!.name) return fail(res, "TRANSFER_CONFIRMATION_MISMATCH", "请输入完整厅名称确认转移", 400);
    if (previewResult.preview.revision !== expectedRevision) return fail(res, "TRANSFER_DATA_CHANGED", "组织数据在预检后发生变化，请重新预检", 409);

    const oldPath = previewResult.context.hall!.path;
    const newPath = `${previewResult.context.targetTeam!.path}/${previewResult.context.hall!.orgCode}`;
    const now = new Date();

    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM org_units WHERE id IN (${Prisma.join([hallOrgId, targetTeamOrgId])}) FOR UPDATE`;
        const [hall, targetTeam] = await Promise.all([
          tx.orgUnit.findUnique({ where: { id: hallOrgId } }),
          tx.orgUnit.findUnique({ where: { id: targetTeamOrgId } }),
        ]);
        if (!hall || !targetTeam || hall.parentId === targetTeam.id) throw new Error("TRANSFER_CONTEXT_CHANGED");
        if (hall.updatedAt.toISOString() !== expectedRevision) throw new Error("TRANSFER_DATA_CHANGED");

        const oldActiveTargets = await tx.hallTaskAssignmentTarget.findMany({
          where: { hallOrgId, assignment: { status: { in: ["active", "scheduled"] }, teamOrgId: { not: targetTeamOrgId } } },
          select: { id: true },
        });
        const targetAssignments = await tx.hallTaskAssignment.findMany({
          where: { teamOrgId: targetTeamOrgId, status: { in: ["active", "scheduled"] } },
          select: { id: true, status: true },
        });
        if (targetAssignments.filter((item) => item.status === "active").length > 1
          || targetAssignments.filter((item) => item.status === "scheduled").length > 1) {
          throw new Error("TRANSFER_TARGET_ASSIGNMENTS_CHANGED");
        }

        if (oldActiveTargets.length) {
          await tx.hallTaskAssignmentTarget.deleteMany({ where: { id: { in: oldActiveTargets.map((item) => item.id) } } });
        }
        if (targetAssignments.length) {
          await tx.hallTaskAssignmentTarget.createMany({
            data: targetAssignments.map((assignment) => ({ assignmentId: assignment.id, hallOrgId })),
            skipDuplicates: true,
          });
        }

        await tx.orgUnit.update({ where: { id: hallOrgId }, data: { parentId: targetTeamOrgId, path: newPath, depth: targetTeam.depth + 1 } });
        await tx.userIdentity.updateMany({ where: { scopePath: { startsWith: oldPath } }, data: { scopePath: newPath } });
        const profiles = await tx.anchorProfile.findMany({ where: { hallOrgId }, select: { boundUserId: true } });
        const anchorUserIds = Array.from(new Set(profiles.map((item) => item.boundUserId).filter(Boolean) as string[]));
        if (anchorUserIds.length) {
          await tx.userIdentity.updateMany({ where: { userId: { in: anchorUserIds }, roleCode: "ANCHOR" }, data: { orgId: hallOrgId, scopePath: newPath } });
        }

        await tx.auditLog.create({
          data: {
            operatorUserId: req.userId!,
            operatorIdentityId: req.identity!.id,
            action: "ORGANIZATION_DATA_TRANSFER",
            targetType: "HALL",
            targetId: hallOrgId,
            ip: req.ip,
            detailJson: {
              hallName: hall.name,
              sourceTeamOrgId: hall.parentId,
              targetTeamOrgId,
              oldPath,
              newPath,
              detachedHallDailyTargetCount: oldActiveTargets.length,
              attachedHallDailyTargetCount: targetAssignments.length,
              preview: previewResult.preview.affected,
              transferredAt: now.toISOString(),
            },
          },
        });

        return {
          hall: { id: hall.id, name: hall.name, oldPath, newPath, targetTeamOrgId },
          detachedHallDailyTargetCount: oldActiveTargets.length,
          attachedHallDailyTargetCount: targetAssignments.length,
          transferredAt: now.toISOString(),
        };
      }, { timeout: 20_000 });
      return ok(res, result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "TRANSFER_DATA_CHANGED" || code === "TRANSFER_CONTEXT_CHANGED" || code === "TRANSFER_TARGET_ASSIGNMENTS_CHANGED") {
        return fail(res, code, "组织数据已发生变化，请重新预检后再执行", 409);
      }
      throw error;
    }
  }
);
