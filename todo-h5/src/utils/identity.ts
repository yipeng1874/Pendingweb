import type { Identity } from "../types";

const ROLE_LEVEL: Record<string, number> = {
  DEV_ADMIN: 1,
  HQ_ADMIN: 2,
  BASE_ADMIN: 3,
  TEAM_ADMIN: 4,
  HALL_MANAGER: 5,
  ANCHOR: 6,
};

export function pickBestIdentity(identities: Identity[], recommendedIdentityId?: string | null) {
  const recommended = identities.find((identity) => identity.id === recommendedIdentityId);
  if (recommended) return recommended;
  if (!identities.length) return undefined;
  return [...identities].sort((a, b) => {
    const roleDiff = (ROLE_LEVEL[a.roleCode] ?? 99) - (ROLE_LEVEL[b.roleCode] ?? 99);
    if (roleDiff !== 0) return roleDiff;
    const switchDiff = new Date(b.lastSwitchedAt ?? 0).getTime() - new Date(a.lastSwitchedAt ?? 0).getTime();
    if (switchDiff !== 0) return switchDiff;
    const grantDiff = new Date(a.grantedAt ?? 0).getTime() - new Date(b.grantedAt ?? 0).getTime();
    if (grantDiff !== 0) return grantDiff;
    return a.id.localeCompare(b.id);
  })[0];
}
