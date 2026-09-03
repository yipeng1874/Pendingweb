import assert from "node:assert/strict";
import fs from "node:fs";
import { after, beforeEach, mock, test } from "node:test";

// Exercise both real submission paths with an isolated database double and fake Feishu responses.
// No database or network connections are made by this suite.
let task: any;
let steps: any[];
let answers: any[];
let issuer: any;
let config: any;
let fetchFailure: "token" | "send" | "invalid" | undefined;
let failTransaction = false;
let transactionActive = false;
let transactionQueue = Promise.resolve();
let messages: any[];
let logs: any[];
let tokenRequests = 0;
const now = new Date();

const database: any = {
  workflowStep: {
    findUnique: async ({ where }: any) => {
      const step = steps.find((s) => s.id === where.id);
      return step ? structuredClone({ ...step, task }) : null;
    },
    updateMany: async ({ where, data }: any) => {
      assert.equal(transactionActive, true);
      const step = steps.find((s) => s.id === where.id && s.status !== where.status.not);
      if (!step) return { count: 0 };
      Object.assign(step, data);
      return { count: 1 };
    },
    findMany: async () => structuredClone(steps),
  },
  workflowAnswer: {
    upsert: async ({ where, create, update }: any) => {
      const key = where.stepId_questionId;
      const existing = answers.find((a) => a.stepId === key.stepId && a.questionId === key.questionId);
      if (existing) Object.assign(existing, update);
      else answers.push({ ...create });
    },
    findMany: async ({ where }: any) => structuredClone(answers.filter((a) => a.stepId === where.stepId)),
  },
  workflowTask: {
    update: async ({ data }: any) => {
      if (failTransaction && transactionActive) throw new Error("transaction failed");
      Object.assign(task, data);
    },
    findUnique: async () => ({
      ...task,
      steps: steps.map((s) => ({ ...s, answers: answers.filter((a) => a.stepId === s.id) })),
    }),
  },
  user: {
    findUnique: async ({ where }: any) => {
      assert.equal(where.id, "A", "recipient must be the original issuer");
      return issuer;
    },
  },
  feishuEnterpriseConfig: {
    findFirst: async ({ where }: any) => {
      assert.deepEqual(where, { id: "issuer-config", status: "active" });
      return config;
    },
  },
  $transaction: async (callback: any) => {
    // Simulate the row lock held by conditional UPDATE until commit.
    const previous = transactionQueue;
    let release!: () => void;
    transactionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = structuredClone({ task, steps, answers });
    transactionActive = true;
    try {
      return await callback(database);
    } catch (error) {
      ({ task, steps, answers } = snapshot);
      throw error;
    } finally {
      transactionActive = false;
      release();
    }
  },
};

(globalThis as any).prisma = database;
const { submitWorkflowStep, saveStepQuestionAnswer } = await import("../src/modules/task/collaboration/workflow.store.js");
mock.method(fs, "mkdirSync", () => undefined);
mock.method(fs, "appendFileSync", (_path: any, data: any) => { logs.push(JSON.parse(data)); });
mock.method(globalThis, "fetch", async (url: any, init: any) => {
  const body = JSON.parse(init.body);
  if (String(url).includes("tenant_access_token")) {
    tokenRequests++;
    assert.equal(steps.some((s) => s.status === "completed"), true, "completion must precede sending");
    assert.deepEqual(body, { app_id: "issuer-app", app_secret: "fake-secret" });
    if (fetchFailure === "token") throw new Error("token unavailable");
    return Response.json({ code: 0, tenant_access_token: "fake-token" });
  }
  assert.equal(init.headers.Authorization, "Bearer fake-token");
  messages.push(body);
  if (fetchFailure === "send") throw new Error("Feishu unavailable");
  return Response.json({ code: 0, data: { message_id: "message", invalid_open_ids: fetchFailure === "invalid" ? ["issuer-open-id"] : [] } });
});

