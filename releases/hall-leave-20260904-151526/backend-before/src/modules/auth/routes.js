import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { authRequired } from "../../middleware/authRequired.js";
import { ok, fail } from "../../shared/response.js";
import { prisma } from "../../shared/prisma.js";
export const authRoutes = Router();
function safeUser(user) {
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
}
function filterValidIdentities(identities) {
    return identities.filter((i) => i.roleCode === "DEV_ADMIN" || !i.org || i.org.status !== "paused");
}
const IDENTITY_ROLE_LEVEL = {
    DEV_ADMIN: 1,
    HQ_ADMIN: 2,
    BASE_ADMIN: 3,
    TEAM_ADMIN: 4,
    HALL_MANAGER: 5,
    ANCHOR: 6,
};
function recommendIdentityId(identities, config) {
    if (!identities.length)
        return null;
    const contextRank = (identity) => {
        if (!config)
            return 0;
        const orgId = identity.orgId ?? identity.org?.id;
        const scopePath = identity.scopePath ?? identity.org?.path ?? "";
        const teamPath = config.teamOrg.path ?? "";
        const basePath = config.baseOrg.path ?? "";
        if (orgId === config.teamOrgId)
            return 0;
        if (teamPath && (scopePath === teamPath || scopePath.startsWith(`${teamPath}/`)))
            return 1;
        if (orgId === config.baseOrgId)
            return 2;
        if (basePath && (scopePath === basePath || scopePath.startsWith(`${basePath}/`)))
            return 3;
        return 4;
    };
    return [...identities].sort((a, b) => {
        const contextDiff = contextRank(a) - contextRank(b);
        if (contextDiff !== 0)
            return contextDiff;
        const roleDiff = (IDENTITY_ROLE_LEVEL[a.roleCode] ?? 99) - (IDENTITY_ROLE_LEVEL[b.roleCode] ?? 99);
        if (roleDiff !== 0)
            return roleDiff;
        const switchDiff = new Date(b.lastSwitchedAt ?? 0).getTime() - new Date(a.lastSwitchedAt ?? 0).getTime();
        if (switchDiff !== 0)
            return switchDiff;
        const grantDiff = new Date(a.grantedAt ?? 0).getTime() - new Date(b.grantedAt ?? 0).getTime();
        if (grantDiff !== 0)
            return grantDiff;
        return a.id.localeCompare(b.id);
    })[0]?.id ?? null;
}
function makeJwt(userId) {
    return jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}
