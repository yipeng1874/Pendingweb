import { fail } from "../shared/response.js";
import { prisma } from "../shared/prisma.js";
export async function identityRequired(req, res, next) {
    try {
        const identityId = req.header("X-Identity-Id") ?? String(req.body.identityId ?? "");
        const identity = await prisma.userIdentity.findFirst({
            where: { id: identityId, userId: req.userId, status: "active" },
            include: { org: { select: { status: true, name: true } } },
        });
        if (!identity)
            return fail(res, "IDENTITY_REQUIRED", "当前身份无效或不属于该账号", 403);
        // 检查关联组织是否已暂停（DEV_ADMIN 为全局管理员，不受组织暂停限制）
        if (identity.org &&
            identity.org.status === "paused" &&
            identity.roleCode !== "DEV_ADMIN") {
            return fail(res, "ORG_PAUSED", `当前所属组织「${identity.org.name}」已被暂停，无法执行操作，请联系上级管理员`, 403);
        }
        req.identity = {
            id: identity.id,
            userId: identity.userId,
            roleCode: identity.roleCode,
            orgId: identity.orgId ?? undefined,
            anchorProfileId: identity.anchorProfileId ?? undefined,
            scopePath: identity.scopePath ?? undefined,
            status: identity.status,
        };
        return next();
    }
    catch (error) {
        console.error("身份校验失败", error);
        return fail(res, "IDENTITY_CHECK_FAILED", "身份校验失败，请稍后重试", 500);
    }
}
