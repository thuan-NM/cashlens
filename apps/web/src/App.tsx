import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import type { ReactNode } from "react";
import { AppProvider } from "@/providers/AppProvider";
import { AppShell } from "@/components/layout/AppShell";
import { AuthPage } from "@/features/auth";
import { DashboardPage } from "@/features/dashboard";
import { TransactionsPage } from "@/features/transactions";
import { AccountsPage } from "@/features/accounts";
import { BudgetsPage } from "@/features/budgets";
import { GoalsPage } from "@/features/goals";
import { AlertsPage } from "@/features/alerts";
import { EmailPage } from "@/features/email-connections";
import { OpsPage } from "@/features/ops";
import { SettingsPage } from "@/features/settings";
import { useAuthStore } from "@/stores/authStore";
import { ROUTES } from "@/config/routes";

function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthed = useAuthStore((state) => state.isAuthed);
  return isAuthed ? children : <Navigate to={ROUTES.AUTH} replace />;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path={ROUTES.AUTH} element={<AuthPage />} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to={ROUTES.DASHBOARD} replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="budgets" element={<BudgetsPage />} />
            <Route path="goals" element={<GoalsPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="email" element={<EmailPage />} />
            <Route path="ops" element={<OpsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to={ROUTES.AUTH} replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
