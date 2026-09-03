import assert from "node:assert/strict";
import fs from "node:fs";
import { after, beforeEach, mock, test } from "node:test";

// Real record submission and notification services, isolated from the database and Feishu.
let records: any[];
let issuer: any;
let config: any;
let messages: any[];
let logs: any[];
let sendFailure = false;
let writeFailure = false;
const clone = (value: any) => structuredClone(value);
const getRecord = (id: string) => records.find((r) => r.id === id);
const database: any = {
  taskRecord: {
    findFirst: async ({ where, include }: any) => {
      const record = getRecord(where.id);
      if (!record || !where.OR.some((clause: any) => clause.userId === record.userId || record.visibleIdentityLinks.some((link: any) => link.identityId === clause.visibleIdentityLinks?.some.identityId))) return null;
      const copy = clone(record);
      if (include?.assignment?.select) {
        copy.assignment = Object.fromEntries(Object.keys(include.assignment.select).map((key) => [key, copy.assignment[key]]));
      }
      return copy;
    },
    findUnique: async ({ where }: any) => clone(getRecord(where.id)),
    findUniqueOrThrow: async ({ where }: any) => {
      const record = getRecord(where.id);
      if (!record) throw new Error("RECORD_NOT_FOUND");
      return clone(record);
    },
    updateMany: async ({ where, data }: any) => {
      if (writeFailure) throw new Error("write failed");
      const record = getRecord(where.id);
      if (!record) return { count: 0 };
      if (where.status?.not && record.status === where.status.not) return { count: 0 };
      if (typeof where.status === "string" && record.status !== where.status) return { count: 0 };
      if (where.submittedAt === null && record.submittedAt !== null) return { count: 0 };
      Object.assign(record, data);
      return { count: 1 };
    },
    update: async ({ where, data }: any) => {
      Object.assign(getRecord(where.id), data);
      return clone(getRecord(where.id));
    },
  },
  taskItemRecord: {
    upsert: async ({ where, create, update }: any) => {
      const { taskRecordId, taskItemId } = where.taskRecordId_taskItemId;
      const record = getRecord(taskRecordId);
      const existing = record.itemRecords.find((item: any) => item.taskItemId === taskItemId);
      if (existing) Object.assign(existing, update);
      else record.itemRecords.push({ ...create });
      return clone(record.itemRecords.find((item: any) => item.taskItemId === taskItemId));
    },
    count: async ({ where }: any) => getRecord(where.taskRecordId).itemRecords.filter((item: any) => item.status === where.status).length,
  },
  user: {
    findFirst: async ({ where }: any) => ({ id: where.id, nickname: where.id === "B" ? "张三" : "李四", status: "active" }),
    findUnique: async ({ where }: any) => {
      assert.equal(where.id, "A", "completion reminder must go to the publisher");
      return issuer;
    },
  },
  feishuEnterpriseConfig: {
    findFirst: async ({ where }: any) => {
      assert.deepEqual(where, { id: "issuer-config", status: "active" });
      return config;
    },
  },
};

(globalThis as any).prisma = database;
const { RecordService } = await import("../src/modules/task/record/record.service.js");
mock.method(fs, "mkdirSync", () => undefined);
mock.method(fs, "appendFileSync", (_path: any, data: any) => { logs.push(JSON.parse(data)); });
mock.method(globalThis, "fetch", async (url: any, init: any) => {
  assert.equal(records.some((record) => record.status === "submitted"), true);
  if (String(url).includes("tenant_access_token")) {
    assert.deepEqual(JSON.parse(init.body), { app_id: "issuer-app", app_secret: "fake-secret" });
    return Response.json({ code: 0, tenant_access_token: "fake-token" });
  }
  messages.push(JSON.parse(init.body));
  if (sendFailure) throw new Error("Feishu unavailable");
  return Response.json({ code: 0, data: { message_id: "fake-message" } });
});

