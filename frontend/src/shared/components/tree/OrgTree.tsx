import { ChevronDown, ChevronRight } from "lucide-react";
import type { OrgNode } from "../../utils/orgTree";

const orgTypeMeta = {
  HQ: { label: "总部", badge: "bg-[#EEF4FF] text-[#4C72FF]", text: "text-base font-semibold tracking-[-0.01em]", size: "h-7 min-w-10" },
  BASE: { label: "基地", badge: "bg-[#F2EEFF] text-[#7A5AF8]", text: "text-[15px] font-semibold tracking-[-0.01em]", size: "h-6 min-w-10" },
  TEAM: { label: "团队", badge: "bg-[#ECFDF3] text-[#17A34A]", text: "text-sm font-medium", size: "h-6 min-w-10" },
  HALL: { label: "厅", badge: "bg-[#FFF4E5] text-[#D97706]", text: "text-[13px] font-medium", size: "h-5 min-w-7" },
} as const;

type OrgTreeProps = {
  nodes: OrgNode[];
  selectedOrgId: string;
  onSelect: (orgId: string) => void;
  collapsedIds?: Set<string>;
  onToggleCollapse?: (orgId: string) => void;
};

export function OrgTree({ nodes, selectedOrgId, onSelect, collapsedIds = new Set(), onToggleCollapse }: OrgTreeProps) {
  const hasChildren = (node: OrgNode) => node.children.length > 0 || Boolean(node.hasChildren);
  const toggleCollapse = onToggleCollapse ?? (() => undefined);

  return (
    <div className="space-y-2.5">
      {nodes.map((node) => {
        const meta = orgTypeMeta[node.orgType];
        const expandable = hasChildren(node);
        const collapsed = collapsedIds.has(node.id);

        return (
          <div key={node.id}>
            <div className="flex items-center gap-1.5" style={{ marginLeft: `${(node.depth - 1) * 16}px` }}>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                disabled={!expandable || !onToggleCollapse}
                onClick={() => toggleCollapse(node.id)}
              >
                {expandable ? collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
              </button>
              <button
                type="button"
                onClick={() => onSelect(node.id)}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-[18px] border px-3.5 py-3 text-left transition-all duration-200 ${selectedOrgId === node.id ? "border-[#B9CBFF] bg-[#EEF4FF] text-[#4C72FF] shadow-[0_10px_24px_rgba(76,114,255,0.08)]" : "border-transparent bg-white text-slate-700 shadow-[0_4px_14px_rgba(15,23,42,0.03)] hover:border-slate-100 hover:bg-slate-50 hover:shadow-[0_8px_18px_rgba(15,23,42,0.05)]"}`}
              >
                <span className={`inline-flex ${meta.size} shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-semibold ${meta.badge}`}>{meta.label}</span>
                <span className={`truncate ${meta.text}`}>{node.name}</span>
                {node.orgType !== "HALL" && <span className="ml-auto shrink-0 text-xs text-slate-400">{node.orgCode}</span>}
              </button>
            </div>
            {expandable && !collapsed && node.children.length > 0 && (
              <div className="mt-2 pl-4">
                <OrgTree
                  nodes={node.children}
                  selectedOrgId={selectedOrgId}
                  onSelect={onSelect}
                  collapsedIds={collapsedIds}
                  onToggleCollapse={onToggleCollapse}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
