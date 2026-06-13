import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Search, UserRoundPlus } from "lucide-react";
import { api } from "../../services/http";
import type { Identity, OrgUnit, PaginatedResult, RoleCode } from "../../types";
import {
  getDisplayAccountNickname,
  grantManagementIdentity,
  isManagementIdentity,
  isRoleVisibleForOrg,
  orgTypeLabelMap,
  roleOptions,
  roleLabelMap,
} from "./accountsTypes";
import type { Account, ConflictDetail, ViewMode } from "./accountsTypes";
import { OrgTree } from "../../shared/components/tree/OrgTree";
import { ORG_TREE_SIDEBAR_WIDTH } from "../../shared/constants/layout";
import { GrantModal } from "./GrantModal";
import { AccountDrawer } from "./AccountDrawer";
import { buildOrgTree, getDefaultExpandedOrgIds, getDefaultSelectedOrgId } from "../../shared/utils/orgTree";
import { useIdentityStore } from "../../stores/identityStore";

function collectAncestorOrgIds(orgs: OrgUnit[], orgId: string) {
  const ancestors = new Set<string>();
  const orgMap = new Map(orgs.map((org) => [org.id, org]));
  let current = orgMap.get(orgId);

  while (current?.parentId) {
    ancestors.add(current.parentId);
    current = orgMap.get(current.parentId);
  }

  return ancestors;
}

type ConfirmationState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger" | "primary";
  onConfirm: () => Promise<void> | void;
} | null;

