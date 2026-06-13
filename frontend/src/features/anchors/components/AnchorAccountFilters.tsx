import { Search } from "lucide-react";

interface AnchorAccountFiltersProps {
  keyword: string;
  setKeyword: (val: string) => void;
  status: string;
  setStatus: (val: string) => void;
  onRefresh: () => void;
}

export function AnchorAccountFilters({
  keyword,
  setKeyword,
  status,
  setStatus,
  onRefresh,
}: AnchorAccountFiltersProps) {
  return (
    <div className="grid gap-3 md:grid-cols-[220px_140px_auto]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          className="w-full rounded-2xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-feishu-blue"
          placeholder="昵称/抖音号/UID/手机号"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>
      <select className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-feishu-blue" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">全部状态</option>
        <option value="bound">使用中</option>
        <option value="unbound">未绑定</option>
        <option value="inactive">已停用</option>
      </select>
      <button className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600" onClick={onRefresh}>刷新</button>
    </div>
  );
}
