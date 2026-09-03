import React, { act, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { PageErrorBoundary } from "../src/components/PageErrorBoundary";
import { useAuthStore } from "../src/stores/auth";
import "../src/styles.css";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// Keep this fixture isolated from real sessions and backend data.
useAuthStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
useAuthStore.setState({ token: "fixture", currentIdentity: { id: "fixture", userId: "fixture", roleCode: "BASE_ADMIN", org: { id: "base", name: "测试基地", orgType: "BASE" } } });
window.fetch = async () => new Response(JSON.stringify({ success: false, error: { message: "模拟接口不可用" } }), { status: 503 });
const root = createRoot(document.getElementById("root")!);
const report = document.getElementById("result")!;
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    if (check()) return;
  }
  throw new Error("页面未在预期时间内显示");
}
async function run() {
  await act(async () => { root.render(<PageErrorBoundary><MemoryRouter initialEntries={["/dashboard"]}><App /></MemoryRouter></PageErrorBoundary>); });
  await until(() => Boolean(document.querySelector(".compact-cockpit-header")));
  if (!document.querySelector("h1")?.textContent?.includes("仪表台")) throw new Error("仪表台懒加载失败");
  report.textContent = "通过：真实仪表台路由懒加载成功；接口失败时仍能显示页面。";

  // Reproduce the exact empty-module failure from the reported console message.
  const EmptyModule = lazy(() => Promise.resolve({ default: undefined as unknown as React.ComponentType }));
  await act(async () => { root.render(<PageErrorBoundary key="empty-module"><Suspense fallback="加载中"><EmptyModule /></Suspense></PageErrorBoundary>); });
  await until(() => Boolean(document.querySelector('[role="alert"]')));
  if (!document.querySelector('[role="alert"]')?.textContent?.includes("重新加载")) throw new Error("错误恢复入口缺失");
  report.textContent += " 通过：空模块异常被捕获，显示重新加载与返回待办入口。";
}
run().catch((error) => { report.textContent = `验证失败：${error.message}`; console.error(error); });
