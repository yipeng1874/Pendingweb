import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export function PublishFeedback({ message, success, onClose, onConfirm }: { message: string; success: boolean; onClose: () => void; onConfirm?: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    button.current?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="wp-feedback-overlay"><section className="wp-feedback" role="alertdialog" aria-modal="true" aria-labelledby="wp-feedback-title" aria-describedby="wp-feedback-message" onKeyDown={event => {
    if (event.key === "Escape") onClose();
    if (event.key === "Tab") { event.preventDefault(); if (onConfirm && document.activeElement === button.current) confirmButton.current?.focus(); else button.current?.focus(); }
  }}>
    <span className={`wp-feedback-icon ${success ? "success" : "attention"}`}>{success ? <CheckCircle2 size={28} /> : <AlertCircle size={28} />}</span>
    <h2 id="wp-feedback-title">{onConfirm ? "删除这道题目？" : success ? "发布成功" : "请注意"}</h2>
    <p id="wp-feedback-message">{message}</p>
    <div className="wp-feedback-actions"><button ref={button} type="button" className={`btn ${onConfirm ? "btn-ghost" : "btn-primary"}`} onClick={onClose}>{onConfirm ? "取消" : success ? "查看发布记录" : "知道了"}</button>{onConfirm && <button ref={confirmButton} type="button" className="btn wp-confirm-delete" onClick={onConfirm}>确认删除</button>}</div>
  </section></div>, document.body);
}
