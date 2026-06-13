import type { Identity, RoleCode, User } from "../../types";

export type Account = User & { identities: Identity[] };
export type SearchAccount = Account;
export type ConflictDetail = { id: string; roleCode: RoleCode; orgId?: string; orgName?: string; orgCode?: string };
export type ViewMode = "by-org" | "by-account";
