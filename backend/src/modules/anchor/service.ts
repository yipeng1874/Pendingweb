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
          ? ["TEAM"]
          : input.roleCode === "TEAM_ADMIN"
            ? ["HALL"]
            : input.roleCode === "HALL_MANAGER"
              ? ["HALL"]
              : ["BASE", "TEAM", "HALL"];
    if (!allowedTypes.length) return [];

    const rootWhere = !parent && input.roleCode === "HALL_MANAGER"
      ? input.identityOrgId
        ? { id: input.identityOrgId }
        : null
      : null;

    const where: Prisma.OrgUnitWhereInput = {
      status: "active",
      orgType: { in: allowedTypes },
      ...(parent
        ? { parentId: parent.id }
        : rootWhere
          ? rootWhere
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

  async getProfiles(input: { keyword: string; hallOrgId: string; orgId?: string; status: string; scopePath?: string; roleCode?: string; page?: number; pageSize?: number }) {
    const normalizedKeyword = input.keyword.trim();
    const selectedOrg = input.orgId
      ? await prisma.orgUnit.findUnique({ where: { id: input.orgId }, select: { id: true, path: true, orgType: true } })
      : null;
    const selectedScopePath = selectedOrg?.path;
    const effectiveScopePath = selectedScopePath || (input.roleCode !== "DEV_ADMIN" ? input.scopePath : undefined);
    const hallFilter = effectiveScopePath ? { hallOrg: { path: { startsWith: effectiveScopePath } } } : {};
    const where: Prisma.AnchorProfileWhereInput = {
      ...hallFilter,
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

      let nextHallPath: string | null | undefined;
      if (nextHallOrgId !== current.hallOrgId) {
        const hall = await tx.orgUnit.findFirst({ where: { id: nextHallOrgId, orgType: "HALL", status: "active" }, select: { path: true } });
        if (!hall) throw createAnchorBusinessError("HALL_NOT_FOUND", "归属厅不存在或已停用");
        nextHallPath = hall.path;
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

      if (nextHallOrgId !== current.hallOrgId) {
        await tx.userIdentity.updateMany({
          where: { anchorProfileId: updated.id, roleCode: "ANCHOR" },
          data: { orgId: nextHallOrgId, scopePath: nextHallPath },
        });
        await tx.taskRecord.updateMany({
          where: {
            OR: [
              ...(updated.boundUserId ? [{ subjectUserId: updated.boundUserId }, { userId: updated.boundUserId }] : []),
              ...(current.douyinUid ? [{ subjectKey: current.douyinUid }] : []),
            ],
          },
          data: { subjectOrgId: nextHallOrgId },
        });
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

  async toggleProfileStatus(profile: any, enable: boolean) {
    return prisma.$transaction(async (tx) => {
      if (enable) {
        const hall = await tx.orgUnit.findUnique({ where: { id: profile.hallOrgId } });
        if (profile.boundUserId) {
          await tx.user.update({ where: { id: profile.boundUserId }, data: { status: "active" } });
          await tx.userIdentity.updateMany({ where: { userId: profile.boundUserId, anchorProfileId: profile.id, roleCode: "ANCHOR" }, data: { status: "active", expiredAt: null, scopePath: hall?.path } });
        }
        return tx.anchorProfile.update({ where: { id: profile.id }, data: { status: profile.boundUserId ? "bound" : "unbound" } });
      } else {
        await tx.userIdentity.updateMany({ where: { anchorProfileId: profile.id, roleCode: "ANCHOR" }, data: { status: "disabled", expiredAt: new Date() } });
        if (profile.boundUserId) await tx.user.update({ where: { id: profile.boundUserId }, data: { status: "disabled" } });
        return tx.anchorProfile.update({ where: { id: profile.id }, data: { status: "inactive" } });
      }
    });
  },

  async deleteProfile(profile: any) {
    return prisma.$transaction(async (tx) => {
      await tx.userIdentity.deleteMany({ where: { anchorProfileId: profile.id, roleCode: "ANCHOR" } });
      await tx.anchorRegistrationApplication.deleteMany({ where: { userId: profile.boundUserId ?? undefined } });
      if (profile.boundUserId) {
        await tx.user.update({ where: { id: profile.boundUserId }, data: { status: "disabled" } });
      }
      await tx.anchorProfile.delete({ where: { id: profile.id } });
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
