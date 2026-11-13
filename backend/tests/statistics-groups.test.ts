import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStatisticsGroups, groupedTeamStatistics, type TeamStats, type StatisticsGroup } from "../src/modules/organization/statistics-groups.js";
const row = (orgId: string, completed: number, total: number, exemptions = 0): TeamStats => ({ orgId, orgName: orgId, completed, total, exemptions, completionRate: 0, exemptionRate: 0 });
const group: StatisticsGroup = { id: "g", name: "中台", enabled: true, teamIds: ["a", "b", "c", "d", "e"] };
test("sum raw counts and recalculate rate, preserving members and totals", () => {
  const rows = [row("a", 5, 6, 1), row("b", 9, 12, 3), row("c", 5, 5), row("d", 8, 12, 3), row("e", 5, 6, 1), row("f", 10, 20)];
  const result = mergeStatisticsGroups(rows, [group]);
  const merged = result.find((r) => r.members)!;
  assert.deepEqual([merged.completed, merged.total, merged.exemptions, merged.completionRate], [32, 41, 8, 97]);
  assert.equal(merged.members?.length, 5);
  for (const key of ["completed", "total", "exemptions"] as const) assert.equal(result.reduce((s, r) => s + r[key], 0), rows.reduce((s, r) => s + r[key], 0));
  assert.equal(rows.length, 6);
});
test("disabled and dissolved groups leave rows intact", () => {
  const rows = [row("a", 1, 2), row("b", 1, 3)];
  assert.deepEqual(mergeStatisticsGroups(rows, [{ ...group, enabled: false }]), rows);
  assert.deepEqual(mergeStatisticsGroups(rows, []), rows);
});
test("restricted scope never gains rows or group labels", async () => {
  const rows = [row("a", 1, 2)];
  assert.deepEqual(await groupedTeamStatistics("base", rows, "TEAM_ADMIN"), rows);
});
test("group stays grouped when only one member participated in the period", () => {
  const result = mergeStatisticsGroups([row("a", 1, 2)], [group]);
  assert.equal(result[0].orgName, "中台"); assert.equal(result[0].total, 2);
});
test("all exempt and zero participation never divide by zero", () => {
  assert.equal(mergeStatisticsGroups([row("a", 0, 2, 2), row("b", 0, 3, 3)], [group])[0].completionRate, 0);
  assert.equal(mergeStatisticsGroups([row("a", 0, 0), row("b", 0, 0)], [group])[0].completionRate, 0);
});
test("overlapping configurations cannot double count", () => {
  const result = mergeStatisticsGroups([row("a", 1, 2), row("b", 2, 3)], [group, { ...group, id: "other" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].total, 5);
});
test("merged groups appear last even when their names sort first", () => {
  const result = mergeStatisticsGroups(
    [row("z", 1, 2), row("a", 1, 2), row("y", 1, 2), row("b", 1, 2)],
    [{ ...group, id: "second", name: "B", teamIds: ["b"] }, { ...group, id: "first", name: "A", teamIds: ["a"] }],
  );
  assert.deepEqual(result.map((r) => r.orgName), ["y", "z", "A", "B"]);
  assert.deepEqual(result.map((r) => Boolean(r.members)), [false, false, true, true]);
});
