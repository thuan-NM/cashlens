import { create } from "zustand";

interface UiStore {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  notificationOpen: boolean;
  readAlerts: string[];
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
  setNotificationOpen: (open: boolean) => void;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: (ids: string[]) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  sidebarCollapsed: false,
  mobileNavOpen: false,
  notificationOpen: false,
  readAlerts: [],
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setNotificationOpen: (notificationOpen) => set({ notificationOpen }),
  markAlertRead: (id) =>
    set((state) => ({
      readAlerts: state.readAlerts.includes(id) ? state.readAlerts : [...state.readAlerts, id],
    })),
  markAllAlertsRead: (readAlerts) => set({ readAlerts }),
}));
