import type { AuthProvider } from "@refinedev/core";
import { apiRequest } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";

type LoginParams = { email: string; password: string };
type RegisterParams = LoginParams & { fullName?: string; name?: string };

export const authProvider: AuthProvider = {
  login: async (params) => {
    const { email, password } = params as LoginParams;

    try {
      await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      return { success: true, redirectTo: "/app/dashboard" };
    } catch (error) {
      return {
        success: false,
        error: {
          name: "Login failed",
          message: error instanceof Error ? error.message : "Invalid credentials",
        },
      };
    }
  },

  register: async (params) => {
    const values = params as RegisterParams;

    try {
      await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          fullName: values.fullName ?? values.name,
        }),
      });
      return { success: true, redirectTo: "/" };
    } catch (error) {
      return {
        success: false,
        error: {
          name: "Register failed",
          message: error instanceof Error ? error.message : "Registration failed",
        },
      };
    }
  },

  logout: async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch {
      // The client state should still be cleared if the server session is already gone.
    }
    // The app's route guard reads the auth store (there is no refine router provider),
    // so a sign-out triggered by refine (e.g. an expired session in onError) must clear it.
    useAuthStore.getState().setUser(null);

    return { success: true, redirectTo: "/" };
  },

  check: async () => {
    try {
      await apiRequest("/auth/me");
      return { authenticated: true };
    } catch {
      return { authenticated: false, redirectTo: "/" };
    }
  },

  getIdentity: async () => {
    try {
      return await apiRequest("/auth/me");
    } catch {
      return null;
    }
  },

  onError: async (error) => {
    const { status, sessionRenewed } = error as { status?: number; sessionRenewed?: boolean };

    // The client already tried one session renewal (api/client.ts). If it worked, the
    // user stays signed in and retries the action; otherwise they return to sign-in.
    if (status === 401 && !sessionRenewed) {
      return {
        logout: true,
        redirectTo: "/",
        error: { name: "Session expired", message: "Please sign in again." },
      };
    }

    return { error };
  },
};