import { api } from "../../services/http";
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

  getApplications: (params: Record<string, string>) => {
    const urlParams = new URLSearchParams(params);
    const qs = urlParams.toString();
    return api.get<PaginatedResult<AnchorApplication>>(`/anchors/applications${qs ? `?${qs}` : ""}`);
  },

  getApplicationDetail: (id: string) => api.get<AnchorApplication>(`/anchors/applications/${id}`),

  updateProfile: (id: string, data: Partial<Anchor>) => api.patch<Anchor>(`/anchors/profiles/${id}`, data),

  deleteProfile: (id: string) => api.delete<{ deleted: boolean }>(`/anchors/profiles/${id}`),

  disableProfile: (id: string) => api.post<Anchor>(`/anchors/profiles/${id}/disable`),

  enableProfile: (id: string) => api.post<Anchor>(`/anchors/profiles/${id}/enable`),

  resetPassword: (userId: string) => api.post(`/accounts/${userId}/reset-password`),
};
