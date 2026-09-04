import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkflowPublishPage } from "../src/pages/WorkflowPublishPage";
import { canPublishWorkflow } from "../src/services/workflowPublish";
import { useAuthStore } from "../src/stores/auth";
import "../src/styles.css";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
useAuthStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const identity = { id: "test", userId: "me", roleCode: "BASE_ADMIN" };
useAuthStore.setState({ token: "test", currentIdentity: identity });
const person = { userId: "worker", nickname: "测试执行人", phone: "13800000000", orgName: "测试厅", primaryCategory: "subordinate_anchor" };
let tasks: any[] = [], posts: any[] = [], failNext = true;
let searches = 0;
const issuedRequests: string[] = [];
window.fetch = async (url, init = {}) => {
  const path = String(url);
  const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
  if (path.includes("/bootstrap")) throw new Error("禁止下载全量人员");
  if (path.includes("/assignees/search")) { searches++; return ok([person]); }
  if (path.endsWith("/issued")) throw new Error("禁止全量加载发布历史");
  if (path.includes("/issued-page?")) { issuedRequests.push(path); const u = new URL(path, location.origin); const status = u.searchParams.get("status"); return ok({ items: status === "in_progress" ? tasks : [], nextCursor: status === "in_progress" && !u.searchParams.get("cursor") ? "next" : null }); }
  if (init.method === "POST") {
    const body = JSON.parse(String(init.body)); posts.push(body);
    check(new Headers(init.headers).get("X-Identity-Id") === "test", "发布携带当前身份");
    if (failNext) { failNext = false; return new Response(JSON.stringify({ success: false, error: { message: "模拟发布失败" } }), { status: 503 }); }
    const task = { ...body, id: "created", status: "in_progress", createdByName: "测试发布者", targetOrgName: "测试基地", steps: body.steps.map((s: any, i: number) => ({ ...s, id: `s${i}`, order: i + 1, status: "active", assigneeName: person.nickname, questions: s.questions.map((q: any, qi: number) => ({ ...q, id: `q${qi}` })), stepAnswers: [{ questionId: "q0", answerText: "已填写的结果" }] })) };
    tasks = [task]; return ok(task);
  }
  throw new Error(`未预期接口 ${path}`);
};
const root = createRoot(document.getElementById("root")!);
const results: string[] = [];
function check(value: unknown, label: string) { if (!value) throw new Error(label); results.push(`通过：${label}`); }
const pause = async (ms = 40) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
async function click(label: string, container: ParentNode = document) {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes(label));
  if (!button) throw new Error(`找不到按钮 ${label}`);
  await act(async () => button.click()); await pause();
}
async function fill(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
async function chooseDeadline() {
  await click("请选择截止时间");
  for (const [unit, value] of [["年", 2030], ["月", 9], ["日", 4]]) {
    await act(async () => document.getElementById(`mdt-${unit}-${value}`)!.click());
  }
  await click("下一步", document.querySelector('[role="dialog"]')!);
  for (const [unit, value] of [["时", 16], ["分", 0]]) {
    await act(async () => document.getElementById(`mdt-${unit}-${value}`)!.click());
  }
  await click("确定");
}
async function run() {
  await act(async () => root.render(<MemoryRouter initialEntries={["/publish"]}><Routes><Route path="/publish" element={<WorkflowPublishPage />} /><Route path="/todos" element={<p>无发布权限</p>} /></Routes></MemoryRouter>));
  await pause();
  if (location.search.includes("preview")) {
    document.getElementById("results")!.hidden = true;
    if (location.search.includes("nodes")) {
      await fill(document.querySelector('input[placeholder="请输入任务标题"]')!, "手机流转任务");
      await chooseDeadline();
      await click("下一步");
    }
    return;
  }
  for (const roleCode of ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN", "HALL_MANAGER"]) check(canPublishWorkflow({ ...identity, roleCode }), `${roleCode}可发布`);
  check(!canPublishWorkflow({ ...identity, roleCode: "ANCHOR" }), "主播无发布权限");
  await click("请选择截止时间");
  const today = new Date();
  check(document.querySelector('[aria-label="日"] [aria-selected="true"]')?.textContent === String(today.getDate()).padStart(2,"0"), "日期首次定位当天");
  check(document.querySelector(".mdt-steps")?.textContent?.includes("23:59"), "默认23点59分");
  await act(async () => document.getElementById("mdt-年-2028")!.click());
  await act(async () => document.getElementById("mdt-月-1")!.click());
  await act(async () => document.getElementById("mdt-日-31")!.click());
  await act(async () => document.getElementById("mdt-月-2")!.click());
  check(document.querySelector('[aria-label="日"] [aria-selected="true"]')?.textContent === "29", "闰年二月自动调整29天");
  await act(async () => document.getElementById("mdt-年-2027")!.click());
  check(document.querySelector('[aria-label="日"] [aria-selected="true"]')?.textContent === "28", "平年二月自动调整28天");
  await click("取消");
  check(document.querySelector('.mdt-trigger')?.textContent?.includes("请选择"), "取消不写入截止时间");
  await click("下一步"); check(document.body.textContent?.includes("请填写任务标题和截止时间"), "基本信息校验"); check(document.querySelector('[role="alertdialog"]'), "校验使用弹窗"); await click("知道了");
  await fill(document.querySelector('input[placeholder="请输入任务标题"]')!, "手机发布验证");
  await chooseDeadline();
  await click("下一步");
  check(document.querySelector('[role="dialog"][aria-label="选择执行人"]'), "配置节点先选择执行人");
  check(searches === 0 && !document.querySelector(".wp-picker .wp-person"), "打开选人不请求不展示全量人员");
  await click("取消");
  check(!document.querySelector(".wp-type-picker"), "取消选人不产生空节点");
  await click("预览任务"); check(document.body.textContent?.includes("请至少配置一个节点"), "无节点阻止预览"); await click("知道了");
  await click("添加下一节点");
  await fill(document.querySelector('input[aria-label="搜索执行人"]')!, "测试"); await pause(400);
  await click("测试执行人", document.querySelector('[role="dialog"]')!);
  check(document.querySelector(".wp-question-header select"), "选人自动创建题目并展示题型下拉框");
  await fill(document.querySelector('input[placeholder="请输入题目内容"]')!, "问答题");
  for (const [type, title] of [["FILL_BLANK", "待办题"], ["SINGLE_CHOICE", "单选题"], ["MULTI_CHOICE", "多选题"], ["LINK", "链接题"], ["ATTACHMENT", "附件题"]]) {
    await click("添加题目");
    const box = Array.from(document.querySelectorAll(".wp-question")).at(-1)!;
    await fill(box.querySelector("select")!, type);
    await fill(box.querySelector('input[placeholder="请输入题目内容"]')!, title);
    if (type.includes("CHOICE")) {
      const options = box.querySelectorAll<HTMLInputElement>(".wp-option-row input");
      check(options.length === 2, "选择题默认显示两个独立选项");
      await fill(options[0], "选项甲"); await fill(options[1], "选项乙");
      await click("添加选项", box);
      check(box.querySelectorAll(".wp-option-row").length === 3, "支持添加选项");
      await act(async () => (box.querySelector('[aria-label="删除选项3"]') as HTMLButtonElement).click());
    }
    if (type === "LINK") await fill(box.querySelector('input[type="url"]')!, "https://example.com");
  }
  await click("添加下一节点");
  await fill(document.querySelector('input[aria-label="搜索执行人"]')!, "测试"); await pause(400);
  await click("测试执行人", document.querySelector('[role="dialog"]')!);
  check(document.querySelectorAll("details.wp-panel").length === 2, "添加节点同样先选执行人");
  await click("删除节点", document.querySelectorAll("details.wp-panel")[1]);
  await click("预览任务");
  check(document.querySelectorAll(".wp-preview-options li").length === 4, "预览逐条显示单选多选选项");
  check(document.querySelector(".wp-publish-check")?.textContent?.includes("测试执行人"), "发布核对展示节点执行人");
  check(Array.from(document.querySelectorAll("button")).some(b => b.textContent?.includes("确认发布（") && b.disabled), "5秒倒计时禁止提前发布");
  await pause(5200);
  await click("确认发布"); check(document.body.textContent?.includes("模拟发布失败"), "失败保留预览供重试"); await click("知道了");
  await act(async () => { const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent === "确认发布")!; b.click(); b.click(); }); await pause();
  check(posts.length === 2, "连续点击只产生一次成功提交");
  check(posts[1].steps[0].questions.length === 6, "六题型全部随发布提交");
  check(posts[1].steps[0].questions[2].options.length === 2, "选项序列化一致");
  check(document.body.textContent?.includes("流转任务发布成功"), "成功转到发布记录"); await click("查看发布记录");
  check(issuedRequests.every(url => url.includes("status=in_progress")), "默认不请求已结束已完成");
  await click("加载更多"); check(issuedRequests.at(-1)?.includes("cursor=next"), "加载更多发送游标");
  await act(async () => (document.querySelector(".dashboard-card-toggle") as HTMLButtonElement).click());
  check(document.body.textContent?.includes("已填写的结果"), "发布者能查看执行答案");
  check(!Array.from(document.querySelectorAll("button")).some(b => b.textContent?.includes("提交回答")), "发布记录只读");
  await click("已完成"); check(issuedRequests.at(-1)?.includes("status=completed"), "点击才加载已完成分类");
  await click("已结束"); check(issuedRequests.at(-1)?.includes("status=ended"), "点击才加载已结束分类");
  await click("新建流转任务");
  await fill(document.querySelector('input[placeholder="请输入任务标题"]')!, "旧身份草稿");
  await act(async () => useAuthStore.setState({ currentIdentity: { ...identity, id: "another" } })); await pause();
  check((document.querySelector('input[placeholder="请输入任务标题"]') as HTMLInputElement).value === "", "切换身份清除旧草稿");
  await act(async () => useAuthStore.setState({ currentIdentity: { ...identity, roleCode: "ANCHOR" } })); await pause();
  check(document.body.textContent?.includes("无发布权限"), "无权限身份直接访问被拦截");
  document.getElementById("results")!.textContent = results.join("\n") + "\n全部通过";
}
run().catch(e => { document.getElementById("results")!.textContent = results.join("\n") + "\n失败：" + e.message; });
