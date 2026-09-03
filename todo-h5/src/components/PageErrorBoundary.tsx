import { Component, type ErrorInfo, type ReactNode } from "react";

export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("H5 页面加载失败", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page-shell">
        <main className="mobile-page section" style={{ paddingTop: 60 }}>
          <div className="card detail-block" role="alert">
            <h1 className="card-title">页面暂时无法显示</h1>
            <p className="card-subtitle">请重新加载页面后再试。</p>
            <div className="action-row">
              <button className="btn btn-primary" onClick={() => window.location.reload()}>重新加载</button>
              <a className="btn btn-ghost" href="/todos">返回我的待办</a>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
