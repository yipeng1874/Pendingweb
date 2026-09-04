import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import "./mobileDateTimePicker.css";

type Parts = { year: number; month: number; day: number; hour: number; minute: number };
const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
const pad = (n: number) => String(n).padStart(2, "0");
export const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
function initialValue(value: string): Parts {
  const date = value ? new Date(value) : new Date();
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: value ? date.getHours() : 23, minute: value ? date.getMinutes() : 59 };
}
const formatValue = (p: Parts) => `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;

function Wheel({ label, values, value, onChange }: { label: string; values: number[]; value: number; onChange: (value: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const index = values.indexOf(value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / 44) !== index) el.scrollTop = index * 44;
  }, [index, values.length]);
  return <div className="mdt-column"><span className="mdt-unit">{label}</span><div ref={ref} className="mdt-wheel" role="listbox" aria-label={label} aria-activedescendant={`mdt-${label}-${value}`} tabIndex={0}
    onScroll={event => { const i = Math.max(0, Math.min(values.length - 1, Math.round(event.currentTarget.scrollTop / 44))); if (values[i] !== value) onChange(values[i]); }}
    onKeyDown={event => {
      const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (delta) { event.preventDefault(); onChange(values[Math.max(0, Math.min(values.length - 1, index + delta))]); }
      if (event.key === "Home" || event.key === "End") { event.preventDefault(); onChange(event.key === "Home" ? values[0] : values[values.length - 1]); }
    }}>
    {values.map(n => <div className={`mdt-option${n === value ? " mdt-selected" : ""}`} role="option" aria-selected={n === value} id={`mdt-${label}-${n}`} key={n} onClick={() => onChange(n)}>{label === "年" ? n : pad(n)}</div>)}
  </div></div>;
}

function DateSheet({ value, onConfirm, onClose }: { value: string; onConfirm: (value: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => initialValue(value));
  const [stage, setStage] = useState<"date" | "time">("date");
  const sheet = useRef<HTMLDivElement>(null);
  const today = new Date();
  const yearStart = Math.min(today.getFullYear() - 1, draft.year);
  const yearEnd = Math.max(today.getFullYear() + 20, draft.year);
  function change(patch: Partial<Parts>) {
    setDraft(old => { const next = { ...old, ...patch }; next.day = Math.min(next.day, daysInMonth(next.year, next.month)); return next; });
  }
  useEffect(() => {
    const overflow = document.body.style.overflow;
    const focused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    sheet.current?.focus();
    return () => { document.body.style.overflow = overflow; focused?.focus(); };
  }, []);
  const quickDate = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); change({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }); };
  return createPortal(<div className="mdt-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={sheet} tabIndex={-1} className="mdt-sheet" role="dialog" aria-modal="true" aria-labelledby="mdt-title" onKeyDown={e => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = Array.from(sheet.current!.querySelectorAll<HTMLElement>('button,[tabindex="0"]'));
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}>
      <div className="mdt-handle" /><header className="mdt-header"><button type="button" onClick={stage === "date" ? onClose : () => setStage("date")}>{stage === "date" ? "取消" : "上一步"}</button><h2 id="mdt-title">{stage === "date" ? "选择截止日期" : "选择截止时刻"}</h2><button type="button" className="mdt-confirm" onClick={() => stage === "date" ? setStage("time") : onConfirm(formatValue(draft))}>{stage === "date" ? "下一步" : "确定"}</button></header>
      <div className="mdt-steps"><button type="button" aria-current={stage === "date" ? "step" : undefined} onClick={() => setStage("date")}>{draft.year}/{pad(draft.month)}/{pad(draft.day)}</button><span>›</span><button type="button" aria-current={stage === "time" ? "step" : undefined} onClick={() => setStage("time")}>{pad(draft.hour)}:{pad(draft.minute)}</button></div>
      <div className={`mdt-wheels mdt-${stage}`} key={stage}>{stage === "date" ? <><Wheel label="年" values={range(yearStart, yearEnd)} value={draft.year} onChange={year => change({ year })} /><Wheel label="月" values={range(1, 12)} value={draft.month} onChange={month => change({ month })} /><Wheel label="日" values={range(1, daysInMonth(draft.year, draft.month))} value={draft.day} onChange={day => change({ day })} /></> : <><Wheel label="时" values={range(0, 23)} value={draft.hour} onChange={hour => change({ hour })} /><Wheel label="分" values={range(0, 59)} value={draft.minute} onChange={minute => change({ minute })} /></>}</div>
      <div className="mdt-shortcuts">{stage === "date" ? <><button type="button" onClick={() => quickDate(0)}>今天</button><button type="button" onClick={() => quickDate(1)}>明天</button></> : <button type="button" onClick={() => change({ hour: 23, minute: 59 })}>设为当天 23:59</button>}</div>
    </div>
  </div>, document.body);
}

export function MobileDateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={`mdt-trigger${value ? " mdt-has-value" : ""}`} aria-label="截止时间" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><span>{value ? value.replace("T", " ").replace(/-/g, "/") : "请选择截止时间"}</span><CalendarDays size={18} /></button>{open && <DateSheet value={value} onClose={() => setOpen(false)} onConfirm={next => { onChange(next); setOpen(false); }} />}</>;
}
