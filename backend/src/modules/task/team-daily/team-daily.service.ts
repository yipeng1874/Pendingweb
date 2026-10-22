import { prisma } from "../../../shared/prisma.js";
import { withTeamRecordLock } from "./team-record-lock.js";
import {
  formatBeijingDate,
  makeBeijingDate,
  getDailyTaskContext,
  isDailyRecordOverdue,
  isDailyRecordCollectionClosed,
} from "../record/daily-record-time.utils.js";

// ─── 权限常量 ─────────────────────────────────────────────────────────────────
// 允许维护团队管理日常任务的角色（基地自治：TEAM_ADMIN 为核心，上级可选定基地后操作）
const TEAM_DAILY_ALLOWED_ROLE_CODES = new Set([
  "DEV_ADMIN",
  "HQ_ADMIN",
  "BASE_ADMIN",
  "BASE_ADMIN",
]);

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function ensureTeamDailyRole(roleCode?: string) {
  if (!roleCode || !TEAM_DAILY_ALLOWED_ROLE_CODES.has(roleCode)) {
    throw new Error("TEAM_DAILY_ROLE_FORBIDDEN");
  }
}

function ensureTeamScopeSelected(scopeOrgId?: string) {
  if (!scopeOrgId) throw new Error("TEAM_DAILY_TEAM_SCOPE_REQUIRED");
}

function isPathWithinScope(scopePath?: string, targetPath?: string | null) {
  if (!targetPath) return false;
  if (!scopePath) return false;
  return (
    targetPath === scopePath ||
    targetPath.startsWith(`${scopePath}/`) ||
    false
  );
}

async function resolveBaseOrg(baseOrgId: string, scopePath?: string, roleCode?: string) {
  const org = await prisma.orgUnit.findFirst({
    where: { id: baseOrgId, status: "active" },
    select: { id: true, path: true, orgType: true, name: true },
  });
  if (!org) throw new Error("TEAM_DAILY_TEAM_ORG_NOT_FOUND");
  if (org.orgType !== "BASE") throw new Error("TEAM_DAILY_TEAM_ORG_REQUIRED");
  if (roleCode !== "DEV_ADMIN" && !isPathWithinScope(scopePath, org.path)) {
    throw new Error("TEAM_DAILY_FORBIDDEN");
  }
  return org;
}

