import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { authRequired } from "../../middleware/authRequired.js";
import { ok, fail } from "../../shared/response.js";
import { prisma } from "../../shared/prisma.js";

export const authRoutes = Router();

type FeishuAction = "login" | "bind";

type FeishuClient = "pc" | "h5";

type FeishuStatePayload = {
  action: FeishuAction;
  client: FeishuClient;
  configId: string;
  nonce: string;
  token?: string;
};

type FeishuProfile = {
  open_id: string;
  union_id: string;
  name: string;
  avatar_url: string;
};

type FeishuOrgOption = {
  id: string;
  name: string;
  orgCode: string;
  orgType: string;
};

type FeishuConfigRecord = {
  id: string;
  name: string;
  appId: string;
  appSecret: string;
  baseOrgId: string;
  teamOrgId: string;
  status: string;
  baseOrg: FeishuOrgOption;
  teamOrg: FeishuOrgOption;
};

function safeUser<T extends { passwordHash?: string }>(user: T) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

function makeJwt(userId: string) {
  return jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
}

function getFeishuConfigDelegate() {
  return (prisma as any).feishuEnterpriseConfig as {
    findFirst: (args: unknown) => Promise<FeishuConfigRecord | null>;
    findMany: (args: unknown) => Promise<FeishuConfigRecord[]>;
  } | undefined;
}

function dedupeFeishuOrgOptions(items: Array<FeishuOrgOption | null | undefined>) {
  const uniqueOptions = new Map<string, FeishuOrgOption>();
  for (const item of items) {
    if (!item?.id) continue;
    if (!uniqueOptions.has(item.id)) {
      uniqueOptions.set(item.id, item);
    }
  }
  return Array.from(uniqueOptions.values());
}

function normalizeFeishuAuthErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function getFeishuConfigById(configId: string): Promise<FeishuConfigRecord | null> {
  if (!configId) return null;
  const delegate = getFeishuConfigDelegate();
  if (!delegate) return null;
  return delegate.findFirst({
    where: { id: configId, status: "active" },
    include: {
      baseOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
      teamOrg: { select: { id: true, name: true, orgCode: true, orgType: true } },
    },
  });
}

function getFeishuRedirectUri(client: FeishuClient) {
  const redirectUri = client === "h5"
    ? (process.env.FEISHU_REDIRECT_URI_H5 || env.FEISHU_REDIRECT_URI)
    : (process.env.FEISHU_REDIRECT_URI_PC || env.FEISHU_REDIRECT_URI);

  if (!redirectUri) {
    throw new Error(`系统未配置 ${client.toUpperCase()} 飞书回调地址`);
  }
  return redirectUri;
}

function requireFeishuConfig(config: FeishuConfigRecord | null, res: Parameters<typeof fail>[0], client: FeishuClient = "pc"): config is FeishuConfigRecord {
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
  } catch {
    fail(res, "FEISHU_REDIRECT_NOT_CONFIGURED", `系统未配置 ${client.toUpperCase()} 飞书回调地址`, 500);
    return false;
  }
  return true;
}

function feishuAuthorizeUrl(config: FeishuConfigRecord, state: string, client: FeishuClient) {
  const url = new URL("https://open.feishu.cn/open-apis/authen/v1/index");
  url.searchParams.set("app_id", config.appId);
  url.searchParams.set("redirect_uri", getFeishuRedirectUri(client));
  url.searchParams.set("state", state);
  return url.toString();
}

function feishuState(action: FeishuAction, configId: string, client: FeishuClient, token?: string) {
  return JSON.stringify({ action, client, configId, nonce: randomUUID(), ...(token ? { token } : {}) } satisfies FeishuStatePayload);
}

function parseFeishuState(raw: unknown): FeishuStatePayload | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FeishuStatePayload>;
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
  } catch {
    return null;
  }
}

