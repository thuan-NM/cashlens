import { create } from "zustand";

interface AuthStore {
  isAuthed: boolean;
  user: { name: string; email: string } | null;
  login: (user: { name: string; email: string }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  isAuthed: false,
  user: null,
  login: (user) => set({ isAuthed: true, user }),
  logout: () => set({ isAuthed: false, user: null }),
}));
