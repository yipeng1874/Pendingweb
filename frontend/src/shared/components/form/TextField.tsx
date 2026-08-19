export function TextField({ label, value, onChange, readOnly = false, maxLength }: { label: string; value: string; onChange: (value: string) => void; readOnly?: boolean; maxLength?: number }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-feishu-blue read-only:bg-slate-50 read-only:text-slate-500"
        value={value}
        readOnly={readOnly}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
      {!readOnly && maxLength && <span className="mt-1 block text-right text-xs text-slate-400">{value.length}/{maxLength} 字符</span>}
    </label>
  );
}
