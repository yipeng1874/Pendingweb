import type { ReactNode } from "react";
import { useIdentityStore } from "../stores/identityStore";
import type { RoleCode } from "../types";

interface PermissionGateProps {
  permission?: string;
  permissions?: string[];
  roles?: RoleCode[];
  children: ReactNode;
}

export function PermissionGate({ permission, permissions: requiredPermissions, roles, children }: PermissionGateProps) {
  const permissions = useIdentityStore((state) => state.permissions);
  const currentRoleCode = useIdentityStore((state) => state.currentIdentity?.roleCode);

  const roleAllowed = !roles?.length || Boolean(currentRoleCode && roles.includes(currentRoleCode));
  const permissionCodes = requiredPermissions ?? (permission ? [permission] : []);
  const permissionAllowed = !permissionCodes.length || permissionCodes.some((code) => permissions.includes("*") || permissions.includes(code));

  if (!roleAllowed || !permissionAllowed) return null;
  return <>{children}</>;
}
