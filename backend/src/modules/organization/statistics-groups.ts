import { prisma } from "../../shared/prisma.js";
import { runtimeErrorDetails, writeRuntimeLog } from "../../shared/runtime-log.js";

export type StatisticsGroup = { id: string; name: string; enabled: boolean; teamIds: string[] };
export type TeamStats = { orgId: string; orgName: string; total: number; completed: number; exemptions: number; completionRate: number; exemptionRate: number; members?: TeamStats[] };

export async function readStatisticsGroups(baseId: string) {
  const rows = await prisma.$queryRaw<Array<{ groupsJson: unknown; revision: number }>>`
    SELECT groups_json AS groupsJson, revision FROM organization_statistics_groups WHERE base_org_id = ${baseId}`;
  const row = rows[0];
  return { groups: (row ? (typeof row.groupsJson === "string" ? JSON.parse(row.groupsJson) : row.groupsJson) : []) as StatisticsGroup[], revision: row?.revision ?? 0 };
}

// Only aggregate already-authorized rows. Never load another team's metrics here.
export function mergeStatisticsGroups(teams: TeamStats[], groups: StatisticsGroup[]): TeamStats[] {
  const used = new Set<string>();
  const merged: TeamStats[] = [];
  for (const group of groups.filter((item) => item.enabled)) {
    const members = teams.filter((team) => group.teamIds.includes(team.orgId) && !used.has(team.orgId));
    // Some members may have no participation in this date range.
    if (!members.length) continue;
    members.forEach((team) => used.add(team.orgId));
    const total = members.reduce((sum, team) => sum + team.total, 0);
    const completed = members.reduce((sum, team) => sum + team.completed, 0);
    const exemptions = members.reduce((sum, team) => sum + team.exemptions, 0);
    const denominator = Math.max(0, total - exemptions);
    merged.push({ orgId: `statistics:${group.id}`, orgName: group.name, total, completed, exemptions,
      completionRate: denominator > 0 ? Math.round(completed / denominator * 100) : 0,
      exemptionRate: total > 0 ? Math.round(exemptions / total * 100) : 0, members });
  }
  // Keep merged groups below ordinary teams; sort names within each section.
  const byName = (a: TeamStats, b: TeamStats) => a.orgName.localeCompare(b.orgName);
  return [...teams.filter((team) => !used.has(team.orgId)).sort(byName), ...merged.sort(byName)];
}

export async function groupedTeamStatistics(baseId: string, teams: TeamStats[], viewerRole: string) {
  // A team-scoped viewer must never see their own row labeled as an entire group.
  if (!["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"].includes(viewerRole)) return teams;
  try {
    const { groups } = await readStatisticsGroups(baseId);
    return mergeStatisticsGroups(teams, groups);
  } catch (error) {
    // Optional presentation configuration must not bring down historical reports.
    writeRuntimeLog("error", "statistics_groups_read_failed", { baseId, error: runtimeErrorDetails(error) });
    return teams;
  }
}
