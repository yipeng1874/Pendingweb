import { prisma } from "../../../shared/prisma.js";

const DAILY_ALLOWED_ROLE_CODES = new Set(["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"]);

function isPathWithinScope(scopePath?: string, targetPath?: string | null) {
  if (!targetPath) return false;
  if (!scopePath) return true;
  // 向下：targetPath 在 scope 内部（scope 是祖先）
  // 向上：targetPath 是 scope 的祖先（允许 TEAM_ADMIN 操作上级 BASE 的模板）
  return (
    targetPath === scopePath ||
    targetPath.startsWith(`${scopePath}/`) ||
    scopePath.startsWith(`${targetPath}/`)
  );
}

async function resolveTemplateOrg(tx: any, orgId: string, scopePath?: string, roleCode?: string) {
  const org = await tx.orgUnit.findFirst({
    where: { id: orgId, status: "active" },
    select: { id: true, path: true, orgType: true },
  });
  if (!org) throw new Error("TEMPLATE_ORG_NOT_FOUND");
  if (roleCode !== "DEV_ADMIN" && !isPathWithinScope(scopePath, org.path)) {
    throw new Error("TEMPLATE_FORBIDDEN");
  }
  return org;
}

function ensureScopeOrgMatch(targetOrgId: string, scopeOrgId?: string) {
  if (scopeOrgId && targetOrgId !== scopeOrgId) throw new Error("TEMPLATE_SCOPE_MISMATCH");
}

function ensureDailyBaseOrg(org: { orgType: string }) {
  if (org.orgType !== "BASE") throw new Error("DAILY_TEMPLATE_BASE_REQUIRED");
}

function ensureDailyTemplateRole(roleCode?: string) {
  if (!roleCode || !DAILY_ALLOWED_ROLE_CODES.has(roleCode)) throw new Error("DAILY_TEMPLATE_ROLE_FORBIDDEN");
}

function ensureDailyTemplateScope(scopeOrgId?: string) {
  if (!scopeOrgId) throw new Error("DAILY_TEMPLATE_SCOPE_REQUIRED");
}

const ABSOLUTE_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const RELATIVE_LINK_RE = /^(\/|\.\/|\.\.\/|#|\?)/;
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:"]);

function normalizeTemplateLinkUrl(linkUrl?: string | null) {
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

function normalizeTemplateItems(
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
    const normalizedLinkUrl = item.itemType === "LINK" ? normalizeTemplateLinkUrl(item.linkUrl) : null;
    if (item.itemType === "LINK") {
      if (!item.linkUrl?.trim()) throw new Error("TEMPLATE_LINK_URL_REQUIRED");
      if (!normalizedLinkUrl) throw new Error("TEMPLATE_LINK_URL_INVALID");
    }

    return {
      sortOrder: item.sortOrder ?? index,
      itemType: item.itemType,
      title: typeof item.title === "string" ? item.title.trim() : "",
      isRequired: item.isRequired ?? true,
      linkUrl: normalizedLinkUrl,
      options: item.options?.map((option, optionIndex) => ({
        sortOrder: option.sortOrder ?? optionIndex,
        label: option.label,
      })) ?? [],
    };
  });
}

async function ensureTemplateAccessible(tx: any, id: string, scopePath?: string, roleCode?: string, include?: any, scopeOrgId?: string) {

  const template = await tx.taskTemplate.findUnique({
    where: { id },
    ...(include ? { include } : {}),
  });
  if (!template) throw new Error("TEMPLATE_NOT_FOUND");
  await resolveTemplateOrg(tx, template.orgId, scopePath, roleCode);
  ensureScopeOrgMatch(template.orgId, scopeOrgId);
  return template;
}

