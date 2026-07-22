import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { isVirtualHall } from "./utils.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function normalizePagination(page?: number, pageSize?: number) {
  const normalizedPage = Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : DEFAULT_PAGE;
  const normalizedPageSize = Number.isFinite(pageSize) && (pageSize as number) > 0
    ? Math.min(Math.floor(pageSize as number), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { page: normalizedPage, pageSize: normalizedPageSize, skip: (normalizedPage - 1) * normalizedPageSize };
}

function buildAnchorConflictMessage(conflict: { phone?: string | null; douyinNo?: string | null; douyinUid?: string | null }) {
  const fields = [
    conflict.phone ? `手机号 ${conflict.phone}` : null,
    conflict.douyinNo ? `抖音号 ${conflict.douyinNo}` : null,
    conflict.douyinUid ? `抖音UID ${conflict.douyinUid}` : null,
  ].filter(Boolean);
  return fields.length ? `${fields.join("、")} 已存在，禁止重复注册或审核通过` : "账号信息已存在，禁止重复注册或审核通过";
}

function toTrimmedNullable(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function createAnchorBusinessError(code: string, message: string) {
  const error = new Error(message);
  (error as any).code = code;
  return error;
}

function buildMigrationSuffix(now = new Date()) {
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const milliseconds = String(now.getMilliseconds()).padStart(3, "0");
  return `back-${year}${month}${day}-${hours}${minutes}${seconds}${milliseconds}`;
}

function appendMigrationSuffix(value: string | null | undefined, suffix: string) {
  const normalized = String(value ?? "").trim();
  return normalized ? `${normalized}${suffix}` : normalized;
}

function isHistoricalMigratedProfile(profile?: { nickname?: string | null; status?: string | null }) {
  return Boolean(profile && profile.status === "inactive" && /back-\d{6,8}(?:-\d{9})?$/i.test(String(profile.nickname ?? "").trim()));
}

function buildProfileViewFilter(viewMode?: string): Prisma.AnchorProfileWhereInput {
  if (viewMode === "history") {
    return {
      AND: [
        { status: "inactive" },
        { nickname: { contains: "back-" } },
      ],
    };
  }

  return {
    NOT: {
      AND: [
        { status: "inactive" },
        { nickname: { contains: "back-" } },
      ],
    },
  };
}

function isAnchorUniqueConstraintError(error: unknown, field?: "douyinNo" | "douyinUid") {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const targets = Array.isArray(error.meta?.target)
    ? error.meta.target.map((item) => String(item))
    : error.meta?.target
      ? [String(error.meta.target)]
      : [];
  if (!field) return true;
  const keywords = field === "douyinNo"
    ? ["douyin_no", "douyinNo", "anchor_profiles_douyin_no", "anchor_profiles_douyin_no_key"]
    : ["douyin_uid", "douyinUid", "anchor_profiles_douyin_uid", "anchor_profiles_douyin_uid_key"];
  return targets.some((target) => keywords.some((keyword) => target.includes(keyword)));
}

async function assertNoAnchorRegistrationConflict(input: {
  phone?: string | null;
  douyinNo?: string | null;
  douyinUid?: string | null;
  excludeUserId?: string;
  excludeApplicationId?: string;
  excludeApplicationUserId?: string;
  excludeProfileId?: string;
}) {
  const phone = input.phone?.trim();
  const douyinNo = input.douyinNo?.trim();
  const douyinUid = input.douyinUid?.trim();

  if (phone) {
    const existingUser = await prisma.user.findFirst({
      where: {
        phone,
        ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
      },
      select: { id: true, phone: true },
    });
    if (existingUser) {
      const error = new Error(buildAnchorConflictMessage({ phone }));
      (error as any).code = "PHONE_EXISTS";
      throw error;
    }
  }

  if (douyinNo || douyinUid) {
    const existingProfile = await prisma.anchorProfile.findFirst({
      where: {
        OR: [
          ...(douyinNo ? [{ douyinNo }] : []),
          ...(douyinUid ? [{ douyinUid }] : []),
        ],
        ...(input.excludeProfileId ? { id: { not: input.excludeProfileId } } : {}),
      },
      select: { id: true, douyinNo: true, douyinUid: true },
    });
    if (existingProfile) {
      const error = new Error(buildAnchorConflictMessage({
        ...(existingProfile.douyinNo === douyinNo ? { douyinNo } : {}),
        ...(existingProfile.douyinUid === douyinUid ? { douyinUid } : {}),
      }));
      (error as any).code = existingProfile.douyinUid === douyinUid ? "DOUYIN_UID_EXISTS" : "DOUYIN_NO_EXISTS";
      throw error;
    }

    const existingApplication = await prisma.anchorRegistrationApplication.findFirst({
      where: {
        status: { in: ["pending", "approved"] },
        OR: [
          ...(douyinNo ? [{ douyinNo }] : []),
          ...(douyinUid ? [{ douyinUid }] : []),
        ],
        ...(input.excludeApplicationId ? { id: { not: input.excludeApplicationId } } : {}),
        ...(input.excludeApplicationUserId ? { userId: { not: input.excludeApplicationUserId } } : {}),
      },
      select: { id: true, douyinNo: true, douyinUid: true },
    });
    if (existingApplication) {
      const error = new Error(buildAnchorConflictMessage({
        ...(existingApplication.douyinNo === douyinNo ? { douyinNo } : {}),
        ...(existingApplication.douyinUid === douyinUid ? { douyinUid } : {}),
      }));
      (error as any).code = existingApplication.douyinUid === douyinUid ? "DOUYIN_UID_EXISTS" : "DOUYIN_NO_EXISTS";
      throw error;
    }
  }
}

async function syncAnchorProfileSnapshots(tx: Prisma.TransactionClient, input: { profileId: string; boundUserId?: string | null; nickname?: string | null; douyinNo?: string | null; douyinUid?: string | null }) {
  const identities = await tx.userIdentity.findMany({
    where: { anchorProfileId: input.profileId, roleCode: "ANCHOR" },
    select: { id: true, userId: true },
  });
  const userIds = Array.from(new Set([input.boundUserId, ...identities.map((item) => item.userId)].filter(Boolean) as string[]));
  if (!userIds.length && !input.douyinNo && !input.douyinUid && !input.nickname) return;

  const taskRecordWhere: Prisma.TaskRecordWhereInput = {
    OR: [
      ...(userIds.length ? [{ subjectUserId: { in: userIds } }, { userId: { in: userIds } }] : []),
      ...(input.douyinUid ? [{ subjectKey: input.douyinUid }] : []),
    ],
  };

  await tx.taskRecord.updateMany({
    where: taskRecordWhere,
    data: {
      ...(input.nickname ? { subjectName: input.nickname } : {}),
    },
  });
}

export const AnchorService = {
  async getRegisterOrgs(parentId: string, orgType: string, includeVirtual: boolean) {
    const where: Prisma.OrgUnitWhereInput = {
      status: "active",
      ...(orgType ? { orgType: orgType as "BASE" | "TEAM" | "HALL" } : { orgType: { in: ["BASE", "TEAM", "HALL"] } }),
      ...(parentId ? { parentId } : {}),
    };
    const orgs = await prisma.orgUnit.findMany({
      where,
      select: { id: true, parentId: true, orgType: true, name: true, orgCode: true, douyinNo: true, douyinUid: true, path: true },
      orderBy: [{ depth: "asc" }, { name: "asc" }],
    });
    return orgType === "HALL" && !includeVirtual ? orgs.filter((org) => !isVirtualHall(org)) : orgs;
  },

  async getScopedOrgChildren(input: { parentId?: string; identityOrgId?: string; scopePath?: string; roleCode?: string; includeVirtual?: boolean }) {
    const scopePath = input.scopePath?.trim();
    const includeVirtual = Boolean(input.includeVirtual);
    const isAdmin = input.roleCode === "DEV_ADMIN" || input.roleCode === "HQ_ADMIN";

    let parent = null as null | { id: string; orgType: "HQ" | "BASE" | "TEAM" | "HALL" };
    if (input.parentId) {
      parent = await prisma.orgUnit.findUnique({
        where: { id: input.parentId },
        select: { id: true, path: true, orgType: true, depth: true },
      });
      if (!parent) return [];
    }

    const nextOrgTypes: Record<string, Array<"HQ" | "BASE" | "TEAM" | "HALL">> = {
      ROOT: ["HQ", "BASE"],
      HQ: ["BASE"],
      BASE: ["TEAM"],
      TEAM: ["HALL"],
      HALL: [],
    };

    const allowedTypes: Array<"HQ" | "BASE" | "TEAM" | "HALL"> = parent
      ? nextOrgTypes[parent.orgType] ?? []
      : isAdmin
        ? ["HQ", "BASE"]
        : input.roleCode === "BASE_ADMIN"
          ? ["BASE", "TEAM"]
          : input.roleCode === "TEAM_ADMIN"
            ? ["TEAM", "HALL"]
            : input.roleCode === "HALL_MANAGER"
              ? ["HALL"]
              : ["BASE", "TEAM", "HALL"];
    if (!allowedTypes.length) return [];

    const rootWhere = !parent && input.roleCode === "HALL_MANAGER"
      ? input.identityOrgId
        ? { id: input.identityOrgId }
        : null
      : null;

    // BASE_ADMIN / TEAM_ADMIN 根节点查询：同时返回自身节点（id匹配）和直属下级（parentId匹配）
    const scopedRootWhere: Prisma.OrgUnitWhereInput | null =
      !parent && input.identityOrgId && (input.roleCode === "BASE_ADMIN" || input.roleCode === "TEAM_ADMIN")
        ? { OR: [{ id: input.identityOrgId }, { parentId: input.identityOrgId }] }
        : null;

    const where: Prisma.OrgUnitWhereInput = {
      status: "active",
      orgType: { in: allowedTypes },
      ...(parent
        ? { parentId: parent.id }
        : rootWhere
          ? rootWhere
          : scopedRootWhere
            ? scopedRootWhere
            : input.identityOrgId
              ? { parentId: input.identityOrgId }
              : { depth: { lte: 2 } }),
      ...(!isAdmin && scopePath ? { path: { startsWith: scopePath } } : {}),
    };

    let orgs = await prisma.orgUnit.findMany({
      where,
      select: { id: true, parentId: true, orgType: true, name: true, orgCode: true, douyinNo: true, douyinUid: true, path: true, depth: true, status: true },
      orderBy: [{ depth: "asc" }, { name: "asc" }],
    });

    if (!includeVirtual) {
      orgs = orgs.filter((org) => org.orgType !== "HALL" || !isVirtualHall(org));
    }

    const parentIds = orgs.map((org) => org.id);
    const childCounts = parentIds.length
      ? await prisma.orgUnit.groupBy({ by: ["parentId"], where: { parentId: { in: parentIds }, status: "active" }, _count: { _all: true } })
      : [];
    const childCountMap = new Map(childCounts.map((item) => [item.parentId ?? "", item._count._all]));

    return orgs.map((org) => ({
      ...org,
      hasChildren: (childCountMap.get(org.id) ?? 0) > 0,
      childCount: childCountMap.get(org.id) ?? 0,
    }));
  },

  async getHalls(includeVirtual: boolean) {
    const halls = await prisma.orgUnit.findMany({
      where: { orgType: "HALL", status: "active" },
      select: { id: true, parentId: true, orgType: true, name: true, orgCode: true, douyinNo: true, douyinUid: true },
      orderBy: { name: "asc" },
    });
    return includeVirtual ? halls : halls.filter((hall) => !isVirtualHall(hall));
  },

  async registerAnchor(nickname: string, phone: string, passwordHash: string, targetHallOrgId: string, douyinNo: string, douyinUid: string) {
    const normalizedNickname = nickname.trim();
    const normalizedDouyinNo = toTrimmedNullable(douyinNo);
    const normalizedDouyinUid = toTrimmedNullable(douyinUid);
    const reusableUser = await prisma.user.findFirst({
      where: { phone },
      select: { id: true, status: true },
    });

    if (reusableUser) {
      const [activeIdentityCount, boundProfileCount, blockingApplicationCount, reusableApplication] = await Promise.all([
        prisma.userIdentity.count({ where: { userId: reusableUser.id, status: "active" } }),
        prisma.anchorProfile.count({ where: { boundUserId: reusableUser.id } }),
        prisma.anchorRegistrationApplication.count({
          where: {
            userId: reusableUser.id,
            status: { in: ["pending", "approved"] },
          },
        }),
        prisma.anchorRegistrationApplication.findFirst({
          where: {
            userId: reusableUser.id,
            status: { in: ["rejected", "cancelled"] },
          },
          orderBy: { submittedAt: "desc" },
          select: { id: true },
        }),
      ]);

      const canReuseRejectedAccount = reusableUser.status === "disabled"
        && activeIdentityCount === 0
        && boundProfileCount === 0
        && blockingApplicationCount === 0;

      if (!canReuseRejectedAccount) {
        throw createAnchorBusinessError("PHONE_EXISTS", "手机号已注册，请直接登录或联系上级为该账号开通管理权限");
      }

      await assertNoAnchorRegistrationConflict({
        phone: null,
        douyinNo: normalizedDouyinNo,
        douyinUid: normalizedDouyinUid,
        excludeUserId: reusableUser.id,
      });

      return prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: reusableUser.id },
          data: { nickname: normalizedNickname, passwordHash, status: "disabled", mustChangePassword: false },
        });
        const applicationData = {
          userId: user.id,
          anchorNickname: normalizedNickname,
          targetHallOrgId,
          douyinNo: normalizedDouyinNo,
          douyinUid: normalizedDouyinUid || `pending-${user.id}`,
          status: "pending" as const,
          reviewedBy: null,
          reviewedAt: null,
          submittedAt: new Date(),
        };

        if (reusableApplication) {
          await tx.anchorRegistrationApplication.deleteMany({ where: { userId: user.id, id: { not: reusableApplication.id } } });
          const app = await tx.anchorRegistrationApplication.update({
            where: { id: reusableApplication.id },
            data: applicationData,
          });
          return { user, app };
        }

        await tx.anchorRegistrationApplication.deleteMany({ where: { userId: user.id } });
        const app = await tx.anchorRegistrationApplication.create({ data: applicationData });
        return { user, app };
      });
    }

    await assertNoAnchorRegistrationConflict({ phone, douyinNo: normalizedDouyinNo, douyinUid: normalizedDouyinUid });
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { phone, nickname: normalizedNickname, passwordHash, status: "disabled", mustChangePassword: false } });
      const app = await tx.anchorRegistrationApplication.create({
        data: { userId: user.id, anchorNickname: normalizedNickname, targetHallOrgId, douyinNo: normalizedDouyinNo, douyinUid: normalizedDouyinUid || `pending-${user.id}`, status: "pending" }
      });
      return { user, app };
    });
  },

  async getProfiles(input: { keyword: string; hallOrgId: string; orgId?: string; status: string; scopePath?: string; roleCode?: string; viewMode?: string; page?: number; pageSize?: number }) {
    const normalizedKeyword = input.keyword.trim();
    const selectedOrg = input.orgId
      ? await prisma.orgUnit.findUnique({ where: { id: input.orgId }, select: { id: true, path: true, orgType: true } })
      : null;
    const selectedScopePath = selectedOrg?.path;
    const effectiveScopePath = selectedScopePath || (input.roleCode !== "DEV_ADMIN" ? input.scopePath : undefined);

    // 修复：若选中的是"厅"（叶子节点），直接精确匹配 hallOrgId，
    // 避免 path 前缀模糊匹配把编码相似的兄弟厅的主播也抓出来。
    // 对上级节点（基地/团队）则在路径末尾追加 "/" 确保只匹配真正的子孙，防止前缀冲突。
    let hallFilter: Prisma.AnchorProfileWhereInput = {};
    if (selectedOrg?.orgType === "HALL") {
      hallFilter = { hallOrgId: selectedOrg.id };
    } else if (effectiveScopePath) {
      hallFilter = {
        hallOrg: {
          path: { startsWith: effectiveScopePath.endsWith("/") ? effectiveScopePath : `${effectiveScopePath}/` },
        },
      };
    }
    const where: Prisma.AnchorProfileWhereInput = {
      ...hallFilter,
      ...buildProfileViewFilter(input.viewMode),
      ...(input.hallOrgId ? { hallOrgId: input.hallOrgId } : {}),
      ...(input.status ? { status: input.status as "unbound" | "bound" | "inactive" } : {}),
      ...(normalizedKeyword
        ? {
            OR: [
              { nickname: { contains: normalizedKeyword } },
              { douyinNo: { contains: normalizedKeyword } },
              { douyinUid: { contains: normalizedKeyword } },
              { boundUserId: { not: null }, identities: { some: { user: { phone: { contains: normalizedKeyword } } } } },
              { boundUserId: { not: null }, identities: { some: { user: { nickname: { contains: normalizedKeyword } } } } },
            ],
          }
        : {}),
    };

    const { page, pageSize, skip } = normalizePagination(input.page, input.pageSize);
    const [total, profiles] = await Promise.all([
      prisma.anchorProfile.count({ where }),
      prisma.anchorProfile.findMany({
        where,
        include: {
          hallOrg: true,
          identities: {
            where: { roleCode: "ANCHOR" },
            include: { user: { select: { id: true, phone: true, nickname: true, status: true } } },
            orderBy: { grantedAt: "desc" },
          },
        },
        orderBy: [{ hallOrgId: "asc" }, { createdAt: "desc" }],
        skip,
        take: pageSize,
      }),
    ]);

    return {
      items: profiles.map(({ identities, ...profile }) => ({
        ...profile,
        boundUser: profile.boundUserId
          ? identities.find((identity) => identity.userId === profile.boundUserId)?.user ?? identities.find((identity) => identity.user)?.user ?? null
          : null,
      })),
      total,
      page,
      pageSize,
    };
  },

  async exportProfiles(input: { keyword: string; orgId?: string; status: string; scopePath?: string; roleCode?: string; viewMode?: string }) {
    const MAX_EXPORT = 5000;
    const normalizedKeyword = input.keyword.trim();
    const selectedOrg = input.orgId
      ? await prisma.orgUnit.findUnique({ where: { id: input.orgId }, select: { id: true, path: true, orgType: true } })
      : null;
    const selectedScopePath = selectedOrg?.path;
    const effectiveScopePath = selectedScopePath || (input.roleCode !== "DEV_ADMIN" ? input.scopePath : undefined);

    let hallFilter: Prisma.AnchorProfileWhereInput = {};
    if (selectedOrg?.orgType === "HALL") {
      hallFilter = { hallOrgId: selectedOrg.id };
    } else if (effectiveScopePath) {
      hallFilter = {
        hallOrg: {
          path: { startsWith: effectiveScopePath.endsWith("/") ? effectiveScopePath : `${effectiveScopePath}/` },
        },
      };
    }

    const where: Prisma.AnchorProfileWhereInput = {
      ...hallFilter,
      ...buildProfileViewFilter(input.viewMode),
      ...(input.status ? { status: input.status as "unbound" | "bound" | "inactive" } : {}),
      ...(normalizedKeyword
        ? {
            OR: [
              { nickname: { contains: normalizedKeyword } },
              { douyinNo: { contains: normalizedKeyword } },
              { douyinUid: { contains: normalizedKeyword } },
              { boundUserId: { not: null }, identities: { some: { user: { phone: { contains: normalizedKeyword } } } } },
              { boundUserId: { not: null }, identities: { some: { user: { nickname: { contains: normalizedKeyword } } } } },
            ],
          }
        : {}),
    };

    const profiles = await prisma.anchorProfile.findMany({
      where,
      include: {
        hallOrg: {
          select: { id: true, name: true, orgCode: true, douyinNo: true, douyinUid: true, path: true },
        },
        identities: {
          where: { roleCode: "ANCHOR" },
          include: { user: { select: { id: true, phone: true, nickname: true, status: true } } },
          orderBy: { grantedAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ hallOrgId: "asc" }, { createdAt: "desc" }],
      take: MAX_EXPORT,
    });

    // 从 hallOrg.path 批量提取 BASE、TEAM 的 orgCode，一次性查出名称
    // path 格式示例: /hq-001/base-001/team-001/hall-001 → parts[1]=BASE, parts[2]=TEAM
    const allPaths = [...new Set(profiles.map((p) => p.hallOrg?.path).filter(Boolean))] as string[];
    const ancestorOrgCodes = new Set<string>();
    for (const path of allPaths) {
      const parts = path.split("/").filter(Boolean);
      if (parts[1]) ancestorOrgCodes.add(parts[1]);
      if (parts[2]) ancestorOrgCodes.add(parts[2]);
    }

    const ancestorOrgs = ancestorOrgCodes.size
      ? await prisma.orgUnit.findMany({
          where: { orgCode: { in: [...ancestorOrgCodes] }, orgType: { in: ["BASE", "TEAM"] } },
          select: { orgCode: true, orgType: true, name: true },
        })
      : [];

    const baseMap = new Map(ancestorOrgs.filter((o) => o.orgType === "BASE").map((o) => [o.orgCode, o.name]));
    const teamMap = new Map(ancestorOrgs.filter((o) => o.orgType === "TEAM").map((o) => [o.orgCode, o.name]));

    return profiles.map((profile) => {
      const path = profile.hallOrg?.path ?? "";
      const parts = path.split("/").filter(Boolean);
      const baseCode = parts[1] ?? "";
      const teamCode = parts[2] ?? "";
      const boundUser = profile.identities[0]?.user ?? null;

      return {
        identityType:  isHistoricalMigratedProfile(profile) ? "历史身份" : "当前身份",
        baseName:      baseMap.get(baseCode) ?? "",
        baseCode,
        teamName:      teamMap.get(teamCode) ?? "",
        teamCode,
        hallName:      profile.hallOrg?.name ?? "",
        hallDouyinUid: profile.hallOrg?.douyinUid ?? "",
        nickname:      profile.nickname,
        phone:         boundUser?.phone ?? "",
        douyinNo:      profile.douyinNo ?? "",
        douyinUid:     profile.douyinUid,
        profileStatus: profile.status,
      };
    });
  },

  async createProfile(data: any) {
    const nickname = String(data.nickname ?? "").trim();
    const douyinNo = toTrimmedNullable(data.douyinNo);
    const douyinUid = String(data.douyinUid ?? "").trim();
    const hallOrgId = String(data.hallOrgId ?? "").trim();
    const boundUserId = toTrimmedNullable(data.boundUserId);

    if (!nickname) throw createAnchorBusinessError("ANCHOR_PROFILE_NICKNAME_REQUIRED", "主播昵称不能为空");
    if (!douyinUid) throw createAnchorBusinessError("ANCHOR_PROFILE_DOUYIN_UID_REQUIRED", "抖音 UID 不能为空");
    if (!hallOrgId) throw createAnchorBusinessError("HALL_NOT_FOUND", "归属厅不存在");

    const hall = await prisma.orgUnit.findFirst({ where: { id: hallOrgId, orgType: "HALL", status: "active" }, select: { id: true } });
    if (!hall) throw createAnchorBusinessError("HALL_NOT_FOUND", "归属厅不存在或已停用");

    await assertNoAnchorRegistrationConflict({ phone: null, douyinNo, douyinUid });

    try {
      return await prisma.anchorProfile.create({
        data: {
          ...data,
          nickname,
          douyinNo,
          douyinUid,
          hallOrgId,
          boundUserId,
          status: boundUserId ? "bound" : data.status ?? "unbound",
        },
      });
    } catch (error) {
      if (isAnchorUniqueConstraintError(error, "douyinNo")) {
        throw createAnchorBusinessError("DOUYIN_NO_EXISTS", buildAnchorConflictMessage({ douyinNo }));
      }
      if (isAnchorUniqueConstraintError(error, "douyinUid")) {
        throw createAnchorBusinessError("DOUYIN_UID_EXISTS", buildAnchorConflictMessage({ douyinUid }));
      }
      throw error;
    }
  },

  async updateProfile(id: string, data: any) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.anchorProfile.findUnique({ where: { id } });
      if (!current) throw createAnchorBusinessError("ANCHOR_PROFILE_NOT_FOUND", "主播档案不存在");

      const nextNickname = "nickname" in data ? String(data.nickname ?? "").trim() : current.nickname;
      const nextDouyinNo = "douyinNo" in data ? toTrimmedNullable(data.douyinNo) : current.douyinNo;
      const nextDouyinUid = "douyinUid" in data ? String(data.douyinUid ?? "").trim() : current.douyinUid;
      const nextHallOrgId = "hallOrgId" in data ? String(data.hallOrgId ?? "").trim() : current.hallOrgId;

      if (!nextNickname) throw createAnchorBusinessError("ANCHOR_PROFILE_NICKNAME_REQUIRED", "主播昵称不能为空");
      if (!nextDouyinUid) throw createAnchorBusinessError("ANCHOR_PROFILE_DOUYIN_UID_REQUIRED", "抖音 UID 不能为空");
      if (!nextHallOrgId) throw createAnchorBusinessError("HALL_NOT_FOUND", "归属厅不存在");
      if (nextHallOrgId !== current.hallOrgId) {
        throw createAnchorBusinessError("ANCHOR_PROFILE_MIGRATION_REQUIRED", "跨厅迁移请使用专用迁移流程，不能直接修改归属厅");
      }

      const identityChanged = nextDouyinNo !== current.douyinNo || nextDouyinUid !== current.douyinUid;
      if (identityChanged) {
        await assertNoAnchorRegistrationConflict({
          phone: null,
          douyinNo: nextDouyinNo,
          douyinUid: nextDouyinUid,
          excludeProfileId: current.id,
          excludeApplicationUserId: current.boundUserId ?? undefined,
        });
      }

      let updated;
      try {
        updated = await tx.anchorProfile.update({
          where: { id },
          data: {
            ...data,
            nickname: nextNickname,
            douyinNo: nextDouyinNo,
            douyinUid: nextDouyinUid,
            hallOrgId: nextHallOrgId,
          },
        });
      } catch (error) {
        if (isAnchorUniqueConstraintError(error, "douyinNo")) {
          throw createAnchorBusinessError("DOUYIN_NO_EXISTS", buildAnchorConflictMessage({ douyinNo: nextDouyinNo }));
        }
        if (isAnchorUniqueConstraintError(error, "douyinUid")) {
          throw createAnchorBusinessError("DOUYIN_UID_EXISTS", buildAnchorConflictMessage({ douyinUid: nextDouyinUid }));
        }
        throw error;
      }

      if (updated.boundUserId && nextNickname !== current.nickname) {
        await tx.user.update({ where: { id: updated.boundUserId }, data: { nickname: nextNickname } });
      }

      if (data.nickname || data.douyinNo || data.douyinUid) {
        if (current.douyinUid && updated.douyinUid && current.douyinUid !== updated.douyinUid) {
          await tx.taskRecord.updateMany({ where: { subjectKey: current.douyinUid }, data: { subjectKey: updated.douyinUid } });
        }
        await syncAnchorProfileSnapshots(tx, {
          profileId: updated.id,
          boundUserId: updated.boundUserId,
          nickname: updated.nickname,
          douyinNo: updated.douyinNo,
          douyinUid: updated.douyinUid,
        });
      }

      return updated;
    });
  },

  async migrateProfile(id: string, input: { targetHallOrgId: string; reason?: string; operatorUserId?: string }) {
    const targetHallOrgId = String(input.targetHallOrgId ?? "").trim();
    if (!targetHallOrgId) throw createAnchorBusinessError("HALL_NOT_FOUND", "目标归属厅不能为空");

    return prisma.$transaction(async (tx) => {
      const current = await tx.anchorProfile.findUnique({ where: { id } });
      if (!current) throw createAnchorBusinessError("ANCHOR_PROFILE_NOT_FOUND", "主播档案不存在");
      if (!current.boundUserId) throw createAnchorBusinessError("ANCHOR_PROFILE_MIGRATION_UNBOUND", "未绑定账号的主播档案不支持迁移");
      if (current.hallOrgId === targetHallOrgId) throw createAnchorBusinessError("ANCHOR_PROFILE_MIGRATION_SAME_HALL", "目标归属厅与当前归属厅一致，无需迁移");

      const [targetHall, currentAnchorIdentity, existingActiveAnchorIdentities] = await Promise.all([
        tx.orgUnit.findFirst({ where: { id: targetHallOrgId, orgType: "HALL", status: "active" }, select: { id: true, path: true } }),
        tx.userIdentity.findFirst({
          where: { userId: current.boundUserId, roleCode: "ANCHOR", anchorProfileId: current.id, status: "active" },
          select: { id: true },
        }),
        tx.userIdentity.findMany({
          where: { userId: current.boundUserId, roleCode: "ANCHOR", status: "active" },
          select: { id: true, anchorProfileId: true, orgId: true },
        }),
      ]);

      if (!targetHall) throw createAnchorBusinessError("HALL_NOT_FOUND", "目标归属厅不存在或已停用");
      if (!currentAnchorIdentity) throw createAnchorBusinessError("ANCHOR_PROFILE_MIGRATION_IDENTITY_REQUIRED", "当前主播身份未启用，无法迁移");
      if (existingActiveAnchorIdentities.some((identity) => identity.anchorProfileId !== current.id)) {
        throw createAnchorBusinessError("ANCHOR_PROFILE_ACTIVE_IDENTITY_CONFLICT", "该账号存在其他启用中的主播身份，请先处理后再迁移");
      }

      await assertNoAnchorRegistrationConflict({
        phone: null,
        douyinNo: current.douyinNo,
        douyinUid: current.douyinUid,
        excludeProfileId: current.id,
        excludeApplicationUserId: current.boundUserId,
      });

      const suffix = buildMigrationSuffix();
      const archivedNickname = appendMigrationSuffix(current.nickname, suffix);
      const archivedDouyinNo = appendMigrationSuffix(current.douyinNo, suffix);
      const archivedDouyinUid = appendMigrationSuffix(current.douyinUid, suffix);

      try {
        await tx.anchorProfile.update({
          where: { id: current.id },
          data: {
            nickname: archivedNickname,
            douyinNo: archivedDouyinNo || null,
            douyinUid: archivedDouyinUid,
            status: "inactive",
            inactiveByOrgPause: false,
          },
        });
      } catch (error) {
        if (isAnchorUniqueConstraintError(error, "douyinNo")) {
          throw createAnchorBusinessError("DOUYIN_NO_EXISTS", buildAnchorConflictMessage({ douyinNo: archivedDouyinNo }));
        }
        if (isAnchorUniqueConstraintError(error, "douyinUid")) {
          throw createAnchorBusinessError("DOUYIN_UID_EXISTS", buildAnchorConflictMessage({ douyinUid: archivedDouyinUid }));
        }
        throw error;
      }

      await tx.userIdentity.updateMany({
        where: { userId: current.boundUserId, roleCode: "ANCHOR", anchorProfileId: current.id },
        data: { status: "disabled", expiredAt: new Date(), disabledByOrgPause: false },
      });

      const nextProfile = await tx.anchorProfile.create({
        data: {
          nickname: current.nickname,
          douyinNo: current.douyinNo,
          douyinUid: current.douyinUid,
          hallOrgId: targetHallOrgId,
          boundUserId: current.boundUserId,
          source: current.source,
          status: "bound",
        },
      });

      const nextIdentity = await tx.userIdentity.create({
        data: {
          userId: current.boundUserId,
          roleCode: "ANCHOR",
          orgId: targetHallOrgId,
          anchorProfileId: nextProfile.id,
          scopePath: targetHall.path,
          status: "active",
          grantedBy: input.operatorUserId ?? null,
        },
      });

      await tx.user.update({ where: { id: current.boundUserId }, data: { nickname: current.nickname, status: "active" } });

      return {
        archivedProfileId: current.id,
        archivedIdentityId: currentAnchorIdentity.id,
        profile: nextProfile,
        identity: nextIdentity,
        targetHallOrgId,
        reason: input.reason?.trim() || null,
      };
    });
  },

  async toggleProfileStatus(profile: any, enable: boolean) {
    return prisma.$transaction(async (tx) => {
      if (enable) {
        if (isHistoricalMigratedProfile(profile)) {
          throw createAnchorBusinessError("ANCHOR_PROFILE_HISTORICAL_ENABLE_FORBIDDEN", "历史迁移档案不允许直接启用，如需回到原厅请重新发起迁移");
        }
        const hall = await tx.orgUnit.findUnique({ where: { id: profile.hallOrgId } });
        if (profile.boundUserId) {
          const otherActiveAnchorIdentity = await tx.userIdentity.findFirst({
            where: {
              userId: profile.boundUserId,
              roleCode: "ANCHOR",
              status: "active",
              anchorProfileId: { not: profile.id },
            },
            select: { id: true },
          });
          if (otherActiveAnchorIdentity) {
            throw createAnchorBusinessError("ANCHOR_PROFILE_ACTIVE_IDENTITY_CONFLICT", "该账号已存在其他启用中的主播身份，不能重复启用");
          }
          await tx.user.update({ where: { id: profile.boundUserId }, data: { status: "active" } });
          await tx.userIdentity.updateMany({ where: { userId: profile.boundUserId, anchorProfileId: profile.id, roleCode: "ANCHOR" }, data: { status: "active", expiredAt: null, scopePath: hall?.path, disabledByOrgPause: false } });
        }
        return tx.anchorProfile.update({ where: { id: profile.id }, data: { status: profile.boundUserId ? "bound" : "unbound", inactiveByOrgPause: false } });
      } else {
        await tx.userIdentity.updateMany({ where: { anchorProfileId: profile.id, roleCode: "ANCHOR" }, data: { status: "disabled", expiredAt: new Date(), disabledByOrgPause: false } });
        return tx.anchorProfile.update({ where: { id: profile.id }, data: { status: "inactive", inactiveByOrgPause: false } });
      }
    });
  },

  async deleteProfile(profile: any) {
    return prisma.$transaction(async (tx) => {
      const profileId = profile.id;
      const boundUserId = profile.boundUserId ?? null;

      // 1) 清理 task_record_identity_links 中指向该主播档案 / 即将被删的 ANCHOR 身份的链路
      //    - identityId 是非空外键，删 userIdentity 前必须先 delete
      //    - anchorProfileId 是可空外键，但删 anchorProfile 前也要先 delete
      //    二者在创建时都填了同一对 (identityId, anchorProfileId)，用 anchorProfileId 一并覆盖
      const anchorIdentityIds = (
        await tx.userIdentity.findMany({
          where: { anchorProfileId: profileId, roleCode: "ANCHOR" },
          select: { id: true },
        })
      ).map((row) => row.id);

      if (anchorIdentityIds.length > 0) {
        // identityId 是非空外键，必须先 delete 这些链路才能删 userIdentity
        await tx.taskRecordIdentityLink.deleteMany({
          where: { identityId: { in: anchorIdentityIds } },
        });
        await tx.taskRecordIdentityLink.deleteMany({
          where: { anchorProfileId: profileId },
        });
      } else {
        // 即使没有 ANCHOR 身份，也兜底清一次 anchorProfileId 维度的链路
        await tx.taskRecordIdentityLink.deleteMany({
          where: { anchorProfileId: profileId },
        });
      }

      // 2) 把 task_assignment_exclusions 上指向该主播档案的可空外键置 null
      await tx.taskAssignmentExclusion.updateMany({
        where: { anchorProfileId: profileId },
        data: { anchorProfileId: null },
      });

      // 3) 删除该主播的 ANCHOR 身份（此时所有指向它的外键已清理）
      await tx.userIdentity.deleteMany({
        where: { anchorProfileId: profileId, roleCode: "ANCHOR" },
      });

      // 4) 只删该用户自己的注册申请（避免 userId: undefined 误清全表）
      if (boundUserId) {
        await tx.anchorRegistrationApplication.deleteMany({
          where: { userId: boundUserId },
        });
        await tx.user.update({
          where: { id: boundUserId },
          data: { status: "disabled" },
        });
      }

      // 5) 最后删档案本身（此时没有任何外键指向它）
      await tx.anchorProfile.delete({ where: { id: profileId } });
    });
  },

  async getApplications(input: { status: string; keyword?: string; scopePath?: string; roleCode?: string; targetOrgId?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const normalizedKeyword = input.keyword?.trim() || "";
    const selectedOrg = input.targetOrgId
      ? await prisma.orgUnit.findUnique({ where: { id: input.targetOrgId }, select: { id: true, path: true, orgType: true } })
      : null;
    const effectiveScopePath = selectedOrg?.path || input.scopePath;
    const matchedUsers = normalizedKeyword
      ? await prisma.user.findMany({
          where: {
            OR: [
              { phone: { contains: normalizedKeyword } },
              { nickname: { contains: normalizedKeyword } },
            ],
          },
          select: { id: true },
          take: 200,
        })
      : [];
    const matchedUserIds = matchedUsers.map((item) => item.id);
    const where: Prisma.AnchorRegistrationApplicationWhereInput = {
      ...(effectiveScopePath ? { hall: { path: { startsWith: effectiveScopePath } } } : {}),
      ...(input.status ? { status: input.status as "pending" | "approved" | "rejected" | "cancelled" } : {}),
      ...(normalizedKeyword
        ? {
            OR: [
              { anchorNickname: { contains: normalizedKeyword } },
              { douyinNo: { contains: normalizedKeyword } },
              { douyinUid: { contains: normalizedKeyword } },
              ...(matchedUserIds.length ? [{ userId: { in: matchedUserIds } }] : []),
            ],
          }
        : {}),
      ...(input.startDate || input.endDate
        ? {
            submittedAt: {
              ...(input.startDate ? { gte: new Date(input.startDate) } : {}),
              ...(input.endDate ? { lte: new Date(input.endDate) } : {}),
            },
          }
        : {}),
    };
    const { page, pageSize, skip } = normalizePagination(input.page, input.pageSize);
    const [total, apps] = await Promise.all([
      prisma.anchorRegistrationApplication.count({ where }),
      prisma.anchorRegistrationApplication.findMany({
        where,
        include: { hall: true },
        orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
        skip,
        take: pageSize,
      }),
    ]);
    const userIds = apps.map((item) => item.userId);
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, phone: true, nickname: true, status: true } })
      : [];
    const userMap = new Map(users.map((item) => [item.id, item]));

    const teamIds = Array.from(new Set(apps.map((item) => item.hall?.parentId).filter(Boolean))) as string[];
    const teams = teamIds.length
      ? await prisma.orgUnit.findMany({ where: { id: { in: teamIds } }, select: { id: true, parentId: true, name: true, orgCode: true, orgType: true, path: true, depth: true, status: true } })
      : [];
    const teamMap = new Map(teams.map((item) => [item.id, item]));

    const baseIds = Array.from(new Set(teams.map((item) => item.parentId).filter(Boolean))) as string[];
    const bases = baseIds.length
      ? await prisma.orgUnit.findMany({ where: { id: { in: baseIds } }, select: { id: true, parentId: true, name: true, orgCode: true, orgType: true, path: true, depth: true, status: true } })
      : [];
    const baseMap = new Map(bases.map((item) => [item.id, item]));

    return {
      items: apps.map((app) => {
        const hall = app.hall ?? null;
        const team = hall?.parentId ? teamMap.get(hall.parentId) ?? null : null;
        const base = team?.parentId ? baseMap.get(team.parentId) ?? null : null;
        return {
          ...app,
          user: userMap.get(app.userId) ?? null,
          hall,
          teamOrg: team,
          baseOrg: base,
        };
      }),
      total,
      page,
      pageSize,
    };
  },

  async getProfileDetail(profileId: string, scopePath?: string, roleCode?: string) {
    const profile = await prisma.anchorProfile.findFirst({
      where: {
        id: profileId,
        ...(scopePath && roleCode !== "DEV_ADMIN" ? { hallOrg: { path: { startsWith: scopePath } } } : {}),
      },
      include: {
        hallOrg: true,
        identities: {
          where: { roleCode: "ANCHOR" },
          include: { user: { select: { id: true, phone: true, nickname: true, status: true } } },
          orderBy: { grantedAt: "desc" },
        },
      },
    });
    if (!profile) return null;
    const { identities, ...rest } = profile;
    return {
      ...rest,
      boundUser: rest.boundUserId
        ? identities.find((identity) => identity.userId === rest.boundUserId)?.user ?? identities.find((identity) => identity.user)?.user ?? null
        : null,
    };
  },

  async getApplicationDetail(applicationId: string, scopePath?: string, roleCode?: string) {
    const application = await prisma.anchorRegistrationApplication.findFirst({
      where: {
        id: applicationId,
        ...(scopePath && roleCode !== "DEV_ADMIN" ? { hall: { path: { startsWith: scopePath } } } : {}),
      },
      include: {
        hall: true,
      },
    });

    if (!application) return null;

    const user = await prisma.user.findUnique({
      where: { id: application.userId },
      select: { id: true, phone: true, nickname: true, status: true },
    });

    const teamOrg = application.hall?.parentId
      ? await prisma.orgUnit.findUnique({
          where: { id: application.hall.parentId },
          select: { id: true, parentId: true, name: true, orgCode: true, orgType: true, path: true, depth: true, status: true },
        })
      : null;

    const baseOrg = teamOrg?.parentId
      ? await prisma.orgUnit.findUnique({
          where: { id: teamOrg.parentId },
          select: { id: true, parentId: true, name: true, orgCode: true, orgType: true, path: true, depth: true, status: true },
        })
      : null;

    return {
      ...application,
      user,
      teamOrg,
      baseOrg,
    };
  },

  async getCandidates(app: any, keyword: string) {
    const q = keyword || app.douyinUid.replace(/^pending-.+$/, "") || app.anchorNickname;
    return prisma.anchorProfile.findMany({
      where: { OR: [{ nickname: { contains: q } }, { douyinNo: { contains: q } }, { douyinUid: { contains: q } }] },
      take: 20
    });
  },

  async rejectApplication(appId: string, reviewerId: string) {
    return prisma.anchorRegistrationApplication.update({
      where: { id: appId },
      data: { status: "rejected", reviewedBy: reviewerId, reviewedAt: new Date() }
    });
  },

  async approveApplication(app: any, douyinUid: string, douyinNo: string, nickname: string, _profileId: string | undefined, reviewerId: string) {
    await assertNoAnchorRegistrationConflict({
      phone: null,
      douyinNo,
      douyinUid,
      excludeUserId: app.userId,
      excludeApplicationId: app.id,
    });
    return prisma.$transaction(async (tx) => {
      const profile = await tx.anchorProfile.create({
        data: { nickname, douyinNo, douyinUid, hallOrgId: app.targetHallOrgId, boundUserId: app.userId, status: "bound", source: "registration_review" }
      });
      const hall = await tx.orgUnit.findUnique({ where: { id: app.targetHallOrgId } });
      const existingIdentity = await tx.userIdentity.findFirst({ where: { userId: app.userId, roleCode: "ANCHOR", orgId: app.targetHallOrgId, anchorProfileId: profile.id } });
      const identity = existingIdentity
        ? await tx.userIdentity.update({ where: { id: existingIdentity.id }, data: { status: "active", expiredAt: null, scopePath: hall?.path } })
        : await tx.userIdentity.create({ data: { userId: app.userId, roleCode: "ANCHOR", anchorProfileId: profile.id, orgId: app.targetHallOrgId, scopePath: hall?.path, status: "active", grantedBy: reviewerId } });
      await tx.user.update({ where: { id: app.userId }, data: { status: "active", nickname } });
      await syncAnchorProfileSnapshots(tx, {
        profileId: profile.id,
        boundUserId: profile.boundUserId,
        nickname: profile.nickname,
        douyinNo: profile.douyinNo,
        douyinUid: profile.douyinUid,
      });
      const reviewed = await tx.anchorRegistrationApplication.update({ where: { id: app.id }, data: { status: "approved", douyinNo, douyinUid, anchorNickname: nickname, reviewedBy: reviewerId, reviewedAt: new Date() } });
      return { application: reviewed, profile, identity };
    });
  }
};
