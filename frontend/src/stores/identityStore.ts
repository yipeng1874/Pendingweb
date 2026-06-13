import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Identity } from "../types";

interface IdentityState {
  currentIdentity?: Identity;
  permissions: string[];
  setIdentity: (identity: Identity) => void;
  setPermissions: (permissions: string[]) => void;
}

export const useIdentityStore = create<IdentityState>()(
  persist(
    (set) => ({
      permissions: [],
      setIdentity: (identity) => set({ currentIdentity: identity }),
      setPermissions: (permissions) => set({ permissions }),
    }),
    {
      name: "identity", // localStorage key
      // permissions 不需要持久化（每次刷新从后端重新拉取）
      partialize: (state) => ({ currentIdentity: state.currentIdentity }),
    }
  )
);
