import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";

export function MiniDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (value ? new Date(value) : new Date()));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (open && value) setViewDate(new Date(value));
  }, [open, value]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dayElements = [];
  for (let i = 0; i < firstDay; i++) {
    dayElements.push(<div key={`empty-${i}`} className="h-8 w-8" />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const currentDate = new Date(year, month, d);
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isSelected = value === dateStr;
    const isToday = currentDate.getTime() === today.getTime();
    const isPast = currentDate.getTime() < today.getTime();

    dayElements.push(
      <button
        key={d}
        type="button"
        disabled={isPast}
        onClick={() => {
          onChange(dateStr);
          setOpen(false);
        }}
        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition ${
          isPast
            ? "cursor-not-allowed text-slate-300"
            : isSelected
              ? "bg-blue-500 font-semibold text-white shadow-sm"
              : isToday
                ? "bg-blue-50 font-semibold text-blue-600"
                : "text-slate-700 hover:bg-slate-100"
        }`}
      >
        {d}
      </button>
    );
  }

  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    <div className="relative" ref={containerRef}>
      <CalendarClock size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
      <div
        onClick={() => setOpen(true)}
        className={`flex w-full cursor-pointer items-center rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm transition hover:border-blue-400 ${open ? "border-blue-400 ring-4 ring-blue-100" : ""}`}
      >
        <span className={value ? "text-slate-900" : "text-slate-400"}>{value || "请选择日期"}</span>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[270px] rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_10px_40px_rgba(0,0,0,0.1)]">
          <div className="mb-3 flex items-center justify-between px-1">
            <button type="button" onClick={prevMonth} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-800">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-slate-800">
              {year}年 {month + 1}月
            </span>
            <button type="button" onClick={nextMonth} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-800">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7 place-items-center gap-1">
            {weekDays.map((w) => (
              <div key={w} className="w-8 text-center text-[11px] font-medium text-slate-400">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 place-items-center gap-1">{dayElements}</div>
        </div>
      )}
    </div>
  );
}

export function MiniTimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const currentHour = value ? value.split(":")[0] : "23";
  const currentMinute = value ? value.split(":")[1] : "59";

  const handleSelect = (h: string, m: string) => {
    onChange(`${h}:${m}`);
    setOpen(false);
  };

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = ["00", "15", "30", "45", "59"];

  return (
    <div className="relative" ref={containerRef}>
      <div
        onClick={() => setOpen(!open)}
        className={`flex w-full cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition hover:border-blue-400 ${open ? "border-blue-400 ring-4 ring-blue-100" : ""}`}
      >
        <span className={value ? "text-slate-900" : "text-slate-400"}>{value || "选择时间"}</span>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 flex h-[200px] w-48 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_10px_40px_rgba(0,0,0,0.1)]">
          <div className="custom-scrollbar flex-1 overflow-y-auto border-r border-slate-100 p-1">
            <div className="sticky top-0 bg-white/90 pb-1 pt-2 text-center text-[10px] font-semibold text-slate-400 backdrop-blur">小时</div>
            {hours.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onChange(`${h}:${currentMinute}`)}
                className={`w-full rounded-lg py-1.5 text-xs transition ${h === currentHour ? "bg-blue-50 font-semibold text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {h}
              </button>
            ))}
          </div>
          <div className="custom-scrollbar flex-1 overflow-y-auto p-1">
            <div className="sticky top-0 bg-white/90 pb-1 pt-2 text-center text-[10px] font-semibold text-slate-400 backdrop-blur">分钟</div>
            {minutes.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleSelect(currentHour, m)}
                className={`w-full rounded-lg py-1.5 text-xs transition ${m === currentMinute ? "bg-blue-50 font-semibold text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
