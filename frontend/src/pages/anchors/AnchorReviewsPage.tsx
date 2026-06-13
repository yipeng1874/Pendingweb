import { useEffect, useState } from "react";
import { anchorApi } from "../../features/anchors/api";
import { AlertCircle, X } from "lucide-react";
import { useAnchorReviews, makeDraft } from "../../features/anchors/hooks/useAnchorReviews";
import { AnchorReviewFilters } from "../../features/anchors/components/AnchorReviewFilters";
import { AnchorReviewList } from "../../features/anchors/components/AnchorReviewList";
import { AnchorReviewDetail } from "../../features/anchors/components/AnchorReviewDetail";
import { OrgTree } from "../../shared/components/tree/OrgTree";
import { ORG_TREE_SIDEBAR_WIDTH } from "../../shared/constants/layout";
import { Toast } from "../../shared/components/Toast";
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

export function AnchorReviewsPage() {
  const {
    orgTree,
    orgMap,
    selectedOrgId,
    setSelectedOrgId,
    reviewStatus,
    setReviewStatus,
    keyword,
    setKeyword,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    activeAppId,
    setActiveAppId,
    reviewDrafts,
    setReviewDrafts,
    message,
    error,
    filteredApps,
    activeApp,
    loadApplications,
    review,
    page,
    total,
    pageSize,
    loadOrgChildren,
    setPage,
  } = useAnchorReviews();

  const [activeAppDetail, setActiveAppDetail] = useState<typeof activeApp | null>(null);
  const activeDraft = activeAppDetail ? reviewDrafts[activeAppDetail.id] ?? makeDraft(activeAppDetail) : undefined;
  const drawerOpen = !!activeAppId;

  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [orgTreeCollapsed, setOrgTreeCollapsed] = useState<Set<string>>(new Set());
  const selectedOrg = selectedOrgId ? orgMap.get(selectedOrgId) : undefined;
  const orgs = Array.from(orgMap.values());
  const emptyText = selectedOrgId ? "当前筛选条件下暂无审核记录" : "请先从左侧组织树选择组织后查看审核记录";
  const collapsibleOrgIds = orgTree.filter((node) => node.children.length > 0).map((node) => node.id);
  const allCollapsed = collapsibleOrgIds.length > 0 && collapsibleOrgIds.every((id) => orgTreeCollapsed.has(id));
  const handleToggleAll = () => {
    setOrgTreeCollapsed(allCollapsed ? new Set() : new Set(collapsibleOrgIds));
  };

  useEffect(() => {
    if (error) setToast({ text: error, type: "error" });
  }, [error]);

  useEffect(() => {
    if (message) setToast({ text: message, type: "success" });
  }, [message]);

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  useEffect(() => {
    if (!activeAppId) return;
    if (!filteredApps.some((app) => app.id === activeAppId)) {
      closeDrawer();
    }
  }, [activeAppId, filteredApps]);

  async function handleSelectApp(appId: string) {
    setActiveAppId(appId);
    try {
      const detail = await anchorApi.getApplicationDetail(appId);
      setActiveAppDetail(detail);
      setReviewDrafts((previous) => ({
        ...previous,
        [detail.id]: previous[detail.id] ?? makeDraft(detail),
      }));
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : "加载审核详情失败", type: "error" });
    }
  }

  function closeDrawer() {
    setActiveAppId("");
    setActiveAppDetail(null);
  }

  function handleSelectOrg(orgId: string) {
    closeDrawer();
    const ancestorIds = collectAncestorOrgIds(orgs, orgId);
    setOrgTreeCollapsed((previous) => {
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
    <div className="grid gap-6 xl:grid-cols-[var(--org-tree-sidebar-width)_minmax(0,1fr)]" style={{ ["--org-tree-sidebar-width" as string]: ORG_TREE_SIDEBAR_WIDTH.anchorReviews }}>
      <aside className="min-w-0 rounded-3xl bg-white p-5 shadow-card">
        <h1 className="text-xl font-semibold text-slate-900">注册审核</h1>
        <p className="mt-1 text-sm text-slate-500">适合大量记录处理的审核列表，支持组织过滤与快速搜索。</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              closeDrawer();
              void setSelectedOrgId("");
            }}
            className={`flex-1 rounded-2xl px-3 py-2 text-left text-sm ${!selectedOrgId ? "bg-feishu-pale text-feishu-blue" : "bg-slate-50 text-slate-600"}`}
          >
            清空当前组织选择
          </button>
          <button type="button" onClick={handleToggleAll} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">{allCollapsed ? "全部展开" : "全部折叠"}</button>
        </div>
        <div className="mt-4 max-h-[760px] overflow-auto pr-1">
          <OrgTree
            nodes={orgTree}
            selectedOrgId={selectedOrgId}
            onSelect={handleSelectOrg}
            collapsedIds={orgTreeCollapsed}
            onToggleCollapse={(orgId) => {
              void loadOrgChildren(orgId);
              setOrgTreeCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(orgId)) next.delete(orgId);
                else next.add(orgId);
                return next;
              });
            }}
          />
        </div>
      </aside>

      <section className="space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">{selectedOrg ? `${selectedOrg.name} 的注册审核` : "请先选择组织"}</h2>
              <p className="mt-1 text-sm text-slate-500">点击列表行查看并处理单条审核记录。</p>
            </div>
            <AnchorReviewFilters
              keyword={keyword}
              setKeyword={setKeyword}
              dateFrom={dateFrom}
              setDateFrom={setDateFrom}
              dateTo={dateTo}
              setDateTo={setDateTo}
              reviewStatus={reviewStatus}
              setReviewStatus={setReviewStatus}
              onReset={() => {
                setDateFrom("");
                setDateTo("");
                setKeyword("");
                setPage(1);
                loadApplications();
              }}
              onRefresh={loadApplications}
            />
          </div>

          <div className="mt-6 space-y-4">
            {!selectedOrgId && (
              <div className="flex items-center gap-3 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <AlertCircle size={18} />
                <span>请先在左侧组织树中选择具体组织，再查看右侧审核记录与详情。</span>
              </div>
            )}
            <AnchorReviewList
              apps={filteredApps}
              orgMap={orgMap}
              activeAppId={activeAppId}
              setActiveAppId={handleSelectApp}
              emptyText={emptyText}
            />
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>共 {total} 条，当前第 {page} 页</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!selectedOrgId || page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded-xl border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
                >上一页</button>
                <button
                  type="button"
                  disabled={!selectedOrgId || page * pageSize >= total}
                  onClick={() => setPage(page + 1)}
                  className="rounded-xl border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
                >下一页</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {toast && (
        <Toast
          message={toast.text}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity"
          onClick={closeDrawer}
        />
      )}

      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-full flex-col bg-white shadow-2xl transition-transform duration-300 ${drawerOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">审核详情</h3>
          <button
            type="button"
            onClick={closeDrawer}
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <AnchorReviewDetail
            activeApp={activeAppDetail ?? undefined}
            activeDraft={activeDraft}
            reviewStatus={reviewStatus}
            orgMap={orgMap}
            onDraftChange={(draft) => {
              if (activeAppDetail) setReviewDrafts({ ...reviewDrafts, [activeAppDetail.id]: draft });
            }}
            onReview={(app, approved) => {
              review(app, approved);
              closeDrawer();
            }}
          />
        </div>
      </div>
    </div>
  );
}
