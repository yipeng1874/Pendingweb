import { useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react";

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" style={{ padding: 0, overflow: "hidden" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(226,232,240,0.9)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{title}</div>
          <button type="button" className="btn btn-ghost icon-btn" style={{ minWidth: 40, minHeight: 40 }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

export function MiniDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (value ? new Date(value) : new Date()));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

  const dayElements = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const elements: React.ReactNode[] = [];

    for (let i = 0; i < firstDay; i += 1) {
      elements.push(<div key={`empty-${i}`} style={{ height: 40 }} />);
    }

    for (let d = 1; d <= daysInMonth; d += 1) {
      const currentDate = new Date(year, month, d);
      currentDate.setHours(0, 0, 0, 0);
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isSelected = value === dateStr;
      const isToday = currentDate.getTime() === today.getTime();
      const isPast = currentDate.getTime() < today.getTime();

      elements.push(
        <button
          key={d}
          type="button"
          disabled={isPast}
          onClick={() => {
            onChange(dateStr);
            setOpen(false);
          }}
          style={{
            height: 40,
            width: "100%",
            border: "none",
            borderRadius: 14,
            background: isSelected ? "#2563eb" : isToday ? "#eff6ff" : "transparent",
            color: isPast ? "#cbd5e1" : isSelected ? "#fff" : isToday ? "#2563eb" : "#334155",
            fontWeight: isSelected || isToday ? 700 : 500,
            cursor: isPast ? "not-allowed" : "pointer",
          }}
        >
          {d}
        </button>
      );
    }

    return elements;
  }, [month, onChange, value, year]);

  return (
    <>
      <button
        type="button"
        className="input"
        style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}
        onClick={() => setOpen(true)}
      >
        <CalendarClock size={15} color="#94a3b8" />
        <span style={{ color: value ? "#0f172a" : "#94a3b8" }}>{value || "请选择日期"}</span>
      </button>

      {open ? (
        <Sheet title="选择日期" onClose={() => setOpen(false)}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <button type="button" className="btn btn-ghost icon-btn" style={{ minWidth: 40, minHeight: 40 }} onClick={prevMonth}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{year}年 {month + 1}月</span>
            <button type="button" className="btn btn-ghost icon-btn" style={{ minWidth: 40, minHeight: 40 }} onClick={nextMonth}>
              <ChevronRight size={16} />
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 8 }}>
            {weekDays.map((w) => (
              <div key={w} style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", padding: "2px 0" }}>{w}</div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>{dayElements}</div>
        </Sheet>
      ) : null}
    </>
  );
}

export function MiniTimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const currentHour = value ? value.split(":")[0] : "23";
  const currentMinute = value ? value.split(":")[1] : "59";
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = ["00", "15", "30", "45", "59"];

  const handleSelect = (h: string, m: string) => {
    onChange(`${h}:${m}`);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="input"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left" }}
        onClick={() => setOpen(true)}
      >
        <span style={{ color: value ? "#0f172a" : "#94a3b8" }}>{value || "选择时间"}</span>
        <Clock3 size={15} color="#94a3b8" />
      </button>

      {open ? (
        <Sheet title="选择时间" onClose={() => setOpen(false)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ border: "1px solid rgba(226,232,240,0.9)", borderRadius: 18, overflow: "hidden" }}>
              <div style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", padding: "10px 0", borderBottom: "1px solid rgba(226,232,240,0.9)", background: "#f8fafc" }}>小时</div>
              <div style={{ maxHeight: 260, overflowY: "auto", padding: 8 }}>
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onChange(`${h}:${currentMinute}`)}
                    style={{
                      width: "100%",
                      border: "none",
                      borderRadius: 12,
                      background: h === currentHour ? "#eff6ff" : "transparent",
                      color: h === currentHour ? "#2563eb" : "#475569",
                      fontWeight: h === currentHour ? 700 : 500,
                      padding: "10px 0",
                      cursor: "pointer",
                    }}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ border: "1px solid rgba(226,232,240,0.9)", borderRadius: 18, overflow: "hidden" }}>
              <div style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", padding: "10px 0", borderBottom: "1px solid rgba(226,232,240,0.9)", background: "#f8fafc" }}>分钟</div>
              <div style={{ maxHeight: 260, overflowY: "auto", padding: 8 }}>
                {minutes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleSelect(currentHour, m)}
                    style={{
                      width: "100%",
                      border: "none",
                      borderRadius: 12,
                      background: m === currentMinute ? "#eff6ff" : "transparent",
                      color: m === currentMinute ? "#2563eb" : "#475569",
                      fontWeight: m === currentMinute ? 700 : 500,
                      padding: "10px 0",
                      cursor: "pointer",
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
