import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Loader2, Search, UserPlus, X } from "lucide-react";

import { accountApi } from "../../../../features/accounts/api";
import type { SearchAccount } from "../../../../features/accounts/types";
import type { OrgUnit } from "../../../../types";
import { orgTypeMeta } from "../../../../shared/constants/org";
import { roleLabelMap } from "../../../../shared/constants/roles";
import { collectDescendantIds } from "../../../../shared/utils/orgTree";

type Props = {
  scopeOrgId?: string;
  orgs: OrgUnit[];
  managementScopePath?: string;
  selectedAccounts: SearchAccount[];
  selectedOrgIds: string[];
  onSelectedAccountsChange: (accounts: SearchAccount[]) => void;
  onSelectedOrgIdsChange: (orgIds: string[]) => void;
  /** 渲染在右侧栏底部的额外内容（如截止时间、提示条） */
  rightFooter?: ReactNode;
};

type Tab = "search" | "scope";

type OrgRow = {
  org: OrgUnit;
  depthOffset: number;
  hasChildren: boolean;
};

function mergeAccounts(accounts: SearchAccount[]) {
  return Array.from(new Map(accounts.map((a) => [a.id, a])).values());
}

function describeIdentity(account: SearchAccount) {
  const labels = account.identities
    .map((identity) => {
      const scope = identity.org?.name ?? identity.anchorProfile?.nickname ?? "未绑定范围";
      return `${roleLabelMap[identity.roleCode]} · ${scope}`;
    })
    .slice(0, 3);
  if (!labels.length) return "暂无可见身份";
  return labels.join("、");
}

function getAncestorIds(orgId: string, orgMap: Map<string, OrgUnit>) {
  const result: string[] = [];
  let current = orgMap.get(orgId);
  while (current?.parentId) {
    result.push(current.parentId);
    current = orgMap.get(current.parentId);
  }
  return result;
}

