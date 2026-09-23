import type { AuthProvider } from "@refinedev/core";
import { apiRequest } from "@/api/client";

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
    if ((error as { status?: number }).status === 401) {
      return { logout: true, redirectTo: "/" };
    }

    return { error };
  },
};