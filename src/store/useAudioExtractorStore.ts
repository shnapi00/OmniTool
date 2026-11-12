import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface MediaInfo {
  filename: string;
  size_bytes: u64;
  size_formatted: string;
  duration_seconds: number;
  duration_formatted: string;
  video_codec: string | null;
  audio_codec: string | null;
  has_audio: boolean;
  has_video: boolean;
}

type u64 = number;

export interface AudioExtractResult {
  success: boolean;
  output_path: string;
  message: string;
  mode: string;
}

interface AudioExtractorState {
  inputPath: string;
  mediaInfo: MediaInfo | null;
  probing: boolean;
  mode: "extract" | "mute";
  audioFormat: "original" | "mp3" | "wav" | "flac";
  saveNextToOriginal: boolean;
  customOutputDir: string;
  loading: boolean;
  result: AudioExtractResult | null;
  error: string | null;
  cancelNotice: string | null;
  isCancelledByUser: boolean;

  setInputPath: (path: string) => Promise<void>;
  setMode: (mode: "extract" | "mute") => void;
  setAudioFormat: (format: "original" | "mp3" | "wav" | "flac") => void;
  setSaveNextToOriginal: (val: boolean) => void;
  setCustomOutputDir: (dir: string) => void;
  startProcess: (cancelText?: string, emptyInputError?: string) => Promise<void>;
  cancelProcess: (cancelText?: string) => Promise<void>;
  clearResult: () => void;
  clearError: () => void;
  clearCancelNotice: () => void;
  reset: () => void;
}

export const useAudioExtractorStore = create<AudioExtractorState>((set, get) => ({
  inputPath: "",
  mediaInfo: null,
  probing: false,
  mode: "extract",
  audioFormat: "original",
  saveNextToOriginal: true,
  customOutputDir: "",
  loading: false,
  result: null,
  error: null,
  cancelNotice: null,
  isCancelledByUser: false,

  setInputPath: async (path: string) => {
    const cleanPath = path.trim();
    set({
      inputPath: cleanPath,
      result: null,
      error: null,
      cancelNotice: null,
    });

    if (!cleanPath) {
      set({ mediaInfo: null, probing: false });
      return;
    }

    set({ probing: true });
    try {
      const info = await invoke<MediaInfo>("probe_media_file", {
        inputPath: cleanPath,
      });
      set({ mediaInfo: info, probing: false });
    } catch (err) {
      console.warn("Probe media file error:", err);
      set({ mediaInfo: null, probing: false });
    }
  },

  setMode: (mode: "extract" | "mute") => set({ mode, result: null }),
  setAudioFormat: (audioFormat) => set({ audioFormat }),
  setSaveNextToOriginal: (saveNextToOriginal) => set({ saveNextToOriginal }),
  setCustomOutputDir: (customOutputDir) => set({ customOutputDir }),

  startProcess: async (cancelText?: string, emptyInputError?: string) => {
    const { inputPath, mode, audioFormat, saveNextToOriginal, customOutputDir } = get();
    if (!inputPath.trim()) {
      set({ error: emptyInputError || "Please select a video file" });
      return;
    }

    set({
      loading: true,
      error: null,
      result: null,
      cancelNotice: null,
      isCancelledByUser: false,
    });

    try {
      const outputPath = !saveNextToOriginal && customOutputDir.trim()
        ? customOutputDir.trim()
        : null;

      const res = await invoke<AudioExtractResult>("process_audio_extraction", {
        options: {
          input_path: inputPath.trim(),
          output_path: outputPath,
          mode,
          audio_format: audioFormat,
        },
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
        const notice = cancelText || "Operation cancelled";
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

  cancelProcess: async (cancelText?: string) => {
    const notice = cancelText || "Operation cancelled";
    set({
      isCancelledByUser: true,
      loading: false,
      cancelNotice: notice,
      error: null,
    });

    try {
      await invoke("cancel_task", { taskType: "audio_extractor" });
    } catch (err) {
      console.error("Cancel task error:", err);
    }

    setTimeout(() => {
      set((s) => (s.cancelNotice === notice ? { cancelNotice: null, isCancelledByUser: false } : {}));
    }, 2500);
  },

  clearResult: () => set({ result: null }),
  clearError: () => set({ error: null }),
  clearCancelNotice: () => set({ cancelNotice: null }),
  reset: () =>
    set({
      inputPath: "",
      mediaInfo: null,
      probing: false,
      result: null,
      error: null,
      cancelNotice: null,
      loading: false,
      isCancelledByUser: false,
    }),
}));
