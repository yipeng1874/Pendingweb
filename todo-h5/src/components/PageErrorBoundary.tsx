import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCcw, ArrowLeft, CloudOff } from "lucide-react";

export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; resourceFailed: boolean }> {
  state = { failed: false, resourceFailed: false };

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { failed: true, resourceFailed: /dynamically imported module|loading chunk|chunkloaderror|importing a module script|module script failed|preload css/i.test(message) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("H5 页面加载失败", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page-shell">
        <main className="mobile-page page-recovery">
          <div className="page-recovery-card" role="alert">
            <div className="page-recovery-icon" aria-hidden="true">{this.state.resourceFailed ? <RefreshCcw size={28}/> : <CloudOff size={28}/>}</div>
            <h1>{this.state.resourceFailed ? "页面需要重新载入" : "页面暂时未能打开"}</h1>
            <p>{this.state.resourceFailed ? "可能是页面版本已更新，或网络暂时中断。请重新载入后继续。" : "请重新载入试试，也可以先返回我的待办。"}</p>
            <div className="page-recovery-actions">
              <button className="btn btn-primary" onClick={() => window.location.reload()}><RefreshCcw size={16}/>重新载入</button>
              <a className="page-recovery-back" href="/todos"><ArrowLeft size={15}/>返回我的待办</a>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
