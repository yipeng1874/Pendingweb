import { test } from "node:test";
import assert from "node:assert/strict";
const queries: any[] = [];
let owned = true;
(globalThis as any).prisma = {
  orgUnit: { findFirst: async (q: any) => q.where.id ? { id: "hall", path: "/base/hall", name: "厅" } : { id: "base", path: "/base", name: "基地" } },
  userIdentity: { findMany: async (q: any) => { queries.push(q); return []; } },
  broadcastTask: { findMany: async (q: any) => { queries.push(q); return Array.from({ length: 11 }, (_, i) => ({ id: String(i) })); }, findFirst: async (q: any) => { queries.push(q); return owned ? { id: "task" } : null; } },
  broadcastAnchorRecord: { groupBy: async () => [], findMany: async (q: any) => { queries.push(q); return Array.from({ length: 11 }, (_, i) => ({ id: String(i) })); } },
};
const { broadcastTaskRoutes } = await import("../src/modules/task/collaboration/broadcast.routes.js");
async function call(path: string, roleCode: string, query: any = {}) {
  const layer = (broadcastTaskRoutes as any).stack.find((l: any) => l.route && (Array.isArray(l.route.path) ? l.route.path.includes(path) : l.route.path === path));
  let code = 200, body: any;
  const response: any = { status: (n: number) => { code = n; return response; }, json: (data: any) => { body = data; return response; } };
  await layer.route.stack.at(-1).handle({ path, query, params: { taskId: "task" }, identity: { id: "identity", userId: "owner", roleCode, orgId: "hall" } }, response);
  return { code, body };
}
const base = "/tasks/collaboration/broadcast";
test("mobile recipient search and history enforce scope and pagination", async () => {
  assert.equal((await call(`${base}/recipients`, "TEAM_ADMIN", { type: "ANCHOR", q: "名字" })).code, 403);
  queries.length = 0;
  await call(`${base}/recipients`, "HALL_MANAGER", { type: "ANCHOR", q: "" });
  assert.equal(queries.length, 1); assert.equal(queries[0].take, 21); assert.equal(queries[0].where.AND, undefined); queries.length = 0;
  await call(`${base}/recipients`, "HALL_MANAGER", { type: "ANCHOR", q: "名字" });
  assert.equal(queries[0].take, 21); assert.equal(queries[0].where.roleCode, "ANCHOR"); assert.equal(queries[0].where.OR[0].scopePath, "/base/hall");
  queries.length = 0;
  const page = await call(`${base}/mobile-issued`, "HALL_MANAGER", { status: "active" });
  assert.equal(queries[0].where.createdByUserId, "owner"); assert.equal(queries[0].where.status, "active"); assert.equal(queries[0].take, 11); assert.equal(queries[0].include.anchorRecords, undefined);
  assert.equal(page.body.data.tasks.length, 10); assert.equal(page.body.data.hasMore, true);
  assert.equal((await call(`${base}/mobile-issued`, "BASE_ADMIN")).code, 403);
  owned = false;
  assert.equal((await call(`${base}/mobile-issued/:taskId/recipients`, "HALL_MANAGER")).code, 404);
  owned = true; queries.length = 0;
  const recipients = await call(`${base}/mobile-issued/:taskId/recipients`, "TEAM_ADMIN", { page: 2 });
  assert.equal(queries[0].where.createdByUserId, "owner"); assert.equal(queries[1].skip, 10); assert.equal(queries[1].take, 11); assert.equal(recipients.body.data.items.length, 10);
});