const ABSOLUTE_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const RELATIVE_LINK_RE = /^(\/|\.\/|\.\.\/|#|\?)/;
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:"]);

function normalizeTeamTaskLinkUrl(linkUrl?: string | null) {
  const value = typeof linkUrl === "string" ? linkUrl.trim() : "";
  if (!value || RELATIVE_LINK_RE.test(value)) return null;
  const candidate = ABSOLUTE_PROTOCOL_RE.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol) || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTeamTaskItems(
  items: Array<{
    sortOrder: number;
    itemType: string;
    title: string;
    isRequired?: boolean;
    linkUrl?: string | null;
    options?: Array<{ sortOrder: number; label: string }>;
  }>
) {
  return items.map((item, index) => {
    const normalizedLinkUrl = item.itemType === "LINK" ? normalizeTeamTaskLinkUrl(item.linkUrl) : null;
    if (item.itemType === "LINK") {
      if (!item.linkUrl?.trim()) throw new Error("TEAM_TASK_LINK_URL_REQUIRED");
      if (!normalizedLinkUrl) throw new Error("TEAM_TASK_LINK_URL_INVALID");
    }
    return {
      sortOrder: item.sortOrder ?? index,
      itemType: item.itemType,
      title: typeof item.title === "string" ? item.title.trim() : "",
      isRequired: item.isRequired ?? true,
      linkUrl: normalizedLinkUrl,
      options: item.options?.map((opt, oi) => ({ sortOrder: opt.sortOrder ?? oi, label: opt.label })) ?? [],
    };
  });
}

const TEMPLATE_INCLUDE = {
  items: {
    include: { options: { orderBy: { sortOrder: "asc" as const } } },
    orderBy: { sortOrder: "asc" as const },
  },
};

// ─── 模板服务 ─────────────────────────────────────────────────────────────────

export const TeamDailyTemplateService = {
  async list(params: {
    baseOrgId?: string;
    status?: string;
    neverPublished?: boolean;
    scopePath?: string;
    roleCode?: string;
    limit?: number;
    offset?: number;
  }) {
    const { baseOrgId, status, neverPublished, scopePath, roleCode, limit, offset } = params;
    ensureTeamDailyRole(roleCode);
    ensureTeamScopeSelected(baseOrgId);

    // 验证基地组织权限
    await resolveBaseOrg(baseOrgId!, scopePath, roleCode);

    const where: any = { baseOrgId };
    if (status) where.status = status;

    // neverPublished=true：只返回从未被发布过的纯净草稿
    // 即：没有任何 assignment 状态为 scheduled / active / ended 的模板
    if (neverPublished) {
      where.assignments = {
        none: { status: { in: ["scheduled", "active", "ended"] } },
      };
    }

    return prisma.teamTaskTemplate.findMany({
      where,
      include: {
        ...TEMPLATE_INCLUDE,
        _count: { select: { assignments: true } },
      },
      orderBy: { createdAt: "desc" },
      ...(offset && offset > 0 ? { skip: offset } : {}),
      ...(limit && limit > 0 ? { take: limit } : {}),
    });
  },

  async getById(id: string, scopePath?: string, roleCode?: string, baseOrgId?: string) {
    ensureTeamDailyRole(roleCode);
    const template = await prisma.teamTaskTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
    if (baseOrgId && template.baseOrgId !== baseOrgId) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
    await resolveBaseOrg(template.baseOrgId, scopePath, roleCode);
    return template;
  },

  async create(data: {
    title: string;
    description?: string;
    baseOrgId: string;
    createdBy: string;
    scopePath?: string;
    roleCode?: string;
    items: Array<{
      sortOrder: number;
      itemType: string;
      title: string;
      isRequired?: boolean;
      linkUrl?: string;
      options?: Array<{ sortOrder: number; label: string }>;
    }>;
  }) {
    ensureTeamDailyRole(data.roleCode);
    ensureTeamScopeSelected(data.baseOrgId);
    await resolveBaseOrg(data.baseOrgId, data.scopePath, data.roleCode);

    const normalizedItems = normalizeTeamTaskItems(data.items);

    return prisma.teamTaskTemplate.create({
      data: {
        title: data.title,
        description: data.description,
        baseOrgId: data.baseOrgId,
        createdBy: data.createdBy,
        version: 1,
        status: "draft",
        items: {
          create: normalizedItems.map((item) => ({
            sortOrder: item.sortOrder,
            itemType: item.itemType as any,
            title: item.title,
            isRequired: item.isRequired,
            linkUrl: item.linkUrl,
            options: item.options.length
              ? { create: item.options.map((opt) => ({ sortOrder: opt.sortOrder, label: opt.label })) }
              : undefined,
          })),
        },
      },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
  },

  async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      items?: Array<{
        sortOrder: number;
        itemType: string;
        title: string;
        isRequired?: boolean;
        linkUrl?: string;
        options?: Array<{ sortOrder: number; label: string }>;
      }>;
    },
    scopePath?: string,
    roleCode?: string,
    baseOrgId?: string
  ) {
    ensureTeamDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const template = await tx.teamTaskTemplate.findUnique({ where: { id } });
      if (!template) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
      if (baseOrgId && template.baseOrgId !== baseOrgId) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
      await resolveBaseOrg(template.baseOrgId, scopePath, roleCode);

      // 有生效/已发布任务时禁止修改
      const blockedCount = await tx.teamTaskAssignment.count({
        where: { templateId: id, status: { in: ["active", "scheduled"] } },
      });
      if (blockedCount > 0) throw new Error("TEAM_TASK_TEMPLATE_IN_USE");

      if (data.items !== undefined) {
        const normalizedItems = normalizeTeamTaskItems(data.items);
        const oldItems = await tx.teamTaskItem.findMany({ where: { templateId: id }, select: { id: true } });
        for (const item of oldItems) {
          await tx.teamTaskItemOption.deleteMany({ where: { taskItemId: item.id } });
        }
        await tx.teamTaskItem.deleteMany({ where: { templateId: id } });
        for (const item of normalizedItems) {
          const created = await tx.teamTaskItem.create({
            data: {
              templateId: id,
              sortOrder: item.sortOrder,
              itemType: item.itemType as any,
              title: item.title,
              isRequired: item.isRequired,
              linkUrl: item.linkUrl,
            },
          });
          if (item.options.length) {
            await tx.teamTaskItemOption.createMany({
              data: item.options.map((opt) => ({ taskItemId: created.id, sortOrder: opt.sortOrder, label: opt.label })),
            });
          }
        }
      }

      return tx.teamTaskTemplate.update({
        where: { id },
        data: { title: data.title, description: data.description },
        include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
      });
    });
  },

  async remove(id: string, scopePath?: string, roleCode?: string, baseOrgId?: string) {
    ensureTeamDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const template = await tx.teamTaskTemplate.findUnique({
        where: { id },
        include: { items: { select: { id: true } }, assignments: { select: { id: true, status: true } } },
      });
      if (!template) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
      if (baseOrgId && template.baseOrgId !== baseOrgId) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
      await resolveBaseOrg(template.baseOrgId, scopePath, roleCode);

      const hasBlocker = template.assignments.some((a: any) => ["active", "scheduled", "ended"].includes(a.status));
      if (hasBlocker) throw new Error("TEAM_TASK_TEMPLATE_HAS_ASSIGNMENTS");

      // 只清理 draft 状态的 assignment（active/scheduled/ended 已在上方拦截）
      const cleanableIds = template.assignments.filter((a: any) => a.status === "draft").map((a: any) => a.id);
      if (cleanableIds.length > 0) {
        await tx.teamTaskAssignmentTarget.deleteMany({ where: { assignmentId: { in: cleanableIds } } });
        await tx.teamTaskAssignment.deleteMany({ where: { id: { in: cleanableIds } } });
      }
      const itemIds = template.items.map((i: any) => i.id);
      if (itemIds.length > 0) {
        await tx.teamTaskItemOption.deleteMany({ where: { taskItemId: { in: itemIds } } });
      }
      await tx.teamTaskItem.deleteMany({ where: { templateId: id } });
      await tx.teamTaskTemplate.delete({ where: { id } });

      return { deleted: true, id };
    });
  },

  async copy(id: string, operatorUserId: string, scopePath?: string, roleCode?: string, baseOrgId?: string) {
    ensureTeamDailyRole(roleCode);
    const source = await prisma.teamTaskTemplate.findUnique({
      where: { id },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!source) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
    if (baseOrgId && source.baseOrgId !== baseOrgId) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
    await resolveBaseOrg(source.baseOrgId, scopePath, roleCode);

    const normalizedItems = normalizeTeamTaskItems(
      source.items.map((item: any) => ({
        sortOrder: item.sortOrder,
        itemType: item.itemType,
        title: item.title,
        isRequired: item.isRequired,
        linkUrl: item.linkUrl,
        options: item.options?.map((opt: any) => ({ sortOrder: opt.sortOrder, label: opt.label })) ?? [],
      }))
    );

    return prisma.teamTaskTemplate.create({
      data: {
        title: source.title + "（副本）",
        description: source.description,
        baseOrgId: source.baseOrgId,
        createdBy: operatorUserId,
        version: 1,
        status: "draft",
        items: {
          create: normalizedItems.map((item) => ({
            sortOrder: item.sortOrder,
            itemType: item.itemType as any,
            title: item.title,
            isRequired: item.isRequired,
            linkUrl: item.linkUrl,
            options: item.options.length
              ? { create: item.options.map((opt) => ({ sortOrder: opt.sortOrder, label: opt.label })) }
              : undefined,
          })),
        },
      },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
  },

  async archive(id: string, scopePath?: string, roleCode?: string, baseOrgId?: string) {
    ensureTeamDailyRole(roleCode);
    const template = await prisma.teamTaskTemplate.findUnique({ where: { id } });
    if (!template) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
    if (baseOrgId && template.baseOrgId !== baseOrgId) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
    await resolveBaseOrg(template.baseOrgId, scopePath, roleCode);

    return prisma.teamTaskTemplate.update({
      where: { id },
      data: { status: "archived" },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
  },
};

// ─── 发布服务 ─────────────────────────────────────────────────────────────────

export const TeamDailyAssignmentService = {
  async list(params: {
    baseOrgId?: string;
    status?: string;
    scopePath?: string;
    roleCode?: string;
    limit?: number;
    offset?: number;
  }) {
    const { baseOrgId, status, scopePath, roleCode, limit, offset } = params;
    ensureTeamDailyRole(roleCode);
    ensureTeamScopeSelected(baseOrgId);
    await resolveBaseOrg(baseOrgId!, scopePath, roleCode);

    const where: any = { baseOrgId };
    if (status) where.status = status;

    return prisma.teamTaskAssignment.findMany({
      where,
      include: {
        template: { select: { id: true, title: true, status: true } },
        targets: { include: { teamOrg: { select: { id: true, name: true } } } },
        _count: { select: { records: true } },
      },
      orderBy: { createdAt: "desc" },
      ...(offset && offset > 0 ? { skip: offset } : {}),
      ...(limit && limit > 0 ? { take: limit } : {}),
    });
  },

  // 保存草稿（创建或更新）
  async saveDraft(data: {
    assignmentId?: string;
    templateId: string;
    baseOrgId: string;
    teamOrgIds: string[];
    effectMode?: "immediate" | "next_midnight";
    createdBy: string;
    scopePath?: string;
    roleCode?: string;
  }) {
    ensureTeamDailyRole(data.roleCode);
    ensureTeamScopeSelected(data.baseOrgId);
    await resolveBaseOrg(data.baseOrgId, data.scopePath, data.roleCode);

    const template = await prisma.teamTaskTemplate.findUnique({ where: { id: data.templateId } });
    if (!template) throw new Error("TEAM_TASK_TEMPLATE_NOT_FOUND");
    if (template.baseOrgId !== data.baseOrgId) throw new Error("TEAM_TASK_TEMPLATE_TEAM_MISMATCH");
    if (template.status === "archived") throw new Error("TEAM_TASK_TEMPLATE_ARCHIVED");

    // 验证目标团队都属于该基地
    if (data.teamOrgIds.length > 0) {
      const halls = await prisma.orgUnit.findMany({
        where: { id: { in: data.teamOrgIds }, orgType: "TEAM", status: "active" },
        select: { id: true, path: true },
      });
      const baseOrg = await prisma.orgUnit.findUnique({ where: { id: data.baseOrgId }, select: { path: true } });
      const invalidHalls = halls.filter((h) => !h.path.startsWith(`${baseOrg!.path}/`));
      if (halls.length !== new Set(data.teamOrgIds).size || invalidHalls.length > 0) throw new Error("TEAM_DAILY_HALL_NOT_IN_TEAM");
    }

    return prisma.$transaction(async (tx) => {
      let assignmentId = data.assignmentId;
      if (assignmentId) {
        const existing = await tx.teamTaskAssignment.findUnique({ where: { id: assignmentId } });
        if (!existing) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
        if (existing.baseOrgId !== data.baseOrgId) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
        if (existing.status !== "draft") throw new Error("TEAM_TASK_ASSIGNMENT_NOT_DRAFT");
        await tx.teamTaskAssignment.update({
          where: { id: assignmentId },
          data: { templateId: data.templateId, effectMode: data.effectMode ?? "immediate" },
        });
      } else {
        const created = await tx.teamTaskAssignment.create({
          data: {
            templateId: data.templateId,
            baseOrgId: data.baseOrgId,
            status: "draft",
            effectMode: data.effectMode ?? "immediate",
            createdBy: data.createdBy,
            createdByOrgId: data.baseOrgId,
          },
        });
        assignmentId = created.id;
      }

      // 覆盖目标团队
      await tx.teamTaskAssignmentTarget.deleteMany({ where: { assignmentId } });
      if (data.teamOrgIds.length > 0) {
        await tx.teamTaskAssignmentTarget.createMany({
          data: data.teamOrgIds.map((teamOrgId) => ({ assignmentId: assignmentId!, teamOrgId })),
        });
      }

      return tx.teamTaskAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          template: { select: { id: true, title: true, status: true } },
          targets: { include: { teamOrg: { select: { id: true, name: true } } } },
        },
      });
    });
  },

  // 发布预览
  async getPublishPreview(id: string, scopePath?: string, roleCode?: string, baseOrgId?: string) {
    ensureTeamDailyRole(roleCode);
    const assignment = await prisma.teamTaskAssignment.findUnique({
      where: { id },
      include: {
        template: { select: { id: true, title: true } },
        targets: { include: { teamOrg: { select: { id: true, name: true } } } },
      },
    });
    if (!assignment) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
    if (baseOrgId && assignment.baseOrgId !== baseOrgId) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
    await resolveBaseOrg(assignment.baseOrgId, scopePath, roleCode);
    if (assignment.status !== "draft") throw new Error("TEAM_TASK_ASSIGNMENT_NOT_DRAFT");

    // 检查目标团队是否已有生效任务
    const activeAssignments = await prisma.teamTaskAssignment.findMany({
      where: {
        baseOrgId: assignment.baseOrgId,
        status: { in: ["active", "scheduled"] },
        id: { not: id },
      },
      include: {
        template: { select: { title: true } },
        targets: { select: { teamOrgId: true } },
      },
    });

    const targetHallIds = new Set(assignment.targets.map((t: any) => t.teamOrgId));
    const overlapping = activeAssignments
      .filter((a: any) => a.targets.some((t: any) => targetHallIds.has(t.teamOrgId)))
      .map((a: any) => ({ id: a.id, title: a.template.title, status: a.status }));

    return {
      assignmentId: assignment.id,
      templateId: assignment.templateId,
      templateTitle: (assignment as any).template.title,
      effectMode: assignment.effectMode,
      targetOrgCount: assignment.targets.length,
      targetOrgs: assignment.targets.map((t: any) => ({ id: t.teamOrg.id, name: t.teamOrg.name })),
      overlappingAssignments: overlapping,
    };
  },

  // 正式发布
  async publish(id: string, effectMode: "immediate" | "next_midnight", scopePath?: string, roleCode?: string, baseOrgId?: string) {
    ensureTeamDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const assignment = await tx.teamTaskAssignment.findUnique({
        where: { id },
        include: { targets: true, template: true },
      });
      if (!assignment) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
      if (baseOrgId && assignment.baseOrgId !== baseOrgId) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
      await resolveBaseOrg(assignment.baseOrgId, scopePath, roleCode);
      await tx.$queryRaw`SELECT id FROM org_units WHERE id = ${assignment.baseOrgId} FOR UPDATE`;
      const current = await tx.teamTaskAssignment.findUniqueOrThrow({ where: { id } });
      if (current.status !== "draft") throw new Error("TEAM_TASK_ASSIGNMENT_NOT_DRAFT");
      if (assignment.targets.length === 0) throw new Error("TEAM_TASK_ASSIGNMENT_TARGETS_REQUIRED");
      if ((assignment as any).template.status === "archived") throw new Error("TEAM_TASK_TEMPLATE_ARCHIVED");
      if (!await tx.teamTaskItem.count({ where: { templateId: assignment.templateId } })) throw new Error("TEAM_TASK_TEMPLATE_NO_ITEMS");

      const now = new Date();
      // 使用北京时间计算次日零点（UTC+8），避免服务器时区影响
      const todayBeijing = formatBeijingDate(now);
      const [y, m, d] = todayBeijing.split("-").map(Number);
      const nextMidnight = makeBeijingDate(y, m, d + 1, 0, 0, 0, 0);

      const nextStatus = effectMode === "next_midnight" ? "scheduled" : "active";
      const effectiveAt = effectMode === "next_midnight" ? nextMidnight : now;

      // 无论哪种生效模式，只要同基地存在待生效任务，均拒绝发布
      // （防止出现两个排队等待的任务，避免零点激活时逻辑混乱）
      const existingScheduled = await tx.teamTaskAssignment.findFirst({
        where: { baseOrgId: assignment.baseOrgId, status: "scheduled", id: { not: id } },
        select: { id: true },
      });
      if (existingScheduled) throw new Error("TEAM_TASK_ASSIGNMENT_SCHEDULED_EXISTS");

      // 结束同基地下其他生效中的团队管理日常任务
      // - 立即生效：旧任务立即结束
      // - 次日零点生效：旧任务继续保持 active，由零点定时器负责在激活新任务时一并结束，不提前变更状态
      if (effectMode !== "next_midnight") {
        await tx.teamTaskAssignment.updateMany({
          where: {
            baseOrgId: assignment.baseOrgId,
            status: "active",
            id: { not: id },
          },
          data: { status: "ended", endedAt: now },
        });
      }

      const published = await tx.teamTaskAssignment.update({
        where: { id },
        data: {
          status: nextStatus,
          effectMode,
          effectiveAt,
          publishedAt: now,
        },
        include: {
          template: { select: { id: true, title: true } },
          targets: { include: { teamOrg: { select: { id: true, name: true } } } },
        },
      });
      // Publish and create executable records atomically; do not wait for the scheduler.
      if (nextStatus === "active") {
        const items = await tx.teamTaskItem.findMany({ where: { templateId: assignment.templateId }, select: { id: true } });
        for (const target of assignment.targets) {
          await tx.$queryRaw`SELECT id FROM org_units WHERE id = ${target.teamOrgId} FOR UPDATE`;
          const team = await tx.orgUnit.findFirst({ where: { id: target.teamOrgId, status: "active", orgType: "TEAM", parentId: assignment.baseOrgId } });
          if (!team) throw new Error("TEAM_DAILY_HALL_NOT_IN_TEAM");
          await tx.teamTaskRecord.create({ data: {
            assignmentId: id, teamOrgId: target.teamOrgId, recordDate: todayBeijing, totalItems: items.length,
            itemRecords: { create: items.map(item => ({ taskItemId: item.id })) },
          } });
        }
      }
      return published;
    }, { isolationLevel: "ReadCommitted" });
  },

  async close(id: string, scopePath?: string, roleCode?: string, baseOrgId?: string) {
    ensureTeamDailyRole(roleCode);
    const assignment = await prisma.teamTaskAssignment.findUnique({ where: { id } });
    if (!assignment) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
    if (baseOrgId && assignment.baseOrgId !== baseOrgId) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
    await resolveBaseOrg(assignment.baseOrgId, scopePath, roleCode);
    if (!["active", "scheduled"].includes(assignment.status)) throw new Error("TEAM_TASK_ASSIGNMENT_CANNOT_CLOSE");

    return prisma.teamTaskAssignment.update({
      where: { id },
      data: { status: "ended", endedAt: new Date() },
      include: {
        template: { select: { id: true, title: true } },
        targets: { include: { teamOrg: { select: { id: true, name: true } } } },
      },
    });
  },

  async delete(id: string, scopePath?: string, roleCode?: string, baseOrgId?: string) {
    ensureTeamDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const assignment = await tx.teamTaskAssignment.findUnique({ where: { id } });
      if (!assignment) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
      if (baseOrgId && assignment.baseOrgId !== baseOrgId) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_FOUND");
      await resolveBaseOrg(assignment.baseOrgId, scopePath, roleCode);
      // draft 可直接删除；scheduled（待生效）可取消——退回草稿后删除；active/ended 不允许删除
      if (!["draft", "scheduled"].includes(assignment.status)) throw new Error("TEAM_TASK_ASSIGNMENT_NOT_DRAFT");

      await tx.teamTaskAssignmentTarget.deleteMany({ where: { assignmentId: id } });
      await tx.teamTaskAssignment.delete({ where: { id } });
      return { deleted: true, id };
    });
  },
};