beforeEach(() => {
  task = { id: "task", title: "月度资料", createdByUserId: "A", createdByIdentityId: "A-identity", createdByName: "A", status: "in_progress", currentStepOrder: 1, createdAt: now, updatedAt: now };
  steps = ["B", "C"].map((user, index) => ({
    id: `step-${user}`, taskId: "task", order: index + 1, title: `节点${index + 1}`,
    requirement: "", assigneeUserId: user, assigneeName: user, status: "active",
    questions: [{ id: `question-${user}`, title: "资料", itemType: "QA", isRequired: true, options: [] }],
  }));
  answers = [];
  issuer = { status: "active", feishuConfigId: "issuer-config", feishuOpenId: "issuer-open-id" };
  config = { appId: "issuer-app", appSecret: "fake-secret" };
  messages = [];
  logs = [];
  fetchFailure = undefined;
  failTransaction = false;
  tokenRequests = 0;
});

const answerB = { questionId: "question-B", answerText: "已填写" };

test("B and C each notify A when their own node completes", async () => {
  const b = await saveStepQuestionAnswer("task", "step-B", "B", answerB);
  assert.equal(b.stepCompleted, true);
  assert.equal(b.task?.status, "in_progress");
  const c = await saveStepQuestionAnswer("task", "step-C", "C", { questionId: "question-C", answerText: "完成" });
  assert.equal(c.task?.status, "completed");
  assert.deepEqual(messages, [
    "【流转任务·（B）节点完成】\n主任务：月度资料\n1问答：资料 - 已填写\n执行人：B\n该节点必填子任务已全部完成。",
    "【流转任务·（C）节点完成】\n主任务：月度资料\n1问答：资料 - 完成\n执行人：C\n该节点必填子任务已全部完成。",
  ].map((text) => ({
    msg_type: "text", open_ids: ["issuer-open-id"], content: { text },
  })));
});

test("unfinished required answers do not trigger a notification", async () => {
  steps[0].questions.push({ id: "second", title: "第二题", itemType: "LINK", isRequired: true, options: [] });
  const result = await saveStepQuestionAnswer("task", "step-B", "B", answerB);
  assert.equal(result.stepCompleted, false);
  assert.equal(tokenRequests, 0);
  await saveStepQuestionAnswer("task", "step-B", "B", { questionId: "second", isLinkConfirmed: true });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content.text, "【流转任务·（B）节点完成】\n主任务：月度资料\n1问答：资料 - 已填写\n2学习链接：第二题 - 已确认完成\n执行人：B\n该节点必填子任务已全部完成。");
});

test("legacy whole-node submission lists this node's subtasks and notifies once", async () => {
  steps[0].title = "资料复核";
  steps[0].questions.push({ id: "optional", title: "补充说明", itemType: "QA", isRequired: false, options: [] });
  steps[1].questions[0].title = "其他节点的子任务";
  assert.equal((await submitWorkflowStep("task", "step-B", "B", [answerB])).success, true);
  assert.equal(messages[0].content.text, "【流转任务·（B）节点完成】\n主任务：月度资料\n1问答：资料 - 已填写\n2问答：补充说明 - 未填写\n执行人：B\n该节点必填子任务已全部完成。");
  assert.equal((await submitWorkflowStep("task", "step-B", "B", [answerB])).error, "STEP_ALREADY_COMPLETED");
  assert.equal((await saveStepQuestionAnswer("task", "step-B", "B", answerB)).error, "STEP_ALREADY_COMPLETED");
  assert.equal(messages.length, 1);
});