export function AccountsPage() {
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const [viewMode, setViewMode] = useState<ViewMode>("by-org");
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [orgKeyword, setOrgKeyword] = useState("");
  const [accountPage, setAccountPage] = useState(1);
  const [accountTotal, setAccountTotal] = useState(0);
  const [loadedOrgIds, setLoadedOrgIds] = useState<Set<string>>(new Set());
  const [loadingOrgIds, setLoadingOrgIds] = useState<Set<string>>(new Set());
  const [activeAccountId, setActiveAccountId] = useState("");
  const [activeAccountDetail, setActiveAccountDetail] = useState<Account | undefined>();
  const [isAccountDetailLoading, setIsAccountDetailLoading] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);

  const [globalSearchKeyword, setGlobalSearchKeyword] = useState("");
  const [globalAccounts, setGlobalAccounts] = useState<Account[]>([]);
  const [selectedGlobalAccountId, setSelectedGlobalAccountId] = useState("");
  const [globalPage, setGlobalPage] = useState(1);
  const [globalTotal, setGlobalTotal] = useState(0);

  const orgSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitializedCollapsedIdsRef = useRef(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const orgTree = useMemo(() => buildOrgTree(orgs), [orgs]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const selectedOrg = useMemo(() => orgs.find((item) => item.id === selectedOrgId), [orgs, selectedOrgId]);
  const activeAccount = useMemo(() => accounts.find((a) => a.id === activeAccountId), [accounts, activeAccountId]);
  const selectedGlobalAccount = useMemo(() => globalAccounts.find((item) => item.id === selectedGlobalAccountId), [globalAccounts, selectedGlobalAccountId]);

  useEffect(() => {
    document.body.style.overflow = activeAccountId ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [activeAccountId]);

  useEffect(() => { void loadOrgs(); }, [currentIdentity?.id]);

  useEffect(() => {
    if (!orgs.length || hasInitializedCollapsedIdsRef.current) return;
    const expandedIds = getDefaultExpandedOrgIds(orgs, currentIdentity);
    const nextCollapsedIds = new Set<string>();
    orgs.filter((org) => orgs.some((item) => item.parentId === org.id)).forEach((org) => {
      if (!expandedIds.has(org.id)) nextCollapsedIds.add(org.id);
    });
    setCollapsedIds(nextCollapsedIds);
    hasInitializedCollapsedIdsRef.current = true;
  }, [currentIdentity, orgs]);

  useEffect(() => {
    if (!selectedOrgId) {
      setAccounts([]);
      setAccountTotal(0);
      setActiveAccountId("");
      setActiveAccountDetail(undefined);
      setIsAccountDetailLoading(false);
      setShowGrantModal(false);
      return;
    }
    void loadAccounts(selectedOrgId, orgKeyword, accountPage);
  }, [selectedOrgId, accountPage]);

  useEffect(() => {
    if (!selectedOrgId) return;
    if (orgSearchTimerRef.current) clearTimeout(orgSearchTimerRef.current);
    orgSearchTimerRef.current = setTimeout(() => {
      setAccountPage(1);
      void loadAccounts(selectedOrgId, orgKeyword, 1);
    }, 300);
    return () => {
      if (orgSearchTimerRef.current) clearTimeout(orgSearchTimerRef.current);
    };
  }, [orgKeyword, selectedOrgId]);

  useEffect(() => {
    if (!globalSearchKeyword.trim()) {
      setGlobalAccounts([]);
      setGlobalTotal(0);
      setSelectedGlobalAccountId("");
      return;
    }
    if (globalSearchTimerRef.current) clearTimeout(globalSearchTimerRef.current);
    globalSearchTimerRef.current = setTimeout(() => {
      setGlobalPage(1);
      void searchGlobalAccounts(1, globalSearchKeyword);
    }, 300);
    return () => {
      if (globalSearchTimerRef.current) clearTimeout(globalSearchTimerRef.current);
    };
  }, [globalSearchKeyword]);

  async function fetchOrgChildren(parentId: string) {
    return api.get<OrgUnit[]>(`/orgs/children?parentId=${encodeURIComponent(parentId)}`);
  }

  async function loadOrgs() {
    try {
      const result = await api.get<OrgUnit[]>("/orgs/children");
      const scopeRootId = getDefaultSelectedOrgId(result, currentIdentity);
      const scopeRoot = result.find((item) => item.id === scopeRootId);
      let nextOrgs = result;
      const nextLoadedOrgIds = new Set([""]);

      if (scopeRoot?.hasChildren) {
        const children = await fetchOrgChildren(scopeRoot.id);
        nextOrgs = Array.from(new Map([...result, ...children].map((item) => [item.id, item])).values());
        nextLoadedOrgIds.add(scopeRoot.id);
      }

      hasInitializedCollapsedIdsRef.current = false;
      setOrgs(nextOrgs);
      setLoadedOrgIds(nextLoadedOrgIds);
      setLoadingOrgIds(new Set());
      setSelectedOrgId("");
      setAccountPage(1);
      setActiveAccountId("");
      setActiveAccountDetail(undefined);
      setShowGrantModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "组织加载失败");
    }
  }

  async function loadOrgChildren(parentId: string) {
    if (loadedOrgIds.has(parentId) || loadingOrgIds.has(parentId)) return;
    setLoadingOrgIds((previous) => new Set(previous).add(parentId));
    try {
      const result = await fetchOrgChildren(parentId);
      setOrgs((previous) => {
        const next = new Map(previous.map((item) => [item.id, item]));
        for (const item of result) next.set(item.id, item);
        return Array.from(next.values());
      });
      setLoadedOrgIds((previous) => new Set(previous).add(parentId));
    } finally {
      setLoadingOrgIds((previous) => {
        const next = new Set(previous);
        next.delete(parentId);
        return next;
      });
    }
  }

  function expandOrgPath(orgId: string) {
    const ancestorIds = collectAncestorOrgIds(orgs, orgId);
    setCollapsedIds((previous) => {
      if (!ancestorIds.size) return previous;
      const next = new Set(previous);
      let changed = false;
      ancestorIds.forEach((ancestorId) => {
        if (next.delete(ancestorId)) changed = true;
      });
      return changed ? next : previous;
    });
  }

  function handleSelectOrg(orgId: string) {
    setSelectedOrgId(orgId);
    setAccountPage(1);
    expandOrgPath(orgId);
    void loadOrgChildren(orgId);
  }

  async function loadAccounts(orgId: string, keyword = "", page = 1) {
    try {
      const params = new URLSearchParams();
      params.set("orgId", orgId);
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (keyword.trim()) params.set("keyword", keyword.trim());
      const result = await api.get<PaginatedResult<Account>>(`/accounts?${params.toString()}`);
      const org = orgs.find((o) => o.id === orgId);
      const filtered = result.items
        .map((account) => ({
          ...account,
          identities: account.identities.filter((identity) => isManagementIdentity(identity) && identity.orgId === orgId && isRoleVisibleForOrg(identity, org)),
        }))
        .filter((account) => account.identities.length > 0);
      setAccounts(filtered);
      setAccountTotal(result.total);
      setActiveAccountId((current) => filtered.some((item) => item.id === current) ? current : "");
      setActiveAccountDetail((current) => current && filtered.some((item) => item.id === current.id) ? current : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "账号加载失败");
    }
  }

  async function searchGlobalAccounts(page = globalPage, rawKeyword = globalSearchKeyword) {
    setMessage("");
    setError("");
    const keyword = rawKeyword.trim();
    if (!keyword) {
      setGlobalAccounts([]);
      setSelectedGlobalAccountId("");
      setGlobalTotal(0);
      return;
    }
    try {
      const result = await api.get<PaginatedResult<Account>>(`/accounts/search?keyword=${encodeURIComponent(keyword)}&page=${page}&pageSize=20`);
      const managementAccounts = result.items
        .map((account) => ({ ...account, identities: account.identities.filter(isManagementIdentity) }))
        .filter((account) => account.identities.length > 0);
      setGlobalAccounts(managementAccounts);
      setGlobalTotal(result.total);
      setSelectedGlobalAccountId((current) => managementAccounts.some((item) => item.id === current) ? current : managementAccounts[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "全局账号搜索失败");
    }
  }

  async function refreshViews() {
    if (selectedOrgId) await loadAccounts(selectedOrgId, orgKeyword, accountPage);
    if (globalSearchKeyword.trim()) await searchGlobalAccounts(globalPage);
  }

  async function run(action: () => Promise<void>, successText: string) {
    setMessage("");
    setError("");
    try {
      await action();
      setMessage(successText);
      await refreshViews();
      if (activeAccountId) {
        setIsAccountDetailLoading(true);
        try {
          const detail = await api.get<Account>(`/accounts/${activeAccountId}/detail`);
          setActiveAccountDetail(detail);
        } finally {
          setIsAccountDetailLoading(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  function openConfirmation(next: Exclude<ConfirmationState, null>) {
    setConfirmation(next);
  }

  async function toggleIdentity(identity: Identity) {
    openConfirmation({
      title: identity.status === "active" ? "停用身份" : "启用身份",
      description: `角色：${roleLabelMap[identity.roleCode]}\n组织：${identity.org?.name || identity.anchorProfile?.nickname || "未关联"}`,
      confirmLabel: identity.status === "active" ? "确认停用" : "确认启用",
      tone: identity.status === "active" ? "danger" : "primary",
      onConfirm: () => run(
        () => api.patch(`/accounts/identities/${identity.id}/status`, { status: identity.status === "active" ? "disabled" : "active" }),
        identity.status === "active" ? "管理权限已停用" : "管理权限已启用",
      ),
    });
  }

  async function toggleAccount(account: Account) {
    const nextStatus = account.status === "active" ? "disabled" : "active";
    openConfirmation({
      title: nextStatus === "disabled" ? "禁用账号" : "启用账号",
      description: `昵称：${account.nickname}\n手机号：${account.phone}${nextStatus === "disabled" ? "\n禁用后将同步停用该账号全部生效身份。" : ""}`,
      confirmLabel: nextStatus === "disabled" ? "确认禁用" : "确认启用",
      tone: nextStatus === "disabled" ? "danger" : "primary",
      onConfirm: () => run(
        () => api.patch(`/accounts/${account.id}/status`, { status: nextStatus }),
        account.status === "active" ? "账号已禁用" : "账号已启用",
      ),
    });
  }

  async function forceDeleteAccount(accountId: string) {
    const target = [...accounts, ...globalAccounts].find((item) => item.id === accountId);
    openConfirmation({
      title: "删除账号",
      description: target
        ? `昵称：${target.nickname}\n手机号：${target.phone}\n该操作不可恢复。`
        : "该操作不可恢复。",
      confirmLabel: "确认删除",
      tone: "danger",
      onConfirm: async () => {
        await run(() => api.delete(`/accounts/${accountId}`), "账号已强制删除");
        setActiveAccountId("");
      },
    });
  }

  async function performGrant(userId: string, payload: { roleCode: RoleCode; orgId: string }, accountName: string) {
    try {
      await grantManagementIdentity(userId, payload);
      setMessage("组织管理权限已开通");
      setError("");
      await refreshViews();
    } catch (err) {
      const conflictError = err as Error & { code?: string; details?: ConflictDetail[] };
      if (conflictError.code === "ORG_SCOPE_CONFLICT" && conflictError.details?.length) {
        const detailText = conflictError.details.map((item) => `${roleLabelMap[item.roleCode]} / ${item.orgName || item.orgCode || item.orgId}`).join("\n");
        throw new Error(`账号"${accountName}"在当前组织链下已有管理权限，请先停用原权限：\n${detailText}`);
      }
      throw err;
    }
  }

  return (
    <div className="space-y-6">
      {confirmation && (
        <ConfirmModal
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          tone={confirmation.tone}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            await confirmation.onConfirm();
            setConfirmation(null);
          }}
        />
      )}

      {(message || error) && (
        <div className={`rounded-[20px] border px-4 py-3 text-sm whitespace-pre-line shadow-[0_8px_20px_rgba(15,23,42,0.04)] ${error ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
          {error || message}
        </div>
      )}

      <section className="rounded-[28px] border border-white/70 bg-white/90 p-3 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex gap-2">
          <button className={`rounded-[16px] px-4 py-2 text-sm font-medium transition ${viewMode === "by-org" ? "bg-feishu-blue text-white shadow-[0_12px_28px_rgba(76,114,255,0.22)]" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`} onClick={() => setViewMode("by-org")}>按组织管理</button>
          <button className={`rounded-[16px] px-4 py-2 text-sm font-medium transition ${viewMode === "by-account" ? "bg-feishu-blue text-white shadow-[0_12px_28px_rgba(76,114,255,0.22)]" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`} onClick={() => setViewMode("by-account")}>按账号全局管理</button>
        </div>
      </section>

      {viewMode === "by-org" && (
        <section className="grid gap-6 xl:grid-cols-[var(--org-tree-sidebar-width)_minmax(0,1fr)]" style={{ ["--org-tree-sidebar-width" as string]: ORG_TREE_SIDEBAR_WIDTH.accounts }}>
          <aside className="min-w-0 rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-slate-950">组织账号管理</h1>
            <p className="mt-1 text-sm leading-6 text-slate-500">选择组织查看管理账号，点击行打开详情与授权操作。</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => { setSelectedOrgId(""); setAccountPage(1); }} className={`flex-1 rounded-[16px] px-3 py-2 text-left text-sm transition ${!selectedOrgId ? "bg-feishu-pale text-feishu-blue" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>清空当前组织选择</button>
              <button type="button" onClick={() => setCollapsedIds(new Set())} className="rounded-[16px] border border-slate-200 px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-50">全部展开</button>
            </div>
            <div className="mt-4 max-h-[760px] overflow-auto pr-1">
              <OrgTree nodes={orgTree} selectedOrgId={selectedOrgId} onSelect={handleSelectOrg} collapsedIds={collapsedIds} onToggleCollapse={(orgId) => {
                void loadOrgChildren(orgId);
                setCollapsedIds((previous) => {
                  const next = new Set(previous);
                  if (next.has(orgId)) next.delete(orgId);
                  else next.add(orgId);
                  return next;
                });
              }} />
              {loadingOrgIds.size > 0 && <p className="mt-2 text-xs text-slate-400">正在加载下级组织...</p>}
            </div>
          </aside>

          <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[26px] font-semibold tracking-[-0.03em] text-slate-950">{selectedOrg ? `${selectedOrg.name} 的管理账号` : "请先选择组织"}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">只展示当前组织下已经拥有管理权限的账号，点击行查看详情与管理操作。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input className="w-72 rounded-[16px] border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-feishu-blue focus:bg-white focus:shadow-[0_0_0_4px_rgba(76,114,255,0.10)] disabled:cursor-not-allowed disabled:text-slate-400" placeholder="搜索昵称 / 手机号 / 抖音号" value={orgKeyword} disabled={!selectedOrgId} onChange={(event) => setOrgKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && selectedOrgId) { setAccountPage(1); void loadAccounts(selectedOrgId, orgKeyword, 1); } }} />
                </div>
                <button className="rounded-[16px] border border-slate-200 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400" disabled={!selectedOrgId} onClick={() => { if (selectedOrgId) void loadAccounts(selectedOrgId, orgKeyword, accountPage); }}>刷新</button>
                <button className="flex items-center gap-1.5 rounded-[16px] bg-feishu-blue px-4 py-2 text-sm font-medium text-white shadow-[0_12px_28px_rgba(76,114,255,0.22)] transition hover:bg-feishu-blue-strong disabled:bg-slate-300" disabled={!selectedOrgId} onClick={() => setShowGrantModal(true)}>
                  <UserRoundPlus size={15} />
                  新增管理员
                </button>
              </div>
            </div>

            {!selectedOrg && (
              <div className="mt-6 flex items-center gap-3 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <AlertCircle size={18} /><span>请先在左侧组织树中选择具体组织，例如某个基地、团队或厅。</span>
              </div>
            )}

            <div className="mt-6 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
                      <th className="whitespace-nowrap px-4 py-3 text-left">显示昵称</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left">手机号</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left">管理权限</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left">账号状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((account) => {
                      const isActive = activeAccountId === account.id;
                      return (
                        <tr key={account.id} onClick={async () => { setActiveAccountId(account.id); setActiveAccountDetail(account); setIsAccountDetailLoading(true); try { const detail = await api.get<Account>(`/accounts/${account.id}/detail`); setActiveAccountDetail(detail); } catch (err) { setError(err instanceof Error ? err.message : "账号详情加载失败"); } finally { setIsAccountDetailLoading(false); } }} className={`cursor-pointer border-t border-slate-100 transition ${isActive ? "bg-feishu-pale/60" : "bg-white hover:bg-slate-50"}`}>
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{account.anchorProfile?.nickname || account.nickname}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{account.phone}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {account.identities.map((identity) => (
                                <span key={identity.id} className={`rounded-full px-2 py-0.5 text-xs ${identity.status === "active" ? "bg-feishu-pale text-feishu-blue" : "bg-slate-100 text-slate-500"}`}>
                                  {roleLabelMap[identity.roleCode]}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs ${account.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                              {account.status === "active" ? "启用中" : "已禁用"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {!accounts.length && (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-400">
                          {selectedOrg ? "当前组织下暂无已赋权账号" : "请选择左侧组织后查看账号"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>共 {accountTotal} 条，当前第 {accountPage} 页</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={accountPage <= 1}
                  onClick={() => setAccountPage(accountPage - 1)}
                  className="rounded-xl border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
                >上一页</button>
                <button
                  type="button"
                  disabled={accountPage * 20 >= accountTotal}
                  onClick={() => setAccountPage(accountPage + 1)}
                  className="rounded-xl border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
                >下一页</button>
              </div>
            </div>
          </section>

          {activeAccountId && (
            <AccountDrawer account={activeAccountDetail ?? activeAccount} orgs={orgs} loading={isAccountDetailLoading} onClose={() => { setActiveAccountId(""); setActiveAccountDetail(undefined); setIsAccountDetailLoading(false); }} onToggleIdentity={toggleIdentity} onToggleAccount={toggleAccount} onForceDelete={forceDeleteAccount} />
          )}

          {showGrantModal && (
            <GrantModal targetOrg={selectedOrg} orgs={orgs} onClose={() => setShowGrantModal(false)} onGrant={performGrant} />
          )}
        </section>
      )}

      {viewMode === "by-account" && (
        <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <aside className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-slate-950">按账号全局管理</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">搜索一个账号，查看它拥有的全部管理身份，并逐条停用或启用。</p>
            <div className="mt-5 flex gap-2">
              <input className="flex-1 rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-feishu-blue focus:bg-white focus:shadow-[0_0_0_4px_rgba(76,114,255,0.10)]" value={globalSearchKeyword} onChange={(event) => { setGlobalSearchKeyword(event.target.value); setGlobalPage(1); }} onKeyDown={(e) => e.key === "Enter" && void searchGlobalAccounts(1)} placeholder="输入手机号或昵称" />
              <button className="rounded-[16px] bg-feishu-blue px-4 py-2 text-sm font-medium text-white shadow-[0_12px_28px_rgba(76,114,255,0.22)] transition hover:bg-feishu-blue-strong" onClick={() => void searchGlobalAccounts(1)}>搜索</button>
            </div>
            <div className="mt-5 space-y-3">
              {globalAccounts.map((account) => (
                <button key={account.id} className={`w-full rounded-[20px] border px-4 py-3 text-left transition ${selectedGlobalAccountId === account.id ? "border-feishu-blue bg-feishu-pale/40 shadow-[0_8px_20px_rgba(76,114,255,0.08)]" : "border-slate-200 bg-white hover:bg-slate-50"}`} onClick={() => setSelectedGlobalAccountId(account.id)}>
                  <div className="font-medium text-slate-900">{account.nickname}</div>
                  <div className="mt-1 text-xs text-slate-400">{account.phone}</div>
                  <div className="mt-2 text-xs text-slate-500">管理身份 {account.identities.length} 条</div>
                </button>
              ))}
              {!globalAccounts.length && <div className="rounded-[20px] border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">搜索后在这里选择一个账号</div>}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>共 {globalTotal} 条，当前第 {globalPage} 页</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={globalPage <= 1}
                  onClick={() => { const nextPage = globalPage - 1; setGlobalPage(nextPage); void searchGlobalAccounts(nextPage); }}
                  className="rounded-xl border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
                >上一页</button>
                <button
                  type="button"
                  disabled={globalPage * 20 >= globalTotal}
                  onClick={() => { const nextPage = globalPage + 1; setGlobalPage(nextPage); void searchGlobalAccounts(nextPage); }}
                  className="rounded-xl border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
                >下一页</button>
              </div>
            </div>
          </aside>

          <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[26px] font-semibold tracking-[-0.03em] text-slate-950">{selectedGlobalAccount ? `${selectedGlobalAccount.nickname} 的管理身份` : "请选择一个账号"}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">本页只做一件事：按账号查看该账号所有管理角色，并逐条停用或启用。</p>
              </div>
              {selectedGlobalAccount && <div className="rounded-[20px] bg-slate-50 px-4 py-3 text-sm text-slate-600">手机号：{selectedGlobalAccount.phone}</div>}
            </div>

            <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
                    <th className="whitespace-nowrap px-4 py-3 text-left">角色</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left">组织名称</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left">组织路径</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left">层级</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left">授权时间</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left">状态</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedGlobalAccount?.identities.map((identity) => {
                    const readablePath = identity.scopePath ? identity.scopePath.split("/").filter(Boolean).map((segment) => orgs.find((org) => org.orgCode === segment)?.name || segment).join(" / ") : "—";

                    return (
                      <tr key={identity.id} className="border-t border-slate-100 bg-white hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{roleLabelMap[identity.roleCode]}</td>
                        <td className="px-4 py-3 text-slate-600"><div className="max-w-[220px] truncate">{identity.org?.name || "未关联"}</div></td>
                        <td className="px-4 py-3 text-slate-500"><div className="max-w-[340px] truncate font-medium text-slate-700" title={readablePath}>{readablePath}</div></td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{identity.org ? orgTypeLabelMap[identity.org.orgType] : "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{identity.grantedAt ? new Date(identity.grantedAt).toLocaleDateString() : "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${identity.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{identity.status === "active" ? "生效中" : "已停用"}</span></td>
                        <td className="whitespace-nowrap px-4 py-3"><button className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:border-feishu-blue hover:text-feishu-blue" onClick={() => toggleIdentity(identity)}>{identity.status === "active" ? "停用" : "启用"}</button></td>
                      </tr>
                    );
                  })}
                  {!selectedGlobalAccount && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">请先从左侧搜索并选择一个账号</td></tr>
                  )}
                  {selectedGlobalAccount && !selectedGlobalAccount.identities.length && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">该账号暂无管理身份</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}
      {confirmation && (
        <ConfirmModal
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          tone={confirmation.tone}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            await confirmation.onConfirm();
            setConfirmation(null);
          }}
        />
      )}
    </div>
  );
}

function ConfirmModal({ title, description, confirmLabel, tone, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; tone: "danger" | "primary"; onCancel: () => void; onConfirm: () => Promise<void> | void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[4px]">
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.16)]">
        <div className="border-b border-slate-100 px-6 py-5">
          <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-slate-950">{title}</h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{description}</p>
        </div>
        <div className="flex justify-end gap-2 bg-slate-50/60 px-6 py-4">
          <button className="feishu-button-secondary h-10 px-4" onClick={onCancel}>取消</button>
          <button className={`feishu-button-primary h-10 px-4 ${tone === "danger" ? "!bg-red-500 hover:!bg-red-600 !shadow-[0_12px_28px_rgba(239,68,68,0.22)]" : ""}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}