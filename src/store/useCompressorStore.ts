import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface CompressorProbeResult {
  filename: string;
  file_type: "video" | "image";
  size_bytes: number;
  size_formatted: string;
  width?: number;
  height?: number;
  resolution_formatted: string;
  duration_seconds?: number;
  duration_formatted: string;
  has_audio?: boolean;
}

export interface CompressResult {
  success: boolean;
  output_path: string;
  original_size_bytes: number;
  original_size_formatted: string;
  compressed_size_bytes: number;
  compressed_size_formatted: string;
  ratio_percent: number;
  message: string;
}

export interface CompressProgressPayload {
  percent: number;
  pass?: number;
  stage: string;
}

export type CompressorUnit = "MB" | "KB" | "B";

interface CompressorState {
  inputPath: string | null;
  mediaInfo: CompressorProbeResult | null;
  probing: boolean;

  targetSizeValue: string;
  targetSizeUnit: CompressorUnit;
  saveNextToOriginal: boolean;
  customOutputPath: string | null;

  loading: boolean;
  progress: CompressProgressPayload | null;
  result: CompressResult | null;
  error: string | null;
  cancelNotice: boolean;

  setInputPath: (path: string | null) => Promise<void>;
  setTargetSizeValue: (val: string) => void;
  setTargetSizeUnit: (unit: CompressorUnit) => void;
  setSaveNextToOriginal: (val: boolean) => void;
  setCustomOutputPath: (path: string | null) => void;

  startCompress: () => Promise<void>;
  cancelCompress: () => Promise<void>;
  reset: () => void;
}

export const useCompressorStore = create<CompressorState>((set, get) => ({
  inputPath: null,
  mediaInfo: null,
  probing: false,

  targetSizeValue: "10",
  targetSizeUnit: "MB",
  saveNextToOriginal: true,
  customOutputPath: null,

  loading: false,
  progress: null,
  result: null,
  error: null,
  cancelNotice: false,

  setInputPath: async (path: string | null) => {
    if (!path) {
      set({ inputPath: null, mediaInfo: null, probing: false, result: null, error: null });
      return;
    }

    set({ inputPath: path, probing: true, error: null, result: null, cancelNotice: false });
    try {
      const info = await invoke<CompressorProbeResult>("probe_compressor_file", {
        inputPath: path,
      });

      // Suggest reasonable default target size based on original size
      const currentVal = get().targetSizeValue;
      let suggestedVal = currentVal;
      let suggestedUnit: CompressorUnit = get().targetSizeUnit;

      if (info.size_bytes > 0) {
        const mb = info.size_bytes / (1024 * 1024);
        if (mb >= 5) {
          suggestedVal = Math.max(1, Math.round(mb * 0.4)).toString();
          suggestedUnit = "MB";
        } else if (mb >= 1) {
          suggestedVal = Math.max(1, Math.round(mb * 0.5)).toString();
          suggestedUnit = "MB";
        } else {
          const kb = info.size_bytes / 1024;
          if (kb >= 1) {
            suggestedVal = Math.max(1, Math.round(kb * 0.5)).toString();
            suggestedUnit = "KB";
          } else {
            suggestedVal = Math.max(1, Math.round(info.size_bytes * 0.5)).toString();
            suggestedUnit = "B";
          }
        }
      }

      set({
        mediaInfo: info,
        probing: false,
        targetSizeValue: suggestedVal,
        targetSizeUnit: suggestedUnit,
      });
    } catch (err) {
      console.error("Probe error:", err);
      set({ probing: false, error: String(err) });
    }
  },

  setTargetSizeValue: (val: string) => set({ targetSizeValue: val }),
  setTargetSizeUnit: (unit: CompressorUnit) => set({ targetSizeUnit: unit }),
  setSaveNextToOriginal: (val: boolean) => set({ saveNextToOriginal: val }),
  setCustomOutputPath: (path: string | null) => set({ customOutputPath: path }),

  startCompress: async () => {
    const { inputPath, targetSizeValue, targetSizeUnit, saveNextToOriginal, customOutputPath } = get();
    if (!inputPath) return;

    const numVal = parseFloat(targetSizeValue);
    if (isNaN(numVal) || numVal <= 0) {
      set({ error: "INVALID_TARGET_SIZE" });
      return;
    }

    set({
      loading: true,
      error: null,
      result: null,
      cancelNotice: false,
      progress: { percent: 0, stage: "starting" },
    });

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<CompressProgressPayload>("compressor-progress", (event) => {
        set({ progress: event.payload });
      });

      const res = await invoke<CompressResult>("compress_media", {
        options: {
          input_path: inputPath,
          output_path: customOutputPath,
          target_size_value: numVal,
          target_size_unit: targetSizeUnit,
          save_next_to_original: saveNextToOriginal,
        },
      });

      set({ result: res, loading: false });
    } catch (err: any) {
      const errStr = String(err);
      if (errStr.includes("TASK_CANCELLED_BY_USER")) {
        set({ loading: false, cancelNotice: true });
      } else {
        set({ error: errStr, loading: false });
      }
    } finally {
      if (unlisten) {
        unlisten();
      }
    }
  },

  cancelCompress: async () => {
    try {
      await invoke("cancel_task", { taskType: "compressor" });
      set({ loading: false, cancelNotice: true, progress: null });
    } catch (err) {
      console.warn("Cancel compressor task error:", err);
    }
  },

  reset: () => {
    set({
      inputPath: null,
      mediaInfo: null,
      probing: false,
      loading: false,
      progress: null,
      result: null,
      error: null,
      cancelNotice: false,
      customOutputPath: null,
    });
  },
}));
