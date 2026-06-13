import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { AnchorAccountTable } from "../../features/anchors/components/AnchorAccountTable";
import { AnchorAccountDrawer } from "../../features/anchors/components/AnchorAccountDrawer";
import { AnchorAccountFilters } from "../../features/anchors/components/AnchorAccountFilters";
import { useAnchorAccounts } from "../../features/anchors/hooks/useAnchorAccounts";
import { OrgTree } from "../../shared/components/tree/OrgTree";
import { ORG_TREE_SIDEBAR_WIDTH } from "../../shared/constants/layout";
import { Toast } from "../../shared/components/Toast";
import { anchorApi } from "../../features/anchors/api";
import { useIdentityStore } from "../../stores/identityStore";
import { getDefaultExpandedOrgIds } from "../../shared/utils/orgTree";
import type { OrgUnit } from "../../types";

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

export function AnchorAccountsPage() {
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const permissions = useIdentityStore((state) => state.permissions);
  const canManage = permissions.includes("*") || permissions.includes("anchor:profile:create") || permissions.includes("anchor:profile:bind");
  const isReadOnly = !canManage;

  const {
    orgTree,
    orgs,
    selectedOrg,
    selectedOrgId,
    setSelectedOrgId,
    keyword,
    setKeyword,
    status,
    setStatus,
    editing,
    setEditing,
    message,
    error,
    filteredAnchors,
    approvedApps,
    detailsByUserId,
    load,
    run,
    saveProfile,
    removeProfile,
    resetPassword,
    anchorPage,
    anchorTotal,
    pageSize,
    loadOrgChildren,
    setAnchorPage,
  } = useAnchorAccounts();

  const [activeAnchorId, setActiveAnchorId] = useState("");
  const [activeAnchorDetail, setActiveAnchorDetail] = useState<typeof filteredAnchors[number] | null>(null);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const hasInitializedCollapsedIdsRef = useRef(false);
  const emptyText = selectedOrgId ? "当前筛选条件下暂无主播账号" : "请先从左侧组织树选择组织后查看主播账号";
  const orgTreeWidth = useMemo(() => ORG_TREE_SIDEBAR_WIDTH.anchorAccounts, []);
  useEffect(() => {
    if (!orgs.length || hasInitializedCollapsedIdsRef.current) return;
    const expandedIds = getDefaultExpandedOrgIds(orgs, currentIdentity);
    const nextCollapsed = new Set<string>();
    orgs.filter((org) => orgs.some((item) => item.parentId === org.id)).forEach((org) => {
      if (!expandedIds.has(org.id)) nextCollapsed.add(org.id);
    });
    setCollapsedIds(nextCollapsed);
    hasInitializedCollapsedIdsRef.current = true;
  }, [currentIdentity, orgs]);
  const collapsibleOrgIds = orgTree.filter((node) => node.children.length > 0).map((node) => node.id);
  const allCollapsed = collapsibleOrgIds.length > 0 && collapsibleOrgIds.every((id) => collapsedIds.has(id));
  const handleToggleAll = () => {
    setCollapsedIds(allCollapsed ? new Set() : new Set(collapsibleOrgIds));
  };

  useEffect(() => {
    if (error) setToast({ text: error, type: "error" });
  }, [error]);

  useEffect(() => {
    if (message) setToast({ text: message, type: "success" });
  }, [message]);

  // 抽屉打开时锁定背景滚动
  useEffect(() => {
    if (activeAnchorId) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [activeAnchorId]);

  useEffect(() => {
    if (!activeAnchorId) return;
    if (!filteredAnchors.some((anchor) => anchor.id === activeAnchorId)) {
      closeDrawer();
    }
  }, [activeAnchorId, filteredAnchors]);

  const activeAnchor = activeAnchorDetail ?? filteredAnchors.find((a) => a.id === activeAnchorId);

  async function handleSelectAnchor(id: string) {
    const anchor = filteredAnchors.find((a) => a.id === id);
    if (!anchor) return;
    setActiveAnchorId(id);
    setEditing(anchor);
    try {
      const detail = await anchorApi.getProfileDetail(id);
      setActiveAnchorDetail(detail);
      setEditing(detail);
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : "加载主播详情失败", type: "error" });
    }
  }

  function closeDrawer() {
    setActiveAnchorId("");
    setActiveAnchorDetail(null);
    setEditing(undefined);
  }

  function handleSelectOrg(orgId: string) {
    closeDrawer();
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
    void setSelectedOrgId(orgId);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[var(--org-tree-sidebar-width)_1fr]" style={{ ["--org-tree-sidebar-width" as string]: orgTreeWidth }}>
      <aside className="min-w-0 rounded-3xl bg-white p-5 shadow-card">
        <h1 className="text-xl font-semibold text-slate-900">主播账号管理</h1>
        <p className="mt-1 text-sm text-slate-500">独立管理审核通过后的主播账号、密码和主播资料。</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              closeDrawer();
              void setSelectedOrgId("");
            }}
            className={`flex-1 rounded-[16px] px-3 py-2 text-left text-sm transition ${!selectedOrgId ? "bg-feishu-pale text-feishu-blue" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
          >
            清空当前组织选择
          </button>
          <button type="button" onClick={handleToggleAll} className="rounded-[16px] border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-50">{allCollapsed ? "全部展开" : "全部折叠"}</button>
        </div>
        <div className="mt-4 max-h-[760px] overflow-auto pr-1">
          <OrgTree
            nodes={orgTree}
            selectedOrgId={selectedOrgId}
            onSelect={handleSelectOrg}
            collapsedIds={collapsedIds}
            onToggleCollapse={(orgId) => {
              void loadOrgChildren(orgId);
              setCollapsedIds((previous) => {
                const next = new Set(previous);
                if (next.has(orgId)) next.delete(orgId);
                else next.add(orgId);
                return next;
              });
            }}
          />
        </div>
      </aside>

      <div className="space-y-6">
        <section className="rounded-3xl bg-white p-6 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">
                {selectedOrg ? `${selectedOrg.name} 范围内的主播账号` : "请先选择组织"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{isReadOnly ? "左侧组织树决定查询范围；如需进一步缩小到某个厅，可使用归属厅筛选。当前身份为只读权限。" : "左侧组织树决定查询范围；如需进一步缩小到某个厅，可使用归属厅筛选。"}</p>
            </div>
            <AnchorAccountFilters
              keyword={keyword}
              setKeyword={setKeyword}
              status={status}
              setStatus={setStatus}
              onRefresh={load}
            />
          </div>

          <div className="mt-6 space-y-4">
            {!selectedOrgId && (
              <div className="flex items-center gap-3 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <AlertCircle size={18} />
                <span>请先在左侧组织树中选择具体组织，再查看右侧主播账号与详情。</span>
              </div>
            )}
            <AnchorAccountTable
              anchors={filteredAnchors}
              activeAnchorId={activeAnchorId}
              setActiveAnchorId={handleSelectAnchor}
              emptyText={emptyText}
            />
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>共 {anchorTotal} 条，当前第 {anchorPage} 页</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!selectedOrgId || anchorPage <= 1}
                  onClick={() => setAnchorPage(anchorPage - 1)}
                  className="rounded-xl border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
                >上一页</button>
                <button
                  type="button"
                  disabled={!selectedOrgId || anchorPage * pageSize >= anchorTotal}
                  onClick={() => setAnchorPage(anchorPage + 1)}
                  className="rounded-xl border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
                >下一页</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.text}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* 侧滑抽屉 */}
      {activeAnchor && editing && (
        <AnchorAccountDrawer
          anchor={activeAnchor}
          editing={editing}
          orgs={orgs}
          matchedApp={activeAnchor.boundUserId ? detailsByUserId.get(activeAnchor.boundUserId) : undefined}
          readOnly={isReadOnly}
          onClose={closeDrawer}
          onChange={setEditing}
          onSave={async () => {
            const saved = await saveProfile();
            if (saved) closeDrawer();
          }}
          onDisable={() => { run(async () => { await anchorApi.disableProfile(activeAnchor.id); }, "主播账号已停用"); closeDrawer(); }}
          onEnable={() => { run(async () => { await anchorApi.enableProfile(activeAnchor.id); }, "主播账号已启用"); closeDrawer(); }}
          onDelete={() => { removeProfile(activeAnchor); closeDrawer(); }}
          onResetPassword={
            activeAnchor.boundUserId
              ? (() => {
                  const app = approvedApps.find((a) => a.userId === activeAnchor.boundUserId);
                  return app ? () => resetPassword(app) : undefined;
                })()
              : undefined
          }
        />
      )}
    </div>
  );
}
