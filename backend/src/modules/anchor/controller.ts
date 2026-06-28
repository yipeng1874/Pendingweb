import bcrypt from "bcryptjs";
import { fail, ok } from "../../shared/response.js";
import { prisma } from "../../shared/prisma.js";
import { text, safeUser } from "./utils.js";
import { AnchorService } from "./service.js";

export const AnchorController = {
  async getRegisterOrgs(req: any, res: any) {
    const orgs = await AnchorService.getRegisterOrgs(text(req.query.parentId), text(req.query.orgType), req.query.includeVirtual === "true");
    return ok(res, orgs);
  },

  async getOrgChildren(req: any, res: any) {
    const orgs = await AnchorService.getScopedOrgChildren({
      parentId: text(req.query.parentId) || undefined,
      identityOrgId: req.identity?.orgId,
      scopePath: req.identity?.scopePath,
      roleCode: req.identity?.roleCode,
      includeVirtual: req.query.includeVirtual === "true",
    });
    return ok(res, orgs);
  },

  async getHalls(req: any, res: any) {
    const halls = await AnchorService.getHalls(req.query.includeVirtual === "true");
    return ok(res, halls);
  },

  async register(req: any, res: any) {
    const nickname = text(req.body.nickname);
    const phone = text(req.body.phone);
    const password = text(req.body.password);
    const targetHallOrgId = text(req.body.targetHallOrgId);
    if (!nickname || !phone || !password || !targetHallOrgId) return fail(res, "REGISTER_REQUIRED_FIELDS", "请填写账号昵称、手机号、密码并选择归属厅", 400);
    if (!/^\d{11}$/.test(phone)) return fail(res, "PHONE_INVALID", "手机号必须为11位数字", 400);
    
    const hall = await prisma.orgUnit.findFirst({ where: { id: targetHallOrgId, orgType: "HALL", status: "active" } });
    if (!hall) return fail(res, "HALL_NOT_FOUND", "选择的归属厅不存在或已停用", 400);

    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const result = await AnchorService.registerAnchor(nickname, phone, passwordHash, targetHallOrgId, text(req.body.douyinNo), text(req.body.douyinUid));
      return ok(res, {
        user: safeUser(result.user),
        application: result.app,
        message: "账号注册申请已提交，审核通过后可使用账号；如需管理权限，请由上级在组织账号管理中授权。",
      });
    } catch (error: any) {
      if (["PHONE_EXISTS", "DOUYIN_NO_EXISTS", "DOUYIN_UID_EXISTS"].includes(error?.code)) {
        return fail(res, error.code, error.message, 409);
      }
      throw error;
    }
  },

  async getProfiles(req: any, res: any) {
    const data = await AnchorService.getProfiles({
      keyword: text(req.query.keyword),
      hallOrgId: text(req.query.hallOrgId),
      orgId: text(req.query.orgId) || undefined,
      status: text(req.query.status),
      viewMode: text(req.query.viewMode) || "current",
      scopePath: req.identity?.scopePath,
      roleCode: req.identity?.roleCode,
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
    });
    return ok(res, data);
  },

  async exportProfiles(req: any, res: any) {
    const rows = await AnchorService.exportProfiles({
      keyword:   text(req.query.keyword),
      orgId:     text(req.query.orgId) || undefined,
      status:    text(req.query.status),
      viewMode:  text(req.query.viewMode) || "current",
      scopePath: req.identity?.scopePath,
      roleCode:  req.identity?.roleCode,
    });
    return ok(res, rows);
  },

  async getProfileDetail(req: any, res: any) {
    const profile = await AnchorService.getProfileDetail(req.params.id, req.identity?.scopePath, req.identity?.roleCode);
    if (!profile) return fail(res, "ANCHOR_PROFILE_NOT_FOUND", "主播档案不存在或无权查看", 404);
    return ok(res, profile);
  },

  async createProfile(req: any, res: any) {
    const nickname = text(req.body.nickname);
    const douyinUid = text(req.body.douyinUid);
    const hallOrgId = text(req.body.hallOrgId);
    if (!nickname || !douyinUid || !hallOrgId) return fail(res, "ANCHOR_PROFILE_REQUIRED_FIELDS", "请填写主播昵称、抖音 UID 和归属厅", 400);
    const hall = await prisma.orgUnit.findFirst({ where: { id: hallOrgId, orgType: "HALL" } });
    if (!hall) return fail(res, "HALL_NOT_FOUND", "归属厅不存在", 400);

    try {
      const profile = await AnchorService.createProfile({ 
        nickname, 
        douyinNo: text(req.body.douyinNo) || null, 
        douyinUid, 
        hallOrgId, 
        boundUserId: text(req.body.boundUserId) || null, 
        status: text(req.body.boundUserId) ? "bound" : "unbound" 
      });
      return ok(res, profile);
    } catch (error: any) {
      if (["DOUYIN_NO_EXISTS", "DOUYIN_UID_EXISTS"].includes(error?.code)) {
        return fail(res, error.code, error.message, 409);
      }
      if (["ANCHOR_PROFILE_NICKNAME_REQUIRED", "ANCHOR_PROFILE_DOUYIN_UID_REQUIRED", "HALL_NOT_FOUND"].includes(error?.code)) {
        return fail(res, error.code, error.message, 400);
      }
      throw error;
    }
  },

  async updateProfile(req: any, res: any) {
    const allowed = ["nickname", "douyinNo", "douyinUid", "hallOrgId"] as const;
    const data = Object.fromEntries(allowed.filter((key) => key in req.body).map((key) => [key, text(req.body[key])]));

    try {
      const profile = await AnchorService.updateProfile(req.params.id, data);
      return ok(res, profile);
    } catch (error: any) {
      if (["DOUYIN_NO_EXISTS", "DOUYIN_UID_EXISTS"].includes(error?.code)) {
        return fail(res, error.code, error.message, 409);
      }
      if (["ANCHOR_PROFILE_NICKNAME_REQUIRED", "ANCHOR_PROFILE_DOUYIN_UID_REQUIRED", "HALL_NOT_FOUND", "ANCHOR_PROFILE_MIGRATION_REQUIRED"].includes(error?.code)) {
        return fail(res, error.code, error.message, 400);
      }
      if (error?.code === "ANCHOR_PROFILE_NOT_FOUND") {
        return fail(res, error.code, error.message, 404);
      }
      throw error;
    }
  },

  async migrateProfile(req: any, res: any) {
    const targetHallOrgId = text(req.body.targetHallOrgId);
    if (!targetHallOrgId) return fail(res, "HALL_NOT_FOUND", "请选择目标归属厅", 400);

    try {
      const result = await AnchorService.migrateProfile(req.params.id, {
        targetHallOrgId,
        reason: text(req.body.reason) || undefined,
        operatorUserId: req.userId,
      });
      return ok(res, result);
    } catch (error: any) {
      if (["DOUYIN_NO_EXISTS", "DOUYIN_UID_EXISTS"].includes(error?.code)) {
        return fail(res, error.code, error.message, 409);
      }
      if ([
        "HALL_NOT_FOUND",
        "ANCHOR_PROFILE_MIGRATION_UNBOUND",
        "ANCHOR_PROFILE_MIGRATION_SAME_HALL",
        "ANCHOR_PROFILE_MIGRATION_IDENTITY_REQUIRED",
        "ANCHOR_PROFILE_ACTIVE_IDENTITY_CONFLICT",
      ].includes(error?.code)) {
        return fail(res, error.code, error.message, 400);
      }
      if (error?.code === "ANCHOR_PROFILE_NOT_FOUND") {
        return fail(res, error.code, error.message, 404);
      }
      throw error;
    }
  },


  async disableProfile(req: any, res: any) {
    const profile = await prisma.anchorProfile.findUnique({ where: { id: req.params.id } });
    if (!profile) return fail(res, "ANCHOR_PROFILE_NOT_FOUND", "主播档案不存在", 404);
    const updated = await AnchorService.toggleProfileStatus(profile, false);
    return ok(res, updated);
  },

  async enableProfile(req: any, res: any) {
    const profile = await prisma.anchorProfile.findUnique({ where: { id: req.params.id } });
    if (!profile) return fail(res, "ANCHOR_PROFILE_NOT_FOUND", "主播档案不存在", 404);
    try {
      const updated = await AnchorService.toggleProfileStatus(profile, true);
      return ok(res, updated);
    } catch (error: any) {
      if (["ANCHOR_PROFILE_HISTORICAL_ENABLE_FORBIDDEN", "ANCHOR_PROFILE_ACTIVE_IDENTITY_CONFLICT"].includes(error?.code)) {
        return fail(res, error.code, error.message, 400);
      }
      throw error;
    }
  },

  async deleteProfile(req: any, res: any) {
    const profile = await prisma.anchorProfile.findUnique({ where: { id: req.params.id } });
    if (!profile) return fail(res, "ANCHOR_PROFILE_NOT_FOUND", "主播档案不存在", 404);

    if (profile.boundUserId) {
      const activeManagementIdentity = await prisma.userIdentity.findFirst({
        where: { userId: profile.boundUserId, roleCode: { not: "ANCHOR" }, status: "active" },
        include: { org: true },
      });
      if (activeManagementIdentity) {
        return fail(res, "ANCHOR_PROFILE_DELETE_BLOCKED", `该主播账号仍持有管理权限：${activeManagementIdentity.org?.name || "未命名组织"} / ${activeManagementIdentity.roleCode}，请先停用或删除管理权限后再删除主播档案`, 400);
      }
    }

    await AnchorService.deleteProfile(profile);
    return ok(res, { deleted: true });
  },

  async getApplications(req: any, res: any) {
    const data = await AnchorService.getApplications({
      status: text(req.query.status),
      keyword: text(req.query.keyword) || undefined,
      scopePath: req.identity?.scopePath,
      roleCode: req.identity?.roleCode,
      targetOrgId: text(req.query.targetOrgId),
      startDate: text(req.query.startDate) || undefined,
      endDate: text(req.query.endDate) ? `${text(req.query.endDate)}T23:59:59.999Z` : undefined,
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
    });
    return ok(res, data);
  },

  async getApplicationDetail(req: any, res: any) {
    const app = await AnchorService.getApplicationDetail(req.params.id, req.identity?.scopePath, req.identity?.roleCode);
    if (!app) return fail(res, "APPLICATION_NOT_FOUND", "注册账号申请不存在或无权查看", 404);
    return ok(res, app);
  },

  async getCandidates(req: any, res: any) {
    const app = await prisma.anchorRegistrationApplication.findUnique({ where: { id: req.params.id } });
    if (!app) return fail(res, "APPLICATION_NOT_FOUND", "注册账号申请不存在", 404);
    const candidates = await AnchorService.getCandidates(app, text(req.query.keyword));
    return ok(res, candidates);
  },

  async reviewApplication(req: any, res: any) {
    const approved = Boolean(req.body.approved);
    const app = await prisma.anchorRegistrationApplication.findUnique({ where: { id: req.params.id } });
    if (!app) return fail(res, "APPLICATION_NOT_FOUND", "注册账号申请不存在", 404);
    if (app.status !== "pending") return fail(res, "APPLICATION_REVIEWED", "该申请已审核", 400);

    if (!approved) {
      const rejected = await AnchorService.rejectApplication(app.id, req.userId);
      return ok(res, { application: rejected, message: "账号注册申请已驳回" });
    }

    const douyinUid = text(req.body.douyinUid || app.douyinUid).replace(/^pending-.+$/, "");
    const douyinNo = text(req.body.douyinNo || app.douyinNo);
    const nickname = text(req.body.anchorNickname || app.anchorNickname);
    if (!douyinUid || !douyinNo || !nickname) return fail(res, "ANCHOR_REVIEW_REQUIRED_FIELDS", "审核通过必须填写账号昵称、抖音号和抖音 UID", 400);

    try {
      const result = await AnchorService.approveApplication(app, douyinUid, douyinNo, nickname, req.body.profileId, req.userId);
      return ok(res, { ...result, message: "账号注册申请已通过，账号已激活；如需管理权限，请在组织账号管理中继续授权。" });
    } catch (error: any) {
      if (["PHONE_EXISTS", "DOUYIN_NO_EXISTS", "DOUYIN_UID_EXISTS"].includes(error?.code)) {
        return fail(res, error.code, error.message, 409);
      }
      throw error;
    }
  }
};