async function getFeishuAppAccessToken(config: FeishuConfigRecord): Promise<string> {
  const appTokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  const appTokenJson = await appTokenResp.json() as any;
  if (appTokenJson.code !== 0) throw new Error(appTokenJson.msg || "获取飞书 app_access_token 失败");
  return appTokenJson.app_access_token as string;
}

async function exchangeFeishuCode(config: FeishuConfigRecord, code: string): Promise<FeishuProfile> {
  const appAccessToken = await getFeishuAppAccessToken(config);
  const tokenResp = await fetch("https://open.feishu.cn/open-apis/authen/v1/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${appAccessToken}` },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const tokenJson = await tokenResp.json() as any;
  if (tokenJson.code !== 0) throw new Error(tokenJson.msg || "飞书授权失败");
  return {
    open_id: tokenJson.data?.open_id as string ?? "",
    union_id: tokenJson.data?.union_id as string ?? "",
    name: tokenJson.data?.name as string ?? "",
    avatar_url: tokenJson.data?.avatar_url as string ?? "",
  };
}

async function exchangeFeishuJsapiCode(config: FeishuConfigRecord, code: string): Promise<FeishuProfile> {
  const appAccessToken = await getFeishuAppAccessToken(config);
  const userTokenResp = await fetch("https://open.feishu.cn/open-apis/authen/v1/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${appAccessToken}` },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const userTokenJson = await userTokenResp.json() as any;
  if (userTokenJson.code !== 0) throw new Error(userTokenJson.msg || "飞书授权码无效或已过期");

  return {
    open_id: userTokenJson.data?.open_id as string ?? "",
    union_id: userTokenJson.data?.union_id as string ?? "",
    name: userTokenJson.data?.name as string ?? "",
    avatar_url: userTokenJson.data?.avatar_url as string ?? "",
  };
}

// GET /feishu/app-ids
// 返回所有 active 飞书企业的 configId + appId（appId 是飞书公开标识，不含 appSecret）
// 供飞书客户端内并行竞速 tt.requestAccess，自动识别当前用户所属企业
authRoutes.get("/feishu/app-ids", async (_req, res) => {
  const delegate = getFeishuConfigDelegate();
  if (!delegate) return ok(res, []);
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
  if (!baseOrgId) return fail(res, "FEISHU_BASE_REQUIRED", "请选择基地后再加载团队", 400);

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
  const { phone, password } = req.body as { phone?: string; password?: string };
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
  const identities = await prisma.userIdentity.findMany({ where: { userId: user.id, status: "active" }, include: { org: true, anchorProfile: true } });
  const token = makeJwt(user.id);
  return ok(res, { token, user: safeUser(user), identities });
});

authRoutes.post("/change-password", authRequired, async (req, res) => {
  const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
  if (!oldPassword || !newPassword) return fail(res, "PASSWORD_REQUIRED", "请填写旧密码和新密码", 400);
  if (newPassword.length < 8) return fail(res, "PASSWORD_TOO_SHORT", "新密码至少 8 位", 400);
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return fail(res, "ACCOUNT_NOT_FOUND", "账号不存在", 404);
  const valid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!valid) return fail(res, "PASSWORD_INCORRECT", "旧密码错误", 400);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false } });
  return ok(res, { changed: true });
});

let cachedTickets = new Map<string, { ticket: string; expiresAt: number }>();

