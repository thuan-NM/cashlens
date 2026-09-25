import { create } from "zustand";
import { apiRequest } from "@/api/client";
import type { ApiUser } from "@/types/user";

export interface AuthUser {
  id?: string;
  name: string;
  email: string;
  fullName?: string | null;
}

interface AuthStore {
  isAuthed: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  hydrate: () => Promise<void>;
  login: (values: { email: string; password: string }) => Promise<AuthUser>;
  register: (values: { email: string; password: string; fullName?: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
}

/** The user fields the client reads; `name` is a legacy fallback the current API does not send. */
type ApiAuthUser = ApiUser & { name?: string | null };

/** `POST /auth/login` answers `{ user }`; a bare user is still accepted. */
type LoginResponse = ApiAuthUser & { user?: ApiAuthUser };

const toAuthUser = (value: ApiAuthUser): AuthUser => ({
  id: value?.id,
  name: value?.fullName ?? value?.name ?? value?.email ?? "User",
  fullName: value?.fullName,
  email: value?.email,
});

export const useAuthStore = create<AuthStore>((set) => ({
  isAuthed: false,
  isLoading: true,
  user: null,

  setUser: (user) => set({ user, isAuthed: Boolean(user), isLoading: false }),

  hydrate: async () => {
    set({ isLoading: true });
    try {
      const user = await apiRequest<ApiAuthUser>("/auth/me");
      set({ isAuthed: true, user: toAuthUser(user), isLoading: false });
    } catch {
      set({ isAuthed: false, user: null, isLoading: false });
    }
  },

  login: async (values) => {
    const result = await apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(values),
    });
    const user = toAuthUser(result.user ?? result);
    set({ isAuthed: true, user, isLoading: false });
    return user;
  },

  register: async (values) => {
    const user = await apiRequest<ApiAuthUser>("/auth/register", {
      method: "POST",
      body: JSON.stringify(values),
    });
    return toAuthUser(user);
  },

  logout: async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout errors; local auth state still needs to be cleared.
    }
    set({ isAuthed: false, user: null, isLoading: false });
  },
}));