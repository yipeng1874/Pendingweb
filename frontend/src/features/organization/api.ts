import { api } from "../../services/http";
import type { OrgUnit } from "../../types";
import type { BatchHallRow } from "./types";

export async function fetchOrgTree() {
  return api.get<OrgUnit[]>("/orgs/tree");
}

export async function createOrg(payload: any) {
  return api.post<OrgUnit>("/orgs", payload);
}

export async function updateOrg(id: string, payload: any) {
  return api.patch<OrgUnit>(`/orgs/${id}`, payload);
}

export async function toggleOrgStatus(id: string, isPaused: boolean) {
  return api.post<OrgUnit>(`/orgs/${id}/${isPaused ? "restore" : "pause"}`);
}

export async function moveOrg(id: string, parentId: string) {
  return api.post<OrgUnit>(`/orgs/${id}/move`, { parentId });
}

export async function deleteOrg(id: string) {
  return api.delete<{ deleted: boolean }>(`/orgs/${id}`);
}

export async function batchCreateHalls(parentId: string, rows: BatchHallRow[]) {
  return api.post<{ count: number; items: OrgUnit[] }>("/orgs/halls/batch", { parentId, rows });
}
