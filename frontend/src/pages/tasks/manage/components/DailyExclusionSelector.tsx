import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Search, ShieldMinus, X } from "lucide-react";

import type { Anchor } from "../../../../features/anchors/types";
import { anchorApi } from "../../../../features/anchors/api";
import { orgTypeMeta } from "../../../../shared/constants/org";
import { buildOrgTree, type OrgNode } from "../../../../shared/utils/orgTree";
import type { OrgUnit } from "../../../../types";

export type ExcludedAnchorMeta = {
  id: string;
  nickname: string;
  douyinNo?: string | null;
  douyinUid?: string | null;
  phone?: string;
  hallOrgId?: string;
  hallOrgName?: string;
};

type Props = {
  orgs: OrgUnit[];
  scopePath?: string;
  excludedOrgIds: string[];
  excludedAnchorProfileIds: string[];
  knownExcludedAnchors?: Record<string, ExcludedAnchorMeta>;
  onExcludedOrgIdsChange: (value: string[]) => void;
  onExcludedAnchorProfileIdsChange: (value: string[]) => void;
  enableAnchorExclusion?: boolean;
  allowedOrgTypes?: OrgUnit["orgType"][];
  title?: string;
  description?: string;
};

type ExcludedOrgSection = {
  title: string;
  items: OrgUnit[];
};

type ExcludedAnchorRow = ExcludedAnchorMeta & {
  hallLabel: string;
};

function collectDefaultCollapsedIds(nodes: OrgNode[]) {
  const ids: string[] = [];
  const walk = (rows: OrgNode[]) => {
    rows.forEach((node) => {
      if (node.children.length > 0) ids.push(node.id);
      walk(node.children);
    });
  };
  walk(nodes);
  return ids;
}

function collectAncestorIds(orgIds: string[], orgMap: Map<string, OrgUnit>) {
  const ids = new Set<string>();
  orgIds.forEach((orgId) => {
    let current = orgMap.get(orgId);
    while (current?.parentId) {
      ids.add(current.parentId);
      current = orgMap.get(current.parentId);
    }
  });
  return ids;
}


function toAnchorMeta(anchor: Anchor | ExcludedAnchorMeta): ExcludedAnchorMeta {
  const hallOrgName = (anchor as Anchor).hallOrg?.name ?? (anchor as ExcludedAnchorMeta).hallOrgName;
  const phone = (anchor as Anchor).boundUser?.phone ?? (anchor as ExcludedAnchorMeta).phone;
  return {
    id: anchor.id,
    nickname: anchor.nickname,
    douyinNo: anchor.douyinNo,
    douyinUid: anchor.douyinUid,
    phone,
    hallOrgId: anchor.hallOrgId,
    hallOrgName,
  };
}

function createExcludedOrgSections(rows: OrgUnit[]): ExcludedOrgSection[] {
  const grouped: Record<OrgUnit["orgType"], OrgUnit[]> = { HQ: [], BASE: [], TEAM: [], HALL: [] };
  rows.forEach((row) => {
    grouped[row.orgType].push(row);
  });
  return [
    { title: "不参与任务基地", items: grouped.BASE },
    { title: "不参与任务团队", items: grouped.TEAM },
    { title: "不参与任务厅", items: grouped.HALL },
  ]
    .map((section) => ({ ...section, items: [...section.items].sort((left, right) => left.path.localeCompare(right.path)) }))
    .filter((section) => section.items.length > 0);
}

function createExcludedAnchorRows(excludedAnchorProfileIds: string[], knownAnchors: Record<string, ExcludedAnchorMeta>, orgMap: Map<string, OrgUnit>): ExcludedAnchorRow[] {
  return excludedAnchorProfileIds
    .map((anchorId) => {
      const anchor = knownAnchors[anchorId] ?? { id: anchorId, nickname: `主播 ${anchorId.slice(0, 6)}` };
      const fallbackHallName = anchor.hallOrgId ? orgMap.get(anchor.hallOrgId)?.name : undefined;
      return { ...anchor, hallLabel: anchor.hallOrgName || fallbackHallName || "未识别所属厅" };
    })
    .sort((left, right) => left.hallLabel.localeCompare(right.hallLabel) || left.nickname.localeCompare(right.nickname));
}

