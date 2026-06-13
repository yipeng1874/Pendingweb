import { ChevronDown, ChevronRight } from "lucide-react";
import type { OrgUnit } from "../../../types";
import { orgTypeMeta } from "../constants";

export function OrgTreeList({
  orgs,
  visibleOrgs,
  hasChildren,
  collapsedIds,
  selected,
  onToggleCollapsed,
  onSelectOrg,
  onCollapseAll,
  onExpandAll,
}: {
  orgs: OrgUnit[];
  visibleOrgs: OrgUnit[];
  hasChildren: Set<string>;
  collapsedIds: Set<string>;
  selected?: OrgUnit;
  onToggleCollapsed: (org: OrgUnit) => void;
  onSelectOrg: (org: OrgUnit) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
}) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">组织树</h1>
        <div className="flex gap-2">
          <button className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50" onClick={onExpandAll}>全部展开</button>
          <button className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50" onClick={onCollapseAll}>全部折叠</button>
        </div>
      </div>
      <div className="space-y-2">
        {visibleOrgs.map((org) => {
          const meta = orgTypeMeta[org.orgType];
          const expandable = hasChildren.has(org.id);
          const collapsed = collapsedIds.has(org.id);
          return (
            <div key={org.id} className="flex items-center gap-1">
              <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50 disabled:opacity-30" disabled={!expandable} onClick={() => onToggleCollapsed(org)}>
                {expandable ? collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
              </button>
              <button
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-3 py-3 text-left transition hover:bg-feishu-pale ${selected?.id === org.id ? "bg-feishu-pale text-feishu-blue" : "bg-slate-50 text-slate-700"}`}
                style={{ marginLeft: `${(org.depth - 1) * 16}px` }}
                onClick={() => onSelectOrg(org)}
              >
                <span className={`inline-flex ${meta.size} shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-semibold ${meta.badge}`}>{meta.label}</span>
                <span className={`truncate ${meta.text}`}>{org.name}</span>
                <span className="ml-auto shrink-0 text-xs text-slate-400">{org.orgCode}</span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
