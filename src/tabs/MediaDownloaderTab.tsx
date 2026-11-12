import React, { useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Folder,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  FolderOpen,
  X,
  Info,
} from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "../i18n/useTranslation";
import { useTabActivity } from "../context/TabActivityContext";
import { useMediaDownloaderStore } from "../store/useMediaDownloaderStore";

interface MediaDownloaderTabProps {
  initialUrl?: string;
  isActive?: boolean;
}

export const MediaDownloaderTab: React.FC<MediaDownloaderTabProps> = ({
  initialUrl,
  isActive = true,
}) => {
  const { t } = useTranslation();
  const { setTabProcess } = useTabActivity();

  const {
    url,
    outputDir,
    formatType,
    loading,
    toolStatus,
    toolError,
    progress,
    result,
    error,
    cancelNotice,
    setUrl,
    setOutputDir,
    setFormatType,
    checkTool,
    startDownload,
    cancelDownload,
  } = useMediaDownloaderStore();

  useEffect(() => {
    setTabProcess("media_downloader", loading);
  }, [loading, setTabProcess]);

  useEffect(() => {
    if (initialUrl && initialUrl !== url) {
      setUrl(initialUrl);
    }
  }, [initialUrl]);

  useEffect(() => {
    checkTool();
  }, [checkTool]);

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
        setUrl(text.trim());
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isActive, setUrl]);

  const handleSelectFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("dl_output_dir"),
      });
      if (typeof selected === "string") {
        setOutputDir(selected);
      }
    } catch (err) {
      console.error(err);
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

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="border-b border-white/[0.07] pb-2">
        <h2 className="text-sm font-medium text-zinc-100">{t("dl_title")}</h2>
        <p className="text-[11px] text-zinc-400 mt-0.5">{t("dl_desc")}</p>
      </div>

      {/* Tool Availability Banner */}
      {toolError ? (
        <div className="p-2.5 rounded-md bg-amber-950/30 border border-amber-900/40 text-xs text-amber-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-[11px]">
            {t("dl_ytdlp_missing_hint")}{" "}
            <code className="bg-black/40 px-1 py-0.5 rounded text-amber-200">
              winget install yt-dlp
            </code>
          </span>
        </div>
      ) : (
        toolStatus && (
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80"></span>
            <span>
              {t("dl_ytdlp_ready", {
                version:
                  toolStatus.match(/\((?:версия|version|wersja|バージョン):\s*([^\)]+)\)/i)?.[1] ||
                  toolStatus,
              })}
            </span>
          </div>
        )
      )}

      {/* Form Area */}
      <div className="space-y-2.5 pt-0.5">
        <div>
          <label className="block text-[11px] font-medium text-zinc-300 mb-1">
            {t("dl_url_label")}
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading && url.trim()) {
                startDownload(t("dl_cancelled"), t("dl_url_placeholder"), t("dl_background_loading"));
              }
            }}
            placeholder={t("dl_url_placeholder")}
            className="w-full input-base font-mono text-xs"
          />
        </div>

        {/* Format Selector */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-300 mb-1">
            {t("dl_format_label")}
          </label>
          <div className="inline-flex bg-zinc-900 border border-white/[0.08] p-0.5 rounded-md">
            {[
              { id: "mp4" as const, label: t("dl_fmt_mp4") },
              { id: "mp3" as const, label: t("dl_fmt_mp3") },
              { id: "flac" as const, label: t("dl_fmt_flac") },
            ].map((f) => {
              const isSelected = formatType === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormatType(f.id)}
                  className={`px-3 py-1 text-xs rounded transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-zinc-800 text-zinc-100 font-medium shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-zinc-300 mb-1">
            {t("dl_output_dir")}
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              className="flex-1 input-base font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleSelectFolder}
              className="btn-secondary h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("common_browse")}</span>
            </button>
          </div>
        </div>

        {/* Download Progress Bar */}
        {loading && progress && (
          <div className="p-2.5 bg-zinc-900/80 border border-white/[0.08] rounded-md space-y-1.5">
            <div className="flex justify-between items-center text-[11px] font-mono text-zinc-400">
              <span className="truncate max-w-[280px]">{progress.status}</span>
              <span>{Math.round(progress.percent)}%</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
              />
            </div>
            {(progress.speed || progress.eta) && (
              <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                {progress.speed && <span>{t("dl_speed_label", { speed: progress.speed })}</span>}
                {progress.eta && <span>{t("dl_eta_label", { eta: progress.eta })}</span>}
              </div>
            )}
          </div>
        )}

        <div className="pt-2 flex justify-end gap-2">
          {loading && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => cancelDownload(t("dl_cancelled"))}
              className="btn-secondary h-8 px-3 text-xs flex items-center gap-1.5 text-zinc-300 hover:text-red-400 hover:border-red-500/30 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t("common_cancel")}</span>
            </motion.button>
          )}

          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => startDownload(t("dl_cancelled"), t("dl_url_placeholder"), t("dl_background_loading"))}
            disabled={loading || !url.trim()}
            className="btn-primary"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t("dl_background_loading")}</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>{t("dl_download_btn")}</span>
              </>
            )}
          </motion.button>
        </div>
      </div>

      {/* Notifications */}
      {cancelNotice && (
        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-400 flex items-center gap-2 font-sans transition-all">
          <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span>{cancelNotice}</span>
        </div>
      )}

      {error && !cancelNotice && (
        <div className="p-2.5 bg-red-950/30 border border-red-900/40 rounded-md text-xs text-red-300 flex items-start gap-2 font-mono">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <span className="break-all whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {result && (
        <div className="p-2.5 bg-emerald-950/30 border border-emerald-900/40 rounded-md text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{result.message}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5 font-mono">
                {t("dl_saved_to", { dir: result.output_dir })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleOpenFolder(result.output_dir)}
            className="btn-secondary h-6 px-2 text-[11px] flex items-center gap-1 text-zinc-200 cursor-pointer shrink-0"
          >
            <FolderOpen className="w-3 h-3 text-zinc-400" />
            <span>{t("dl_open_folder")}</span>
          </button>
        </div>
      )}
    </div>
  );
};
