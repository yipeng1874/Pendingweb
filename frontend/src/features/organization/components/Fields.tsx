export function Field({ label, value, required, onChange }: { label: string; value: string; required?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}{required && <span className="ml-1 text-red-500">*</span>}</span>
      <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-feishu-blue" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function Info({ label, value, required }: { label: string; value: string; required?: boolean }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs text-slate-400">{label}{required && <span className="ml-1 text-red-500">*</span>}</p>
      <p className="mt-2 text-sm font-medium text-slate-700">{value}</p>
    </div>
  );
}

export function EditableInfo({ label, value, fallback, isEditing, readonly, multiline, required, onChange }: { label: string; value: string; fallback?: string; isEditing: boolean; readonly?: boolean; multiline?: boolean; required?: boolean; onChange: (value: string) => void }) {
  if (!isEditing || readonly) return <Info label={label} value={value || fallback || "未登记"} required={required} />;
  return (
    <label className="block rounded-2xl bg-slate-50 p-4">
      <span className="text-xs text-slate-400">{label}{required && <span className="ml-1 text-red-500">*</span>}</span>
      {multiline ? (
        <textarea className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-feishu-blue" rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-feishu-blue" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}
