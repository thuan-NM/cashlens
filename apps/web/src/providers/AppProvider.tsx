import { App as AntdApp, ConfigProvider, theme } from "antd";
import viVN from "antd/locale/vi_VN";
import { Refine } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { authProvider } from "./authProvider";
import { dataProvider } from "./dataProvider";

/**
 * Drops every cached query when the signed-in user goes away or changes (sign-out,
 * an expired session, another account), so the next user in the same tab never sees
 * the previous user's data while their own loads.
 */
function ClearCacheOnUserChange() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      useAuthStore.subscribe((state, previous) => {
        const before = previous.user;
        const after = state.user;
        if (before && (!after || after.id !== before.id || after.email !== before.email)) queryClient.clear();
      }),
    [queryClient],
  );

  return null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const mode = useThemeStore((state) => state.theme);

  return (
    <Refine
      authProvider={authProvider}
      dataProvider={dataProvider}
      resources={[
        { name: "dashboard" },
        { name: "transactions" },
        { name: "financial-accounts" },
        { name: "transaction-categories" },
        { name: "budgets" },
        { name: "goals" },
        { name: "alerts" },
        { name: "email-connections" },
        { name: "email-listen-rules" },
        { name: "bank-providers" },
      ]}
      options={{ syncWithLocation: false, warnWhenUnsavedChanges: false }}
    >
      <ClearCacheOnUserChange />
      <ConfigProvider
        locale={viVN}
        theme={{
          algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: "#D97757",
            colorInfo: "#D97757",
            colorSuccess: "#4a9d6e",
            colorWarning: "#d99a3c",
            colorError: "#d2604c",
            borderRadius: 11,
            fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
          },
        }}
      >
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </Refine>
  );
}