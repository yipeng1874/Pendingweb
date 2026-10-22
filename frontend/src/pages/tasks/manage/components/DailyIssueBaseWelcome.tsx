import type { OrgUnit } from "../../../../types";
type Props = { title: string; description: string; availableBaseOrgs: OrgUnit[]; onSelect: (id:string)=>void };
export function DailyIssueBaseWelcome({title,description,availableBaseOrgs,onSelect:setSelectedScopeOrgId}:Props) {
  return (
        <div className="relative overflow-hidden rounded-3xl bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          {/* 背景装饰 */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-blue-50 opacity-60" />
          <div className="pointer-events-none absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-indigo-50 opacity-40" />

          <div className="relative flex flex-col items-center px-8 py-16">
            {/* 品牌标识 */}
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-[0_8px_24px_rgba(79,70,229,0.3)] select-none">
              <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="M9 12h6M9 16h4" />
              </svg>
            </div>

            {/* 标题 */}
            <h3 className="mt-5 text-xl font-bold text-slate-900 tracking-tight">{title}</h3>

            {/* 激励语 */}
            <p className="mt-2 text-sm text-slate-400 text-center max-w-sm leading-relaxed">
              {description}
            </p>

            {/* 三个价值点 */}
            <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-md">
              {[
                { label: "精准赋能", desc: "任务直达基地一线" },
                { label: "高效协同", desc: "多端同步实时响应" },
                { label: "驱动成长", desc: "数据积累沉淀价值" },
              ].map((item) => (
                <div key={item.label} className="flex flex-col items-center rounded-2xl bg-slate-50 px-3 py-4">
                  <span className="text-sm font-semibold text-slate-700">{item.label}</span>
                  <span className="mt-1 text-xs text-slate-400 text-center leading-snug">{item.desc}</span>
                </div>
              ))}
            </div>

            {/* 快速选择 */}
            {availableBaseOrgs.length > 0 && (
              <div className="mt-8 w-full max-w-md">
                <p className="text-xs font-medium text-slate-400 text-center mb-3 tracking-widest uppercase">快速进入</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {availableBaseOrgs.map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => setSelectedScopeOrgId(org.id)}
                      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-4 py-3 text-left transition-all duration-200 hover:border-blue-300 hover:shadow-[0_4px_16px_rgba(59,130,246,0.12)]"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 opacity-0 transition-opacity duration-200 group-hover:opacity-5" />
                      <p className="text-sm font-medium text-slate-700 group-hover:text-blue-700 transition-colors truncate">{org.name}</p>
                      <p className="mt-0.5 text-xs text-slate-400 group-hover:text-blue-400 transition-colors">{org.orgCode}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
  );
}