beforeEach(() => {
  records = [{
    id: "record", assignmentId: "assignment", subjectType: "USER", subjectKey: "USER:B", subjectName: "张三",
    userId: "B", user: { nickname: "张三" }, status: "pending", submittedAt: null, doneItems: 0, totalItems: 2,
    visibleIdentityLinks: [{ identityId: "identity-B" }, { identityId: "identity-C" }],
    itemRecords: [], exemption: null,
    assignment: {
      id: "assignment", category: "TEMPORARY", status: "active", createdBy: "A", temporaryMode: "ACCOUNT", targetRoleType: "ACCOUNT",
      preDeadlineConfirmEnabled: true,
      template: { title: "月度资料", items: [
        { id: "item1", title: "资料收集", itemType: "QA", isRequired: true, sortOrder: 1 },
        { id: "item2", title: "阅读确认", itemType: "LINK", isRequired: true, sortOrder: 2 },
      ] },
    },
  }];
  issuer = { status: "active", feishuConfigId: "issuer-config", feishuOpenId: "issuer-open-id" };
  config = { appId: "issuer-app", appSecret: "fake-secret" };
  messages = [];
  logs = [];
  sendFailure = false;
  writeFailure = false;
});

function finishItems(record = records[0]) {
  record.itemRecords = record.assignment.template.items.filter((item: any) => item.isRequired).map((item: any) => ({ taskItemId: item.id, status: "done", answerText: "已完成收集", isLinkConfirmed: true }));
}
const saveItem = (taskItemId: string, extra: any = {}) => RecordService.submitItemRecord({
  taskRecordId: "record", taskItemId, userId: "B", identityId: "identity-B", done: true, ...extra,
});

for (const [mode, label] of [["ACCOUNT", "触达式"], ["ANCHOR", "主播式"], ["MANAGER", "管理式"]]) {
  test(`${mode} completion sends the correct subject and item list to A`, async () => {
    records[0].assignment.temporaryMode = mode;
    if (mode === "MANAGER") {
      records[0].subjectType = "ORG";
      records[0].subjectKey = "ORG:team";
      records[0].subjectName = "运营一组";
    }
    finishItems();
    await RecordService.submitRecord("record", "B", "identity-B");
    assert.deepEqual(messages, [{
      msg_type: "text", open_ids: ["issuer-open-id"], content: { text: [
        `【临时任务·${label}】`, "任务标题：月度资料", "1问答：资料收集 - 已完成收集", "2学习链接：阅读确认 - 已确认完成",
        ...(mode === "MANAGER" ? ["组织：运营一组", "提交人：张三"] : ["执行人：张三"]),
        "该任务必填子任务已全部完成。",
      ].join("\n") },
    }]);
  });
}

test("mixed item types notify only when the final item completes", async () => {
  const types = ["QA", "FILL_BLANK", "SINGLE_CHOICE", "MULTI_CHOICE", "LINK", "ATTACHMENT"];
  records[0].assignment.template.items = types.map((itemType, index) => ({ id: `item${index}`, itemType, title: itemType, isRequired: true, sortOrder: index }));
  records[0].totalItems = types.length;
  for (let i = 0; i < types.length; i++) {
    await saveItem(`item${i}`, { answerText: "完成", answerOptions: ["选项1"], isLinkConfirmed: true });
    assert.equal(messages.length, i === types.length - 1 ? 1 : 0);
  }
  assert.equal(records[0].status, "submitted");
  assert.match(messages[0].content.text, /6图片：ATTACHMENT - 请进后台查看/);
  assert.match(messages[0].content.text, /1问答：QA - 完成/);
  assert.match(messages[0].content.text, /2待办确认：FILL_BLANK - 完成/);
  assert.match(messages[0].content.text, /3单选：SINGLE_CHOICE - 选项1/);
  assert.match(messages[0].content.text, /4多选：MULTI_CHOICE - 选项1/);
  assert.match(messages[0].content.text, /5学习链接：LINK - 已确认完成/);
});

test("incomplete required items block whole-record submission and send nothing", async () => {
  await saveItem("item1");
  await assert.rejects(RecordService.submitRecord("record", "B", "identity-B"), /REQUIRED_ITEMS_INCOMPLETE/);
  assert.equal(messages.length, 0);
});

