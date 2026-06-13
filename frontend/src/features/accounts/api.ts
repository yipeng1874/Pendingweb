import { api } from "../../services/http";
import type { Identity, PaginatedResult, RoleCode } from "../../types";
import type { Account, SearchAccount } from "./types";

type AccountSearchOptions = {
  scopeOrgId?: string;
  ids?: string[];
};

type AccountListResponse<T> = T[] | PaginatedResult<T>;

function buildSearchQuery(keyword: string, options?: AccountSearchOptions) {
  const params = new URLSearchParams();
  if (keyword.trim()) params.set("keyword", keyword.trim());
  if (options?.scopeOrgId) params.set("scopeOrgId", options.scopeOrgId);
  if (options?.ids?.length) params.set("ids", options.ids.join(","));
  return params.toString();
}

function unwrapAccountList<T>(result: AccountListResponse<T>) {
  return Array.isArray(result) ? result : result.items;
}

export const accountApi = {
  getAccounts: async (params: URLSearchParams) => unwrapAccountList(await api.get<AccountListResponse<Account>>(`/accounts?${params.toString()}`)),
  searchAccounts: async (keyword: string, options?: AccountSearchOptions) => unwrapAccountList(await api.get<AccountListResponse<SearchAccount>>(`/accounts/search?${buildSearchQuery(keyword, options)}`)),
  getAccountsByIds: async (ids: string[], options?: Pick<AccountSearchOptions, "scopeOrgId">) => unwrapAccountList(await api.get<AccountListResponse<SearchAccount>>(`/accounts/search?${buildSearchQuery("", { ...options, ids })}`)),
  grantIdentity: (userId: string, payload: { roleCode: RoleCode; orgId: string }) => api.post<Identity>(`/accounts/${userId}/identities`, payload),
  toggleIdentity: (identityId: string, action: "pause" | "restore") => api.post<Identity>(`/identities/${identityId}/${action}`),
  deleteIdentity: (identityId: string) => api.delete<{ deleted: boolean }>(`/identities/${identityId}`),
};
