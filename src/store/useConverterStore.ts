import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface ConvertResult {
  success: boolean;
  output_path: string;
  message: string;
}

interface ConverterState {
  inputPath: string;
  outputPath: string;
  targetFormat: string;
  startTime: string;
  endTime: string;
  loading: boolean;
  result: ConvertResult | null;
  error: string | null;
  cancelNotice: string | null;
  isCancelledByUser: boolean;

  setInputPath: (path: string) => void;
  setOutputPath: (path: string) => void;
  setTargetFormat: (fmt: string) => void;
  setStartTime: (time: string) => void;
  setEndTime: (time: string) => void;
  startConvert: (cancelText?: string, emptyInputError?: string) => Promise<void>;
  cancelConvert: (cancelText?: string) => Promise<void>;
  clearResult: () => void;
  clearError: () => void;
  clearCancelNotice: () => void;
}

export const useConverterStore = create<ConverterState>((set, get) => ({
  inputPath: "",
  outputPath: "",
  targetFormat: "mp4",
  startTime: "",
  endTime: "",
  loading: false,
  result: null,
  error: null,
  cancelNotice: null,
  isCancelledByUser: false,

  setInputPath: (inputPath: string) => {
    set({ inputPath });
    const fmt = get().targetFormat;
    const dotIndex = inputPath.lastIndexOf(".");
    if (dotIndex !== -1) {
      set({ outputPath: `${inputPath.substring(0, dotIndex)}.${fmt}` });
    } else {
      set({ outputPath: `${inputPath}.${fmt}` });
    }
  },

  setOutputPath: (outputPath: string) => set({ outputPath }),

  setTargetFormat: (targetFormat: string) => {
    set({ targetFormat });
    const input = get().inputPath;
    if (input) {
      const dotIndex = input.lastIndexOf(".");
      if (dotIndex !== -1) {
        set({ outputPath: `${input.substring(0, dotIndex)}.${targetFormat}` });
      } else {
        set({ outputPath: `${input}.${targetFormat}` });
      }
    }
  },

  setStartTime: (startTime: string) => set({ startTime }),
  setEndTime: (endTime: string) => set({ endTime }),

  startConvert: async (cancelText?: string, emptyInputError?: string) => {
    const { inputPath, outputPath, targetFormat, startTime, endTime } = get();
    if (!inputPath.trim()) {
      set({ error: emptyInputError || "Please select a file to convert" });
      return;
    }

    set({ loading: true, error: null, result: null, cancelNotice: null, isCancelledByUser: false });

    try {
      const res = await invoke<ConvertResult>("convert_media", {
        inputPath: inputPath.trim(),
        outputPath: outputPath.trim(),
        targetFormat: targetFormat.trim(),
        startTime: startTime.trim() ? startTime.trim() : null,
        endTime: endTime.trim() ? endTime.trim() : null,
      });

      if (get().isCancelledByUser) {
        return;
      }
      set({ result: res, loading: false });
    } catch (err) {
      const errStr = String(err);
      if (
        get().isCancelledByUser ||
        errStr.includes("TASK_CANCELLED_BY_USER") ||
        errStr.toLowerCase().includes("отменен") ||
        errStr.toLowerCase().includes("cancel")
      ) {
        const notice = cancelText || "Conversion cancelled";
        set({
          loading: false,
          error: null,
          cancelNotice: notice,
          isCancelledByUser: true,
        });
        setTimeout(() => {
          set((s) => (s.cancelNotice === notice ? { cancelNotice: null, isCancelledByUser: false } : {}));
        }, 2500);
      } else {
        set({ error: errStr, loading: false });
      }
    }
  },

  cancelConvert: async (cancelText?: string) => {
    const notice = cancelText || "Conversion cancelled";
    set({ isCancelledByUser: true, loading: false, cancelNotice: notice, error: null });

    try {
      await invoke("cancel_task", { taskType: "converter" });
    } catch (err) {
      console.error(err);
    }

    setTimeout(() => {
      set((s) => (s.cancelNotice === notice ? { cancelNotice: null, isCancelledByUser: false } : {}));
    }, 2500);
  },

  clearResult: () => set({ result: null }),
  clearError: () => set({ error: null }),
  clearCancelNotice: () => set({ cancelNotice: null }),
}));