function getFeishuConfigDelegate() {
    return prisma.feishuEnterpriseConfig;
}
function dedupeFeishuOrgOptions(items) {
    const uniqueOptions = new Map();
    for (const item of items) {
        if (!item?.id)
            continue;
        if (!uniqueOptions.has(item.id)) {
            uniqueOptions.set(item.id, item);
        }
    }
    return Array.from(uniqueOptions.values());
}
function normalizeFeishuAuthErrorMessage(error, fallback) {
    return error instanceof Error ? error.message : fallback;
}
async function getFeishuConfigById(configId) {
    if (!configId)
        return null;
    const delegate = getFeishuConfigDelegate();
    if (!delegate)
        return null;
    return delegate.findFirst({
        where: { id: configId, status: "active" },
        include: {
            baseOrg: { select: { id: true, name: true, orgCode: true, orgType: true, path: true } },
            teamOrg: { select: { id: true, name: true, orgCode: true, orgType: true, path: true } },
        },
    });
}
function getFeishuRedirectUri(client) {
    const redirectUri = client === "h5"
        ? (process.env.FEISHU_REDIRECT_URI_H5 || env.FEISHU_REDIRECT_URI)
        : (process.env.FEISHU_REDIRECT_URI_PC || env.FEISHU_REDIRECT_URI);
    if (!redirectUri) {
        throw new Error(`系统未配置 ${client.toUpperCase()} 飞书回调地址`);
    }
    return redirectUri;
}
function requireFeishuConfig(config, res, client = "pc") {
    if (!config) {
        fail(res, "FEISHU_CONFIG_NOT_FOUND", "未找到可用的飞书企业配置，请先选择基地、团队和飞书企业", 404);
        return false;
    }
    if (!config.appId || !config.appSecret) {
        fail(res, "FEISHU_NOT_CONFIGURED", "所选飞书企业配置不完整，请联系管理员补充 App ID / App Secret", 500);
        return false;
    }
    try {
        getFeishuRedirectUri(client);
    }
    catch {
        fail(res, "FEISHU_REDIRECT_NOT_CONFIGURED", `系统未配置 ${client.toUpperCase()} 飞书回调地址`, 500);
        return false;
    }
    return true;
}
function feishuAuthorizeUrl(config, state, client) {
    const url = new URL("https://open.feishu.cn/open-apis/authen/v1/index");
    url.searchParams.set("app_id", config.appId);
    url.searchParams.set("redirect_uri", getFeishuRedirectUri(client));
    url.searchParams.set("state", state);
    return url.toString();
}
function feishuState(action, configId, client, token) {
    return JSON.stringify({ action, client, configId, nonce: randomUUID(), ...(token ? { token } : {}) });
}
function parseFeishuState(raw) {
    if (typeof raw !== "string" || !raw.trim())
        return null;
    try {
        const parsed = JSON.parse(raw);
        if ((parsed.action === "login" || parsed.action === "bind") && typeof parsed.configId === "string" && parsed.configId) {
            return {
                action: parsed.action,
                client: parsed.client === "h5" ? "h5" : "pc",
                configId: parsed.configId,
                nonce: typeof parsed.nonce === "string" ? parsed.nonce : randomUUID(),
                token: typeof parsed.token === "string" ? parsed.token : undefined,
            };
        }
        return null;
    }
    catch {
        return null;
    }
}
async function getFeishuAppAccessToken(config) {
    const appTokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
    });
    const appTokenJson = await appTokenResp.json();
    if (appTokenJson.code !== 0)
        throw new Error(appTokenJson.msg || "获取飞书 app_access_token 失败");
    return appTokenJson.app_access_token;
}
async function exchangeFeishuCode(config, code) {
    const appAccessToken = await getFeishuAppAccessToken(config);
    const tokenResp = await fetch("https://open.feishu.cn/open-apis/authen/v1/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${appAccessToken}` },
        body: JSON.stringify({ grant_type: "authorization_code", code }),
    });
    const tokenJson = await tokenResp.json();
    if (tokenJson.code !== 0)
        throw new Error(tokenJson.msg || "飞书授权失败");
    return {
        open_id: tokenJson.data?.open_id ?? "",
        union_id: tokenJson.data?.union_id ?? "",
        name: tokenJson.data?.name ?? "",
        avatar_url: tokenJson.data?.avatar_url ?? "",
    };
}
async function exchangeFeishuJsapiCode(config, code) {
    const appAccessToken = await getFeishuAppAccessToken(config);
    const userTokenResp = await fetch("https://open.feishu.cn/open-apis/authen/v1/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${appAccessToken}` },
        body: JSON.stringify({ grant_type: "authorization_code", code }),
    });
    const userTokenJson = await userTokenResp.json();
    if (userTokenJson.code !== 0)
        throw new Error(userTokenJson.msg || "飞书授权码无效或已过期");
    return {
        open_id: userTokenJson.data?.open_id ?? "",
        union_id: userTokenJson.data?.union_id ?? "",
        name: userTokenJson.data?.name ?? "",
        avatar_url: userTokenJson.data?.avatar_url ?? "",
    };
}
// GET /feishu/app-ids
// 返回所有 active 飞书企业的 configId + appId（appId 是飞书公开标识，不含 appSecret）
// 供飞书客户端内并行竞速 tt.requestAccess，自动识别当前用户所属企业
authRoutes.get("/feishu/app-ids", async (_req, res) => {
    const delegate = getFeishuConfigDelegate();
    if (!delegate)
        return ok(res, []);
    const configs = await delegate.findMany({
        where: { status: "active" },
        orderBy: [{ baseOrgId: "asc" }, { teamOrgId: "asc" }, { name: "asc" }],
    });
    return ok(res, configs.map((c) => ({ configId: c.id, appId: c.appId })));
});
authRoutes.get("/feishu/base-options", async (_req, res) => {
    const delegate = getFeishuConfigDelegate();
    if (!delegate) {
        return ok(res, []);
    }
    const configs = await delegate.findMany({
        where: { status: "active" },
        include: {
            baseOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
            teamOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
        },
        orderBy: [{ baseOrgId: "asc" }, { teamOrgId: "asc" }, { name: "asc" }],
    });
    return ok(res, dedupeFeishuOrgOptions(configs.map((item) => item.baseOrg)));
});
authRoutes.get("/feishu/team-options", async (req, res) => {
    const delegate = getFeishuConfigDelegate();
    if (!delegate) {
        return ok(res, []);
    }
    const baseOrgId = typeof req.query.baseOrgId === "string" ? req.query.baseOrgId.trim() : "";
    if (!baseOrgId)
        return fail(res, "FEISHU_BASE_REQUIRED", "请选择基地后再加载团队", 400);
    const configs = await delegate.findMany({
        where: { status: "active", baseOrgId },
        include: {
            baseOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
            teamOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
        },
        orderBy: [{ teamOrgId: "asc" }, { name: "asc" }],
    });
    return ok(res, dedupeFeishuOrgOptions(configs.map((item) => item.teamOrg)));
});
authRoutes.get("/feishu/configs", async (req, res) => {
    const delegate = getFeishuConfigDelegate();
    if (!delegate) {
        return ok(res, []);
    }
    const configId = typeof req.query.configId === "string" ? req.query.configId.trim() : "";
    const baseOrgId = typeof req.query.baseOrgId === "string" ? req.query.baseOrgId.trim() : "";
    const teamOrgId = typeof req.query.teamOrgId === "string" ? req.query.teamOrgId.trim() : "";
    const configs = await delegate.findMany({
        where: {
            status: "active",
            ...(configId ? { id: configId } : {}),
            ...(!configId && baseOrgId ? { baseOrgId } : {}),
            ...(!configId && teamOrgId ? { teamOrgId } : {}),
        },
        include: {
            baseOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
            teamOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
        },
        orderBy: [{ baseOrgId: "asc" }, { teamOrgId: "asc" }, { name: "asc" }],
    });
    return ok(res, configs);
});
authRoutes.post("/login", async (req, res) => {
    const { phone, password } = req.body;
    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user || !password || !(await bcrypt.compare(password, user.passwordHash))) {
        return fail(res, "LOGIN_FAILED", "手机号或密码错误", 401);
    }
    if (user.status === "disabled") {
        return fail(res, "ACCOUNT_DISABLED", "账号已被停用，请联系上级管理员", 403);
    }
    if (user.status !== "active") {
        return fail(res, "ACCOUNT_INACTIVE", "账号状态异常，请联系上级管理员", 403);
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const allIdentities = await prisma.userIdentity.findMany({ where: { userId: user.id, status: "active" }, include: { org: true, anchorProfile: true } });
    const identities = filterValidIdentities(allIdentities);
    const token = makeJwt(user.id);
    return ok(res, { token, user: safeUser(user), identities, recommendedIdentityId: recommendIdentityId(identities) });
});
authRoutes.post("/change-password", authRequired, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
        return fail(res, "PASSWORD_REQUIRED", "请填写旧密码和新密码", 400);
    if (newPassword.length < 8)
        return fail(res, "PASSWORD_TOO_SHORT", "新密码至少 8 位", 400);
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user)
        return fail(res, "ACCOUNT_NOT_FOUND", "账号不存在", 404);
    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid)
        return fail(res, "PASSWORD_INCORRECT", "旧密码错误", 400);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false } });
    return ok(res, { changed: true });
});
authRoutes.patch("/update-phone", authRequired, async (req, res) => {
    const { currentPassword, newPhone } = req.body;
    if (!currentPassword || !newPhone)
        return fail(res, "PARAMS_REQUIRED", "请填写当前密码和新手机号", 400);
    if (!/^1[3-9]\d{9}$/.test(newPhone))
        return fail(res, "PHONE_INVALID", "手机号格式不正确", 400);
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user)
        return fail(res, "ACCOUNT_NOT_FOUND", "账号不存在", 404);
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid)
        return fail(res, "PASSWORD_INCORRECT", "当前密码错误", 400);
    const duplicated = await prisma.user.findFirst({ where: { phone: newPhone, id: { not: user.id } } });
    if (duplicated)
        return fail(res, "PHONE_TAKEN", "该手机号已被其他账号使用", 409);
    const updated = await prisma.user.update({ where: { id: user.id }, data: { phone: newPhone } });
    return ok(res, safeUser(updated));
});
let cachedTickets = new Map();
async function getJsapiTicket(config) {
    const cached = cachedTickets.get(config.id);
    if (cached && Date.now() < cached.expiresAt)
        return cached.ticket;
    const appAccessToken = await getFeishuAppAccessToken(config);
    const ticketResp = await fetch("https://open.feishu.cn/open-apis/jssdk/ticket/get", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${appAccessToken}` },
        body: JSON.stringify({}),
    });
    const ticketJson = await ticketResp.json();
    if (ticketJson.code !== 0)
        throw new Error(ticketJson.msg || "获取 jsapi_ticket 失败");
    const ticket = ticketJson.data?.ticket;
    const expiresAt = Date.now() + (ticketJson.data?.expire_in ?? 7200) * 1000 - 60_000;
    cachedTickets.set(config.id, { ticket, expiresAt });
    return ticket;
}
function sha1(str) {
    return createHash("sha1").update(str).digest("hex");
}
authRoutes.get("/feishu/jssdk-config", async (req, res) => {
    // JS-SDK signatures contain a short-lived timestamp. Never allow browsers,
    // embedded WebViews, proxies, or CDNs to reuse a previous response.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const pageUrl = typeof req.query.url === "string" ? req.query.url : "";
    const configId = typeof req.query.configId === "string" ? req.query.configId : "";
    if (!pageUrl)
        return fail(res, "URL_REQUIRED", "缺少 url 参数", 400);
    const config = await getFeishuConfigById(configId);
    if (!requireFeishuConfig(config, res, "h5"))
        return;
    try {
        const ticket = await getJsapiTicket(config);
        const nonceStr = randomBytes(8).toString("hex");
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = sha1(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${pageUrl}`);
        return ok(res, { appId: config.appId, timestamp, nonceStr, signature, configId: config.id });
    }
    catch (err) {
        return fail(res, "JSSDK_CONFIG_FAILED", err instanceof Error ? err.message : "获取 JSSDK 配置失败", 500);
    }
});
authRoutes.get("/feishu/login", async (req, res) => {
    const action = req.query.action === "bind" ? "bind" : "login";
    const client = req.query.client === "h5" ? "h5" : "pc";
    const token = typeof req.query.token === "string" ? req.query.token : undefined;
    const configId = typeof req.query.configId === "string" ? req.query.configId : "";
    const config = await getFeishuConfigById(configId);
    if (!requireFeishuConfig(config, res, client))
        return;
    const state = feishuState(action, config.id, client, token);
    return res.redirect(feishuAuthorizeUrl(config, state, client));
});
authRoutes.post("/feishu/complete-login", async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const statePayload = parseFeishuState(req.body?.state);
    if (!code)
        return fail(res, "FEISHU_CODE_REQUIRED", "缺少飞书授权 code", 400);
    if (!statePayload?.configId)
        return fail(res, "FEISHU_CONFIG_REQUIRED", "缺少飞书企业配置，请重新选择后登录", 400);
    const config = await getFeishuConfigById(statePayload.configId);
    if (!requireFeishuConfig(config, res))
        return;
    try {
        const profile = await exchangeFeishuCode(config, code);
        const user = await prisma.user.findFirst({
            where: {
                feishuConfigId: config.id,
                OR: [
                    profile.union_id ? { feishuUnionId: profile.union_id } : undefined,
                    profile.open_id ? { feishuOpenId: profile.open_id } : undefined,
                ].filter(Boolean),
            },
        });
        if (!user)
            return fail(res, "FEISHU_UNBOUND", "该飞书账号尚未绑定系统账号，请先登录系统完成绑定", 403);
        if (user.status === "disabled")
            return fail(res, "ACCOUNT_DISABLED", "账号已被停用", 403);
        if (user.status !== "active")
            return fail(res, "ACCOUNT_INACTIVE", "账号状态异常", 403);
        await prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginAt: new Date(),
                feishuConfigId: config.id,
                feishuName: profile.name,
                feishuAvatarUrl: profile.avatar_url,
            },
        });
        const identities = await prisma.userIdentity.findMany({ where: { userId: user.id, status: "active" }, include: { org: true, anchorProfile: true } });
        const validIdentities = filterValidIdentities(identities);
        return ok(res, {
            token: makeJwt(user.id),
            user: safeUser(user),
            identities: validIdentities,
            recommendedIdentityId: recommendIdentityId(validIdentities, config),
        });
    }
    catch (err) {
        return fail(res, "FEISHU_LOGIN_FAILED", err instanceof Error ? err.message : "飞书登录失败", 400);
    }
});
authRoutes.post("/feishu/bind", authRequired, async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const statePayload = parseFeishuState(req.body?.state);
    if (!code)
        return fail(res, "FEISHU_CODE_REQUIRED", "缺少飞书授权 code", 400);
    if (!statePayload?.configId)
        return fail(res, "FEISHU_CONFIG_REQUIRED", "缺少飞书企业配置，请重新选择后绑定", 400);
    const config = await getFeishuConfigById(statePayload.configId);
    if (!requireFeishuConfig(config, res))
        return;
    try {
        const profile = await exchangeFeishuCode(config, code);
        if (!profile.open_id)
            return fail(res, "FEISHU_OPEN_ID_MISSING", "无法获取飞书 open_id", 400);
        const existed = await prisma.user.findFirst({
            where: {
                feishuConfigId: config.id,
                OR: [
                    { feishuOpenId: profile.open_id },
                    ...(profile.union_id ? [{ feishuUnionId: profile.union_id }] : []),
                ],
                NOT: { id: req.userId },
            },
        });
        if (existed)
            return fail(res, "FEISHU_ALREADY_BOUND", "该飞书账号已被其他系统账号绑定", 409);
        await prisma.user.update({
            where: { id: req.userId },
            data: {
                feishuConfigId: config.id,
                feishuOpenId: profile.open_id,
                feishuUnionId: profile.union_id,
                feishuName: profile.name,
                feishuAvatarUrl: profile.avatar_url,
                feishuBoundAt: new Date(),
            },
        });
        return ok(res, { bound: true });
    }
    catch (err) {
        return fail(res, "FEISHU_BIND_FAILED", err instanceof Error ? err.message : "飞书绑定失败", 400);
    }
});
authRoutes.delete("/feishu/bind", authRequired, async (req, res) => {
    try {
        await prisma.user.update({
            where: { id: req.userId },
            data: {
                feishuConfigId: null,
                feishuOpenId: null,
                feishuUnionId: null,
                feishuName: null,
                feishuAvatarUrl: null,
                feishuBoundAt: null,
            },
        });
        return ok(res, { bound: false });
    }
    catch (err) {
        return fail(res, "FEISHU_UNBIND_FAILED", err instanceof Error ? err.message : "飞书解绑失败", 500);
    }
});
authRoutes.post("/feishu/app-login", async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const configId = typeof req.body?.configId === "string" ? req.body.configId.trim() : "";
    if (!code)
        return fail(res, "FEISHU_CODE_REQUIRED", "缺少飞书临时授权码 code", 400);
    const config = await getFeishuConfigById(configId);
    if (!requireFeishuConfig(config, res))
        return;
    try {
        const profile = await exchangeFeishuJsapiCode(config, code);
        if (!profile.open_id)
            return fail(res, "FEISHU_OPEN_ID_MISSING", "无法获取飞书用户 open_id", 400);
        const user = await prisma.user.findFirst({
            where: {
                feishuConfigId: config.id,
                OR: [
                    { feishuOpenId: profile.open_id },
                    ...(profile.union_id ? [{ feishuUnionId: profile.union_id }] : []),
                ],
            },
        });
        if (!user)
            return fail(res, "FEISHU_UNBOUND", "该飞书账号尚未绑定系统账号，请先使用手机号密码登录后在设置页绑定飞书", 403);
        if (user.status === "disabled")
            return fail(res, "ACCOUNT_DISABLED", "账号已被停用", 403);
        if (user.status !== "active")
            return fail(res, "ACCOUNT_INACTIVE", "账号状态异常", 403);
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), feishuConfigId: config.id, feishuName: profile.name, feishuAvatarUrl: profile.avatar_url } });
        const identities = await prisma.userIdentity.findMany({ where: { userId: user.id, status: "active" }, include: { org: true, anchorProfile: true } });
        const validIdentities = filterValidIdentities(identities);
        const { passwordHash: _ph, ...safeU } = user;
        return ok(res, {
            token: makeJwt(user.id),
            user: safeU,
            identities: validIdentities,
            recommendedIdentityId: recommendIdentityId(validIdentities, config),
        });
    }
    catch (err) {
        return fail(res, "FEISHU_APP_LOGIN_FAILED", err instanceof Error ? err.message : "飞书免登失败", 500);
    }
});
authRoutes.post("/feishu/app-bind", authRequired, async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const configId = typeof req.body?.configId === "string" ? req.body.configId.trim() : "";
    if (!code)
        return fail(res, "FEISHU_CODE_REQUIRED", "缺少飞书临时授权码 code", 400);
    const config = await getFeishuConfigById(configId);
    if (!requireFeishuConfig(config, res))
        return;
    try {
        const profile = await exchangeFeishuJsapiCode(config, code);
        if (!profile.open_id)
            return fail(res, "FEISHU_OPEN_ID_MISSING", "无法获取飞书用户 open_id", 400);
        const existed = await prisma.user.findFirst({
            where: {
                feishuConfigId: config.id,
                OR: [
                    { feishuOpenId: profile.open_id },
                    ...(profile.union_id ? [{ feishuUnionId: profile.union_id }] : []),
                ],
                NOT: { id: req.userId },
            },
        });
        if (existed)
            return fail(res, "FEISHU_ALREADY_BOUND", "该飞书账号已被其他系统账号绑定", 409);
        await prisma.user.update({
            where: { id: req.userId },
            data: {
                feishuConfigId: config.id,
                feishuOpenId: profile.open_id,
                feishuUnionId: profile.union_id || undefined,
                feishuName: profile.name,
                feishuAvatarUrl: profile.avatar_url,
                feishuBoundAt: new Date(),
            },
        });
        return ok(res, { bound: true });
    }
    catch (err) {
        return fail(res, "FEISHU_APP_BIND_FAILED", normalizeFeishuAuthErrorMessage(err, "飞书绑定失败"), 500);
    }
});
