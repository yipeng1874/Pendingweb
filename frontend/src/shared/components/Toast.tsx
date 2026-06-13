import { useEffect, useState } from "react";
import { CheckCircle, XCircle } from "lucide-react";

interface ToastProps {
  message: string;
  type: "success" | "error";
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 触发进入动画
    const enterTimer = setTimeout(() => setVisible(true), 10);
    // 自动消失
    const leaveTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, duration);
    return () => {
      clearTimeout(enterTimer);
      clearTimeout(leaveTimer);
    };
  }, [duration, onClose]);

  function dismiss() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  return (
    <>
      {/* 半透明遮罩，点击关闭 */}
      <div
        className={`fixed inset-0 z-[99] bg-black/20 transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
        onClick={dismiss}
      />
      {/* 居中弹窗 */}
      <div
        className={`fixed left-1/2 top-1/2 z-[100] -translate-x-1/2 -translate-y-1/2 flex min-w-[320px] max-w-sm items-start gap-4 rounded-3xl bg-white px-7 py-6 shadow-2xl transition-all duration-300 ${
          visible ? "scale-100 opacity-100" : "scale-90 opacity-0"
        } ${type === "error" ? "ring-2 ring-red-400" : "ring-2 ring-emerald-400"}`}
      >
        {type === "error"
          ? <XCircle size={30} className="mt-0.5 shrink-0 text-red-500" />
          : <CheckCircle size={30} className="mt-0.5 shrink-0 text-emerald-500" />}
        <div className="flex-1">
          <p className={`text-base font-semibold ${type === "error" ? "text-red-600" : "text-emerald-700"}`}>{message}</p>
          <p className="mt-1 text-xs text-slate-400">{duration / 1000} 秒后自动关闭</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
        >
          <XCircle size={18} />
        </button>
      </div>
    </>
  );
}