export const TemplateService = {
  async list(orgId?: string, category?: string, status?: string, scopePath?: string, roleCode?: string, scopeOrgId?: string, limit?: number, offset?: number) {
    const where: any = {};
    if (category) where.category = category;
    if (status) where.status = status;

    if (orgId && scopeOrgId && orgId !== scopeOrgId) {
      throw new Error("TEMPLATE_SCOPE_MISMATCH");
    }

    if (category === "DAILY") {
      ensureDailyTemplateRole(roleCode);
      ensureDailyTemplateScope(scopeOrgId);
    }

    const effectiveOrgId = scopeOrgId || orgId;
    if (effectiveOrgId) {
      const org = await resolveTemplateOrg(prisma, effectiveOrgId, scopePath, roleCode);
      if (category === "DAILY") ensureDailyBaseOrg(org);
      where.orgId = effectiveOrgId;
    } else if (scopePath && roleCode !== "DEV_ADMIN") {
      const orgs = await prisma.orgUnit.findMany({
        where: { path: { startsWith: scopePath } },
        select: { id: true },
      });
      where.orgId = { in: orgs.map((org) => org.id) };
    }

    return prisma.taskTemplate.findMany({
      where,
      include: {
        items: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
        _count: { select: { assignments: true } },
      },
      orderBy: { createdAt: "desc" },
      ...(offset && offset > 0 ? { skip: offset } : {}),
      ...(limit && limit > 0 ? { take: limit } : {}),
    });
  },

  async getById(id: string, scopePath?: string, roleCode?: string, scopeOrgId?: string) {
    const template = await ensureTemplateAccessible(prisma, id, scopePath, roleCode, {
      items: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
    }, scopeOrgId);
    return template;
  },

  async create(data: {
    title: string;
    description?: string;
    category: "DAILY" | "TEMPORARY";
    orgId: string;
    createdBy: string;
    scopePath?: string;
    roleCode?: string;
    scopeOrgId?: string;
    items: Array<{
      sortOrder: number;
      itemType: string;
      title: string;
      isRequired?: boolean;
      linkUrl?: string;
      options?: Array<{ sortOrder: number; label: string }>;
    }>;
  }) {
    if (data.category === "DAILY") {
      ensureDailyTemplateRole(data.roleCode);
      ensureDailyTemplateScope(data.scopeOrgId);
    }
    const org = await resolveTemplateOrg(prisma, data.orgId, data.scopePath, data.roleCode);
    ensureScopeOrgMatch(data.orgId, data.scopeOrgId);
    if (data.category === "DAILY") ensureDailyBaseOrg(org);

    const normalizedItems = normalizeTemplateItems(data.items);

    return prisma.taskTemplate.create({
      data: {
        title: data.title,
        description: data.description,
        category: data.category,
        orgId: data.orgId,
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
              ? { create: item.options.map((option) => ({ sortOrder: option.sortOrder, label: option.label })) }
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
        id?: string;
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
    scopeOrgId?: string
  ) {
    return prisma.$transaction(async (tx) => {
      await ensureTemplateAccessible(tx, id, scopePath, roleCode, {
        items: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
      }, scopeOrgId);

      const protectedAssignmentCount = await tx.taskAssignment.count({
        where: {
          templateId: id,
          OR: [{ status: { not: "draft" } }, { records: { some: {} } }],
        },
      });
      if (protectedAssignmentCount > 0) throw new Error("TEMPLATE_IN_USE");

      if (data.items !== undefined) {
        const normalizedItems = normalizeTemplateItems(data.items);
        const oldItems = await tx.taskItem.findMany({ where: { templateId: id }, select: { id: true } });
        for (const item of oldItems) {
          await tx.taskItemOption.deleteMany({ where: { taskItemId: item.id } });
        }
        await tx.taskItem.deleteMany({ where: { templateId: id } });
        for (const item of normalizedItems) {
          const created = await tx.taskItem.create({
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
            await tx.taskItemOption.createMany({
              data: item.options.map((option) => ({ taskItemId: created.id, sortOrder: option.sortOrder, label: option.label })),
            });
          }
        }
      }


      return tx.taskTemplate.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
        },
        include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
      });
    });
  },

  async remove(id: string, scopePath?: string, roleCode?: string, scopeOrgId?: string) {
    return prisma.$transaction(async (tx) => {
      const template = await ensureTemplateAccessible(tx, id, scopePath, roleCode, {
        items: { select: { id: true } },
        assignments: {
          select: {
            id: true,
            status: true,
            _count: { select: { records: true } },
          },
        },
      }, scopeOrgId);

      const blockedAssignment = template.assignments.find((assignment: any) => assignment.status !== "draft" || assignment._count.records > 0);
      if (blockedAssignment) throw new Error("TEMPLATE_HAS_ASSIGNMENTS");

      const draftAssignmentIds = template.assignments.map((assignment: any) => assignment.id);
      if (draftAssignmentIds.length > 0) {
        await tx.taskAssignmentExclusion.deleteMany({ where: { assignmentId: { in: draftAssignmentIds } } });
        await tx.taskAssignmentTarget.deleteMany({ where: { assignmentId: { in: draftAssignmentIds } } });
        await tx.taskAssignment.deleteMany({ where: { id: { in: draftAssignmentIds } } });
      }

      const itemIds = template.items.map((item: any) => item.id);
      if (itemIds.length > 0) {
        await tx.taskItemOption.deleteMany({ where: { taskItemId: { in: itemIds } } });
      }
      await tx.taskTemplateSnapshot.deleteMany({ where: { templateId: id } });
      await tx.taskItem.deleteMany({ where: { templateId: id } });
      await tx.taskTemplate.delete({ where: { id } });

      return { deleted: true, id };
    });
  },

  async copy(id: string, operatorUserId: string, scopePath?: string, roleCode?: string, scopeOrgId?: string) {
    const source = await ensureTemplateAccessible(prisma, id, scopePath, roleCode, {
      items: { include: { options: true }, orderBy: { sortOrder: "asc" } },
    }, scopeOrgId);
    if (source.category === "DAILY") {
      ensureDailyTemplateRole(roleCode);
      ensureDailyTemplateScope(scopeOrgId);
      ensureScopeOrgMatch(source.orgId, scopeOrgId);
    }

    const normalizedItems = normalizeTemplateItems(
      source.items.map((item: any) => ({
        sortOrder: item.sortOrder,
        itemType: item.itemType,
        title: item.title,
        isRequired: item.isRequired,
        linkUrl: item.linkUrl,
        options: item.options?.map((option: any) => ({ sortOrder: option.sortOrder, label: option.label })) ?? [],
      }))
    );

    return prisma.taskTemplate.create({
      data: {
        title: source.title + "（副本）",
        description: source.description,
        category: source.category,
        orgId: source.orgId,
        createdBy: operatorUserId,
        version: 1,
        status: "draft",
        items: {
          create: normalizedItems.map((item: any) => ({
            sortOrder: item.sortOrder,
            itemType: item.itemType,
            title: item.title,
            isRequired: item.isRequired,
            linkUrl: item.linkUrl,
            options: item.options?.length
              ? { create: item.options.map((option: any) => ({ sortOrder: option.sortOrder, label: option.label })) }
              : undefined,
          })),
        },
      },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });

  },
};