async function getJsapiTicket(config: FeishuConfigRecord): Promise<string> {
  const cached = cachedTickets.get(config.id);
  if (cached && Date.now() < cached.expiresAt) return cached.ticket;

  const appAccessToken = await getFeishuAppAccessToken(config);
  const ticketResp = await fetch("https://open.feishu.cn/open-apis/jssdk/ticket/get", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${appAccessToken}` },
    body: JSON.stringify({}),
  });
  const ticketJson = await ticketResp.json() as any;
  if (ticketJson.code !== 0) throw new Error(ticketJson.msg || "获取 jsapi_ticket 失败");

  const ticket = ticketJson.data?.ticket as string;
  const expiresAt = Date.now() + (ticketJson.data?.expire_in ?? 7200) * 1000 - 60_000;
  cachedTickets.set(config.id, { ticket, expiresAt });
  return ticket;
}

function sha1(str: string) {
  return createHash("sha1").update(str).digest("hex");
}

authRoutes.get("/feishu/jssdk-config", async (req, res) => {
  const pageUrl = typeof req.query.url === "string" ? req.query.url : "";
  const configId = typeof req.query.configId === "string" ? req.query.configId : "";
  if (!pageUrl) return fail(res, "URL_REQUIRED", "缺少 url 参数", 400);

  const config = await getFeishuConfigById(configId);
  if (!requireFeishuConfig(config, res)) return;

  try {
    const ticket = await getJsapiTicket(config);
    const nonceStr = randomBytes(8).toString("hex");
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sha1(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${pageUrl}`);
    return ok(res, { appId: config.appId, timestamp, nonceStr, signature, configId: config.id });
  } catch (err) {
    return fail(res, "JSSDK_CONFIG_FAILED", err instanceof Error ? err.message : "获取 JSSDK 配置失败", 500);
  }
});

authRoutes.get("/feishu/login", async (req, res) => {
  const action: FeishuAction = req.query.action === "bind" ? "bind" : "login";
  const client: FeishuClient = req.query.client === "h5" ? "h5" : "pc";
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  const configId = typeof req.query.configId === "string" ? req.query.configId : "";
  const config = await getFeishuConfigById(configId);
  if (!requireFeishuConfig(config, res, client)) return;
  const state = feishuState(action, config.id, client, token);
  return res.redirect(feishuAuthorizeUrl(config, state, client));
});

authRoutes.post("/feishu/complete-login", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const statePayload = parseFeishuState(req.body?.state);
  if (!code) return fail(res, "FEISHU_CODE_REQUIRED", "缺少飞书授权 code", 400);
  if (!statePayload?.configId) return fail(res, "FEISHU_CONFIG_REQUIRED", "缺少飞书企业配置，请重新选择后登录", 400);

  const config = await getFeishuConfigById(statePayload.configId);
  if (!requireFeishuConfig(config, res)) return;

  try {
    const profile = await exchangeFeishuCode(config, code);
    const user = await prisma.user.findFirst({
      where: {
        feishuConfigId: config.id,
        OR: [
          profile.union_id ? { feishuUnionId: profile.union_id } : undefined,
          profile.open_id ? { feishuOpenId: profile.open_id } : undefined,
        ].filter(Boolean) as any,
      },
    });
    if (!user) return fail(res, "FEISHU_UNBOUND", "该飞书账号尚未绑定系统账号，请先登录系统完成绑定", 403);
    if (user.status === "disabled") return fail(res, "ACCOUNT_DISABLED", "账号已被停用", 403);
    if (user.status !== "active") return fail(res, "ACCOUNT_INACTIVE", "账号状态异常", 403);

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
    return ok(res, { token: makeJwt(user.id), user: safeUser(user), identities });
  } catch (err) {
    return fail(res, "FEISHU_LOGIN_FAILED", err instanceof Error ? err.message : "飞书登录失败", 400);
  }
});

