import type { ApiResponse } from "../types";
import { useAuthStore } from "../stores/auth";

export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const { token, currentIdentity } = useAuthStore.getState();
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(currentIdentity?.id ? { "X-Identity-Id": currentIdentity.id } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let body: ApiResponse<T>;
  try {
    body = text ? JSON.parse(text) as ApiResponse<T> : { success: false, error: { code: "EMPTY_RESPONSE", message: "服务响应为空" } };
  } catch {
    throw new Error(`服务响应不是有效 JSON：${text ? text.slice(0, 120) : "空响应"}`);
  }
  if (!response.ok || !body.success) {
    throw new Error(body.error?.message ?? "请求失败");
  }
  return body.data as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, data?: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(data ?? {}) }),
  patch: <T>(url: string, data?: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(data ?? {}) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