test("mixed question answers are matched by question ID and attachments stay private", async () => {
  steps[0].questions = [
    { id: "qa", title: "资料收集完成", itemType: "QA", isRequired: true },
    { id: "image", title: "附件上传", itemType: "ATTACHMENT", isRequired: true },
    { id: "single", title: "是否核对", itemType: "SINGLE_CHOICE", isRequired: true },
    { id: "multi", title: "核对项目", itemType: "MULTI_CHOICE", isRequired: true },
    { id: "todo", title: "信息确认", itemType: "FILL_BLANK", isRequired: true },
    { id: "link", title: "学习资料", itemType: "LINK", isRequired: true },
  ];
  const entries = [
    { questionId: "multi", answerOptions: ["姓名", "日期"] },
    { questionId: "image", attachmentUrls: ["https://private.example/secret.png"] },
    { questionId: "todo", answerText: "已完成" },
    { questionId: "single", answerOptions: ["是"] },
    { questionId: "qa", answerText: "已完成收集" },
    { questionId: "link", isLinkConfirmed: true },
  ];
  for (let i = 0; i < entries.length; i++) {
    await saveStepQuestionAnswer("task", "step-B", "B", entries[i]);
    assert.equal(messages.length, i === entries.length - 1 ? 1 : 0);
  }
  assert.equal(messages[0].content.text, [
    "【流转任务·（B）节点完成】", "主任务：月度资料",
    "1问答：资料收集完成 - 已完成收集", "2图片：附件上传 - 请进后台查看",
    "3单选：是否核对 - 是", "4多选：核对项目 - 姓名、日期",
    "5待办确认：信息确认 - 已完成", "6学习链接：学习资料 - 已确认完成",
    "执行人：B", "该节点必填子任务已全部完成。",
  ].join("\n"));
  assert.doesNotMatch(messages[0].content.text, /private\.example/);
});

test("concurrent auto-completion requests claim one notification", async () => {
  const results = await Promise.all([
    saveStepQuestionAnswer("task", "step-B", "B", answerB),
    saveStepQuestionAnswer("task", "step-B", "B", answerB),
  ]);
  assert.equal(results.filter((r) => r.stepCompleted).length, 1);
  assert.equal(messages.length, 1);
});

test("concurrent whole-node submissions claim one notification", async () => {
  const results = await Promise.all([
    submitWorkflowStep("task", "step-B", "B", [answerB]),
    submitWorkflowStep("task", "step-B", "B", [answerB]),
  ]);
  assert.equal(results.filter((r) => r.success).length, 1);
  assert.equal(messages.length, 1);
});

test("both completion entry points share the same database guard", async () => {
  await Promise.all([
    saveStepQuestionAnswer("task", "step-B", "B", answerB),
    submitWorkflowStep("task", "step-B", "B", [answerB]),
  ]);
  assert.equal(messages.length, 1);
});

test("failed completion transaction sends nothing and may be retried", async () => {
  failTransaction = true;
  await assert.rejects(submitWorkflowStep("task", "step-B", "B", [answerB]), /transaction failed/);
  assert.equal(steps[0].status, "active");
  assert.equal(tokenRequests, 0);
  failTransaction = false;
  await submitWorkflowStep("task", "step-B", "B", [answerB]);
  assert.equal(messages.length, 1);
});

test("unbound issuer skips notification while completion succeeds", async () => {
  issuer.feishuOpenId = null;
  assert.equal((await submitWorkflowStep("task", "step-B", "B", [answerB])).success, true);
  assert.equal(tokenRequests, 0);
  assert.equal(logs[0].reason, "ISSUER_UNAVAILABLE_OR_UNBOUND");
});

test("disabled enterprise configuration skips notification", async () => {
  config = null;
  assert.equal((await saveStepQuestionAnswer("task", "step-B", "B", answerB)).stepCompleted, true);
  assert.equal(tokenRequests, 0);
  assert.equal(logs[0].reason, "FEISHU_CONFIG_UNAVAILABLE");
});

for (const failure of ["token", "send", "invalid"] as const) {
  test(`${failure} failure is logged without undoing completion`, async () => {
    fetchFailure = failure;
    const result = await saveStepQuestionAnswer("task", "step-B", "B", answerB);
    assert.equal(result.success, true);
    assert.equal(result.stepCompleted, true);
    assert.equal(steps[0].status, "completed");
    assert.equal(logs.at(-1).event, "workflow_completion_notify_failed");
  });
}

test("unauthorized executor cannot complete or notify", async () => {
  assert.equal((await submitWorkflowStep("task", "step-B", "C", [answerB])).error, "FORBIDDEN");
  assert.equal((await saveStepQuestionAnswer("task", "step-B", "C", answerB)).error, "FORBIDDEN");
  assert.equal(steps[0].status, "active");
  assert.equal(tokenRequests, 0);
});

after(() => { mock.restoreAll(); delete (globalThis as any).prisma; });
