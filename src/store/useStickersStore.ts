import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadTgsAnimation } from "../utils/tgsLoader";
import { renderTgsFrames } from "../utils/tgsRenderer";

export interface ProgressPayload {
  current: number;
  total: number;
  status: string;
}

export interface StickerPreviewItem {
  index: number;
  file_id: string;
  thumb_id?: string | null;
  emoji?: string;
  is_animated: boolean;
  is_video: boolean;
  preview_url: string;
  raw_url: string;
}

export interface StickerPackInfo {
  name: string;
  title: string;
  total: number;
  stickers: StickerPreviewItem[];
}

export interface StickerResult {
  success: boolean;
  pack_name: string;
  title: string;
  count: number;
  saved_dir: string;
  message: string;
}

interface StickersState {
  packName: string;
  outputDir: string;
  animatedFormat: "webp" | "gif";
  loadingPack: boolean;
  downloading: boolean;
  packInfo: StickerPackInfo | null;
  selectedIds: Set<string>;
  progress: ProgressPayload | null;
  result: StickerResult | null;
  error: string | null;

  setPackName: (name: string) => void;
  setOutputDir: (dir: string) => void;
  setAnimatedFormat: (format: "webp" | "gif") => void;
  loadPack: (nameOverride?: string, emptyErrorText?: string) => Promise<void>;
  toggleSelectSticker: (fileId: string) => void;
  toggleSelectAll: () => void;
  downloadSelected: (prepStatusText?: string) => Promise<void>;
  clearResult: () => void;
  clearError: () => void;
}

const getStoredAnimFormat = (): "webp" | "gif" => {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("omnitool_sticker_anim_format");
    if (saved === "gif" || saved === "webp") return saved;
  }
  return "webp";
};

export const useStickersStore = create<StickersState>((set, get) => ({
  packName: "",
  outputDir: "Downloads/Stickers",
  animatedFormat: getStoredAnimFormat(),
  loadingPack: false,
  downloading: false,
  packInfo: null,
  selectedIds: new Set<string>(),
  progress: null,
  result: null,
  error: null,

  setPackName: (name: string) => set({ packName: name }),
  setOutputDir: (dir: string) => set({ outputDir: dir }),
  setAnimatedFormat: (format: "webp" | "gif") => {
    if (typeof window !== "undefined") {
      localStorage.setItem("omnitool_sticker_anim_format", format);
    }
    set({ animatedFormat: format });
  },

  loadPack: async (nameOverride?: string, emptyErrorText?: string) => {
    const target = (nameOverride || get().packName).trim();
    if (!target) {
      set({ error: emptyErrorText || "Please specify sticker pack name or link" });
      return;
    }

    set({
      loadingPack: true,
      error: null,
      result: null,
      progress: null,
    });

    try {
      const userToken = localStorage.getItem("omnitool_custom_tg_bot_token")?.trim() || null;
      const info = await invoke<StickerPackInfo>("load_sticker_pack", {
        token: userToken,
        packName: target,
      });

      const allIds = new Set(info.stickers.map((s) => s.file_id));
      set({
        packInfo: info,
        selectedIds: allIds,
        loadingPack: false,
      });
    } catch (err) {
      set({
        error: String(err),
        packInfo: null,
        selectedIds: new Set(),
        loadingPack: false,
      });
    }
  },

  toggleSelectSticker: (fileId: string) => {
    const current = new Set(get().selectedIds);
    if (current.has(fileId)) {
      current.delete(fileId);
    } else {
      current.add(fileId);
    }
    set({ selectedIds: current });
  },

  toggleSelectAll: () => {
    const { packInfo, selectedIds } = get();
    if (!packInfo) return;

    if (selectedIds.size === packInfo.stickers.length) {
      set({ selectedIds: new Set() });
    } else {
      const allIds = new Set(packInfo.stickers.map((s) => s.file_id));
      set({ selectedIds: allIds });
    }
  },

  downloadSelected: async (prepStatusText?: string) => {
    const { packInfo, selectedIds, outputDir, animatedFormat } = get();
    if (!packInfo || selectedIds.size === 0) return;

    set({
      downloading: true,
      error: null,
      result: null,
      progress: { current: 0, total: selectedIds.size, status: prepStatusText || "Preparing..." },
    });

    try {
      const userToken = localStorage.getItem("omnitool_custom_tg_bot_token")?.trim() || null;
      const effectiveToken = userToken;
      const selectedItems = packInfo.stickers.filter((s) => selectedIds.has(s.file_id));

      const targetDir = await invoke<string>("prepare_sticker_pack_dir", {
        packName: packInfo.name,
        outputDir: outputDir.trim(),
      });

      let savedCount = 0;
      const total = selectedItems.length;

      for (let i = 0; i < total; i++) {
        const item = selectedItems[i];
        const index = i + 1;

        set({
          progress: {
            current: index,
            total,
            status: `${prepStatusText || "Downloading"} (${index}/${total})...`,
          },
        });

        try {
          if (item.is_animated) {
            // Векторный Lottie (.tgs)
            let framesRendered = false;
            try {
              const animData = await loadTgsAnimation(item.file_id, item.raw_url);
              if (animData) {
                const { frames, fps } = await renderTgsFrames(animData);
                if (frames.length > 0) {
                  await invoke("save_tgs_animated_sticker", {
                    targetDir,
                    index,
                    frames,
                    fps,
                    format: animatedFormat,
                  });
                  framesRendered = true;
                  savedCount++;
                }
              }
            } catch (renderErr) {
              console.warn("Error rendering TGS frames for sticker", item.file_id, renderErr);
            }

            // Fallback: если не удалось отрендерить кадры, сохраняем миниатюру в PNG
            if (!framesRendered && item.thumb_id) {
              await invoke("save_static_sticker", {
                token: effectiveToken,
                fileId: item.thumb_id,
                targetDir,
                index,
              });
              savedCount++;
            }
          } else if (item.is_video) {
            // Видеостикер (.webm) -> конвертация через FFmpeg в .webp или .gif с сохранением альфа-канала
            await invoke("save_video_sticker", {
              token: effectiveToken,
              fileId: item.file_id,
              targetDir,
              index,
              format: animatedFormat,
            });
            savedCount++;
          } else {
            // Статичный стикер -> чистый прозрачный PNG
            await invoke("save_static_sticker", {
              token: effectiveToken,
              fileId: item.file_id,
              targetDir,
              index,
            });
            savedCount++;
          }
        } catch (itemErr) {
          console.error("Ошибка сохранения стикера", item.file_id, itemErr);
        }
      }

      set({
        result: {
          success: true,
          pack_name: packInfo.name,
          title: packInfo.title,
          count: savedCount,
          saved_dir: targetDir,
          message: `Успешно скачано: ${savedCount} стикеров`,
        },
        downloading: false,
        progress: { current: total, total, status: "Готово!" },
      });
    } catch (err) {
      set({ error: String(err), downloading: false });
    }
  },

  clearResult: () => set({ result: null }),
  clearError: () => set({ error: null }),
}));

// Global listener for sticker progress: runs continuously across tab switches!
if (typeof window !== "undefined") {
  listen<ProgressPayload>("sticker-progress", (event) => {
    useStickersStore.setState({ progress: event.payload });
  }).catch(console.error);
}
