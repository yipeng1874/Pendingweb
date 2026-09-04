import assert from "node:assert/strict";
import { test } from "node:test";
let query: any;
let size = 11;
(globalThis as any).prisma = { workflowTask: { findMany: async (args: any) => {
  query = args;
  return Array.from({ length: size }, (_, i) => ({ id: `task-${i}`, status: "in_progress", createdAt: new Date(), updatedAt: new Date(), steps: [] }));
} } };
const { getWorkflowTasksByIssuerPage } = await import("../src/modules/task/collaboration/workflow.store.js");
test("issuer pages constrain owner, lifecycle, size and cursor at database query", async () => {
  const first = await getWorkflowTasksByIssuerPage("owner", "in_progress");
  assert.equal(query.where.createdByUserId, "owner");
  assert.equal(query.where.status, "in_progress");
  assert.equal(query.take, 11);
  assert.equal(first.items.length, 10);
  assert.equal(first.nextCursor, "task-9");
  assert.ok(query.where.OR[1].dueAt.gte instanceof Date);
  size = 2;
  const last = await getWorkflowTasksByIssuerPage("owner", "completed", "task-9");
  assert.deepEqual(query.cursor, { id: "task-9" });
  assert.equal(query.skip, 1);
  assert.equal(query.where.status, "completed");
  assert.equal(last.nextCursor, null);
  const ended = await getWorkflowTasksByIssuerPage("owner", "ended");
  assert.equal(query.where.OR[0].status, "ended");
  assert.equal(query.where.OR[1].status, "in_progress");
  assert.ok(query.where.OR[1].dueAt.lt instanceof Date);
  assert.equal(ended.items[0].status, "ended");
});
