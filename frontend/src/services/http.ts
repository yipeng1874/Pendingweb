import type { ApiResponse } from "../types";
import { useAuthStore } from "../stores/authStore";
import { useIdentityStore } from "../stores/identityStore";
import { isInFeishuApp } from "../shared/utils/feishu";

export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const identityId = useIdentityStore.getState().currentIdentity?.id;
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(identityId ? { "X-Identity-Id": identityId } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    console.error("[api-network-error]", { url, error });
    throw new Error("无法连接后端服务，请确认服务已启动后重试");
  }
  const text = await response.text();
  let body: ApiResponse<T>;
  try {
    body = text ? JSON.parse(text) as ApiResponse<T> : { success: false, error: { code: "EMPTY_RESPONSE", message: "服务响应为空，请确认前端代理和后端服务已重启" } };
  } catch {
    console.error(text || "响应内容为空");
    throw new Error(`服务响应不是有效 JSON：${text ? text.slice(0, 120) : "空响应"}`);
  }
  if (response.status === 401 && !url.includes("/auth/login")) {
    useAuthStore.getState().logout();
    const feishuAppId = localStorage.getItem("feishu_entry_app_id");
    if (feishuAppId && isInFeishuApp()) {
      // 飞书环境：整页刷新跳回入口，触发重新免登
      window.location.href = `/feishu-entry?appId=${feishuAppId}`;
    } else {
      window.location.href = "/login";
    }
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok || !body.success) {
    const errorCode = body.error?.code;
    console.error(body.error?.message ?? "请求失败");
    const error = new Error(body.error?.message ?? "请求失败") as Error & { responseBody?: ApiResponse<T> };

    // ORG_PAUSED / IDENTITY_REQUIRED：触发重新获取身份列表，可能清空当前身份
    if (errorCode === "ORG_PAUSED" || errorCode === "IDENTITY_REQUIRED") {
      // 清除 localStorage 中可能残留的无效身份
      useIdentityStore.getState().setIdentity(null as any);
      // 非登录接口才做重定向，避免登录本身触发循环
      if (!url.includes("/auth/login")) {
        const feishuAppId = localStorage.getItem("feishu_entry_app_id");
        if (feishuAppId && isInFeishuApp()) {
          window.location.href = `/feishu-entry?appId=${feishuAppId}`;
        } else {
          window.location.href = "/login";
        }
      }
    }

    error.responseBody = body;
    throw error;
  }
  return body.data as T;
}

export async function requestForm<T>(url: string, formData: FormData): Promise<T> {
  const token = useAuthStore.getState().token;
  const identityId = useIdentityStore.getState().currentIdentity?.id;
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      method: "POST",
      body: formData,
      headers: {
        // 不设置 Content-Type，让浏览器自动加 multipart boundary
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(identityId ? { "X-Identity-Id": identityId } : {}),
      },
    });
  } catch (error) {
    console.error("[api-network-error]", { url, error });
    throw new Error("无法连接后端服务，请确认服务已启动后重试");
  }
  const text = await response.text();
  let body: ApiResponse<T>;
  try {
    body = text ? JSON.parse(text) as ApiResponse<T> : { success: false, error: { code: "EMPTY_RESPONSE", message: "服务响应为空" } };
  } catch {
    throw new Error(`服务响应不是有效 JSON：${text ? text.slice(0, 120) : "空响应"}`);
  }
  if (!response.ok || !body.success) {
    const errorCode = body.error?.code;
    const error = new Error(body.error?.message ?? "请求失败") as Error & { responseBody?: ApiResponse<T> };

    if (errorCode === "ORG_PAUSED" || errorCode === "IDENTITY_REQUIRED") {
      const feishuAppId = localStorage.getItem("feishu_entry_app_id");
      if (feishuAppId && isInFeishuApp()) {
        window.location.href = `/feishu-entry?appId=${feishuAppId}`;
      } else {
        window.location.href = "/login";
      }
    }

    error.responseBody = body;
    throw error;
  }
  return body.data as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, data?: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(data ?? {}) }),
  put: <T>(url: string, data?: unknown) => request<T>(url, { method: "PUT", body: JSON.stringify(data ?? {}) }),
  patch: <T>(url: string, data?: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(data ?? {}) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  postForm: <T>(url: string, formData: FormData) => requestForm<T>(url, formData),
};
