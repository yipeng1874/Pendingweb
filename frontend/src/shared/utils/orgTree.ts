import type { Identity, OrgUnit } from "../../types";

export interface OrgNode extends OrgUnit {
  children: OrgNode[];
}

export function buildOrgTree(orgs: OrgUnit[]): OrgNode[] {
  const map = new Map<string, OrgNode>();
  const roots: OrgNode[] = [];

  for (const org of orgs) {
    map.set(org.id, { ...org, children: [] });
  }

  for (const org of orgs) {
    const node = map.get(org.id);
    if (!node) continue;
    if (org.parentId && map.has(org.parentId)) {
      map.get(org.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: OrgNode[]) => {
    nodes.sort((a, b) => a.depth - b.depth || a.orgCode.localeCompare(b.orgCode));
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);
  return roots;
}

export function collectDescendantIds(rootId: string, orgs: OrgUnit[]) {
  const childrenMap = new Map<string, string[]>();
  for (const org of orgs) {
    if (!org.parentId) continue;
    const children = childrenMap.get(org.parentId) ?? [];
    children.push(org.id);
    childrenMap.set(org.parentId, children);
  }

  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const childId of childrenMap.get(id) ?? []) stack.push(childId);
  }
  return result;
}

export function getDefaultExpandedOrgIds(orgs: OrgUnit[], identity?: Identity) {
  if (!orgs.length) return new Set<string>();

  const selectedOrg = identity?.orgId ? orgs.find((org) => org.id === identity.orgId) : undefined;
  const scopeSegments = identity?.scopePath?.split("/").filter(Boolean) ?? [];
  const scopeNodes = scopeSegments
    .map((segment) => orgs.find((org) => org.orgCode === segment))
    .filter((org): org is OrgUnit => Boolean(org));

  if (identity?.roleCode === "HALL_MANAGER") {
    return new Set(scopeNodes.slice(0, -1).map((org) => org.id));
  }

  if (selectedOrg?.orgType === "TEAM") {
    return new Set(scopeNodes.map((org) => org.id));
  }

  if (selectedOrg?.orgType === "BASE") {
    return new Set(scopeNodes.map((org) => org.id));
  }

  if (identity?.roleCode === "DEV_ADMIN" || identity?.roleCode === "HQ_ADMIN") {
    return new Set(orgs.filter((org) => org.orgType === "HQ" || org.orgType === "BASE").map((org) => org.id));
  }

  return new Set(scopeNodes.map((org) => org.id));
}

export function getDefaultSelectedOrgId(orgs: OrgUnit[], identity?: Identity) {
  if (!orgs.length) return "";
  if (identity?.orgId && orgs.some((org) => org.id === identity.orgId)) return identity.orgId;
  const scopeSegments = identity?.scopePath?.split("/").filter(Boolean) ?? [];
  const deepestScopedOrg = [...scopeSegments].reverse().map((segment) => orgs.find((org) => org.orgCode === segment)).find(Boolean);
  return deepestScopedOrg?.id ?? orgs[0]?.id ?? "";
}

export function collectScopedHallOptions(orgs: OrgUnit[], selectedOrgId?: string) {
  const scopeIds = selectedOrgId ? collectDescendantIds(selectedOrgId, orgs) : null;
  return orgs.filter((org) => org.orgType === "HALL" && (!scopeIds || scopeIds.has(org.id)));
}
