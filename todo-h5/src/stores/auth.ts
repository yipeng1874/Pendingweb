import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthPayload, Identity, User } from "../types";
import { pickBestIdentity } from "../utils/identity";

interface AuthState {
  token?: string;
  user?: User;
  identities: Identity[];
  currentIdentity?: Identity;
  setAuth: (payload: AuthPayload) => void;
  setCurrentIdentity: (identity: Identity) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      identities: [],
      setAuth: (payload) => set({
        token: payload.token,
        user: payload.user,
        identities: payload.identities,
        currentIdentity: pickBestIdentity(payload.identities, payload.recommendedIdentityId),
      }),
      setCurrentIdentity: (identity) => set({ currentIdentity: identity }),
      logout: () => set({ token: undefined, user: undefined, identities: [], currentIdentity: undefined }),
    }),
    { name: "todo-h5-auth" }
  )
);
