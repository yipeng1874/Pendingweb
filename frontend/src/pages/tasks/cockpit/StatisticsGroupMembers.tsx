import type { DailyRangeStatsTeam } from "../../../types";

export function StatisticsGroupMembers({ members }: { members?: DailyRangeStatsTeam[] }) {
  if (!members?.length) return null;
  return <details className="text-[11px] rounded-lg bg-slate-50 px-2 py-1 mt-1">
    <summary className="cursor-pointer text-blue-600">展开 {members.length} 个团队明细</summary>
    <div className="space-y-2 py-2 max-h-48 overflow-y-auto">
      {members.map((m) => <div key={m.orgId} className="flex justify-between gap-2">
        <span className="truncate text-slate-600" title={m.orgName}>{m.orgName}</span>
        <span className="shrink-0 tabular-nums"><span className="text-slate-600 mr-2">{m.total > 0 && m.exemptions >= m.total ? "无需考核" : `${m.completionRate}%`}</span><span className="text-emerald-600">{m.completed}</span> / <span className="text-blue-500">{m.total}</span> / <span className="text-amber-500">{m.exemptions}</span></span>
      </div>)}
    </div>
  </details>;
}
