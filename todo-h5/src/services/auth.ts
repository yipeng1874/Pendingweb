import { api } from "./http";
import type { Identity, User } from "../types";

export const authApi = {
  login: (phone: string, password: string) => api.post<{ token: string; user: User; identities: Identity[] }>("/auth/login", { phone, password }),
  getFeishuBaseOptions: () => api.get<Array<{ id: string; name: string; orgType: string }>>("/auth/feishu/base-options"),
  getFeishuTeamOptions: (baseOrgId: string) => api.get<Array<{ id: string; name: string; orgType: string }>>(`/auth/feishu/team-options?baseOrgId=${encodeURIComponent(baseOrgId)}`),
  getFeishuConfigs: (baseOrgId: string, teamOrgId: string) => api.get<Array<{ id: string; name: string; baseOrg?: { name: string }; teamOrg?: { name: string } }>>(`/auth/feishu/configs?baseOrgId=${encodeURIComponent(baseOrgId)}&teamOrgId=${encodeURIComponent(teamOrgId)}`),
  completeFeishuLogin: (code: string, state: string) => api.post<{ token: string; user: User; identities: Identity[] }>("/auth/feishu/complete-login", { code, state }),
};
