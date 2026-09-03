import assert from "node:assert/strict";
import { test } from "node:test";

// Isolated route tests: no database writes, HTTP server, or external notifications.
const team = { id: "team", name: "Team", path: "/base/team" };
const base = { id: "base", name: "Base", path: "/base" };
let recipientQuery: any;
let taskData: any;
const recipients = [
  { userId: "manager", orgId: "hall", scopePath: "/base/other-team/hall", org: { id: "hall", name: "Hall", path: "/base/other-team/hall" }, user: { nickname: "Manager", phone: "" } },
  { userId: "outside", orgId: "outside-hall", scopePath: "/other-base/team/hall", org: { id: "outside-hall", name: "Outside", path: "/other-base/team/hall" }, user: { nickname: "Outside", phone: "" } },
];
(globalThis as any).prisma = {
  orgUnit: { findFirst: async ({ where }: any) => where.orgType === "BASE" ? base : team },
  user: { findUnique: async () => ({ nickname: "Operator" }) },
  userIdentity: { findMany: async (query: any) => {
    recipientQuery = query;
    const { where } = query;
    const rows = recipients.filter((row) => row.scopePath.startsWith(where.scopePath.startsWith)
      && row.org.path.startsWith(where.org.is.path.startsWith)
      && (!where.userId.in || where.userId.in.includes(row.userId))
      && row.userId !== where.userId.not
      && (!where.OR || row.user.nickname.includes(where.OR[0].user.nickname.contains)
        || row.user.phone.includes(where.OR[1].user.phone.contains)
        || row.org.name.includes(where.OR[2].org.name.contains)));
    return rows.slice(query.skip ?? 0, query.take ? (query.skip ?? 0) + query.take : undefined);
  } },
  broadcastTask: { create: async ({ data }: any) => {
    taskData = data;
    return { ...data, id: "task", createdAt: new Date(), updatedAt: new Date(),
      questions: [], anchorRecords: [] };
  } },
};
const { broadcastTaskRoutes } = await import("../src/modules/task/collaboration/broadcast.routes.js");
async function invoke(path: string, method: string, body: any = {}, roleCode = "TEAM_ADMIN", query: any = {}) {
  const route = (broadcastTaskRoutes as any).stack.find((layer: any) => [layer.route?.path].flat().includes(path) && layer.route.methods[method]).route;
  const handler = route.stack.at(-1).handle;
  const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(data: any) { this.body = data; return this; } };
  await handler({ identity: { id: "identity", userId: "issuer", orgId: "team", roleCode }, body, path, query }, res);
  return res;
}
const payload = { title: "Task", recipientType: "HALL_MANAGER", selectedRecipientUserIds: ["manager"], questions: [{ title: "Question", itemType: "QA" }] };

test("bootstrap and empty search do not query or preload hall manager lists", async () => {
  recipientQuery = undefined;
  const res = await invoke("/tasks/collaboration/broadcast/bootstrap", "get");
  assert.equal(res.body.data.allowed, true);
  assert.deepEqual(res.body.data.allowedRecipientTypes, ["HALL_MANAGER"]);
  assert.deepEqual(res.body.data.anchors, []);
  assert.deepEqual(res.body.data.hallManagers, []);
  await invoke("/tasks/collaboration/broadcast/hall-managers", "get", {}, "TEAM_ADMIN", { q: "   " });
  assert.equal(recipientQuery, undefined);
});
test("search exposes matching other-team hall managers in the same base with bounded query", async () => {
  const res = await invoke("/tasks/collaboration/broadcast/hall-managers", "get", {}, "TEAM_ADMIN", { q: "Manager" });
  assert.equal(recipientQuery.where.scopePath.startsWith, "/base/");
  assert.equal(recipientQuery.where.org.is.path.startsWith, "/base/");
  assert.deepEqual(res.body.data.hallManagers.map((row: any) => row.userId), ["manager"]);
  assert.equal(recipientQuery.take, 21);
  assert.equal(recipientQuery.skip, 0);
  const empty = await invoke("/tasks/collaboration/broadcast/hall-managers", "get", {}, "TEAM_ADMIN", { q: "no-match" });
  assert.deepEqual(empty.body.data.hallManagers, []);
});
test("team cannot submit anchor or legacy default-anchor requests", async () => {
  for (const recipientType of ["ANCHOR", undefined]) {
    const res = await invoke("/tasks/collaboration/broadcast", "post", { ...payload, recipientType });
    assert.equal(res.statusCode, 403);
  }
  assert.equal(taskData, undefined);
});
test("other-base recipients are rejected before writing", async () => {
  const res = await invoke("/tasks/collaboration/broadcast", "post", { ...payload, selectedRecipientUserIds: ["outside"] });
  assert.equal(res.body.error.code, "RECIPIENT_SCOPE_INVALID");
  assert.equal(recipientQuery.where.scopePath.startsWith, "/base/");
  assert.equal(recipientQuery.where.org.is.path.startsWith, "/base/");
  assert.equal(taskData, undefined);
});
test("team can create a task for another team's hall manager", async () => {
  const res = await invoke("/tasks/collaboration/broadcast", "post", payload);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(taskData.anchorRecords.create[0].anchorUserId, "manager");
});
test("unrelated admin role remains blocked", async () => {
  const res = await invoke("/tasks/collaboration/broadcast", "post", payload, "BASE_ADMIN");
  assert.equal(res.statusCode, 403);
});

test("search pages results in batches of 20 and rejects oversized keywords", async () => {
  const initialLength = recipients.length;
  try {
    for (let index = 0; index < 25; index++) recipients.push({
      userId: `paged-${index}`, orgId: "hall", scopePath: "/base/other-team/hall",
      org: { id: "hall", name: "Hall", path: "/base/other-team/hall" },
      user: { nickname: `Paged ${index}`, phone: "" },
    });
    const first = await invoke("/tasks/collaboration/broadcast/hall-managers", "get", {}, "TEAM_ADMIN", { q: "Paged" });
    assert.equal(first.body.data.hallManagers.length, 20);
    assert.equal(first.body.data.nextOffset, 20);
    const second = await invoke("/tasks/collaboration/broadcast/hall-managers", "get", {}, "TEAM_ADMIN", { q: "Paged", offset: 20 });
    assert.equal(second.body.data.hallManagers.length, 5);
    assert.equal(second.body.data.nextOffset, null);
    const oversized = await invoke("/tasks/collaboration/broadcast/hall-managers", "get", {}, "TEAM_ADMIN", { q: "x".repeat(81) });
    assert.equal(oversized.statusCode, 400);
  } finally {
    recipients.splice(initialLength);
  }
});
