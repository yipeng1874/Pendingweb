const styles: Record<string, string> = {
  active: "border-[#BEEAD5] bg-[#ECFDF3] text-[#17A34A]",
  pending: "border-[#FFD7A8] bg-[#FFF6E8] text-[#D97706]",
  submitted: "border-[#BEEAD5] bg-[#ECFDF3] text-[#17A34A]",
  published: "border-[#C7D7FF] bg-[#EEF4FF] text-[#4C72FF]",
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  overdue: "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]",
  paused: "border-slate-200 bg-slate-100 text-slate-500",
};

const labels: Record<string, string> = {
  active: "有效",
  pending: "待完成",
  submitted: "已提交",
  published: "已发布",
  draft: "草稿",
  overdue: "已逾期",
  paused: "已暂停",
};

export function StatusTag({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium tracking-[0.01em] shadow-[0_4px_12px_rgba(15,23,42,0.03)] ${styles[status] ?? styles.draft}`}>{labels[status] ?? status}</span>;
}
