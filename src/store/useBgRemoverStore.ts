import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface BgResult {
  success: boolean;
  output_path: string;
  processing_time_ms: number;
  method: string;
  message: string;
}

interface BgRemoverState {
  inputPath: string;
  loading: boolean;
  result: BgResult | null;
  error: string | null;

  setInputPath: (path: string) => void;
  removeBg: (input: string) => Promise<BgResult | null>;
  clearResult: () => void;
  clearError: () => void;
}

export const useBgRemoverStore = create<BgRemoverState>((set) => ({
  inputPath: "",
  loading: false,
  result: null,
  error: null,

  setInputPath: (path: string) => set({ inputPath: path }),

  removeBg: async (input: string) => {
    if (!input.trim()) {
      set({ error: "Please select an image" });
      return null;
    }

    set({ loading: true, error: null, result: null, inputPath: input });

    try {
      const res = await invoke<BgResult>("remove_background", {
        inputPath: input.trim(),
        outputPath: "",
      });

      set({ result: res, loading: false });
      return res;
    } catch (err) {
      set({ error: String(err), loading: false });
      return null;
    }
  },

  clearResult: () => set({ result: null }),
  clearError: () => set({ error: null }),
}));
