import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Identity, User } from "../types";

interface AuthState {
  token?: string;
  user?: User;
  identities: Identity[];
  currentIdentity?: Identity;
  setAuth: (payload: { token: string; user: User; identities: Identity[] }) => void;
  setCurrentIdentity: (identity: Identity) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      identities: [],
      setAuth: (payload) => set({ token: payload.token, user: payload.user, identities: payload.identities }),
      setCurrentIdentity: (identity) => set({ currentIdentity: identity }),
      logout: () => set({ token: undefined, user: undefined, identities: [], currentIdentity: undefined }),
    }),
    { name: "todo-h5-auth" }
  )
);
