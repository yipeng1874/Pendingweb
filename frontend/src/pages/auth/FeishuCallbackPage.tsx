import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request } from "../../services/http";
import { useAuthStore } from "../../stores/authStore";
import { useIdentityStore } from "../../stores/identityStore";
import type { Identity, RoleCode, User } from "../../types";

const ROLE_LEVEL: Record<RoleCode, number> = {
  DEV_ADMIN: 1,
  HQ_ADMIN: 2,
  BASE_ADMIN: 3,
  TEAM_ADMIN: 4,
  HALL_MANAGER: 5,
  ANCHOR: 6,
};

function pickBestIdentity(identities: Identity[]): Identity | null {
  if (!identities.length) return null;
  return [...identities].sort((a, b) => {
    const lvDiff = (ROLE_LEVEL[a.roleCode] ?? 99) - (ROLE_LEVEL[b.roleCode] ?? 99);
    if (lvDiff !== 0) return lvDiff;
    const aSwitch = a.lastSwitchedAt ? new Date(a.lastSwitchedAt).getTime() : 0;
    const bSwitch = b.lastSwitchedAt ? new Date(b.lastSwitchedAt).getTime() : 0;
    if (bSwitch !== aSwitch) return bSwitch - aSwitch;
    const aGrant = a.grantedAt ? new Date(a.grantedAt).getTime() : 0;
    const bGrant = b.grantedAt ? new Date(b.grantedAt).getTime() : 0;
    if (aGrant !== bGrant) return aGrant - bGrant;
    return a.id.localeCompare(b.id);
  })[0];
}

type FeishuCallbackAction = "login" | "bind";

type FeishuCallbackResult =
  | { type: "bind" }
  | { type: "login"; data: { token: string; user: User; identities: Identity[] } };

const inflightFeishuCallbacks = new Map<string, Promise<FeishuCallbackResult>>();

function parseCallbackAction(stateStr: string): FeishuCallbackAction {
  try {
    const stateObj = JSON.parse(stateStr) as { action?: string };
    return stateObj.action === "bind" ? "bind" : "login";
  } catch {
    return "login";
  }
}

function resolveBindToken(stateStr: string) {
  try {
    const stateObj = JSON.parse(stateStr) as { token?: string };
    if (typeof stateObj.token === "string" && stateObj.token) {
      sessionStorage.removeItem("feishu_bind_token");
      return stateObj.token;
    }
  } catch {
    // ignore invalid state payload
  }

  const tokenFromSession = sessionStorage.getItem("feishu_bind_token");
  if (tokenFromSession) {
    sessionStorage.removeItem("feishu_bind_token");
    return tokenFromSession;
  }

  sessionStorage.removeItem("feishu_bind_token");
  return useAuthStore.getState().token ?? null;
}

function getFriendlyFeishuErrorMessage(message: string) {
  if (/code has been used/i.test(message)) {
    return "飞书授权码已失效或已被使用，请返回后重新发起飞书授权。";
  }
  if (/authorization_code/i.test(message) && /(expired|invalid)/i.test(message)) {
    return "飞书授权码已过期，请返回后重新发起飞书授权。";
  }
  if (message.includes("Failed to fetch")) {
    return "网络异常，暂时无法完成飞书授权，请稍后重试。";
  }
  return message;
}

function runFeishuCallbackRequest(params: {
  action: FeishuCallbackAction;
  code: string;
  stateStr: string;
  bindToken: string | null;
}) {
  const requestKey = `${params.action}:${params.code}:${params.stateStr}`;
  const existingRequest = inflightFeishuCallbacks.get(requestKey);
  if (existingRequest) return existingRequest;

  const nextRequest = (params.action === "bind"
    ? request<{ bound: boolean }>("/auth/feishu/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.bindToken}` },
      body: JSON.stringify({ code: params.code, state: params.stateStr }),
    }).then(() => ({ type: "bind" } as const))
    : request<{ token: string; user: User; identities: Identity[] }>("/auth/feishu/complete-login", {
      method: "POST",
      body: JSON.stringify({ code: params.code, state: params.stateStr }),
    }).then((data) => ({ type: "login", data } as const)));

  inflightFeishuCallbacks.set(requestKey, nextRequest);
  void nextRequest.finally(() => {
    window.setTimeout(() => {
      inflightFeishuCallbacks.delete(requestKey);
    }, 60_000);
  });
  return nextRequest;
}

