import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WorkflowCard, BroadcastCard } from "../src/components/CollaborationTaskCards";
import { TodoDetailPage } from "../src/pages/TodoDetailPage";
import { TodoListPage } from "../src/pages/TodoListPage";
import { useAuthStore } from "../src/stores/auth";
import { dailySupplementDeadline, hallRecordForDetail, learningLink, recordEditingReason, workflowEditingReason } from "../src/utils/taskFilling";
import type { CollaborationQuestion, WorkflowTask, BroadcastTask, HallDailyRecord, TaskRecord } from "../src/types";
import "../src/styles.css";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
useAuthStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
useAuthStore.setState({ token: "fixture", currentIdentity: { id: "identity", userId: "me", roleCode: "HALL_MANAGER" } });
const root = createRoot(document.getElementById("root")!);
const results: string[] = [];
const requests: Array<{ path: string; body: any; headers: Headers }> = [];
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString();
const questions: CollaborationQuestion[] = [
  { id: "qa", title: "今天的情况", itemType: "QA", isRequired: true },
  { id: "fill", title: "完成情况", itemType: "FILL_BLANK", isRequired: true },
  { id: "single", title: "单选题", itemType: "SINGLE_CHOICE", isRequired: true, options: ["甲", "乙"] },
  { id: "multi", title: "多选题", itemType: "MULTI_CHOICE", isRequired: true, options: ["甲", "乙"] },
  { id: "link", title: "学习资料", itemType: "LINK", isRequired: true, linkUrl: "example.com" },
  { id: "file", title: "上传凭证", itemType: "ATTACHMENT", isRequired: true },
];
let workflow: WorkflowTask;
let broadcast: BroadcastTask;
let hall: HallDailyRecord;
let record: TaskRecord;
let failNext = false;
function reset() {
  workflow = { id: "workflow", title: "流转填写测试", status: "in_progress", dueAt: tomorrow, createdAt: "", createdByName: "发布人", targetOrgName: "测试厅", currentStepOrder: 1, steps: [
    { id: "other", order: 1, title: "别人的节点", requirement: "", assigneeUserId: "other", assigneeName: "其他人", status: "active", questions: [questions[0]], stepAnswers: [] },
    { id: "mine", order: 2, title: "自己的节点", requirement: "请按实际填写", assigneeUserId: "me", assigneeName: "本人", status: "pending", questions, stepAnswers: [] },
  ] };
  broadcast = { id: "broadcast", title: "直达填写测试", status: "active", dueAt: tomorrow, createdAt: "", createdByName: "发布人", hallOrgName: "测试厅", questions, myRecord: { id: "br", status: "pending", answers: [] } } as BroadcastTask;
  hall = { id: "hall", recordDate: today, status: "pending", doneItems: 0, totalItems: 6, hallOrg: { id: "org", name: "测试厅" }, assignment: { id: "a", status: "active", template: { id: "template", title: "厅管日常测试", items: questions.map((q) => ({ ...q, options: q.options?.map((label, index) => ({ id: String(index), label, sortOrder: index })) })) } }, itemRecords: [] };
  record = { ...hallRecordForDetail(hall), id: "record", assignment: { ...hallRecordForDetail(hall).assignment!, category: "TEMPORARY", temporaryMode: "ACCOUNT" } };
}
reset();
window.fetch = async (input, init = {}) => {
  const path = String(input);
  const body = init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : undefined;
  const headers = new Headers(init.headers);
  requests.push({ path, body, headers });
  const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));
  if (failNext && path.endsWith("/answer")) { failNext = false; return new Response(JSON.stringify({ success: false, error: { message: "模拟断网，请重试" } }), { status: 503 }); }
  if (path === "/api/tasks/collaboration/workflows/mine") return ok([workflow]);
  if (path === "/api/tasks/collaboration/broadcast/mine") return ok([broadcast]);
  if (path === "/api/hall-daily/my-records") return ok([hall]);
  if (path === "/api/tasks/my-records") return ok([record]);
  if (path === "/api/tasks/my-records/record") return ok(record);
  if (path === "/api/tasks/collaboration/workflows/workflow/steps/mine/answer") {
    const step = workflow.steps[1]; step.stepAnswers!.push(body);
    if (step.stepAnswers!.length === 6) step.status = "completed";
    return ok({ task: workflow, stepCompleted: step.status === "completed" });
  }
  if (path === "/api/tasks/collaboration/broadcast/broadcast/answer") {
    broadcast.myRecord.answers.push(body);
    if (broadcast.myRecord.answers.length === 6) broadcast.myRecord.status = "submitted";
    return ok({ task: broadcast, recordCompleted: broadcast.myRecord.status === "submitted" });
  }
  if (path.endsWith("/attachments/upload")) {
    check(body instanceof FormData && body.get("file") instanceof File, "协作上传传递 File");
    check(!headers.has("Content-Type"), "协作上传使用浏览器 multipart boundary");
    return ok({ fileUrl: "/uploads/workflow/proof.pdf", fileName: "proof.pdf" });
  }
  if (path === "/api/hall-daily/item-records" || path === "/api/tasks/item-records") {
    const target = path.includes("hall-daily") ? hall : record;
    check(body.taskRecordId === target.id, "子任务保存使用正确记录 ID");
    const old = target.itemRecords!.find((row) => row.taskItemId === body.taskItemId);
    const item = { ...old, ...body, id: `ir-${body.taskItemId}`, status: body.done ? "done" : "pending" };
    target.itemRecords = [...target.itemRecords!.filter((row) => row.taskItemId !== body.taskItemId), item];
    target.doneItems = target.itemRecords.filter((row) => row.status === "done").length;
    target.status = target.doneItems >= target.totalItems ? "submitted" : "in_progress";
    return ok(target === record && record.assignment?.temporaryMode === "MANAGER" ? record : item);
  }
  if (path === "/api/tasks/hall-daily/upload") {
    check(body.get("hallTaskItemRecordId") === "ir-file" && !body.has("taskItemRecordId"), "厅管图片上传使用专属关联字段");
    check(!headers.has("Content-Type"), "厅管上传使用浏览器 multipart boundary");
    const attachment = { id: "attachment", fileUrl: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2280%22%20height%3D%2280%22%3E%3Crect%20width%3D%2280%22%20height%3D%2280%22%20fill%3D%22%23dbeafe%22%2F%3E%3C%2Fsvg%3E", fileName: "proof.png" };
    hall.itemRecords!.find((row) => row.taskItemId === "file")!.attachments = [attachment];
    return ok(attachment);
  }
  if (path === "/api/tasks/upload") {
    check(body.get("taskItemRecordId") === "ir-file", "普通任务上传必须关联子任务记录，不能使用整条任务 ID");
    const attachment = { id: "attachment", fileUrl: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2280%22%20height%3D%2280%22%3E%3Crect%20width%3D%2280%22%20height%3D%2280%22%20fill%3D%22%23dbeafe%22%2F%3E%3C%2Fsvg%3E", fileName: "proof.png" };
    record.itemRecords!.find((row) => row.taskItemId === "file")!.attachments = [attachment];
    return ok(attachment);
  }
  if (path === "/api/hall-daily/my-records/hall/submit") { hall.status = "submitted"; return ok(hall); }
  throw new Error(`测试不允许真实网络请求: ${path}`);
};
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); }
function passed(message: string) { results.push(`通过：${message}`); document.getElementById("results")!.textContent = results.join("\n"); }
async function settle() { for (let i = 0; i < 100; i++) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); if (!/保存中|加载中|正在处理附件|正在加载待办|提交中/.test(document.getElementById("root")!.textContent || "")) return; } throw new Error("操作未结束"); }
async function render(node: React.ReactNode) { await act(async () => root.render(node)); await settle(); }
async function click(button: Element | undefined | null) { check(button, "按钮存在"); await act(async () => (button as HTMLElement).click()); await settle(); }
function button(scope: ParentNode, text: string) { return [...scope.querySelectorAll("button")].find((node) => node.textContent?.trim() === text); }
async function type(input: HTMLTextAreaElement, text: string) {
  check(input, "输入框存在");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function upload(input: HTMLInputElement, file: File) {
  const files = new DataTransfer(); files.items.add(file);
  await act(async () => { input.files = files.files; input.dispatchEvent(new Event("change", { bubbles: true })); }); await settle();
}
function question(title: string) { return [...document.querySelectorAll(".collaboration-question")].find((node) => node.querySelector("strong")?.textContent?.includes(title) && node.querySelector("fieldset"))!; }
function assertWidth() {
  check(document.documentElement.scrollWidth <= window.innerWidth, "页面没有水平溢出");
  document.querySelectorAll("textarea").forEach((input) => { const box = input.getBoundingClientRect(), parent = input.closest(".detail-item")!.getBoundingClientRect(); check(box.right <= parent.right + 1 && box.left >= parent.left, "输入框不会漂移出卡片"); });
}
function WorkflowDemo() { const [task, setTask] = useState(structuredClone(workflow)); return <WorkflowCard task={task} currentUserId="me" onUpdate={setTask} />; }
function BroadcastDemo() { const [task, setTask] = useState(structuredClone(broadcast)); return <BroadcastCard task={task} onUpdate={setTask} />; }
async function fillCollaboration() {
  await click(document.querySelector(".dashboard-card-toggle"));
  const q = question("今天的情况");
  check((button(q, "确认本题") as HTMLButtonElement).disabled, "空必填回答不可提交");
  await type(q.querySelector("textarea")!, "手机上填写的回答");
  failNext = true; await click(button(q, "确认本题"));
  check(q.textContent?.includes("模拟断网") && q.querySelector("textarea")!.value === "手机上填写的回答", "失败保留输入并可重试");
  await click(button(q, "确认本题"));
  check(!q.querySelector("textarea"), "已确认答案只读");
  const fill = question("完成情况"); await type(fill.querySelector("textarea")!, "已完成检查"); await click(button(fill, "确认本题"));
  const single = question("单选题"); await click(button(single, "乙")); await click(button(single, "确认本题"));
  const multi = question("多选题"); await click(button(multi, "甲")); await click(button(multi, "乙")); await click(button(multi, "确认本题"));
  const link = question("学习资料"); check(link.querySelector("a")!.href === "https://example.com/", "链接格式兼容 PC"); await click(link.querySelector("input")); await click(button(link, "确认本题"));
  const file = question("上传凭证"); await upload(file.querySelector("input")!, new File(["proof"], "proof.pdf", { type: "application/pdf" })); await click(button(file, "确认本题"));
  assertWidth();
}

async function run() {
  check(!workflowEditingReason(workflow, workflow.steps[1], "me"), "本人非当前节点可以填写");
  check(Boolean(workflowEditingReason(workflow, workflow.steps[0], "me")), "其他人的节点不可填写");
  check(Boolean(workflowEditingReason({ ...workflow, dueAt: "2000-01-01" }, workflow.steps[1], "me")), "截止节点不可填写");
  check(dailySupplementDeadline("2026-09-03") === "2026-09-04T08:00:00.000Z", "补录截止为次日北京时间16点");
  check(Boolean(recordEditingReason(hallRecordForDetail({ ...hall, leaveRequests: [{ id: "leave", reason: "", status: "pending" }] }))), "厅管请假审核期间只读");
  check(!recordEditingReason({ ...record, status: "submitted" }), "组织临时任务支持提交后补充");
  check(Boolean(recordEditingReason({ ...record, subjectType: "USER", status: "submitted" })), "个人已提交任务只读");
  check(!learningLink("javascript:alert(1)"), "拒绝无效学习链接");
  passed("负责人、截止时间、请假、补录和提交后补充规则");
  await render(<WorkflowDemo />); await fillCollaboration();
  check(workflow.steps[1].status === "completed" && workflow.steps[0].stepAnswers!.length === 0, "自己的节点完成，其他节点保持原样");
  passed("流转六种题型、失败重试、附件上传及节点自动完成");
  await render(<BroadcastDemo />); await fillCollaboration(); check(broadcast.myRecord.status === "submitted", "直达自动完成");
  passed("厅内直达六种题型和自动完成");
  reset();
  hall.totalItems = 7;
  hall.assignment!.template!.items!.push({ id: "optional", title: "选填备注", itemType: "QA", isRequired: false });
  await render(<MemoryRouter initialEntries={["/todos/hall/hall"]}><Routes><Route path="/todos/hall/:id" element={<TodoDetailPage kind="hall" />} /></Routes></MemoryRouter>);
  function hallItem(title: string) { return [...document.querySelectorAll(".detail-item")].find((node) => node.querySelector(".detail-item-title")?.textContent?.includes(title))!; }
  let item = hallItem("今天的情况"); await type(item.querySelector("textarea")!, "厅管回答"); await click(button(item, "提交回答"));
  await click(button(hallItem("完成情况"), "确认完成该项"));
  await click(button(hallItem("单选题"), "乙"));
  item = hallItem("多选题"); await click(button(item, "甲")); await click(button(item, "乙")); await click(button(item, "确认多选结果"));
  item = hallItem("学习资料");
  await act(async () => { const a = item.querySelector("a")!; a.addEventListener("click", (event) => event.preventDefault(), { once: true }); a.click(); });
  await click(button(item, "已完成学习并确认"));
  // Tiny valid PNG avoids compression; its upload must use the hall-specific ID field.
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
  await upload(hallItem("上传凭证").querySelector("input")!, new File([png], "proof.png", { type: "image/png" }));
  await click(button(hallItem("上传凭证"), "确认附件已上传"));
  check(hall.status === "submitted" && document.body.textContent?.includes("自动提交成功"), "厅管必填项完成自动提交");
  check(!document.querySelector("textarea"), "已提交厅管任务无可编辑输入框");
  assertWidth(); passed("厅管六种题型、正确保存和图片上传接口、自动提交及提交后只读");
  for (const mode of ["DAILY", "ACCOUNT", "ANCHOR", "MANAGER"]) {
    reset();
    record.assignment = { ...record.assignment!, category: mode === "DAILY" ? "DAILY" : "TEMPORARY", temporaryMode: mode, status: "active" };
    await render(<MemoryRouter key={mode} initialEntries={["/todos/record"]}><Routes><Route path="/todos/:id" element={<TodoDetailPage />} /></Routes></MemoryRouter>);
    const qa = hallItem("今天的情况"); await type(qa.querySelector("textarea")!, `${mode} 回答`); await click(button(qa, "提交回答"));
    check(record.itemRecords!.some((row) => row.answerText === `${mode} 回答`), `${mode} 保存到普通待办接口`);
    if (mode === "MANAGER") {
      await upload(hallItem("上传凭证").querySelector("input")!, new File([png], "proof.png", { type: "image/png" }));
      check(record.itemRecords!.some((row) => row.attachments?.length), "管理式兼容整条记录响应并成功关联图片");
    }
    assertWidth();
  }
  passed("主播日常、触达式、主播式、管理式填写入口及管理式图片关联");
  reset();
  await render(<MemoryRouter key="list" initialEntries={["/todos?category=hall"]}><Routes><Route path="/todos" element={<TodoListPage />} /><Route path="/todos/hall/:id" element={<TodoDetailPage kind="hall" />} /></Routes></MemoryRouter>);
  await click(document.querySelector(".todo-card-button")); check(Boolean(document.querySelector("textarea")), "厅管列表可进入填写详情");
  passed("厅管列表到详情路由");
  reset();
  await render(<MemoryRouter key="completion" initialEntries={["/todos?category=workflow"]}><TodoListPage /></MemoryRouter>);
  await fillCollaboration();
  check(document.querySelector(".todo-completed-group")?.textContent?.includes("已完成（1）") && !document.querySelector(".todo-completed-group")?.hasAttribute("open"), "完成后自动移入折叠分组");
  passed("流转完成后待办计数更新并折叠");
  passed("全部验证完成，未连接真实后台");
}
if (new URLSearchParams(location.search).has("preview")) {
  document.getElementById("results")!.textContent = "手机填写示例（模拟数据）";
  render(<div className="page-shell"><div className="mobile-page"><main className="section"><WorkflowDemo /></main></div></div>).then(() => click(document.querySelector(".dashboard-card-toggle")));
} else run().catch((error) => { document.getElementById("results")!.textContent = `${results.join("\n")}\n失败：${error.stack}`; console.error(error); });
