import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { ok, fail } from "../../shared/response.js";
import { prisma } from "../../shared/prisma.js";
export const identityRoutes = Router();
identityRoutes.get("/identities", authRequired, async (req, res) => {
    const list = await prisma.userIdentity.findMany({ where: { userId: req.userId, status: "active" }, include: { org: true, anchorProfile: true } });
    // 过滤掉关联组织已暂停的身份（DEV_ADMIN 例外）
    const valid = list.filter((i) => i.roleCode === "DEV_ADMIN" || !i.org || i.org.status !== "paused");
    return ok(res, valid);
});
identityRoutes.post("/identities/switch", authRequired, async (req, res) => {
    const identity = await prisma.userIdentity.findFirst({ where: { id: req.body.identityId, userId: req.userId, status: "active" }, include: { org: true, anchorProfile: true } });
    if (!identity)
        return ok(res, { identity: null });
    // 拒绝切换到关联组织已暂停的身份（DEV_ADMIN 例外）
    if (identity.roleCode !== "DEV_ADMIN" && identity.org && identity.org.status === "paused") {
        return fail(res, "ORG_PAUSED", `当前所属组织「${identity.org.name}」已被暂停，无法切换身份`, 403);
    }
    await prisma.userIdentity.update({ where: { id: identity.id }, data: { lastSwitchedAt: new Date() } });
    return ok(res, { identity });
});
identityRoutes.get("/me/permissions", authRequired, identityRequired, async (req, res) => {
    const rows = await prisma.rolePermission.findMany({ where: { roleCode: req.identity.roleCode }, select: { permissionCode: true } });
    return ok(res, rows.map((item) => item.permissionCode));
});
identityRoutes.get("/me", authRequired, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user)
        return ok(res, null);
    const { passwordHash: _ph, ...safeU } = user;
    return ok(res, safeU);
});
// 获取当前用户绑定的所有主播档案（含抖音号）
identityRoutes.get("/me/anchor-profiles", authRequired, async (req, res) => {
    const identities = await prisma.userIdentity.findMany({
        where: { userId: req.userId, roleCode: "ANCHOR", status: "active", anchorProfileId: { not: null } },
        include: { anchorProfile: true },
        orderBy: { grantedAt: "desc" },
    });
    const profiles = identities
        .filter((item) => item.anchorProfile)
        .map((item) => item.anchorProfile);
    return ok(res, profiles);
});
// 修改指定主播档案的抖音号（仅允许修改自己绑定的档案）
identityRoutes.patch("/me/anchor-profiles/:id", authRequired, async (req, res) => {
    const profileId = req.params.id;
    const newDouyinNo = typeof req.body?.douyinNo === "string" ? req.body.douyinNo.trim() : "";
    if (!newDouyinNo)
        return fail(res, "DOUYIN_NO_REQUIRED", "请填写抖音号", 400);
    // 验证该档案归属当前用户
    const identity = await prisma.userIdentity.findFirst({
        where: { userId: req.userId, roleCode: "ANCHOR", anchorProfileId: profileId, status: "active" },
    });
    if (!identity)
        return fail(res, "ANCHOR_PROFILE_FORBIDDEN", "该主播档案不属于当前账号或已停用", 403);
    // 查重：检查该抖音号是否已被其他主播档案使用
    const duplicated = await prisma.anchorProfile.findFirst({
        where: { douyinNo: newDouyinNo, id: { not: profileId } },
    });
    if (duplicated)
        return fail(res, "DOUYIN_NO_TAKEN", "该抖音号已被其他主播档案使用", 409);
    const updated = await prisma.anchorProfile.update({
        where: { id: profileId },
        data: { douyinNo: newDouyinNo },
    });
    return ok(res, updated);
});
