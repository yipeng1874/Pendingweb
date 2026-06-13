import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Identity, User } from "../types";

interface AuthState {
  token?: string;
  user?: User;
  identities: Identity[];
  setAuth: (payload: { token: string; user: User; identities: Identity[] }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      identities: [],
      setAuth: (payload) => set(payload),
      logout: () => set({ token: undefined, user: undefined, identities: [] }),
    }),
    {
      name: "auth", // localStorage key
    }
  )
);