authRoutes.post("/feishu/bind", authRequired, async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const statePayload = parseFeishuState(req.body?.state);
  if (!code) return fail(res, "FEISHU_CODE_REQUIRED", "缺少飞书授权 code", 400);
  if (!statePayload?.configId) return fail(res, "FEISHU_CONFIG_REQUIRED", "缺少飞书企业配置，请重新选择后绑定", 400);

  const config = await getFeishuConfigById(statePayload.configId);
  if (!requireFeishuConfig(config, res)) return;

  try {
    const profile = await exchangeFeishuCode(config, code);
    if (!profile.open_id) return fail(res, "FEISHU_OPEN_ID_MISSING", "无法获取飞书 open_id", 400);
    const existed = await prisma.user.findFirst({
      where: {
        feishuConfigId: config.id,
        OR: [
          { feishuOpenId: profile.open_id },
          ...(profile.union_id ? [{ feishuUnionId: profile.union_id }] : []),
        ],
        NOT: { id: req.userId! },
      },
    });
    if (existed) return fail(res, "FEISHU_ALREADY_BOUND", "该飞书账号已被其他系统账号绑定", 409);

    await prisma.user.update({
      where: { id: req.userId! },
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
  } catch (err) {
    return fail(res, "FEISHU_BIND_FAILED", err instanceof Error ? err.message : "飞书绑定失败", 400);
  }
});

authRoutes.delete("/feishu/bind", authRequired, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.userId! },
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
  } catch (err) {
    return fail(res, "FEISHU_UNBIND_FAILED", err instanceof Error ? err.message : "飞书解绑失败", 500);
  }
});

authRoutes.post("/feishu/app-login", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const configId = typeof req.body?.configId === "string" ? req.body.configId.trim() : "";
  if (!code) return fail(res, "FEISHU_CODE_REQUIRED", "缺少飞书临时授权码 code", 400);
  const config = await getFeishuConfigById(configId);
  if (!requireFeishuConfig(config, res)) return;

  try {
    const profile = await exchangeFeishuJsapiCode(config, code);
    if (!profile.open_id) return fail(res, "FEISHU_OPEN_ID_MISSING", "无法获取飞书用户 open_id", 400);

    const user = await prisma.user.findFirst({
      where: {
        feishuConfigId: config.id,
        OR: [
          { feishuOpenId: profile.open_id },
          ...(profile.union_id ? [{ feishuUnionId: profile.union_id }] : []),
        ],
      },
    });
    if (!user) return fail(res, "FEISHU_UNBOUND", "该飞书账号尚未绑定系统账号，请先使用手机号密码登录后在设置页绑定飞书", 403);
    if (user.status === "disabled") return fail(res, "ACCOUNT_DISABLED", "账号已被停用", 403);
    if (user.status !== "active") return fail(res, "ACCOUNT_INACTIVE", "账号状态异常", 403);

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), feishuConfigId: config.id, feishuName: profile.name, feishuAvatarUrl: profile.avatar_url } });
    const identities = await prisma.userIdentity.findMany({ where: { userId: user.id, status: "active" }, include: { org: true, anchorProfile: true } });
    const { passwordHash: _ph, ...safeU } = user as any;
    return ok(res, { token: makeJwt(user.id), user: safeU, identities });
  } catch (err) {
    return fail(res, "FEISHU_APP_LOGIN_FAILED", err instanceof Error ? err.message : "飞书免登失败", 500);
  }
});

authRoutes.post("/feishu/app-bind", authRequired, async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const configId = typeof req.body?.configId === "string" ? req.body.configId.trim() : "";
  if (!code) return fail(res, "FEISHU_CODE_REQUIRED", "缺少飞书临时授权码 code", 400);
  const config = await getFeishuConfigById(configId);
  if (!requireFeishuConfig(config, res)) return;

  try {
    const profile = await exchangeFeishuJsapiCode(config, code);
    if (!profile.open_id) return fail(res, "FEISHU_OPEN_ID_MISSING", "无法获取飞书用户 open_id", 400);

    const existed = await prisma.user.findFirst({
      where: {
        feishuConfigId: config.id,
        OR: [
          { feishuOpenId: profile.open_id },
          ...(profile.union_id ? [{ feishuUnionId: profile.union_id }] : []),
        ],
        NOT: { id: req.userId! },
      },
    });
    if (existed) return fail(res, "FEISHU_ALREADY_BOUND", "该飞书账号已被其他系统账号绑定", 409);

    await prisma.user.update({
      where: { id: req.userId! },
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
  } catch (err) {
    return fail(res, "FEISHU_APP_BIND_FAILED", normalizeFeishuAuthErrorMessage(err, "飞书绑定失败"), 500);
  }
});