export function FeishuCallbackPage() {
  const [status, setStatus] = useState("正在处理飞书授权...");
  const [isError, setIsError] = useState(false);
  const setAuth = useAuthStore((state) => state.setAuth);
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") ?? "";
    const stateStr = params.get("state") ?? "{}";
    const errorParam = params.get("error") ?? "";
    const action = parseCallbackAction(stateStr);
    let redirectTimer: number | null = null;
    let cancelled = false;

    if (errorParam) {
      const msgMap: Record<string, string> = {
        unbound: "该飞书账号尚未绑定系统账号，请先用手机号密码登录，再到【账号设置】页绑定飞书。",
        feishu_already_bound: "该飞书账号已被其他系统账号绑定。",
        bind_requires_login: "绑定操作需要先登录。",
        bind_session_expired: "绑定会话已过期，请重新操作。",
        bind_token_invalid: "登录态已失效，请重新登录后再绑定。",
      };
      setIsError(true);
      setStatus(msgMap[errorParam] ?? `飞书授权失败：${errorParam}`);
      redirectTimer = window.setTimeout(() => navigate("/login", { replace: true }), 3000);
      return () => {
        cancelled = true;
        if (redirectTimer) window.clearTimeout(redirectTimer);
      };
    }

    if (!code) {
      setIsError(true);
      setStatus("缺少飞书授权 code，请重试");
      redirectTimer = window.setTimeout(() => navigate("/login", { replace: true }), 2000);
      return () => {
        cancelled = true;
        if (redirectTimer) window.clearTimeout(redirectTimer);
      };
    }

    const bindToken = action === "bind" ? resolveBindToken(stateStr) : null;
    if (action === "bind" && !bindToken) {
      setIsError(true);
      setStatus("绑定操作需要先登录，正在跳转...");
      redirectTimer = window.setTimeout(() => navigate("/login", { replace: true }), 2000);
      return () => {
        cancelled = true;
        if (redirectTimer) window.clearTimeout(redirectTimer);
      };
    }

    setIsError(false);
    setStatus(action === "bind" ? "正在绑定飞书账号，请稍候..." : "正在完成飞书登录，请稍候...");

    runFeishuCallbackRequest({ action, code, stateStr, bindToken })
      .then((result) => {
        if (cancelled) return;

        if (result.type === "bind") {
          setIsError(false);
          setStatus("飞书账号绑定成功，正在返回设置页...");
          redirectTimer = window.setTimeout(() => navigate("/settings", { replace: true }), 600);
          return;
        }

        setAuth({ token: result.data.token, user: result.data.user, identities: result.data.identities });
        const best = pickBestIdentity(result.data.identities);
        if (best) {
          setIdentity(best);
          navigate("/tasks/dashboard", { replace: true });
        } else {
          navigate("/identity", { replace: true });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = getFriendlyFeishuErrorMessage(err instanceof Error ? err.message : "飞书授权失败，请稍后重试");
        setIsError(true);
        setStatus(msg);
        if (action === "bind") {
          redirectTimer = window.setTimeout(() => navigate("/settings", { replace: true }), 2500);
          return;
        }
        if (msg.includes("尚未绑定") || msg.includes("请选择") || msg.includes("授权码")) {
          redirectTimer = window.setTimeout(() => navigate("/login", { replace: true }), 2500);
        }
      });

    return () => {
      cancelled = true;
      if (redirectTimer) window.clearTimeout(redirectTimer);
    };
  }, [navigate, setAuth, setIdentity]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10">
      <div className="feishu-panel w-full max-w-md p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${isError ? "bg-red-50 text-red-500" : "bg-feishu-pale text-feishu-blue"}`}>
          {isError ? (
            <span className="text-2xl font-semibold">!</span>
          ) : (
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-feishu-blue border-t-transparent" />
          )}
        </div>
        <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.03em] text-slate-950">飞书授权处理中</h1>
        <p className={`mt-3 text-sm leading-6 ${isError ? "text-red-500" : "text-slate-500"}`}>{status}</p>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          {isError ? "系统将自动返回上一页，你也可以稍后重新发起飞书授权。" : "请勿关闭当前页面，系统正在校验飞书授权结果。"}
        </p>
      </div>
    </div>
  );
}

