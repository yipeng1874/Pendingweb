import { api } from "./http";
import type { OrgUnit } from "../types";

export function fetchOrgTree() {
  return api.get<OrgUnit[]>("/orgs/tree");
}