test("optional items may remain empty on explicit submission", async () => {
  records[0].assignment.template.items[1].isRequired = false;
  await saveItem("item1");
  assert.equal(messages.length, 0);
  await RecordService.submitRecord("record", "B", "identity-B");
  assert.equal(messages.length, 1);
  assert.match(messages[0].content.text, /2学习链接：阅读确认 - 未确认/);
});

test("two managers completing the same organizational record trigger one reminder", async () => {
  records[0].subjectType = "ORG";
  records[0].subjectName = "运营一组";
  records[0].assignment.temporaryMode = "MANAGER";
  finishItems();
  await Promise.all([
    RecordService.submitRecord("record", "B", "identity-B"),
    RecordService.submitRecord("record", "C", "identity-C"),
  ]);
  assert.equal(messages.length, 1);
  const firstTime = records[0].submittedAt;
  await saveItem("item1", { userId: "C", identityId: "identity-C", answerText: "补充" });
  await RecordService.submitRecord("record", "C", "identity-C");
  assert.equal(messages.length, 1);
  assert.equal(records[0].submittedAt, firstTime);
});

test("automatic and explicit submission share the same first-completion guard", async () => {
  records[0].itemRecords = [{ taskItemId: "item1", status: "done" }];
  await Promise.all([saveItem("item2"), RecordService.submitRecord("record", "B", "identity-B").catch((error) => {
    assert.match(error.message, /REQUIRED_ITEMS_INCOMPLETE|RECORD_SUBMITTED/);
  })]);
  assert.equal(messages.length, 1);
});

test("different organizations on the same assignment each trigger a reminder", async () => {
  records[0].subjectType = "ORG";
  records[0].subjectName = "一组";
  records[0].assignment.temporaryMode = "MANAGER";
  finishItems();
  records.push({ ...clone(records[0]), id: "record2", subjectName: "二组", subjectKey: "ORG:two" });
  await RecordService.submitRecord("record", "B", "identity-B");
  await RecordService.submitRecord("record2", "B", "identity-B");
  assert.equal(messages.length, 2);
  assert.match(messages[1].content.text, /组织：二组/);
});

test("daily submissions and temporary reconfirmations do not send completion reminders", async () => {
  records[0].assignment.category = "DAILY";
  records[0].recordDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  finishItems();
  await RecordService.submitRecord("record", "B", "identity-B");
  records[0].assignment.category = "TEMPORARY";
  records[0].reconfirmStatus = "pending";
  await RecordService.reconfirmRecord("record", "B", "identity-B");
  assert.equal(messages.length, 0);
});

test("unbound publisher is logged and completion remains successful", async () => {
  issuer.feishuOpenId = null;
  finishItems();
  const result = await RecordService.submitRecord("record", "B", "identity-B");
  assert.equal(result.status, "submitted");
  assert.equal(messages.length, 0);
  assert.equal(logs[0].reason, "ISSUER_UNAVAILABLE_OR_UNBOUND");
});

test("Feishu failure does not roll back completion", async () => {
  sendFailure = true;
  finishItems();
  assert.equal((await RecordService.submitRecord("record", "B", "identity-B")).status, "submitted");
  assert.equal(logs[0].event, "temporary_completion_notify_failed");
});

test("database failure sends nothing and allows a later successful completion", async () => {
  finishItems();
  writeFailure = true;
  await assert.rejects(RecordService.submitRecord("record", "B", "identity-B"), /write failed/);
  assert.equal(messages.length, 0);
  writeFailure = false;
  await RecordService.submitRecord("record", "B", "identity-B");
  assert.equal(messages.length, 1);
});

test("an unrelated executor cannot submit or notify", async () => {
  await assert.rejects(RecordService.submitRecord("record", "outsider", "unknown"), /RECORD_NOT_FOUND/);
  assert.equal(messages.length, 0);
});

after(() => { mock.restoreAll(); delete (globalThis as any).prisma; });