// ─── 定时激活器 ───────────────────────────────────────────────────────────────
// 每分钟由 server.ts 调用，将到期的 scheduled 团队管理日常任务激活为 active，
// 并同步结束同基地内还在 active 的旧任务。

export async function activateTeamDailyScheduled() {
  const now = new Date();

  // 查找所有 effectiveAt <= now 且状态仍为 scheduled 的团队管理员任务
  const dueAssignments = await prisma.teamTaskAssignment.findMany({
    where: {
      status: "scheduled",
      effectiveAt: { lte: now },
    },
    select: { id: true, baseOrgId: true },
  });

  if (dueAssignments.length === 0) return { activated: 0 };

  let activated = 0;
  for (const assignment of dueAssignments) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM org_units WHERE id = ${assignment.baseOrgId} FOR UPDATE`;
      // 再次确认状态（防并发）
      const current = await tx.teamTaskAssignment.findUnique({
        where: { id: assignment.id },
        select: { status: true, effectiveAt: true },
      });
      if (!current || current.status !== "scheduled") return;

      // 结束同基地内其他生效中的旧任务
      await tx.teamTaskAssignment.updateMany({
        where: {
          baseOrgId: assignment.baseOrgId,
          status: "active",
          id: { not: assignment.id },
        },
        data: { status: "ended", endedAt: now },
      });

      // 激活本任务
      await tx.teamTaskAssignment.update({
        where: { id: assignment.id },
        data: { status: "active" },
      });
    });
    activated++;
  }

  return { activated };
}

// ─── 每日 Record 创建器 ────────────────────────────────────────────────────────
// 每分钟由 server.ts 调用。
// 逻辑：对所有当前生效中（active）的团队管理日常任务，为其目标团队列表中的每个 HALL 组织，
// 在当日北京日期下创建一条 TeamTaskRecord（若已存在则跳过，保证幂等）。
// 每条 record 同时预建对应的 TeamTaskItemRecord（每个题目一条，status=pending）。

export async function ensureTeamDailyRecordsForToday() {
  const now = new Date();
  const today = formatBeijingDate(now);

  // 找到所有生效中的团队管理员任务（含目标团队和模板题目）
  const activeAssignments = await prisma.teamTaskAssignment.findMany({
    where: { status: "active" },
    include: {
      targets: { select: { teamOrgId: true } },
      template: {
        include: {
          items: {
            select: { id: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });

  if (activeAssignments.length === 0) return { created: 0 };

  let created = 0;

  for (const assignment of activeAssignments) {
    const totalItems = assignment.template.items.length;

    for (const target of assignment.targets) {
      // 同一个团队同一天只允许一份“有效任务”记录。
      // 旧 assignment 已结束但仍保留历史记录时，不能阻挡当天新 active assignment 接管；
      // 否则新任务会因旧记录存在而永远无法生成执行记录。
      const existing = await prisma.teamTaskRecord.findFirst({
        where: { teamOrgId: target.teamOrgId, recordDate: today, assignment: { status: "active" } },
        select: { id: true },
      });
      if (existing) continue;

      // 跳过已暂停的团队（组织被暂停则不应生成当日 record）
      const hallActive = await prisma.orgUnit.findFirst({
        where: { id: target.teamOrgId, status: "active" },
        select: { id: true },
      });
      if (!hallActive) continue;

      // 创建 record，并同时预建所有题目的 itemRecord
      await prisma.$transaction(async (tx) => {
        // 锁定团队行并双重检查，多个后端实例并发执行时也不会跨 assignment 重复建单。
        await tx.$queryRaw`SELECT id FROM org_units WHERE id = ${target.teamOrgId} FOR UPDATE`;
        if (!await tx.teamTaskAssignment.findFirst({ where: { id: assignment.id, status: "active" } })) return;
        const check = await tx.teamTaskRecord.findFirst({
          where: { teamOrgId: target.teamOrgId, recordDate: today, assignment: { status: "active" } },
          select: { id: true },
        });
        if (check) return;

        const record = await tx.teamTaskRecord.create({
          data: {
            assignmentId: assignment.id,
            teamOrgId: target.teamOrgId,
            recordDate: today,
            status: "pending",
            totalItems,
            doneItems: 0,
          },
        });

        if (assignment.template.items.length > 0) {
          await tx.teamTaskItemRecord.createMany({
            data: assignment.template.items.map((item) => ({
              taskRecordId: record.id,
              taskItemId: item.id,
              status: "pending" as const,
            })),
          });
        }
      });

      created++;
    }
  }

  return { created };
}

// ─── 请假服务 ────────────────────────────────────────────────────────────────

async function ensureHallManagerOwnsRecord(recordId: string, userId: string) {
  const record = await prisma.teamTaskRecord.findUnique({
    where: { id: recordId },
    include: { teamOrg: { select: { id: true, name: true, path: true } } },
  });
  if (!record) throw new Error("TEAM_TASK_RECORD_NOT_FOUND");
  const allowed = await prisma.userIdentity.findFirst({
    where: { userId, roleCode: "TEAM_ADMIN", status: "active", orgId: record.teamOrgId },
    include: { user: { select: { nickname: true, phone: true } } },
  });
  if (!allowed) throw new Error("TEAM_TASK_RECORD_NOT_FOUND");
  return { record, identity: allowed };
}

function canReviewHallPath(reviewerIdentity: any, hallPath?: string | null) {
  const roleCode = reviewerIdentity?.roleCode;
  if (!roleCode || !["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"].includes(roleCode)) return false;
  if (roleCode === "DEV_ADMIN") return true;
  const scopePath = reviewerIdentity?.scopePath;
  if (!scopePath || !hallPath) return false;
  return hallPath === scopePath || hallPath.startsWith(`${scopePath}/`);
}

export const TeamDailyLeaveService = {
  async batch(data: { recordIds: string[]; taskDate: string; action: "approve" | "cancel"; reason: string; operatorUserId: string; identity: any }) {
    ensureTeamDailyRole(data.identity?.roleCode);
    if (data.taskDate !== formatBeijingDate(new Date())) throw new Error("TEAM_TASK_LEAVE_TODAY_ONLY");
    const reason = data.reason.trim();
    if (!reason || reason.length > 1000) throw new Error("TEAM_TASK_LEAVE_REASON_INVALID");
    const ids = [...new Set(data.recordIds)];
    if (!ids.length || ids.length > 100) throw new Error("TEAM_TASK_LEAVE_BATCH_INVALID");
    const records = await prisma.teamTaskRecord.findMany({ where: { id: { in: ids } }, include: { teamOrg: true } });
    // Reject the entire request before any writes if any selected record is unauthorized.
    if (records.length !== ids.length || records.some((r) => r.recordDate !== data.taskDate || r.teamOrg.status !== "active" || !canReviewHallPath(data.identity, r.teamOrg.path))) {
      throw new Error("TEAM_TASK_LEAVE_REVIEW_FORBIDDEN");
    }
    if (new Set(records.map((r) => r.teamOrgId)).size !== records.length) throw new Error("TEAM_TASK_LEAVE_BATCH_INVALID");
    const results: Array<{ recordId: string; hallName: string; status: string }> = [];
    for (const selected of records) {
      try {
        const status = await withTeamRecordLock(selected.id, async (tx) => {
          if (data.taskDate !== formatBeijingDate(new Date())) throw new Error("TEAM_TASK_LEAVE_TODAY_ONLY");
          const record = await tx.teamTaskRecord.findUniqueOrThrow({ where: { id: selected.id }, include: { teamOrg: true, leaveRequests: true } });
          if (!canReviewHallPath(data.identity, record.teamOrg.path) || record.teamOrg.status !== "active") throw new Error("TEAM_TASK_LEAVE_REVIEW_FORBIDDEN");
          const candidates = await tx.teamTaskRecord.findMany({ where: { teamOrgId: record.teamOrgId, recordDate: data.taskDate, assignment: { status: { in: ["active", "ended"] } } }, include: { assignment: { select: { status: true } } }, orderBy: { createdAt: "desc" } });
          const preferred = candidates.find((r) => r.assignment.status === "active") ?? candidates[0];
          if (preferred?.id !== record.id) return "stale_record";
          const active = record.leaveRequests.filter((l) => l.status === "approved" || l.status === "pending");
          const audit = `[管理批量${data.action === "approve" ? "批准" : "取消"} ${new Date().toISOString()} 操作人:${data.operatorUserId}] ${reason}`;
          if (data.action === "cancel") {
            if (!active.length) return "not_enabled";
            for (const leave of active) await tx.teamTaskLeaveRequest.update({ where: { id: leave.id }, data: { status: "cancelled", reviewComment: [leave.reviewComment, audit].filter(Boolean).join("\n") } });
            return "cancelled";
          }
          if (record.status === "submitted") return "completed";
          if (active.some((l) => l.status === "approved")) return "already_approved";
          const pending = active.find((l) => l.status === "pending");
          if (pending) {
            await tx.teamTaskLeaveRequest.update({ where: { id: pending.id }, data: { status: "approved", reviewedBy: data.operatorUserId, reviewedAt: new Date(), reviewComment: [pending.reviewComment, audit].filter(Boolean).join("\n") } });
          } else {
            await tx.teamTaskLeaveRequest.create({ data: { taskRecordId: record.id, applicantUserId: data.operatorUserId, applicantName: "管理直接批准", reason, status: "approved", reviewedBy: data.operatorUserId, reviewedAt: new Date(), reviewComment: audit } });
          }
          return "approved";
        });
        results.push({ recordId: selected.id, hallName: selected.teamOrg.name, status });
      } catch (error) {
        console.error("[hall-leave-batch]", { recordId: selected.id, operatorUserId: data.operatorUserId, action: data.action, error });
        results.push({ recordId: selected.id, hallName: selected.teamOrg.name, status: "failed" });
      }
    }
    return { results };
  },
  async apply(data: { recordId: string; userId: string; reason: string }) {
    const reason = data.reason.trim();
    if (!reason) throw new Error("TEAM_TASK_LEAVE_REASON_REQUIRED");
    const { record, identity } = await ensureHallManagerOwnsRecord(data.recordId, data.userId);
    return withTeamRecordLock(record.id, async (prisma) => {
    const current = await prisma.teamTaskRecord.findUniqueOrThrow({ where: { id: record.id } });
    if (current.status === "submitted") throw new Error("TEAM_TASK_LEAVE_NOT_ALLOWED");
    if (await prisma.teamTaskLeaveRequest.findFirst({ where: { taskRecordId: record.id, status: "approved" } })) throw new Error("TEAM_TASK_LEAVE_NOT_ALLOWED");
    if (record.status === "submitted") throw new Error("TEAM_TASK_LEAVE_NOT_ALLOWED");
    const now = new Date();
    if (isDailyRecordCollectionClosed(record.recordDate, now)) throw new Error("TEAM_TASK_SUPPLEMENT_DEADLINE_PASSED");

    const existingPending = await prisma.teamTaskLeaveRequest.findFirst({
      where: { taskRecordId: record.id, status: "pending" },
      select: { id: true },
    });
    if (existingPending) throw new Error("TEAM_TASK_LEAVE_PENDING_EXISTS");

    return prisma.teamTaskLeaveRequest.create({
      data: {
        taskRecordId: record.id,
        applicantUserId: data.userId,
        applicantName: identity.user?.nickname || identity.user?.phone || null,
        reason,
      },
    });
    });
  },

  async cancel(leaveRequestId: string, userId: string) {
    const leave = await prisma.teamTaskLeaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { taskRecord: true },
    });
    if (!leave || leave.applicantUserId !== userId) throw new Error("TEAM_TASK_LEAVE_REQUEST_NOT_FOUND");
    return withTeamRecordLock(leave.taskRecordId, async (prisma) => {
    const current = await prisma.teamTaskLeaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId } });
    if (current.status !== "pending") throw new Error("TEAM_TASK_LEAVE_NOT_PENDING");
    if (leave.status !== "pending") throw new Error("TEAM_TASK_LEAVE_NOT_PENDING");
    if (isDailyRecordCollectionClosed(leave.taskRecord.recordDate, new Date())) throw new Error("TEAM_TASK_SUPPLEMENT_DEADLINE_PASSED");
    return prisma.teamTaskLeaveRequest.update({
      where: { id: leaveRequestId },
      data: { status: "cancelled" },
    });
    });
  },

  async review(data: {
    leaveRequestId: string;
    reviewerUserId: string;
    reviewerIdentity: any;
    action: "approved" | "rejected";
    comment?: string;
  }) {
    if (data.action === "rejected" && !data.comment?.trim()) throw new Error("TEAM_TASK_LEAVE_COMMENT_REQUIRED");
    const leave = await prisma.teamTaskLeaveRequest.findUnique({
      where: { id: data.leaveRequestId },
      include: { taskRecord: { include: { teamOrg: { select: { path: true } } } } },
    });
    if (!leave) throw new Error("TEAM_TASK_LEAVE_REQUEST_NOT_FOUND");
    return withTeamRecordLock(leave.taskRecordId, async (prisma) => {
    const current = await prisma.teamTaskLeaveRequest.findUniqueOrThrow({ where: { id: data.leaveRequestId }, include: { taskRecord: true } });
    if (current.status !== "pending") throw new Error("TEAM_TASK_LEAVE_NOT_PENDING");
    if (data.action === "approved" && current.taskRecord.status === "submitted") throw new Error("TEAM_TASK_LEAVE_NOT_ALLOWED");
    if (leave.status !== "pending") throw new Error("TEAM_TASK_LEAVE_NOT_PENDING");
    if (!canReviewHallPath(data.reviewerIdentity, leave.taskRecord.teamOrg?.path)) {
      throw new Error("TEAM_TASK_LEAVE_REVIEW_FORBIDDEN");
    }
    return prisma.teamTaskLeaveRequest.update({
      where: { id: data.leaveRequestId },
      data: {
        status: data.action,
        reviewedBy: data.reviewerUserId,
        reviewedAt: new Date(),
        reviewComment: data.comment?.trim() || null,
      },
    });
    });
  },
};

// ─── 执行层服务（团队管理员填报） ────────────────────────────────────────────────────

export const TeamDailyRecordService = {

  /**
   * 获取该账号下所有活跃团队管理员身份对应的团队今日及昨日可补录的 TeamTaskRecord
   */
  async getMyRecords(userId: string, teamOrgId?: string) {
    const { today, yesterday, canSupplementYesterday } = getDailyTaskContext();

    const datesToQuery = [today];
    if (canSupplementYesterday) datesToQuery.push(yesterday);

    // 枚举该账号下所有活跃 TEAM_ADMIN 身份的 orgId（与主播日常任务融通逻辑保持一致）
    const hallManagerIdentities = await prisma.userIdentity.findMany({
      where: { userId, roleCode: "TEAM_ADMIN", status: "active", ...(teamOrgId ? { orgId: teamOrgId } : {}), org: { status: "active" } },
      select: { orgId: true },
    });
    const teamOrgIds = hallManagerIdentities.map((i) => i.orgId).filter(Boolean) as string[];
    if (!teamOrgIds.length) return [];

    const records = await prisma.teamTaskRecord.findMany({
      where: {
        teamOrgId: { in: teamOrgIds },
        recordDate: { in: datesToQuery },
        OR: [{ recordDate: today, assignment: { status: "active" } }, { recordDate: yesterday, assignment: { status: { in: ["active", "ended"] } } }],
      },
      include: {
        teamOrg: { select: { id: true, name: true } },
        assignment: {
          include: {
            template: {
              include: {
                items: {
                  include: { options: { orderBy: { sortOrder: "asc" } } },
                  orderBy: { sortOrder: "asc" },
                },
              },
            },
          },
        },
        itemRecords: {
          include: { attachments: true },
        },
        leaveRequests: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
    });

    // 同步更新 overdue 状态
    const now = new Date();
    const updated: typeof records = [];
    const seen = new Set<string>();
    for (const record of records) {
      const key = record.teamOrgId + record.recordDate;
      if (seen.has(key)) continue;
      seen.add(key);
      if (record.status !== "submitted" && isDailyRecordOverdue(record.recordDate, now)) {
        // Report overdue dynamically; a read must not overwrite a concurrent submission.
        updated.push({ ...record, status: "overdue" as any });
      } else {
        updated.push(record);
      }
    }
    return updated;
  },

  /**
   * 单题作答：保存或更新一条 TeamTaskItemRecord
   */
  async submitItemRecord(data: {
    taskRecordId: string;
    taskItemId: string;
    userId: string;
    answerText?: string;
    answerOptions?: string[];
    isLinkConfirmed?: boolean;
    done: boolean;
  }) {
    return withTeamRecordLock(data.taskRecordId, async (prisma) => {
    const record = await prisma.teamTaskRecord.findUnique({
      where: { id: data.taskRecordId },
      select: { id: true, teamOrgId: true, status: true, recordDate: true, totalItems: true },
    });
    if (!record) throw new Error("TEAM_TASK_RECORD_NOT_FOUND");

    // 校验：该 record 所属的团队必须是该账号某个活跃团队管理员身份的团队
    const allowed = await prisma.userIdentity.findFirst({
      where: { userId: data.userId, roleCode: "TEAM_ADMIN", status: "active", orgId: record.teamOrgId },
    });
    if (!allowed) throw new Error("TEAM_TASK_RECORD_NOT_FOUND");
    if (record.status === "submitted") throw new Error("TEAM_TASK_RECORD_ALREADY_SUBMITTED");
    const approvedLeave = await prisma.teamTaskLeaveRequest.findFirst({ where: { taskRecordId: record.id, status: "approved" }, select: { id: true } });
    if (approvedLeave) throw new Error("TEAM_TASK_LEAVE_NOT_ALLOWED");

    const now = new Date();
    if (isDailyRecordOverdue(record.recordDate, now)) {
      if (isDailyRecordCollectionClosed(record.recordDate, now)) {
        throw new Error("TEAM_TASK_SUPPLEMENT_DEADLINE_PASSED");
      }
    }

    const item = await prisma.teamTaskItem.findFirst({ where: { id: data.taskItemId, template: { assignments: { some: { id: (await prisma.teamTaskRecord.findUniqueOrThrow({ where: { id: record.id } })).assignmentId } } } } });
    if (!item) throw new Error("TEAM_TASK_RECORD_NOT_FOUND");
    if (data.done && item.itemType === "QA" && !data.answerText?.trim()) throw new Error("TEAM_TASK_RECORD_INCOMPLETE");
    if (data.done && item.itemType === "LINK" && !data.isLinkConfirmed) throw new Error("TEAM_TASK_RECORD_INCOMPLETE");
    if (data.done && item.itemType === "ATTACHMENT" && !await prisma.teamTaskItemAttachment.findFirst({where:{teamTaskItemRecord:{taskRecordId:record.id,taskItemId:item.id}}})) throw new Error("TEAM_TASK_RECORD_INCOMPLETE");
    if (data.done && ["SINGLE_CHOICE","MULTI_CHOICE"].includes(item.itemType)) {
      const options = await prisma.teamTaskItemOption.findMany({where:{taskItemId:item.id}});
      if (!data.answerOptions?.length || (item.itemType === "SINGLE_CHOICE" && data.answerOptions.length !== 1) || data.answerOptions.some(value=>!options.some(o=>o.label===value || o.id===value))) throw new Error("TEAM_TASK_RECORD_INCOMPLETE");
    }
    const status = data.done ? "done" : "pending";
    const doneAt = data.done ? now : null;

    const itemRecord = await prisma.teamTaskItemRecord.upsert({
      where: { taskRecordId_taskItemId: { taskRecordId: data.taskRecordId, taskItemId: data.taskItemId } },
      create: {
        taskRecordId: data.taskRecordId,
        taskItemId: data.taskItemId,
        status,
        answerText: data.answerText,
        answerOptions: data.answerOptions ? (data.answerOptions as any) : undefined,
        isLinkConfirmed: data.isLinkConfirmed ?? false,
        doneAt,
        doneBy: data.done ? data.userId : null,
      },
      update: {
        status,
        answerText: data.answerText !== undefined ? data.answerText : undefined,
        answerOptions: data.answerOptions !== undefined ? (data.answerOptions as any) : undefined,
        isLinkConfirmed: data.isLinkConfirmed !== undefined ? data.isLinkConfirmed : undefined,
        doneAt,
        doneBy: data.done ? data.userId : null,
      },
    });

    const doneCount = await prisma.teamTaskItemRecord.count({
      where: { taskRecordId: data.taskRecordId, status: "done" },
    });
    const newRecordStatus = isDailyRecordOverdue(record.recordDate, now)
        ? "overdue"
        : doneCount > 0
          ? "in_progress"
          : "pending";
    await prisma.teamTaskRecord.update({
      where: { id: data.taskRecordId },
      data: {
        doneItems: doneCount,
        status: newRecordStatus as any,
      },
    });

    return itemRecord;
    });
  },

  /**
   * 整条 Record 提交
   */
  async submitRecord(recordId: string, userId: string) {
    return withTeamRecordLock(recordId, async (prisma) => {
    const record = await prisma.teamTaskRecord.findUnique({
      where: { id: recordId },
      include: {
        assignment: { include: { template: { include: { items: { select: { id: true, isRequired: true } } } } } },
        itemRecords: { select: { taskItemId: true, status: true } },
      },
    });
    if (!record) throw new Error("TEAM_TASK_RECORD_NOT_FOUND");

    // 校验：该 record 所属的团队必须是该账号某个活跃团队管理员身份的团队
    const allowed = await prisma.userIdentity.findFirst({
      where: { userId, roleCode: "TEAM_ADMIN", status: "active", orgId: record.teamOrgId },
    });
    if (!allowed) throw new Error("TEAM_TASK_RECORD_NOT_FOUND");
    if (record.status === "submitted") throw new Error("TEAM_TASK_RECORD_ALREADY_SUBMITTED");
    const approvedLeave = await prisma.teamTaskLeaveRequest.findFirst({ where: { taskRecordId: record.id, status: "approved" }, select: { id: true } });
    if (approvedLeave) throw new Error("TEAM_TASK_LEAVE_NOT_ALLOWED");

    const now = new Date();
    if (isDailyRecordOverdue(record.recordDate, now)) {
      if (isDailyRecordCollectionClosed(record.recordDate, now)) {
        throw new Error("TEAM_TASK_SUPPLEMENT_DEADLINE_PASSED");
      }
    }

    const items = record.assignment?.template?.items ?? [];
    const requiredItems = items.filter((item: any) => item.isRequired);
    const doneItemIds = new Set(
      record.itemRecords.filter((ir: any) => ir.status === "done").map((ir: any) => ir.taskItemId)
    );
    const incomplete = requiredItems.filter((item: any) => !doneItemIds.has(item.id));
    if (incomplete.length > 0) throw new Error("TEAM_TASK_RECORD_INCOMPLETE");

    return prisma.teamTaskRecord.update({
      where: { id: recordId },
      data: { status: "submitted", submittedAt: now, submittedBy: userId },
    });
    });
  },
};