export function DailyExclusionSelector({
  orgs,
  scopePath,
  excludedOrgIds,
  excludedAnchorProfileIds,
  knownExcludedAnchors,
  onExcludedOrgIdsChange,
  onExcludedAnchorProfileIdsChange,
  enableAnchorExclusion = true,
  allowedOrgTypes,
  title = "排除配置",
  description = "从当前权限范围内剔除不需要触达的组织或主播。",
}: Props) {
  const [anchorKeywordInput, setAnchorKeywordInput] = useState("");
  const [anchorSearchTerm, setAnchorSearchTerm] = useState("");
  const [visibleAnchors, setVisibleAnchors] = useState<Anchor[]>([]);
  const [loadingHallId, setLoadingHallId] = useState("");
  const [expandedHallId, setExpandedHallId] = useState("");
  const [knownAnchors, setKnownAnchors] = useState<Record<string, ExcludedAnchorMeta>>(knownExcludedAnchors ?? {});
  const [collapsedOrgIds, setCollapsedOrgIds] = useState<Set<string>>(new Set());
  const [hallAnchorCache, setHallAnchorCache] = useState<Record<string, Anchor[]>>({});

  const scopedOrgs = useMemo(
    () => orgs.filter((org) => org.status === "active" && (!scopePath || org.path.startsWith(scopePath))),
    [orgs, scopePath]
  );
  const orgMap = useMemo(() => new Map(scopedOrgs.map((org) => [org.id, org])), [scopedOrgs]);
  const scopeRoot = useMemo(() => scopedOrgs.find((org) => org.path === scopePath) ?? null, [scopedOrgs, scopePath]);
  const orgCandidates = useMemo(
    () => scopedOrgs
      .filter((org) => (!scopePath || org.path !== scopePath) && (!allowedOrgTypes?.length || allowedOrgTypes.includes(org.orgType)))
      .sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path)),
    [allowedOrgTypes, scopedOrgs, scopePath]
  );
  const orgTree = useMemo(() => buildOrgTree(orgCandidates), [orgCandidates]);
  const defaultCollapsedIds = useMemo(() => collectDefaultCollapsedIds(orgTree), [orgTree]);
  const orgStats = useMemo(() => {
    const stats = { BASE: 0, TEAM: 0, HALL: 0 };
    orgCandidates.forEach((org) => {
      if (org.orgType === "BASE") stats.BASE += 1;
      if (org.orgType === "TEAM") stats.TEAM += 1;
      if (org.orgType === "HALL") stats.HALL += 1;
    });
    return stats;
  }, [orgCandidates]);
  const excludedOrgs = useMemo(
    () => excludedOrgIds.map((orgId) => orgMap.get(orgId)).filter(Boolean).sort((left, right) => left!.path.localeCompare(right!.path)) as OrgUnit[],
    [excludedOrgIds, orgMap]
  );
  const excludedOrgSections = useMemo(() => createExcludedOrgSections(excludedOrgs), [excludedOrgs]);
  const excludedAnchorRows = useMemo(
    () => createExcludedAnchorRows(excludedAnchorProfileIds, knownAnchors, orgMap),
    [excludedAnchorProfileIds, knownAnchors, orgMap]
  );
  const cachedHallAnchors = expandedHallId ? hallAnchorCache[expandedHallId] : undefined;

  useEffect(() => {
    if (!knownExcludedAnchors) return;
    setKnownAnchors((current) => ({ ...current, ...knownExcludedAnchors }));
  }, [knownExcludedAnchors]);

  useEffect(() => {
    const next = new Set(defaultCollapsedIds);
    collectAncestorIds(excludedOrgIds, orgMap).forEach((orgId) => next.delete(orgId));
    setCollapsedOrgIds(next);
  }, [defaultCollapsedIds, excludedOrgIds, orgMap]);

  useEffect(() => {
    if (!enableAnchorExclusion) {
      setExpandedHallId("");
      setVisibleAnchors([]);
      setLoadingHallId("");
      setAnchorKeywordInput("");
      setAnchorSearchTerm("");
      return;
    }
    if (!expandedHallId) {
      setAnchorSearchTerm("");
      setAnchorKeywordInput("");
      return;
    }
    const timer = window.setTimeout(() => {
      setAnchorSearchTerm(anchorKeywordInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [anchorKeywordInput, enableAnchorExclusion, expandedHallId]);

  useEffect(() => {
    if (!enableAnchorExclusion || !expandedHallId) {
      setVisibleAnchors([]);
      setLoadingHallId("");
      return;
    }
    if (!anchorSearchTerm && cachedHallAnchors) {
      setVisibleAnchors(cachedHallAnchors);
      setLoadingHallId("");
      return;
    }
    let active = true;
    setVisibleAnchors([]);
    setLoadingHallId(expandedHallId);
    anchorApi
      .getProfiles({ hallOrgId: expandedHallId, status: "bound", ...(anchorSearchTerm ? { keyword: anchorSearchTerm } : {}) })
      .then((rows) => {
        if (!active) return;
        const items = Array.isArray((rows as any)?.items) ? (rows as any).items : rows;
        setVisibleAnchors(items);
        setKnownAnchors((current) => {
          const next = { ...current };
          items.forEach((item: Anchor) => {
            next[item.id] = toAnchorMeta(item);
          });
          return next;
        });
        if (!anchorSearchTerm) {
          setHallAnchorCache((current) => ({ ...current, [expandedHallId]: items }));
        }
      })
      .catch(console.error)
      .finally(() => {
        if (active) setLoadingHallId("");
      });
    return () => {
      active = false;
    };
  }, [anchorSearchTerm, cachedHallAnchors, enableAnchorExclusion, expandedHallId]);

  function toggleOrg(orgId: string) {
    onExcludedOrgIdsChange(excludedOrgIds.includes(orgId) ? excludedOrgIds.filter((item) => item !== orgId) : [...excludedOrgIds, orgId]);
  }

  function toggleAnchor(anchorId: string, anchor?: Anchor) {
    if (!enableAnchorExclusion) return;
    if (anchor) {
      setKnownAnchors((current) => ({ ...current, [anchor.id]: toAnchorMeta(anchor) }));
    }
    onExcludedAnchorProfileIdsChange(
      excludedAnchorProfileIds.includes(anchorId)
        ? excludedAnchorProfileIds.filter((item) => item !== anchorId)
        : [...excludedAnchorProfileIds, anchorId]
    );
  }

  function toggleCollapse(orgId: string) {
    setCollapsedOrgIds((current) => {
      const next = new Set(current);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  }

  function toggleHallAnchors(hallId: string) {
    if (!enableAnchorExclusion) return;
    setExpandedHallId((current) => (current === hallId ? "" : hallId));
    setAnchorKeywordInput("");
    setAnchorSearchTerm("");
  }

  function renderAnchorBranch(hall: OrgUnit, indent: string) {
    if (!enableAnchorExclusion) return null;
    const isLoading = loadingHallId === hall.id;
    const rows = expandedHallId === hall.id ? visibleAnchors : [];
    return (
      <div className="space-y-2 rounded-2xl border border-violet-100 bg-violet-50 p-3" style={{ marginLeft: `calc(${indent} + 38px)` }}>
        <p className="text-sm font-semibold text-slate-900">{hall.name} 主播</p>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={anchorKeywordInput}
            onChange={(event) => setAnchorKeywordInput(event.target.value)}
            className="w-full rounded-2xl border border-violet-200 bg-white px-10 py-2.5 text-sm focus:border-violet-300 focus:outline-none"
            placeholder="搜索当前厅主播"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto rounded-2xl border border-violet-100 bg-white p-2">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-violet-100 bg-violet-50 px-4 py-12 text-sm text-violet-600"><Loader2 size={16} className="animate-spin" />正在读取主播名单...</div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-400">当前厅下没有匹配主播。</div>
          ) : (
            <div className="space-y-2">
              {rows.map((anchor) => {
                const active = excludedAnchorProfileIds.includes(anchor.id);
                return (
                  <div key={anchor.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${active ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-white"}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{anchor.nickname}</p>
                      <p className="mt-1 truncate text-xs text-slate-400">{anchor.douyinNo || anchor.douyinUid || anchor.id}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleAnchor(anchor.id, anchor)}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${active ? "border-violet-200 bg-white text-violet-600 hover:bg-violet-50" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      {active ? "取消排除" : "排除主播"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderOrgNodes(nodes: OrgNode[]) {
    return nodes.map((org) => {
      const active = excludedOrgIds.includes(org.id);
      const hasChildren = org.children.length > 0;
      const isHall = enableAnchorExclusion && org.orgType === "HALL";
      const hallExpanded = isHall && expandedHallId === org.id;
      const collapsed = isHall ? !hallExpanded : collapsedOrgIds.has(org.id);
      const indent = `${Math.max(org.depth - (scopeRoot?.depth ?? 1) - 1, 0) * 14}px`;
      const rowTone = active ? "border-red-200 bg-red-50" : hallExpanded ? "border-violet-200 bg-violet-50 shadow-[0_8px_18px_rgba(139,92,246,0.08)]" : "border-slate-200 bg-white hover:bg-slate-50";
      return (
        <div key={org.id} className="space-y-2">
          <div className="flex items-center gap-2" style={{ marginLeft: indent }}>
            <button
              type="button"
              onClick={() => {
                if (hasChildren) toggleCollapse(org.id);
                else if (isHall) toggleHallAnchors(org.id);
              }}
              disabled={!hasChildren && !isHall}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-default disabled:opacity-30"
            >
              {hasChildren || isHall ? collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
            </button>
            <button
              type="button"
              onClick={() => {
                if (hasChildren) toggleCollapse(org.id);
                else if (isHall) toggleHallAnchors(org.id);
              }}
              className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${rowTone}`}
            >
              <span className={`inline-flex h-6 shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-semibold ${orgTypeMeta[org.orgType].badge}`}>{orgTypeMeta[org.orgType].label}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">{org.name}</span>
                  <span className="truncate text-[11px] text-slate-400">{org.orgCode}</span>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => toggleOrg(org.id)}
              className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-medium transition ${active ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {active ? "取消排除" : `排除${orgTypeMeta[org.orgType].label}`}
            </button>
          </div>
          {isHall && hallExpanded && renderAnchorBranch(org, indent)}
          {hasChildren && !collapsed && <div className="space-y-2">{renderOrgNodes(org.children)}</div>}
        </div>
      );
    });
  }

  const totalExcludedCount = excludedOrgIds.length + (enableAnchorExclusion ? excludedAnchorProfileIds.length : 0);

  return (
    <div className="grid gap-5 xl:grid-cols-2 xl:items-stretch">
      <section className="flex min-h-[560px] flex-col gap-4 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)] xl:h-[700px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><ShieldMinus size={16} className="text-blue-500" /><p className="text-sm font-semibold text-slate-900">{title}</p></div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">基地 {orgStats.BASE}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">团队 {orgStats.TEAM}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">厅 {orgStats.HALL}</span>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            <span>按团队逐层展开，点击厅后再读取主播名单</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {orgTree.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-400">当前范围内没有可排除的组织节点。</div> : <div className="space-y-2">{renderOrgNodes(orgTree)}</div>}
          </div>
        </div>
      </section>
      <aside className="flex min-h-[560px] flex-col gap-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-5 xl:h-[700px]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-900">不参与任务厅、团队</p>
          {totalExcludedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                onExcludedOrgIdsChange([]);
                onExcludedAnchorProfileIdsChange([]);
              }}
              className="text-xs font-medium text-red-500 transition hover:text-red-600"
            >
              清空全部
            </button>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <div className="flex items-center justify-between gap-3"><span>排除组织</span><span className="font-medium text-slate-900">{excludedOrgIds.length} 个</span></div>
          {enableAnchorExclusion && <div className="mt-3 flex items-center justify-between gap-3"><span>排除主播</span><span className="font-medium text-slate-900">{excludedAnchorProfileIds.length} 人</span></div>}
          <div className="mt-3 flex items-center justify-between gap-3"><span>当前范围</span><span className="max-w-[160px] truncate font-medium text-slate-900">{scopeRoot?.name ?? "当前权限范围"}</span></div>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {totalExcludedCount === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-400">当前没有不参与任务的厅、团队或主播。</div>
          ) : (
            <>
              {excludedOrgSections.map((section) => (
                <div key={section.title} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium text-slate-500">{section.title}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 2xl:grid-cols-3">
                    {section.items.map((org) => (
                      <div key={org.id} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900" title={org.name}>{org.name}</p>
                        <button type="button" onClick={() => toggleOrg(org.id)} className="rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-red-500"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {enableAnchorExclusion && excludedAnchorRows.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium text-slate-500">不参与任务主播</p>
                  <div className="mt-3 space-y-2">
                    {excludedAnchorRows.map((anchor) => {
                      const douyinText = anchor.douyinNo || anchor.douyinUid || "未登记抖音号";
                      const phoneText = anchor.phone || "未绑定手机号";
                      return (
                        <div key={anchor.id} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900" title={`${anchor.nickname}-${douyinText}-${phoneText}`}>
                            {anchor.nickname}-{douyinText}-{phoneText}
                          </p>
                          <button type="button" onClick={() => toggleAnchor(anchor.id)} className="rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-red-500"><X size={14} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
