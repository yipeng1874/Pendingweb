import { api } from "../../services/http";
import { useAuthStore } from "../../stores/authStore";
import { useIdentityStore } from "../../stores/identityStore";
import type { AnchorApplication, OrgUnit, PaginatedResult } from "../../types";
import type { Anchor } from "./types";

export const anchorApi = {
  getHalls: () => api.get<OrgUnit[]>("/anchors/halls"),

  getOrgChildren: (params: Record<string, string>) => {
    const urlParams = new URLSearchParams(params);
    const qs = urlParams.toString();
    return api.get<OrgUnit[]>(`/anchors/org-children${qs ? `?${qs}` : ""}`);
  },

  getProfiles: (params: Record<string, string>) => {
    const urlParams = new URLSearchParams(params);
    const qs = urlParams.toString();
    return api.get<PaginatedResult<Anchor>>(`/anchors/profiles${qs ? `?${qs}` : ""}`);
  },

  getProfileDetail: (id: string) => api.get<Anchor>(`/anchors/profiles/${id}`),

  exportProfiles: (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return api.get<Array<{
      identityType: string;
      baseName: string; baseCode: string;
      teamName: string; teamCode: string;
      hallName: string; hallDouyinUid: string;
      nickname: string; phone: string;
      douyinNo: string; douyinUid: string;
      profileStatus: string;
    }>>(`/anchors/profiles/export${qs ? `?${qs}` : ""}`);
  },

  // 异步导出任务
  createExportTask: (params: { orgId: string; keyword?: string; status?: string; viewMode?: "current" | "history" }) =>
    api.post<{ taskId: string; expiresAt: string }>("/anchors/export-tasks", params),

  listExportTasks: () =>
    api.get<Array<{
      id: string;
      status: "pending" | "processing" | "done" | "failed";
      rowCount: number | null;
      filePath: string | null;
      errorMsg: string | null;
      createdAt: string;
      expiresAt: string;
      params: Record<string, string>;
    }>>("/anchors/export-tasks"),

  downloadExportTaskFile: async (id: string, filename: string) => {
    const token = useAuthStore.getState().token;
    const identityId = useIdentityStore.getState().currentIdentity?.id;
    const res = await fetch(`/api/anchors/export-tasks/${id}/file`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(identityId ? { "X-Identity-Id": identityId } : {}),
      },
    });
    if (!res.ok) throw new Error("文件下载失败，请重试");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  getApplications: (params: Record<string, string>) => {
    const urlParams = new URLSearchParams(params);
    const qs = urlParams.toString();
    return api.get<PaginatedResult<AnchorApplication>>(`/anchors/applications${qs ? `?${qs}` : ""}`);
  },

  getApplicationDetail: (id: string) => api.get<AnchorApplication>(`/anchors/applications/${id}`),

  updateProfile: (id: string, data: Partial<Anchor>) => api.patch<Anchor>(`/anchors/profiles/${id}`, data),

  migrateProfile: (id: string, data: { targetHallOrgId: string; reason?: string }) =>
    api.post<{ archivedProfileId: string; archivedIdentityId: string; profile: Anchor; identity: { id: string; orgId: string; anchorProfileId: string } }>(`/anchors/profiles/${id}/migrate`, data),

  deleteProfile: (id: string) => api.delete<{ deleted: boolean }>(`/anchors/profiles/${id}`),

  disableProfile: (id: string) => api.post<Anchor>(`/anchors/profiles/${id}/disable`),

  enableProfile: (id: string) => api.post<Anchor>(`/anchors/profiles/${id}/enable`),

  resetPassword: (userId: string) => api.post(`/accounts/${userId}/reset-password`),
};
