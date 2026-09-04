import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BroadcastPublishPage } from "../src/pages/BroadcastPublishPage";
import { PublishTypePage } from "../src/pages/PublishTypePage";
import { useAuthStore } from "../src/stores/auth";
import "../src/styles.css";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
useAuthStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
useAuthStore.setState({ token: "mock", currentIdentity: { id: "hall", userId: "me", roleCode: "HALL_MANAGER" } });
const requests: string[] = [], posts: any[] = [], results: string[] = [];
let fail = true;
window.fetch = async (url, init = {}) => {
  const path = String(url); if (path.endsWith("/me/permissions")) return new Response(JSON.stringify({ success: true, data: [] })); requests.push(path);
  const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
  if (path.includes("/bootstrap")) throw new Error("禁止全量人员加载");
  if (path.includes("/recipients?type=")) return ok({ anchors: [{ userId: "one", nickname: "测试主播", phone: "13800000000", orgName: "一厅" }], hallManagers: [{ userId: "manager", nickname: "测试厅管", phone: "13900000000", orgName: "二厅" }], nextOffset: null });
  if (init.method === "POST") { posts.push(JSON.parse(String(init.body))); check(new Headers(init.headers).get("X-Identity-Id") === "hall", "发布携带当前身份"); if (fail) { fail = false; return new Response(JSON.stringify({ success: false, error: { message: "模拟失败" } }), { status: 503 }); } return ok({}); }
  if (path.includes("/recipients?page=")) return ok({ items: [{ id: "r", anchorNickname: "测试主播", status: "submitted", answers: [{ questionId: "q", answerText: "执行结果" }] }], hasMore: false });
  if (path.includes("/mobile-issued?")) return ok({ tasks: [{ id: "task", title: "群发验证", questions: [{ id: "q", title: "问题", itemType: "QA" }], _count: { anchorRecords: 1 }, completedCount: 1 }], hasMore: !path.includes("page=2") });
  throw new Error(path);
};
const root = createRoot(document.getElementById("root")!);
function check(value: unknown, label: string) { if (!value) throw new Error(label); results.push(`通过：${label}`); }
const pause = async (ms = 30) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
async function click(text: string) { const b = Array.from((document.querySelector('[role="dialog"]') || document).querySelectorAll("button,a")).find(el => el.textContent?.includes(text)) as HTMLElement; if (!b) throw new Error(`缺少 ${text}`); await act(async () => b.click()); await pause(); }
async function fill(selector: string, value: string) { const el = document.querySelector(selector) as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
async function run() {
  await act(async () => root.render(<MemoryRouter initialEntries={["/publish"]}><Routes><Route path="/publish" element={<PublishTypePage />} /><Route path="/publish/broadcast" element={<BroadcastPublishPage />} /></Routes></MemoryRouter>));
  check(document.body.textContent?.includes("流转任务") && document.body.textContent?.includes("群发任务"), "独立类型选择页");
  if (location.search.includes("preview")) { document.getElementById("results")!.hidden = true; return; }
  await click("群发任务"); check(requests.length === 0, "进入表单无全量请求");
  await click("下一步"); check(!!document.querySelector('[role="alertdialog"]'), "校验弹窗"); await click("知道了");
  await fill('[placeholder="请输入任务标题"]', "群发验证"); await click("下一步");
  check(document.querySelector('[role="alertdialog"]')?.textContent?.includes("请选择截止时间"), "截止时间必填"); await click("知道了");
  await click("请选择截止时间"); await click("下一步",); await click("确定"); await click("下一步");
  check(!!document.querySelector('.bp-anchor-list .bp-person'), "本厅主播直接展示");
  check(!document.querySelector('dialog'), "主播多选无需搜索弹窗");
  await act(async () => (document.querySelector('.bp-anchor-list input') as HTMLElement).click());  check(!document.querySelector('[aria-label="题目1标题"]'), "选人步骤不展示题目"); await click("下一步：配置题目");
  for (const [i, kind] of ["QA", "SINGLE_CHOICE", "MULTI_CHOICE", "FILL_BLANK", "LINK", "ATTACHMENT"].entries()) {
    if (i) await click("＋添加题目");
    await fill(`[aria-label="题目${i + 1}类型"]`, kind); await fill(`[aria-label="题目${i + 1}标题"]`, `问题${i + 1}`);
    if (kind.includes("CHOICE")) { const inputs = document.querySelectorAll('.wp-option-row input'); for (const [n, el] of Array.from(inputs).entries()) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, `选项${n}`); el.dispatchEvent(new Event("input", { bubbles: true })); }); } }
    if (kind === "LINK") await fill('[placeholder="https:// 学习链接"]', "https://example.com");
  }
  await click("上一步"); check(document.querySelector('.bp-anchor-list input:checked'), "返回保留已选接收人"); await click("下一步：配置题目"); check((document.querySelector('[aria-label="题目1标题"]') as HTMLInputElement).value === "问题1", "返回保留题目内容");
  await click("预览任务"); check(document.querySelectorAll('.wp-preview-options li').length === 4, "预览展示选择题选项");
  check((Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes("请核对")))?.disabled, "发布5秒等待"); await pause(5200);
  await click("确认发布"); check(document.body.textContent?.includes("模拟失败"), "失败可重试"); await click("知道了"); await click("确认发布");
  check(posts.length === 2 && posts[1].questions.length === 6 && posts[1].selectedRecipientUserIds[0] === "one", "六题型与接收人提交"); await click("查看发布记录");
  check(!requests.some(p => p.includes("/recipients?page=")), "列表不加载答案");
  await click("群发验证"); check(document.body.textContent?.includes("执行结果"), "展开加载答案");
  await click("加载更多（10条）"); check(requests.some(p => p.includes("page=2")), "记录分页");
  await click("已结束"); check(requests.some(p => p.includes("status=ended")), "历史分类按需请求");
  await act(async () => useAuthStore.setState({ currentIdentity: { id: "team", userId: "team", roleCode: "TEAM_ADMIN" } })); await click("下一步"); await click("知道了"); await fill('[placeholder="请输入任务标题"]', "团队任务"); await click("请选择截止时间"); await click("下一步"); await click("确定"); await click("下一步");
  check(!document.body.textContent?.includes("本厅主播"), "团队管理不能选择主播");
  await click("搜索选择接收人");
  await fill('[aria-label="搜索接收人"]', "测试"); await pause(400);
  await act(async () => (document.querySelector('dialog .bp-person input') as HTMLElement).click());
  await fill('[aria-label="搜索接收人"]', "155"); await pause(400);
  check(document.querySelector('.bp-selected')?.textContent?.includes("测试厅管"), "更换搜索词保留已选人员可见");
  check(!document.querySelector('dialog')?.textContent?.includes("暂无结果"), "不足搜索位数不显示错误空结果");
  await act(async () => (document.querySelector('[aria-label="取消选择测试厅管"]') as HTMLElement).click());
  check(!document.querySelector('.bp-selected'), "已选区支持取消"); await click("取消");
  await act(async () => useAuthStore.setState({ currentIdentity: { id: "base", userId: "base", roleCode: "BASE_ADMIN" } })); await pause(); check(!document.body.textContent?.includes("群发任务"), "高权限身份不显示群发入口");
  check(document.documentElement.scrollWidth <= window.innerWidth, "手机宽度无横向溢出");
}
run().then(() => document.getElementById("results")!.textContent = results.join("\n") + "\n全部通过").catch(e => document.getElementById("results")!.textContent = results.join("\n") + `\n失败：${e.message}`);
