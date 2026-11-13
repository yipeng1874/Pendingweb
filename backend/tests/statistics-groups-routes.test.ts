import { test } from "node:test";
import assert from "node:assert/strict";

const teamA = "11111111-1111-4111-8111-111111111111";
const teamB = "22222222-2222-4222-8222-222222222222";
let writes = 0;
let audits = 0;
let updated = 1;
const tx = {
  $executeRaw: async () => { writes++; return updated; },
  auditLog: { create: async () => { audits++; } },
};
(globalThis as any).prisma = {
  orgUnit: {
    findFirst: async () => ({ id: "base", path: "/hq/base" }),
    findMany: async ({ where }: any) => [teamA, teamB].filter((id) => where.id.in.includes(id)).map((id) => ({ id })),
  },
  $transaction: async (callback: any) => callback(tx),
};
const { statisticsGroupRoutes } = await import("../src/modules/organization/statistics-groups.routes.js");
const handler = (statisticsGroupRoutes as any).stack.find((layer: any) => layer.route?.methods.put).route.stack[0].handle;
const config = () => ({ revision: 1, groups: [{ id: "33333333-3333-4333-8333-333333333333", name: "中台", enabled: true, teamIds: [teamA, teamB] }] });
async function call(body: unknown, scopePath = "/hq/base") {
  writes = 0; audits = 0;
  let status = 200; let result: any;
  const res = { status: (code: number) => { status = code; return res; }, json: (value: unknown) => { result = value; } };
  await handler({ params: { baseId: "base" }, body, identity: { roleCode: "BASE_ADMIN", scopePath, id: "identity" }, userId: "user" }, res, (err: unknown) => { throw err; });
  return { status, result };
}
test("save returns new revision and writes audit", async () => {
  const response = await call(config());
  assert.equal(response.status, 200); assert.equal(response.result.data.revision, 2);
  assert.equal(writes, 1); assert.equal(audits, 1);
});
test("duplicate membership is rejected without writing", async () => {
  const body = config(); body.groups[0].teamIds.push(teamA);
  assert.equal((await call(body)).status, 400); assert.equal(writes, 0);
});
test("team in A cannot join B even if A is disabled", async () => {
  const body = config();
  body.groups[0].enabled = false;
  body.groups.push({ id: "55555555-5555-4555-8555-555555555555", name: "B组", enabled: true, teamIds: [teamA] });
  assert.equal((await call(body)).status, 400); assert.equal(writes, 0);
});
test("team can join B after removal from A", async () => {
  const body = config(); body.groups[0].teamIds = [teamB];
  body.groups.push({ id: "55555555-5555-4555-8555-555555555555", name: "B组", enabled: true, teamIds: [teamA] });
  assert.equal((await call(body)).status, 200); assert.equal(writes, 1);
});
test("cross-base scope is rejected without writing", async () => {
  assert.equal((await call(config(), "/hq/other")).status, 403); assert.equal(writes, 0);
});
test("foreign team membership is rejected", async () => {
  const body = config(); body.groups[0].teamIds[1] = "44444444-4444-4444-8444-444444444444";
  assert.equal((await call(body)).status, 400); assert.equal(writes, 0);
});
test("stale revision returns conflict without audit", async () => {
  updated = 0;
  try { assert.equal((await call(config())).status, 409); assert.equal(audits, 0); }
  finally { updated = 1; }
});
test("empty named groups can be saved before adding teams", async () => {
  const body = config(); body.groups[0].teamIds = [];
  assert.equal((await call(body)).status, 200); assert.equal(writes, 1);
});
test("single-team groups can be saved while organizing", async () => {
  const body = config(); body.groups[0].teamIds = [teamA];
  assert.equal((await call(body)).status, 200); assert.equal(writes, 1);
});
test("unnamed groups are rejected", async () => {
  const body = config(); body.groups[0].name = " ";
  assert.equal((await call(body)).status, 400); assert.equal(writes, 0);
});