export function AccountTargetSelector({
  scopeOrgId,
  orgs,
  managementScopePath,
  selectedAccounts,
  selectedOrgIds,
  onSelectedAccountsChange,
  onSelectedOrgIdsChange,
  rightFooter,
}: Props) {
  const [tab, setTab] = useState<Tab>("search");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchAccount[]>([]);
  const [expandedOrgIds, setExpandedOrgIds] = useState<string[]>([]);

  const selectedIdSet = useMemo(() => new Set(selectedAccounts.map((a) => a.id)), [selectedAccounts]);
  const selectionSet = useMemo(() => new Set(selectedOrgIds), [selectedOrgIds]);
  const orgMap = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);

  const scopeOrg = useMemo(
    () => orgs.find((o) => o.id === scopeOrgId) ?? orgs.find((o) => o.path === managementScopePath) ?? null,
    [scopeOrgId, managementScopePath, orgs]
  );

  const targetOrgRows = useMemo(() => {
    const rows = orgs
      .filter((o) => o.status === "active" && (!managementScopePath || o.path.startsWith(managementScopePath)))
      .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
    const childCount = new Map<string, number>();
    rows.forEach((row) => {
      if (!row.parentId) return;
      childCount.set(row.parentId, (childCount.get(row.parentId) ?? 0) + 1);
    });
    return rows.map<OrgRow>((org) => ({
      org,
      depthOffset: Math.max(org.depth - (scopeOrg?.depth ?? 1) - 1, 0),
      hasChildren: (childCount.get(org.id) ?? 0) > 0,
    }));
  }, [managementScopePath, orgs, scopeOrg?.depth]);

  const visibleRootOrgs = useMemo(
    () => targetOrgRows.filter((row) => row.org.parentId === (scopeOrg?.id ?? null)),
    [scopeOrg?.id, targetOrgRows]
  );

  const selectedOrgObjects = useMemo(
    () => selectedOrgIds.map((id) => orgMap.get(id)).filter(Boolean) as OrgUnit[],
    [selectedOrgIds, orgMap]
  );

  async function doSearch() {
    const searchText = keyword.trim();
    if (!searchText) {
      setResults([]);
      return;
    }
    setLoading(true);
    const next = await accountApi.searchAccounts(searchText, { scopeOrgId }).catch(() => [] as SearchAccount[]);
    setLoading(false);
    setResults(next);
  }

  function toggleAccount(account: SearchAccount) {
    if (selectedIdSet.has(account.id)) {
      onSelectedAccountsChange(selectedAccounts.filter((item) => item.id !== account.id));
    } else {
      onSelectedAccountsChange(mergeAccounts([...selectedAccounts, account]));
    }
  }

  function toggleExpand(orgId: string) {
    setExpandedOrgIds((current) => (current.includes(orgId) ? current.filter((id) => id !== orgId) : [...current, orgId]));
  }

  function toggleOrg(orgId: string, mode: "single" | "multi" | "all" = "single") {
    const ancestorIds = getAncestorIds(orgId, orgMap);
    const descendantIds = Array.from(collectDescendantIds(orgId, orgs)).filter((id) => id !== orgId);
    const next = new Set(selectedOrgIds);

    if (mode === "all") {
      const allIds = [orgId, ...descendantIds];
      const shouldSelectAll = allIds.some((id) => !next.has(id));
      if (shouldSelectAll) {
        ancestorIds.forEach((id) => next.delete(id));
        allIds.forEach((id) => next.add(id));
      } else {
        allIds.forEach((id) => next.delete(id));
      }
      onSelectedOrgIdsChange(Array.from(next));
      return;
    }

    if (next.has(orgId)) {
      next.delete(orgId);
      if (mode === "single") {
        descendantIds.forEach((id) => next.delete(id));
      }
    } else {
      ancestorIds.forEach((id) => next.delete(id));
      if (mode === "single") descendantIds.forEach((id) => next.delete(id));
      next.add(orgId);
    }
    onSelectedOrgIdsChange(Array.from(next));
  }

  const totalSelected = selectedAccounts.length + selectedOrgIds.length;

  return (
    <div className="grid gap-4 xl:grid-cols-2 min-h-0 h-full">

      {/* 左侧：圈定操作容器 */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col">
        {/* 头部：标题 + Tab 切换二合一 */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-2">
          <span className="shrink-0 text-xs font-semibold text-slate-700">触达账号圈定</span>
          <div className="flex flex-1 gap-1 rounded-xl bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setTab("search")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${
                tab === "search" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <span className="inline-flex items-center gap-1"><Search size={11} />搜索添加</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("scope")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${
                tab === "scope" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <span className="inline-flex items-center gap-1"><Building2 size={11} />批量框选</span>
            </button>
          </div>
        </div>

        {/* 搜索添加 Tab */}
        {tab === "search" && (
          <div className="flex flex-col flex-1">
            <div className="flex gap-2 border-b border-slate-100 p-3">
              <div className="relative flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-9 py-2 text-sm focus:border-blue-400 focus:outline-none focus:bg-white"
                  placeholder="手机号、昵称或抖音号"
                />
              </div>
              <button
                type="button"
                onClick={() => void doSearch()}
                disabled={loading}
                className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : "搜索"}
              </button>
            </div>
            <div className="max-h-[340px] space-y-2 overflow-y-auto p-3">
              {!keyword.trim() ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">
                  输入关键词搜索账号
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
                  <Loader2 size={13} className="animate-spin" />搜索中...
                </div>
              ) : results.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">
                  当前范围内没有匹配账号
                </div>
              ) : (
                results.map((account) => {
                  const active = selectedIdSet.has(account.id);
                  return (
                    <div
                      key={account.id}
                      className={`rounded-xl border px-3 py-2.5 transition ${
                        active ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-sm font-semibold text-slate-900">{account.nickname}</p>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{account.phone}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${account.status === "active" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                              {account.status === "active" ? "可用" : "停用"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{describeIdentity(account)}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {account.identities.slice(0, 3).map((identity) => (
                              <span
                                key={identity.id}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                                  identity.org?.orgType ? orgTypeMeta[identity.org.orgType].badge : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                <span>{roleLabelMap[identity.roleCode]}</span>
                                {identity.org?.name && <span className="max-w-[80px] truncate">· {identity.org.name}</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleAccount(account)}
                          className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                            active
                              ? "border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {active ? "取消" : <span className="inline-flex items-center gap-1"><UserPlus size={11} />选定</span>}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 批量框选 Tab */}
        {tab === "scope" && (
          <div className="flex flex-col flex-1">
            <div className="border-b border-slate-100 px-4 py-2">
              <p className="text-xs text-slate-500">按层级展开选择，支持单选、多选与全选；已选组织会在右侧汇总，发布时按账号去重</p>
            </div>
            <div className="max-h-[340px] space-y-1.5 overflow-y-auto p-3">
              {targetOrgRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">
                  暂无可用组织
                </div>
              ) : (
                visibleRootOrgs.map((row) => {
                  const renderNode = (node: OrgRow) => {
                    const selected = selectionSet.has(node.org.id);
                    const expanded = expandedOrgIds.includes(node.org.id);
                    const children = targetOrgRows.filter((item) => item.org.parentId === node.org.id);
                    return (
                      <div key={node.org.id} className="space-y-1">
                        <div
                          className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                            selected
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                          style={{ marginLeft: `${node.depthOffset * 12}px` }}
                        >
                          {node.hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggleExpand(node.org.id)}
                              className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100"
                            >
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          ) : (
                            <span className="shrink-0 w-[22px]" />
                          )}
                          <button
                            type="button"
                            onClick={() => toggleOrg(node.org.id, node.hasChildren ? "all" : "single")}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${orgTypeMeta[node.org.orgType].badge}`}>
                              {orgTypeMeta[node.org.orgType].label}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{node.org.name}</p>
                              <p className="text-[11px] text-slate-400">{node.org.orgCode}</p>
                            </div>
                          </button>
                          <div className="flex items-center gap-1">
                            {node.hasChildren && (
                              <button
                                type="button"
                                onClick={() => toggleOrg(node.org.id, "all")}
                                className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50"
                              >
                                全选
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleOrg(node.org.id, node.hasChildren ? "multi" : "single")}
                              className={`rounded-full px-2 py-1 text-[11px] font-medium transition ${selected ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                            >
                              {selected ? "已选" : "选择"}
                            </button>
                          </div>
                        </div>
                        {node.hasChildren && expanded && <div className="space-y-1">{children.map(renderNode)}</div>}
                      </div>
                    );
                  };
                  return renderNode(row);
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* 右侧：已选汇总容器 */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col">
        <div className="border-b border-slate-100 px-4 py-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">已选汇总</span>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
            共 {totalSelected} 项
          </span>
        </div>
        <div className="flex flex-col gap-3 p-3 flex-1">
          {/* 精确账号 */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <span className="text-xs font-medium text-slate-700">精确账号</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{selectedAccounts.length} 个</span>
                {selectedAccounts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectedAccountsChange([])}
                    className="text-[11px] text-red-400 transition hover:text-red-600"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-[200px] space-y-1.5 overflow-y-auto p-2">
              {selectedAccounts.length === 0 ? (
                <div className="px-2 py-5 text-center text-[11px] text-slate-400">
                  从搜索结果中选定账号
                </div>
              ) : (
                selectedAccounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    <p className="truncate text-xs font-semibold text-slate-900">{account.nickname}</p>
                    <span className="shrink-0 text-[11px] text-slate-400">{account.phone}</span>
                    <button
                      type="button"
                      onClick={() => toggleAccount(account)}
                      className="ml-auto shrink-0 rounded-md p-0.5 text-slate-400 transition hover:text-red-500"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 框选组织 */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <span className="text-xs font-medium text-slate-700">框选组织</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{selectedOrgIds.length} 个</span>
                {selectedOrgIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectedOrgIdsChange([])}
                    className="text-[11px] text-red-400 transition hover:text-red-600"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>
            {selectedOrgObjects.length === 0 ? (
              <div className="px-2 py-5 text-center text-[11px] text-slate-400">
                从组织树中框选范围
              </div>
            ) : (
              <div className="grid grid-cols-2 divide-x divide-slate-100 max-h-[200px] overflow-y-auto">
                {(["TEAM", "HALL"] as const).map((type) => {
                  const items = selectedOrgObjects.filter((o) => o.orgType === type);
                  return (
                    <div key={type} className="flex flex-col gap-1 p-2 min-w-0">
                      <p className={`mb-0.5 text-[10px] font-semibold ${orgTypeMeta[type].badge} w-fit rounded-full px-1.5`}>
                        {orgTypeMeta[type].label}
                        <span className="ml-1 font-normal opacity-70">{items.length}</span>
                      </p>
                      {items.length === 0 ? (
                        <p className="text-[11px] text-slate-300 text-center py-1">—</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-1">
                          {items.map((org) => (
                            <span key={org.id} className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 pl-1.5 pr-0.5 py-0.5 text-[11px] text-slate-700 min-w-0">
                              <span className="flex-1 truncate font-medium">{org.name}</span>
                              <button
                                type="button"
                                onClick={() => toggleOrg(org.id)}
                                className="shrink-0 rounded-full p-0.5 text-slate-300 transition hover:text-red-500"
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 合并说明 */}
          {(selectedAccounts.length > 0 || selectedOrgIds.length > 0) && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] leading-5 text-emerald-700">
              发布时系统会将精确账号与框选组织命中账号合并去重，每个账号只生成一份触达任务。
            </div>
          )}

          {rightFooter}
        </div>
      </div>
    </div>
  );
}
