import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

let records: any[] = [];
let leaves: any[] = [];
let failRecord = "";
let lockCalls = 0;
let queue: Promise<unknown> = Promise.resolve();
const copy = (v: any) => structuredClone(v);
const hydrate = (r: any) => r && copy({ ...r, leaveRequests: leaves.filter((l) => l.taskRecordId === r.id) });
const db: any = {
  $queryRaw: async () => { lockCalls++; return []; },
  hallTaskRecord: {
    findMany: async ({ where }: any) => records.filter((r) => (!where.id || where.id.in.includes(r.id)) && (!where.hallOrgId || where.hallOrgId === r.hallOrgId)).map(hydrate),
    findUnique: async ({ where }: any) => hydrate(records.find((r) => r.id === where.id)),
    findUniqueOrThrow: async ({ where }: any) => hydrate(records.find((r) => r.id === where.id)),
    update: async ({ where, data }: any) => Object.assign(records.find((r) => r.id === where.id), data),
  },
  userIdentity: { findFirst: async () => ({ id: "hall-manager" }) },
  hallTaskLeaveRequest: {
    findFirst: async ({ where }: any) => copy(leaves.find((l) => l.taskRecordId === where.taskRecordId && l.status === where.status)),
    create: async ({ data }: any) => {
      if (data.taskRecordId === failRecord) throw new Error("simulated write failure");
      const row = { ...data, id: `leave-${leaves.length}` }; leaves.push(row); return copy(row);
    },
    update: async ({ where, data }: any) => Object.assign(leaves.find((l) => l.id === where.id), data),
  },
  $transaction: async (action: any) => {
    // Model serialization/rollback without touching a real database.
    const operation = queue.then(async () => {
      const beforeRecords = copy(records), beforeLeaves = copy(leaves);
      try { return await action(db); }
      catch (error) { records = beforeRecords; leaves = beforeLeaves; throw error; }
    });
    queue = operation.catch(() => {});
    return operation;
  },
};
(globalThis as any).prisma = db;
const { HallDailyLeaveService, HallDailyRecordService } = await import("../src/modules/task/hall-daily/hall-daily.service.js");
const { formatBeijingDate } = await import("../src/modules/task/record/daily-record-time.utils.js");
const today = () => formatBeijingDate(new Date());
const identity = { roleCode: "TEAM_ADMIN", scopePath: "/base/team" };
const input = (overrides: any = {}) => ({ recordIds: ["r1"], taskDate: today(), action: "approve" as const, reason: "测试原因", operatorUserId: "operator", identity, ...overrides });
beforeEach(() => {
  leaves = []; failRecord = ""; lockCalls = 0;
  records = [1, 2].map((i) => ({ id: `r${i}`, hallOrgId: `h${i}`, recordDate: today(), status: "pending", itemRecords: [],
    hallOrg: { name: `厅${i}`, path: `/base/team/h${i}`, status: "active" }, assignment: { status: "active", template: { items: [] } } }));
});
test("requires manager scope, today's date, reason and a bounded selection before writes", async () => {
  for (const overrides of [ { identity: { roleCode: "HALL_MANAGER" } }, { identity: { ...identity, scopePath: "/other" } }, { taskDate: "2000-01-01" }, { reason: " " }, { recordIds: [] }, { recordIds: Array.from({ length: 101 }, (_, i) => String(i)) } ]) {
    await assert.rejects(() => HallDailyLeaveService.batch(input(overrides)));
  }
  assert.equal(leaves.length, 0);
  assert.equal(lockCalls, 0);
});
test("repeated batch approvals are idempotent and completed records are skipped", async () => {
  records[1].status = "submitted";
  const first = await HallDailyLeaveService.batch(input({ recordIds: ["r1", "r2"] }));
  assert.deepEqual(first.results.map((r) => r.status), ["approved", "completed"]);
  const second = await HallDailyLeaveService.batch(input());
  assert.equal(second.results[0].status, "already_approved");
  assert.equal(leaves.length, 1);
});
test("approving pending application preserves applicant and original reason", async () => {
  leaves.push({ id: "pending", taskRecordId: "r1", status: "pending", applicantUserId: "original", reason: "原原因", reviewComment: "旧意见" });
  await HallDailyLeaveService.batch(input());
  assert.equal(leaves[0].status, "approved");
  assert.equal(leaves[0].applicantUserId, "original");
  assert.equal(leaves[0].reason, "原原因");
  assert.match(leaves[0].reviewComment, /旧意见.*\n.*operator/);
});
test("cancellation preserves approval history and record answers", async () => {
  await HallDailyLeaveService.batch(input());
  const old = copy(records[0]);
  await HallDailyLeaveService.batch(input({ action: "cancel", reason: "恢复任务" }));
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].status, "cancelled");
  assert.match(leaves[0].reviewComment, /管理批量批准[\s\S]*管理批量取消/);
  assert.equal(leaves[0].reviewedBy, "operator");
  assert.deepEqual(records[0], old);
  assert.equal((await HallDailyLeaveService.batch(input({ action: "cancel" }))).results[0].status, "not_enabled");
});
test("one failed hall does not undo another hall and can be retried", async () => {
  failRecord = "r2";
  const result = await HallDailyLeaveService.batch(input({ recordIds: ["r1", "r2"] }));
  assert.deepEqual(result.results.map((r) => r.status), ["approved", "failed"]);
  failRecord = "";
  assert.equal((await HallDailyLeaveService.batch(input({ recordIds: ["r2"] }))).results[0].status, "approved");
});
test("approved leave rejects submission; submission first prevents approval", async () => {
  await HallDailyLeaveService.batch(input());
  await assert.rejects(() => HallDailyRecordService.submitRecord("r1", "user"), /HALL_TASK_LEAVE_NOT_ALLOWED/);
  await HallDailyRecordService.submitRecord("r2", "user");
  assert.equal((await HallDailyLeaveService.batch(input({ recordIds: ["r2"] }))).results[0].status, "completed");
});
test("concurrent leave and submission never produce approved plus submitted", async () => {
  await Promise.allSettled([HallDailyLeaveService.batch(input()), HallDailyRecordService.submitRecord("r1", "user")]);
  assert.equal(records[0].status === "submitted" && leaves.some((l) => l.taskRecordId === "r1" && l.status === "approved"), false);
  assert.ok(lockCalls >= 2);
});
