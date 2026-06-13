import { api } from "./http";
import type { Identity, User } from "../types";

export function login(phone: string, password: string) {
  return api.post<{ token: string; user: User; identities: Identity[] }>("/auth/login", { phone, password });
}
