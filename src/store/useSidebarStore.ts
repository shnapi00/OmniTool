import { create } from "zustand";

interface SidebarState {
  isCollapsed: boolean;
  sidebarWidth: number;
  toggleCollapsed: () => void;
  setIsCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
}

const COLLAPSED_STORAGE_KEY = "omnitool_sidebar_collapsed";
const WIDTH_STORAGE_KEY = "omnitool_sidebar_width";

const getInitialCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const getInitialWidth = (): number => {
  try {
    const saved = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 180 && parsed <= 380) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return 240; // Default width (w-60)
};

export const useSidebarStore = create<SidebarState>((set, get) => ({
  isCollapsed: getInitialCollapsed(),
  sidebarWidth: getInitialWidth(),

  toggleCollapsed: () => {
    const next = !get().isCollapsed;
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
    set({ isCollapsed: next });
  },

  setIsCollapsed: (collapsed: boolean) => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // ignore
    }
    set({ isCollapsed: collapsed });
  },

  setSidebarWidth: (width: number) => {
    const clamped = Math.max(180, Math.min(380, Math.round(width)));
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // ignore
    }
    set({ sidebarWidth: clamped });
  },
}));
