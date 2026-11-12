import React, { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Folder,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  Search,
  CheckSquare,
  Square,
  FolderOpen,
} from "lucide-react";
import { useTranslation } from "../i18n/useTranslation";
import { useTabActivity } from "../context/TabActivityContext";
import { useStickersStore } from "../store/useStickersStore";
import { StickerCard } from "../components/StickerCard";

interface StickersTabProps {
  initialPack?: string;
  isActive?: boolean;
}

export const StickersTab: React.FC<StickersTabProps> = ({
  initialPack,
  isActive = true,
}) => {
  const { t } = useTranslation();
  const { setTabProcess } = useTabActivity();

  const {
    packName,
    outputDir,
    animatedFormat,
    loadingPack,
    downloading,
    packInfo,
    selectedIds,
    progress,
    result,
    error,
    setPackName,
    setOutputDir,
    setAnimatedFormat,
    loadPack,
    toggleSelectSticker,
    toggleSelectAll,
    downloadSelected,
  } = useStickersStore();

  const [hasBuiltinToken, setHasBuiltinToken] = React.useState(true);

  useEffect(() => {
    invoke<boolean>("has_builtin_tg_token")
      .then(setHasBuiltinToken)
      .catch(() => {});
  }, []);

  // Keep sidebar activity dot in sync with store background processes
  useEffect(() => {
    setTabProcess("stickers", loadingPack || downloading);
  }, [loadingPack, downloading, setTabProcess]);

  useEffect(() => {
    if (initialPack && initialPack !== packName) {
      setPackName(initialPack);
      loadPack(initialPack);
    }
  }, [initialPack]);

  useEffect(() => {
    if (!isActive) return;
    const handlePaste = (e: ClipboardEvent) => {
      const isInput =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (isInput) return;

      const text = e.clipboardData?.getData("text/plain");
      if (text && text.trim().length > 0) {
        e.preventDefault();
        setPackName(text.trim());
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isActive, setPackName]);

  const handleSelectFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("stickers_select_folder_title"),
      });
      if (typeof selected === "string") {
        setOutputDir(selected);
      }
    } catch (err) {
      console.error("Ошибка выбора папки:", err);
    }
  };

  const handleOpenFolder = async (path: string) => {
    try {
      await invoke("open_folder", { path });
    } catch {
      try {
        await openPath(path);
      } catch (err) {
        console.error("Ошибка открытия папки:", err);
      }
    }
  };

  const allSelected = packInfo ? selectedIds.size === packInfo.stickers.length : false;
  const hasToken = Boolean(
    hasBuiltinToken ||
    (typeof window !== "undefined" && localStorage.getItem("omnitool_custom_tg_bot_token")?.trim())
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium text-zinc-100">{t("stickers_title")}</h2>
        <p className="text-xs text-zinc-400">
          {t("stickers_preview_desc")}
        </p>
      </div>

      {/* Missing Token Warning */}
      {!hasToken && (
        <div className="p-2.5 bg-amber-950/20 border border-amber-900/30 rounded text-xs text-amber-200/90 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span>{t("stickers_missing_token_hint")}</span>
        </div>
      )}

      {/* Input & Action Bar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={packName}
            onChange={(e) => setPackName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                loadPack(undefined, t("stickers_input_placeholder"));
              }
            }}
            placeholder={t("stickers_input_placeholder")}
            className="input-base flex-1 h-8 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => loadPack(undefined, t("stickers_input_placeholder"))}
            disabled={loadingPack || downloading || !packName.trim()}
            className="btn-primary h-8 px-3 text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shrink-0"
          >
            {loadingPack ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t("stickers_loading_pack")}</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>{t("stickers_load_pack")}</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            className="input-base flex-1 h-8 font-mono text-xs"
            placeholder={t("stickers_out_dir_placeholder")}
          />
          <button
            type="button"
            onClick={handleSelectFolder}
            className="btn-secondary h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5"
          >
            <Folder className="w-3.5 h-3.5 text-zinc-400" />
            <span>{t("common_browse")}</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.04]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-400">{t("stickers_anim_format")}:</span>
            <div className="inline-flex items-center rounded border border-white/[0.08] bg-zinc-950/60 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setAnimatedFormat("webp")}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  animatedFormat === "webp"
                    ? "bg-zinc-800 text-zinc-100 font-medium"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                WebP
              </button>
              <button
                type="button"
                onClick={() => setAnimatedFormat("gif")}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  animatedFormat === "gif"
                    ? "bg-zinc-800 text-zinc-100 font-medium"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                GIF
              </button>
            </div>
          </div>
          <span className="text-[10px] text-zinc-500">
            {t("stickers_static_note")}
          </span>
        </div>
      </div>

      {/* Errors */}
      {error && (
        <div className="p-2.5 bg-red-950/40 border border-red-900/50 rounded text-xs text-red-300 flex items-start gap-2 font-mono">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400 mt-0.5" />
          <div className="whitespace-pre-wrap">{error}</div>
        </div>
      )}

      {/* Success Banner */}
      {result && (
        <div className="p-2.5 bg-emerald-950/40 border border-emerald-900/50 rounded text-xs font-mono text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              {result.count > 0
                ? t("stickers_download_success", { count: result.count })
                : result.message}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleOpenFolder(result.saved_dir)}
            className="btn-secondary h-6 px-2 text-[11px] flex items-center gap-1 text-zinc-200 cursor-pointer"
          >
            <FolderOpen className="w-3 h-3 text-zinc-400" />
            <span>{t("stickers_open_folder")}</span>
          </button>
        </div>
      )}

      {/* Interactive Selection Grid */}
      {packInfo && (
        <div className="border border-white/[0.08] rounded overflow-hidden bg-zinc-950/30 flex flex-col">
          {/* Grid Toolbar */}
          <div className="h-9 px-3 bg-zinc-900/80 border-b border-white/[0.08] flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-zinc-200 truncate max-w-[200px]">
                  {packInfo.title}
                </span>
                <span className="text-[11px] text-zinc-500 font-mono">
                  ({t("stickers_total_count", { count: packInfo.total })})
                </span>
              </div>

              <div className="h-3.5 w-px bg-white/[0.1]" />

              <button
                type="button"
                onClick={toggleSelectAll}
                className="btn-secondary h-6 px-2 text-[11px] flex items-center gap-1 cursor-pointer"
              >
                {allSelected ? (
                  <>
                    <Square className="w-3 h-3 text-zinc-400" />
                    <span>{t("stickers_deselect_all")}</span>
                  </>
                ) : (
                  <>
                    <CheckSquare className="w-3 h-3 text-emerald-400" />
                    <span>{t("stickers_select_all")}</span>
                  </>
                )}
              </button>

              <span className="text-[11px] text-zinc-400 font-mono">
                {t("stickers_selected_count", { selected: selectedIds.size, total: packInfo.total })}
              </span>
            </div>

            <button
              type="button"
              onClick={() => downloadSelected(t("stickers_downloading"))}
              disabled={selectedIds.size === 0 || downloading}
              className="btn-primary h-6 px-3 text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {downloading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{t("stickers_downloading")}</span>
                </>
              ) : (
                <>
                  <Download className="w-3 h-3" />
                  <span>{t("stickers_download_selected", { count: selectedIds.size })}</span>
                </>
              )}
            </button>
          </div>

          {/* Download Progress Bar */}
          {downloading && progress && (
            <div className="px-3 py-1.5 bg-zinc-900/60 border-b border-white/[0.06] space-y-1">
              <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                <span>
                  {progress.current >= progress.total ? t("common_done") : progress.status}
                </span>
                <span>{Math.round((progress.current / progress.total) * 100)}%</span>
              </div>
              <div className="w-full h-1 bg-zinc-800 rounded overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-150"
                  style={{
                    width: `${Math.min(100, (progress.current / progress.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Stickers Grid */}
          <div className="p-3 max-h-[460px] overflow-y-auto">
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
              {packInfo.stickers.map((sticker) => (
                <StickerCard
                  key={sticker.file_id}
                  sticker={sticker}
                  isSelected={selectedIds.has(sticker.file_id)}
                  onToggle={() => toggleSelectSticker(sticker.file_id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
