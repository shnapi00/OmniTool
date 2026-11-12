import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface MediaProgressPayload {
  percent: number;
  speed: string;
  eta: string;
  status: string;
}

export interface MediaResult {
  success: boolean;
  output_dir: string;
  log: string;
  message: string;
}

interface MediaDownloaderState {
  url: string;
  outputDir: string;
  formatType: "mp4" | "mp3" | "flac";
  loading: boolean;
  toolStatus: string | null;
  toolError: string | null;
  progress: MediaProgressPayload | null;
  result: MediaResult | null;
  error: string | null;
  cancelNotice: string | null;
  isCancelledByUser: boolean;

  setUrl: (url: string) => void;
  setOutputDir: (dir: string) => void;
  setFormatType: (format: "mp4" | "mp3" | "flac") => void;
  checkTool: () => Promise<void>;
  startDownload: (cancelText?: string, emptyUrlError?: string, startingStatus?: string) => Promise<void>;
  cancelDownload: (cancelText?: string) => Promise<void>;
  clearResult: () => void;
  clearError: () => void;
  clearCancelNotice: () => void;
}

export const useMediaDownloaderStore = create<MediaDownloaderState>((set, get) => ({
  url: "",
  outputDir: "Downloads",
  formatType: "mp4",
  loading: false,
  toolStatus: null,
  toolError: null,
  progress: null,
  result: null,
  error: null,
  cancelNotice: null,
  isCancelledByUser: false,

  setUrl: (url: string) => set({ url }),
  setOutputDir: (dir: string) => set({ outputDir: dir }),
  setFormatType: (format: "mp4" | "mp3" | "flac") => set({ formatType: format }),

  checkTool: async () => {
    try {
      const status = await invoke<string>("check_media_tool");
      set({ toolStatus: status, toolError: null });
    } catch (err) {
      set({ toolError: String(err), toolStatus: null });
    }
  },

  startDownload: async (cancelText?: string, emptyUrlError?: string, startingStatus?: string) => {
    const { url, outputDir, formatType } = get();
    const rawUrl = url.trim();
    if (!rawUrl) {
      set({ error: emptyUrlError || "Please enter a video URL" });
      return;
    }

    const cleanUrl =
      !rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")
        ? `https://${rawUrl}`
        : rawUrl;

    set({
      loading: true,
      error: null,
      result: null,
      cancelNotice: null,
      isCancelledByUser: false,
      progress: {
        percent: 0,
        speed: "",
        eta: "",
        status: startingStatus || "Starting download...",
      },
    });

    try {
      const res = await invoke<MediaResult>("download_media", {
        url: cleanUrl,
        outputDir: outputDir.trim(),
        audioOnly: formatType !== "mp4",
        formatType,
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
        const notice = cancelText || "Download cancelled";
        set({
          loading: false,
          progress: null,
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

  cancelDownload: async (cancelText?: string) => {
    const notice = cancelText || "Download cancelled";
    set({
      isCancelledByUser: true,
      loading: false,
      progress: null,
      error: null,
      cancelNotice: notice,
    });

    try {
      await invoke("cancel_task", { taskType: "downloader" });
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

// Global listener for media download progress: runs continuously across tab switches!
if (typeof window !== "undefined") {
  listen<MediaProgressPayload>("media-progress", (event) => {
    useMediaDownloaderStore.setState({ progress: event.payload });
  }).catch(console.error);
}
