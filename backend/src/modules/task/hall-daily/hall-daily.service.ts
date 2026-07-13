import { prisma } from "../../../shared/prisma.js";
import {
  formatBeijingDate,
  makeBeijingDate,
  getDailyTaskContext,
  isDailyRecordOverdue,
  isDailyRecordCollectionClosed,
} from "../record/daily-record-time.utils.js";

// ─── 权限常量 ─────────────────────────────────────────────────────────────────
// 允许维护厅管日常任务的角色（团队自治：TEAM_ADMIN 为核心，上级可选定团队后操作）
const HALL_DAILY_ALLOWED_ROLE_CODES = new Set([
  "DEV_ADMIN",
  "HQ_ADMIN",
  "BASE_ADMIN",
  "TEAM_ADMIN",
]);

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function ensureHallDailyRole(roleCode?: string) {
  if (!roleCode || !HALL_DAILY_ALLOWED_ROLE_CODES.has(roleCode)) {
    throw new Error("HALL_DAILY_ROLE_FORBIDDEN");
  }
}

function ensureTeamScopeSelected(scopeOrgId?: string) {
  if (!scopeOrgId) throw new Error("HALL_DAILY_TEAM_SCOPE_REQUIRED");
}

function isPathWithinScope(scopePath?: string, targetPath?: string | null) {
  if (!targetPath) return false;
  if (!scopePath) return true;
  return (
    targetPath === scopePath ||
    targetPath.startsWith(`${scopePath}/`) ||
    scopePath.startsWith(`${targetPath}/`)
  );
}

async function resolveTeamOrg(teamOrgId: string, scopePath?: string, roleCode?: string) {
  const org = await prisma.orgUnit.findFirst({
    where: { id: teamOrgId, status: "active" },
    select: { id: true, path: true, orgType: true, name: true },
  });
  if (!org) throw new Error("HALL_DAILY_TEAM_ORG_NOT_FOUND");
  if (org.orgType !== "TEAM") throw new Error("HALL_DAILY_TEAM_ORG_REQUIRED");
  if (roleCode !== "DEV_ADMIN" && !isPathWithinScope(scopePath, org.path)) {
    throw new Error("HALL_DAILY_FORBIDDEN");
  }
  return org;
}

