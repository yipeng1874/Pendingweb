import { api } from "./http";
import type { AuthPayload, Identity } from "../types";

export const authApi = {
  login: (phone: string, password: string) => api.post<AuthPayload>("/auth/login", { phone, password }),
  getFeishuBaseOptions: () => api.get<Array<{ id: string; name: string; orgType: string }>>("/auth/feishu/base-options"),
  getFeishuTeamOptions: (baseOrgId: string) => api.get<Array<{ id: string; name: string; orgType: string }>>(`/auth/feishu/team-options?baseOrgId=${encodeURIComponent(baseOrgId)}`),
  getFeishuConfigs: (baseOrgId: string, teamOrgId: string) => api.get<Array<{ id: string; name: string; baseOrg?: { name: string }; teamOrg?: { name: string } }>>(`/auth/feishu/configs?baseOrgId=${encodeURIComponent(baseOrgId)}&teamOrgId=${encodeURIComponent(teamOrgId)}`),
  getFeishuAppIds: () => api.get<Array<{ configId: string; appId: string }>>("/auth/feishu/app-ids"),
  completeFeishuLogin: (code: string, state: string) => api.post<AuthPayload>("/auth/feishu/complete-login", { code, state }),
  completeFeishuAppLogin: (code: string, configId: string) => api.post<AuthPayload>("/auth/feishu/app-login", { code, configId }),
  switchIdentity: (identityId: string) => api.post<{ identity: Identity | null }>("/identities/switch", { identityId }),
};
