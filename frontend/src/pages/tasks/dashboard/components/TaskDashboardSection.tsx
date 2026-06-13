type Props = {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: number;
  pendingCount: number;
  urgentCount: number;
  overdueCount: number;
  tone: string;
  emptyText: string;
  children: React.ReactNode;
  variant?: "section" | "column";
  className?: string;
  action?: React.ReactNode;
  hideDescription?: boolean;
  hideStats?: boolean;
};

export function TaskDashboardSection({ icon, title, description, count, pendingCount, urgentCount, overdueCount, tone, emptyText, children, variant = "section", className = "", action, hideDescription = false, hideStats = false }: Props) {
  const isColumn = variant === "column";

  return (
    <section className={`border bg-white/95 shadow-[0_8px_24px_rgba(15,23,42,0.035)] ${isColumn ? "flex max-h-[calc(100vh-238px)] min-h-0 flex-col rounded-2xl border-slate-200/70" : "rounded-[28px] border-slate-100 p-4"} ${className}`}>
      <div className={`${isColumn ? "border-b border-slate-100 px-3 py-2.5" : "mb-4 flex flex-wrap items-start justify-between gap-3"}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-slate-800">{title}</h2>
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">{count}</span>
              {action && <div className="ml-auto shrink-0">{action}</div>}
            </div>
            {!hideDescription && <p className={`mt-0.5 text-[11px] leading-4 text-slate-400 ${isColumn ? "truncate" : ""}`}>{description}</p>}
          </div>
        </div>
        {!hideStats && (
          <div className={`${isColumn ? "mt-2 grid grid-cols-3 gap-1.5" : "flex flex-wrap gap-2 text-xs"}`}>
            <span className="rounded-lg bg-slate-50 px-2 py-1 text-center text-[11px] font-medium text-slate-500">未 {pendingCount}</span>
            <span className={`rounded-lg px-2 py-1 text-center text-[11px] font-medium ${urgentCount > 0 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-300"}`}>近 {urgentCount}</span>
            <span className={`rounded-lg px-2 py-1 text-center text-[11px] font-medium ${overdueCount > 0 ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-300"}`}>逾 {overdueCount}</span>
          </div>
        )}
      </div>
      {count === 0 ? (
        <div className="m-2 flex min-h-[180px] flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center text-slate-400">
          <div className="mb-2 text-slate-300">{icon}</div>
          <p className="text-xs">{emptyText}</p>
        </div>
      ) : (
        <div className={`${isColumn ? "custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-2" : "space-y-3"}`}>{children}</div>
      )}
    </section>
  );
}