const ABSOLUTE_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const RELATIVE_LINK_RE = /^(\/|\.\/|\.\.\/|#|\?)/;
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:"]);

function normalizeHallTaskLinkUrl(linkUrl?: string | null) {
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

function normalizeHallTaskItems(
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
    const normalizedLinkUrl = item.itemType === "LINK" ? normalizeHallTaskLinkUrl(item.linkUrl) : null;
    if (item.itemType === "LINK") {
      if (!item.linkUrl?.trim()) throw new Error("HALL_TASK_LINK_URL_REQUIRED");
      if (!normalizedLinkUrl) throw new Error("HALL_TASK_LINK_URL_INVALID");
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

export const HallDailyTemplateService = {
  async list(params: {
    teamOrgId?: string;
    status?: string;
    neverPublished?: boolean;
    scopePath?: string;
    roleCode?: string;
    limit?: number;
    offset?: number;
  }) {
    const { teamOrgId, status, neverPublished, scopePath, roleCode, limit, offset } = params;
    ensureHallDailyRole(roleCode);
    ensureTeamScopeSelected(teamOrgId);

    // 验证团队组织权限
    await resolveTeamOrg(teamOrgId!, scopePath, roleCode);

    const where: any = { teamOrgId };
    if (status) where.status = status;

    // neverPublished=true：只返回从未被发布过的纯净草稿
    // 即：没有任何 assignment 状态为 scheduled / active / ended 的模板
    if (neverPublished) {
      where.assignments = {
        none: { status: { in: ["scheduled", "active", "ended"] } },
      };
    }

    return prisma.hallTaskTemplate.findMany({
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

  async getById(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const template = await prisma.hallTaskTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    if (teamOrgId && template.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    await resolveTeamOrg(template.teamOrgId, scopePath, roleCode);
    return template;
  },

  async create(data: {
    title: string;
    description?: string;
    teamOrgId: string;
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
    ensureHallDailyRole(data.roleCode);
    ensureTeamScopeSelected(data.teamOrgId);
    await resolveTeamOrg(data.teamOrgId, data.scopePath, data.roleCode);

    const normalizedItems = normalizeHallTaskItems(data.items);

    return prisma.hallTaskTemplate.create({
      data: {
        title: data.title,
        description: data.description,
        teamOrgId: data.teamOrgId,
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
    teamOrgId?: string
  ) {
    ensureHallDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const template = await tx.hallTaskTemplate.findUnique({ where: { id } });
      if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      if (teamOrgId && template.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      await resolveTeamOrg(template.teamOrgId, scopePath, roleCode);

      // 有生效/已发布任务时禁止修改
      const blockedCount = await tx.hallTaskAssignment.count({
        where: { templateId: id, status: { in: ["active", "scheduled"] } },
      });
      if (blockedCount > 0) throw new Error("HALL_TASK_TEMPLATE_IN_USE");

      if (data.items !== undefined) {
        const normalizedItems = normalizeHallTaskItems(data.items);
        const oldItems = await tx.hallTaskItem.findMany({ where: { templateId: id }, select: { id: true } });
        for (const item of oldItems) {
          await tx.hallTaskItemOption.deleteMany({ where: { taskItemId: item.id } });
        }
        await tx.hallTaskItem.deleteMany({ where: { templateId: id } });
        for (const item of normalizedItems) {
          const created = await tx.hallTaskItem.create({
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
            await tx.hallTaskItemOption.createMany({
              data: item.options.map((opt) => ({ taskItemId: created.id, sortOrder: opt.sortOrder, label: opt.label })),
            });
          }
        }
      }

      return tx.hallTaskTemplate.update({
        where: { id },
        data: { title: data.title, description: data.description },
        include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
      });
    });
  },

  async remove(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const template = await tx.hallTaskTemplate.findUnique({
        where: { id },
        include: { items: { select: { id: true } }, assignments: { select: { id: true, status: true } } },
      });
      if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      if (teamOrgId && template.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      await resolveTeamOrg(template.teamOrgId, scopePath, roleCode);

      const hasBlocker = template.assignments.some((a: any) => ["active", "scheduled", "ended"].includes(a.status));
      if (hasBlocker) throw new Error("HALL_TASK_TEMPLATE_HAS_ASSIGNMENTS");

      // 只清理 draft 状态的 assignment（active/scheduled/ended 已在上方拦截）
      const cleanableIds = template.assignments.filter((a: any) => a.status === "draft").map((a: any) => a.id);
      if (cleanableIds.length > 0) {
        await tx.hallTaskAssignmentTarget.deleteMany({ where: { assignmentId: { in: cleanableIds } } });
        await tx.hallTaskAssignment.deleteMany({ where: { id: { in: cleanableIds } } });
      }
      const itemIds = template.items.map((i: any) => i.id);
      if (itemIds.length > 0) {
        await tx.hallTaskItemOption.deleteMany({ where: { taskItemId: { in: itemIds } } });
      }
      await tx.hallTaskItem.deleteMany({ where: { templateId: id } });
      await tx.hallTaskTemplate.delete({ where: { id } });

      return { deleted: true, id };
    });
  },

  async copy(id: string, operatorUserId: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const source = await prisma.hallTaskTemplate.findUnique({
      where: { id },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!source) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    if (teamOrgId && source.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    await resolveTeamOrg(source.teamOrgId, scopePath, roleCode);

    const normalizedItems = normalizeHallTaskItems(
      source.items.map((item: any) => ({
        sortOrder: item.sortOrder,
        itemType: item.itemType,
        title: item.title,
        isRequired: item.isRequired,
        linkUrl: item.linkUrl,
        options: item.options?.map((opt: any) => ({ sortOrder: opt.sortOrder, label: opt.label })) ?? [],
      }))
    );

    return prisma.hallTaskTemplate.create({
      data: {
        title: source.title + "（副本）",
        description: source.description,
        teamOrgId: source.teamOrgId,
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

  async archive(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const template = await prisma.hallTaskTemplate.findUnique({ where: { id } });
    if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    if (teamOrgId && template.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    await resolveTeamOrg(template.teamOrgId, scopePath, roleCode);

    return prisma.hallTaskTemplate.update({
      where: { id },
      data: { status: "archived" },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
  },
};

// ─── 发布服务 ─────────────────────────────────────────────────────────────────

export const HallDailyAssignmentService = {
  async list(params: {
    teamOrgId?: string;
    status?: string;
    scopePath?: string;
    roleCode?: string;
    limit?: number;
    offset?: number;
  }) {
    const { teamOrgId, status, scopePath, roleCode, limit, offset } = params;
    ensureHallDailyRole(roleCode);
    ensureTeamScopeSelected(teamOrgId);
    await resolveTeamOrg(teamOrgId!, scopePath, roleCode);

    const where: any = { teamOrgId };
    if (status) where.status = status;

    return prisma.hallTaskAssignment.findMany({
      where,
      include: {
        template: { select: { id: true, title: true, status: true } },
        targets: { include: { hallOrg: { select: { id: true, name: true } } } },
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
    teamOrgId: string;
    hallOrgIds: string[];
    effectMode?: "immediate" | "next_midnight";
    createdBy: string;
    scopePath?: string;
    roleCode?: string;
  }) {
    ensureHallDailyRole(data.roleCode);
    ensureTeamScopeSelected(data.teamOrgId);
    await resolveTeamOrg(data.teamOrgId, data.scopePath, data.roleCode);

    const template = await prisma.hallTaskTemplate.findUnique({ where: { id: data.templateId } });
    if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    if (template.teamOrgId !== data.teamOrgId) throw new Error("HALL_TASK_TEMPLATE_TEAM_MISMATCH");
    if (template.status === "archived") throw new Error("HALL_TASK_TEMPLATE_ARCHIVED");

    // 验证目标厅都属于该团队
    if (data.hallOrgIds.length > 0) {
      const halls = await prisma.orgUnit.findMany({
        where: { id: { in: data.hallOrgIds }, orgType: "HALL", status: "active" },
        select: { id: true, path: true },
      });
      const teamOrg = await prisma.orgUnit.findUnique({ where: { id: data.teamOrgId }, select: { path: true } });
      const invalidHalls = halls.filter((h) => !h.path.startsWith(`${teamOrg!.path}/`));
      if (invalidHalls.length > 0) throw new Error("HALL_DAILY_HALL_NOT_IN_TEAM");
    }

    return prisma.$transaction(async (tx) => {
      let assignmentId = data.assignmentId;
      if (assignmentId) {
        const existing = await tx.hallTaskAssignment.findUnique({ where: { id: assignmentId } });
        if (!existing) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
        if (existing.teamOrgId !== data.teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
        if (existing.status !== "draft") throw new Error("HALL_TASK_ASSIGNMENT_NOT_DRAFT");
        await tx.hallTaskAssignment.update({
          where: { id: assignmentId },
          data: { templateId: data.templateId, effectMode: data.effectMode ?? "immediate" },
        });
      } else {
        const created = await tx.hallTaskAssignment.create({
          data: {
            templateId: data.templateId,
            teamOrgId: data.teamOrgId,
            status: "draft",
            effectMode: data.effectMode ?? "immediate",
            createdBy: data.createdBy,
            createdByOrgId: data.teamOrgId,
          },
        });
        assignmentId = created.id;
      }

      // 覆盖目标厅
      await tx.hallTaskAssignmentTarget.deleteMany({ where: { assignmentId } });
      if (data.hallOrgIds.length > 0) {
        await tx.hallTaskAssignmentTarget.createMany({
          data: data.hallOrgIds.map((hallOrgId) => ({ assignmentId: assignmentId!, hallOrgId })),
        });
      }

      return tx.hallTaskAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          template: { select: { id: true, title: true, status: true } },
          targets: { include: { hallOrg: { select: { id: true, name: true } } } },
        },
      });
    });
  },

  // 发布预览
  async getPublishPreview(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const assignment = await prisma.hallTaskAssignment.findUnique({
      where: { id },
      include: {
        template: { select: { id: true, title: true } },
        targets: { include: { hallOrg: { select: { id: true, name: true } } } },
      },
    });
    if (!assignment) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
    if (teamOrgId && assignment.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
    await resolveTeamOrg(assignment.teamOrgId, scopePath, roleCode);
    if (assignment.status !== "draft") throw new Error("HALL_TASK_ASSIGNMENT_NOT_DRAFT");

    // 检查目标厅是否已有生效任务
    const activeAssignments = await prisma.hallTaskAssignment.findMany({
      where: {
        teamOrgId: assignment.teamOrgId,
        status: { in: ["active", "scheduled"] },
        id: { not: id },
      },
      include: {
        template: { select: { title: true } },
        targets: { select: { hallOrgId: true } },
      },
    });

    const targetHallIds = new Set(assignment.targets.map((t: any) => t.hallOrgId));
    const overlapping = activeAssignments
      .filter((a: any) => a.targets.some((t: any) => targetHallIds.has(t.hallOrgId)))
      .map((a: any) => ({ id: a.id, title: a.template.title, status: a.status }));

    return {
      assignmentId: assignment.id,
      templateId: assignment.templateId,
      templateTitle: (assignment as any).template.title,
      effectMode: assignment.effectMode,
      targetOrgCount: assignment.targets.length,
      targetOrgs: assignment.targets.map((t: any) => ({ id: t.hallOrg.id, name: t.hallOrg.name })),
      overlappingAssignments: overlapping,
    };
  },

  // 正式发布
  async publish(id: string, effectMode: "immediate" | "next_midnight", scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const assignment = await tx.hallTaskAssignment.findUnique({
        where: { id },
        include: { targets: true, template: true },
      });
      if (!assignment) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
      if (teamOrgId && assignment.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
      await resolveTeamOrg(assignment.teamOrgId, scopePath, roleCode);
      if (assignment.status !== "draft") throw new Error("HALL_TASK_ASSIGNMENT_NOT_DRAFT");
      if (assignment.targets.length === 0) throw new Error("HALL_TASK_ASSIGNMENT_TARGETS_REQUIRED");
      if ((assignment as any).template.status === "archived") throw new Error("HALL_TASK_TEMPLATE_ARCHIVED");

      const now = new Date();
      // 使用北京时间计算次日零点（UTC+8），避免服务器时区影响
      const todayBeijing = formatBeijingDate(now);
      const [y, m, d] = todayBeijing.split("-").map(Number);
      const nextMidnight = makeBeijingDate(y, m, d + 1, 0, 0, 0, 0);

      const nextStatus = effectMode === "next_midnight" ? "scheduled" : "active";
      const effectiveAt = effectMode === "next_midnight" ? nextMidnight : now;

      // 无论哪种生效模式，只要同团队存在待生效任务，均拒绝发布
      // （防止出现两个排队等待的任务，避免零点激活时逻辑混乱）
      const existingScheduled = await tx.hallTaskAssignment.findFirst({
        where: { teamOrgId: assignment.teamOrgId, status: "scheduled", id: { not: id } },
        select: { id: true },
      });
      if (existingScheduled) throw new Error("HALL_TASK_ASSIGNMENT_SCHEDULED_EXISTS");

      // 结束同团队下其他生效中的厅管日常任务
      // - 立即生效：旧任务立即结束
      // - 次日零点生效：旧任务继续保持 active，由零点定时器负责在激活新任务时一并结束，不提前变更状态
      if (effectMode !== "next_midnight") {
        await tx.hallTaskAssignment.updateMany({
          where: {
            teamOrgId: assignment.teamOrgId,
            status: "active",
            id: { not: id },
          },
          data: { status: "ended", endedAt: now },
        });
      }

      return tx.hallTaskAssignment.update({
        where: { id },
        data: {
          status: nextStatus,
          effectMode,
          effectiveAt,
          publishedAt: now,
        },
        include: {
          template: { select: { id: true, title: true } },
          targets: { include: { hallOrg: { select: { id: true, name: true } } } },
        },
      });
    });
  },

  async close(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const assignment = await prisma.hallTaskAssignment.findUnique({ where: { id } });
    if (!assignment) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
    if (teamOrgId && assignment.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
    await resolveTeamOrg(assignment.teamOrgId, scopePath, roleCode);
    if (!["active", "scheduled"].includes(assignment.status)) throw new Error("HALL_TASK_ASSIGNMENT_CANNOT_CLOSE");

    return prisma.hallTaskAssignment.update({
      where: { id },
      data: { status: "ended", endedAt: new Date() },
      include: {
        template: { select: { id: true, title: true } },
        targets: { include: { hallOrg: { select: { id: true, name: true } } } },
      },
    });
  },

  async delete(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const assignment = await tx.hallTaskAssignment.findUnique({ where: { id } });
      if (!assignment) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
      if (teamOrgId && assignment.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
      await resolveTeamOrg(assignment.teamOrgId, scopePath, roleCode);
      // draft 可直接删除；scheduled（待生效）可取消——退回草稿后删除；active/ended 不允许删除
      if (!["draft", "scheduled"].includes(assignment.status)) throw new Error("HALL_TASK_ASSIGNMENT_NOT_DRAFT");

      await tx.hallTaskAssignmentTarget.deleteMany({ where: { assignmentId: id } });
      await tx.hallTaskAssignment.delete({ where: { id } });
      return { deleted: true, id };
    });
  },
};

// ─── 定时激活器 ───────────────────────────────────────────────────────────────
// 每分钟由 server.ts 调用，将到期的 scheduled 厅管日常任务激活为 active，
// 并同步结束同团队内还在 active 的旧任务。

export async function activateHallDailyScheduled() {
  const now = new Date();

  // 查找所有 effectiveAt <= now 且状态仍为 scheduled 的厅管任务
  const dueAssignments = await prisma.hallTaskAssignment.findMany({
    where: {
      status: "scheduled",
      effectiveAt: { lte: now },
    },
    select: { id: true, teamOrgId: true },
  });

  if (dueAssignments.length === 0) return { activated: 0 };

  let activated = 0;
  for (const assignment of dueAssignments) {
    await prisma.$transaction(async (tx) => {
      // 再次确认状态（防并发）
      const current = await tx.hallTaskAssignment.findUnique({
        where: { id: assignment.id },
        select: { status: true, effectiveAt: true },
      });
      if (!current || current.status !== "scheduled") return;

      // 结束同团队内其他生效中的旧任务
      await tx.hallTaskAssignment.updateMany({
        where: {
          teamOrgId: assignment.teamOrgId,
          status: "active",
          id: { not: assignment.id },
        },
        data: { status: "ended", endedAt: now },
      });

      // 激活本任务
      await tx.hallTaskAssignment.update({
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
// 逻辑：对所有当前生效中（active）的厅管日常任务，为其目标厅列表中的每个 HALL 组织，
// 在当日北京日期下创建一条 HallTaskRecord（若已存在则跳过，保证幂等）。
// 每条 record 同时预建对应的 HallTaskItemRecord（每个题目一条，status=pending）。

export async function ensureHallDailyRecordsForToday() {
  const now = new Date();
  const today = formatBeijingDate(now);

  // 找到所有生效中的厅管任务（含目标厅和模板题目）
  const activeAssignments = await prisma.hallTaskAssignment.findMany({
    where: { status: "active" },
    include: {
      targets: { select: { hallOrgId: true } },
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
      // 检查是否已存在当日 record（幂等）
      const existing = await prisma.hallTaskRecord.findUnique({
        where: {
          assignmentId_hallOrgId_recordDate: {
            assignmentId: assignment.id,
            hallOrgId: target.hallOrgId,
            recordDate: today,
          },
        },
        select: { id: true },
      });
      if (existing) continue;

      // 跳过已暂停的厅（组织被暂停则不应生成当日 record）
      const hallActive = await prisma.orgUnit.findFirst({
        where: { id: target.hallOrgId, status: "active" },
        select: { id: true },
      });
      if (!hallActive) continue;

      // 创建 record，并同时预建所有题目的 itemRecord
      await prisma.$transaction(async (tx) => {
        // 双重检查（防并发）
        const check = await tx.hallTaskRecord.findUnique({
          where: {
            assignmentId_hallOrgId_recordDate: {
              assignmentId: assignment.id,
              hallOrgId: target.hallOrgId,
              recordDate: today,
            },
          },
          select: { id: true },
        });
        if (check) return;

        const record = await tx.hallTaskRecord.create({
          data: {
            assignmentId: assignment.id,
            hallOrgId: target.hallOrgId,
            recordDate: today,
            status: "pending",
            totalItems,
            doneItems: 0,
          },
        });

        if (assignment.template.items.length > 0) {
          await tx.hallTaskItemRecord.createMany({
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
  const record = await prisma.hallTaskRecord.findUnique({
    where: { id: recordId },
    include: { hallOrg: { select: { id: true, name: true, path: true } } },
  });
  if (!record) throw new Error("HALL_TASK_RECORD_NOT_FOUND");
  const allowed = await prisma.userIdentity.findFirst({
    where: { userId, roleCode: "HALL_MANAGER", status: "active", orgId: record.hallOrgId },
    include: { user: { select: { nickname: true, phone: true } } },
  });
  if (!allowed) throw new Error("HALL_TASK_RECORD_NOT_FOUND");
  return { record, identity: allowed };
}

function canReviewHallPath(reviewerIdentity: any, hallPath?: string | null) {
  const roleCode = reviewerIdentity?.roleCode;
  if (!roleCode || !["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(roleCode)) return false;
  if (roleCode === "DEV_ADMIN") return true;
  const scopePath = reviewerIdentity?.scopePath;
  if (!scopePath || !hallPath) return false;
  return hallPath === scopePath || hallPath.startsWith(`${scopePath}/`);
}

export const HallDailyLeaveService = {
  async apply(data: { recordId: string; userId: string; reason: string }) {
    const reason = data.reason.trim();
    if (!reason) throw new Error("HALL_TASK_LEAVE_REASON_REQUIRED");
    const { record, identity } = await ensureHallManagerOwnsRecord(data.recordId, data.userId);
    if (record.status === "submitted") throw new Error("HALL_TASK_LEAVE_NOT_ALLOWED");
    const now = new Date();
    if (isDailyRecordCollectionClosed(record.recordDate, now)) throw new Error("HALL_TASK_SUPPLEMENT_DEADLINE_PASSED");

    const existingPending = await prisma.hallTaskLeaveRequest.findFirst({
      where: { taskRecordId: record.id, status: "pending" },
      select: { id: true },
    });
    if (existingPending) throw new Error("HALL_TASK_LEAVE_PENDING_EXISTS");

    return prisma.hallTaskLeaveRequest.create({
      data: {
        taskRecordId: record.id,
        applicantUserId: data.userId,
        applicantName: identity.user?.nickname || identity.user?.phone || null,
        reason,
      },
    });
  },

  async cancel(leaveRequestId: string, userId: string) {
    const leave = await prisma.hallTaskLeaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { taskRecord: true },
    });
    if (!leave || leave.applicantUserId !== userId) throw new Error("HALL_TASK_LEAVE_REQUEST_NOT_FOUND");
    if (leave.status !== "pending") throw new Error("HALL_TASK_LEAVE_NOT_PENDING");
    if (isDailyRecordCollectionClosed(leave.taskRecord.recordDate, new Date())) throw new Error("HALL_TASK_SUPPLEMENT_DEADLINE_PASSED");
    return prisma.hallTaskLeaveRequest.update({
      where: { id: leaveRequestId },
      data: { status: "cancelled" },
    });
  },

  async review(data: {
    leaveRequestId: string;
    reviewerUserId: string;
    reviewerIdentity: any;
    action: "approved" | "rejected";
    comment?: string;
  }) {
    if (data.action === "rejected" && !data.comment?.trim()) throw new Error("HALL_TASK_LEAVE_COMMENT_REQUIRED");
    const leave = await prisma.hallTaskLeaveRequest.findUnique({
      where: { id: data.leaveRequestId },
      include: { taskRecord: { include: { hallOrg: { select: { path: true } } } } },
    });
    if (!leave) throw new Error("HALL_TASK_LEAVE_REQUEST_NOT_FOUND");
    if (leave.status !== "pending") throw new Error("HALL_TASK_LEAVE_NOT_PENDING");
    if (!canReviewHallPath(data.reviewerIdentity, leave.taskRecord.hallOrg?.path)) {
      throw new Error("HALL_TASK_LEAVE_REVIEW_FORBIDDEN");
    }
    return prisma.hallTaskLeaveRequest.update({
      where: { id: data.leaveRequestId },
      data: {
        status: data.action,
        reviewedBy: data.reviewerUserId,
        reviewedAt: new Date(),
        reviewComment: data.comment?.trim() || null,
      },
    });
  },
};

// ─── 执行层服务（厅管填报） ────────────────────────────────────────────────────

export const HallDailyRecordService = {

  /**
   * 获取该账号下所有活跃厅管身份对应的厅今日及昨日可补录的 HallTaskRecord
   */
  async getMyRecords(userId: string) {
    const { today, yesterday, canSupplementYesterday } = getDailyTaskContext();

    const datesToQuery = [today];
    if (canSupplementYesterday) datesToQuery.push(yesterday);

    // 枚举该账号下所有活跃 HALL_MANAGER 身份的 orgId（与主播日常任务融通逻辑保持一致）
    const hallManagerIdentities = await prisma.userIdentity.findMany({
      where: { userId, roleCode: "HALL_MANAGER", status: "active" },
      select: { orgId: true },
    });
    const hallOrgIds = hallManagerIdentities.map((i) => i.orgId).filter(Boolean) as string[];
    if (!hallOrgIds.length) return [];

    const records = await prisma.hallTaskRecord.findMany({
      where: {
        hallOrgId: { in: hallOrgIds },
        recordDate: { in: datesToQuery },
        assignment: { status: "active" },
      },
      include: {
        hallOrg: { select: { id: true, name: true } },
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
      orderBy: { recordDate: "desc" },
    });

    // 同步更新 overdue 状态
    const now = new Date();
    const updated: typeof records = [];
    for (const record of records) {
      if (record.status !== "submitted" && isDailyRecordOverdue(record.recordDate, now)) {
        await prisma.hallTaskRecord.update({
          where: { id: record.id },
          data: { status: "overdue" },
        });
        updated.push({ ...record, status: "overdue" as any });
      } else {
        updated.push(record);
      }
    }
    return updated;
  },

  /**
   * 单题作答：保存或更新一条 HallTaskItemRecord
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
    const record = await prisma.hallTaskRecord.findUnique({
      where: { id: data.taskRecordId },
      select: { id: true, hallOrgId: true, status: true, recordDate: true, totalItems: true },
    });
    if (!record) throw new Error("HALL_TASK_RECORD_NOT_FOUND");

    // 校验：该 record 所属的厅必须是该账号某个活跃厅管身份的厅
    const allowed = await prisma.userIdentity.findFirst({
      where: { userId: data.userId, roleCode: "HALL_MANAGER", status: "active", orgId: record.hallOrgId },
    });
    if (!allowed) throw new Error("HALL_TASK_RECORD_NOT_FOUND");
    if (record.status === "submitted") throw new Error("HALL_TASK_RECORD_ALREADY_SUBMITTED");
    const approvedLeave = await prisma.hallTaskLeaveRequest.findFirst({ where: { taskRecordId: record.id, status: "approved" }, select: { id: true } });
    if (approvedLeave) throw new Error("HALL_TASK_LEAVE_NOT_ALLOWED");

    const now = new Date();
    if (isDailyRecordOverdue(record.recordDate, now)) {
      if (isDailyRecordCollectionClosed(record.recordDate, now)) {
        throw new Error("HALL_TASK_SUPPLEMENT_DEADLINE_PASSED");
      }
    }

    const status = data.done ? "done" : "pending";
    const doneAt = data.done ? now : null;

    const itemRecord = await prisma.hallTaskItemRecord.upsert({
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

    const doneCount = await prisma.hallTaskItemRecord.count({
      where: { taskRecordId: data.taskRecordId, status: "done" },
    });
    const allDone = record.totalItems > 0 && doneCount >= record.totalItems;
    const newRecordStatus = allDone
      ? "submitted"
      : isDailyRecordOverdue(record.recordDate, now)
        ? "overdue"
        : doneCount > 0
          ? "in_progress"
          : "pending";
    await prisma.hallTaskRecord.update({
      where: { id: data.taskRecordId },
      data: {
        doneItems: doneCount,
        status: newRecordStatus as any,
        ...(allDone ? { submittedAt: now } : {}),
      },
    });

    return itemRecord;
  },

  /**
   * 整条 Record 提交
   */
  async submitRecord(recordId: string, userId: string) {
    const record = await prisma.hallTaskRecord.findUnique({
      where: { id: recordId },
      include: {
        assignment: { include: { template: { include: { items: { select: { id: true, isRequired: true } } } } } },
        itemRecords: { select: { taskItemId: true, status: true } },
      },
    });
    if (!record) throw new Error("HALL_TASK_RECORD_NOT_FOUND");

    // 校验：该 record 所属的厅必须是该账号某个活跃厅管身份的厅
    const allowed = await prisma.userIdentity.findFirst({
      where: { userId, roleCode: "HALL_MANAGER", status: "active", orgId: record.hallOrgId },
    });
    if (!allowed) throw new Error("HALL_TASK_RECORD_NOT_FOUND");
    if (record.status === "submitted") throw new Error("HALL_TASK_RECORD_ALREADY_SUBMITTED");
    const approvedLeave = await prisma.hallTaskLeaveRequest.findFirst({ where: { taskRecordId: record.id, status: "approved" }, select: { id: true } });
    if (approvedLeave) throw new Error("HALL_TASK_LEAVE_NOT_ALLOWED");

    const now = new Date();
    if (isDailyRecordOverdue(record.recordDate, now)) {
      if (isDailyRecordCollectionClosed(record.recordDate, now)) {
        throw new Error("HALL_TASK_SUPPLEMENT_DEADLINE_PASSED");
      }
    }

    const items = record.assignment?.template?.items ?? [];
    const requiredItems = items.filter((item: any) => item.isRequired);
    const doneItemIds = new Set(
      record.itemRecords.filter((ir: any) => ir.status === "done").map((ir: any) => ir.taskItemId)
    );
    const incomplete = requiredItems.filter((item: any) => !doneItemIds.has(item.id));
    if (incomplete.length > 0) throw new Error("HALL_TASK_RECORD_INCOMPLETE");

    return prisma.hallTaskRecord.update({
      where: { id: recordId },
      data: { status: "submitted", submittedAt: now, submittedBy: userId },
    });
  },
};
