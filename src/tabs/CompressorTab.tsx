import React, { useState, useEffect, useRef } from "react";
import {
  Minimize2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
  HardDrive,
  Film,
  Image as ImageIcon,
  Clock,
  X,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "../i18n/useTranslation";
import { useCompressorStore } from "../store/useCompressorStore";
import { useTabActivity } from "../context/TabActivityContext";
import { triggerSuccessConfetti } from "../utils/confetti";
import { FileDropzone } from "../components/FileDropzone";

interface CompressorTabProps {
  isActive?: boolean;
}

const SUPPORTED_EXTENSIONS = [
  "mp4",
  "mkv",
  "mov",
  "webm",
  "avi",
  "png",
  "jpg",
  "jpeg",
  "webp",
];

export const CompressorTab: React.FC<CompressorTabProps> = ({ isActive = true }) => {
  const { t } = useTranslation();
  const { setTabProcess } = useTabActivity();

  const {
    inputPath,
    mediaInfo,
    probing,
    targetSizeValue,
    targetSizeUnit,
    saveNextToOriginal,
    customOutputPath,
    loading,
    progress,
    result,
    error,
    cancelNotice,
    setInputPath,
    setTargetSizeValue,
    setTargetSizeUnit,
    setSaveNextToOriginal,
    setCustomOutputPath,
    startCompress,
    cancelCompress,
    reset,
  } = useCompressorStore();

  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTabProcess("compressor", loading);
  }, [loading, setTabProcess]);

  useEffect(() => {
    if (result && result.success) {
      triggerSuccessConfetti();
    }
  }, [result]);

  // Support Ctrl+V paste of file path from clipboard
  useEffect(() => {
    if (!isActive) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text")?.trim();
      if (text) {
        const clean = text.replace(/^["']|["']$/g, "").trim();
        const ext = clean.split(".").pop()?.toLowerCase();
        if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
          e.preventDefault();
          await setInputPath(clean);
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isActive, setInputPath]);

  // Open file dialog
  const handleChooseFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        title: t("compressor_or_choose"),
        filters: [
          {
            name: "Media Files (Video & Images)",
            extensions: SUPPORTED_EXTENSIONS,
          },
        ],
      });

      if (typeof selected === "string") {
        await setInputPath(selected);
      }
    } catch (err) {
      console.error("Choose file error:", err);
    }
  };

  // Choose custom output file
  const handleSelectCustomOutput = async () => {
    try {
      const isImg = mediaInfo?.file_type === "image";
      const defaultExt = isImg ? "jpg" : "mp4";
      const selected = await saveDialog({
        title: t("compressor_output_path"),
        defaultPath: customOutputPath || `compressed.${defaultExt}`,
      });

      if (typeof selected === "string") {
        setCustomOutputPath(selected);
      }
    } catch (err) {
      console.error("Select output error:", err);
    }
  };

  const handleOpenFolder = async (filePath: string) => {
    try {
      const parent = filePath.substring(0, Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/")));
      await invoke("open_folder", { path: parent });
    } catch {
      try {
        await openPath(filePath);
      } catch (err) {
        console.error("Open folder error:", err);
      }
    }
  };

  const stageLabel = () => {
    if (!progress) return "";
    if (progress.stage === "pass_1") return t("compressor_processing_video_p1");
    if (progress.stage === "pass_2") return t("compressor_processing_video_p2");
    if (progress.stage === "single_pass" || progress.stage === "compressing") return t("compressor_processing_video_sp");
    if (progress.stage === "optimizing_image") return t("compressor_processing_image");
    return "";
  };

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setIsDragOver(false);
        }
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file && (file as any).path) {
          const path = (file as any).path as string;
          await setInputPath(path);
        }
      }}
      className="space-y-4 pb-8 max-w-2xl mx-auto"
    >
      {/* 1. Header: Flat & Minimalist */}
      <div className="border-b border-white/[0.07] pb-2">
        <h2 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
          <Minimize2 className="w-4 h-4 text-zinc-400" />
          <span>{t("compressor_title")}</span>
        </h2>
      </div>

      {/* 2. File Selection Zone */}
      {!inputPath ? (
        <FileDropzone
          onChoose={handleChooseFile}
          isDragOver={isDragOver}
          title={t("compressor_drop_hint")}
          subtitle={t("compressor_formats_hint")}
        />
      ) : (
        /* Selected File Card */
        <div className="bg-zinc-900/60 border border-white/[0.08] rounded-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {mediaInfo?.file_type === "image" ? (
                <ImageIcon className="w-4 h-4 text-zinc-400 shrink-0" />
              ) : (
                <Film className="w-4 h-4 text-zinc-400 shrink-0" />
              )}
              <span className="text-xs font-medium text-zinc-200 truncate font-mono">
                {mediaInfo?.filename || inputPath.split(/[\\/]/).pop()}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleChooseFile}
                disabled={loading}
                className="btn-secondary h-6.5 px-2 text-[11px]"
              >
                {t("common_browse")}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={loading}
                className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors"
                title={t("common_cancel")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Metadata Grid */}
          {probing ? (
            <div className="flex items-center gap-2 text-[11px] text-zinc-400 py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
              <span>{t("common_loading")}</span>
            </div>
          ) : mediaInfo ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-white/[0.06] text-xs">
              <div className="bg-zinc-950/40 p-2 rounded border border-white/[0.04]">
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5">
                  <HardDrive className="w-2.5 h-2.5 text-zinc-400" />
                  <span>{t("compressor_original_size")}</span>
                </div>
                <span className="font-mono text-[11px] text-zinc-200 font-medium">
                  {mediaInfo.size_formatted}
                </span>
              </div>

              <div className="bg-zinc-950/40 p-2 rounded border border-white/[0.04]">
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5">
                  <ImageIcon className="w-2.5 h-2.5 text-zinc-400" />
                  <span>{t("compressor_resolution")}</span>
                </div>
                <span className="font-mono text-[11px] text-zinc-200 font-medium">
                  {mediaInfo.resolution_formatted}
                </span>
              </div>

              {mediaInfo.duration_seconds ? (
                <div className="bg-zinc-950/40 p-2 rounded border border-white/[0.04]">
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5">
                    <Clock className="w-2.5 h-2.5 text-zinc-400" />
                    <span>{t("compressor_duration")}</span>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-200 font-medium">
                    {mediaInfo.duration_formatted}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {/* 3. Target Size Setting */}
      <div className="pt-2 border-t border-white/[0.07] space-y-2">
        <label className="block text-[11px] font-medium text-zinc-400">
          {t("compressor_target_size")}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step={targetSizeUnit === "B" ? "1" : "any"}
            min={targetSizeUnit === "B" ? "1" : "0.001"}
            disabled={loading}
            value={targetSizeValue}
            onChange={(e) => setTargetSizeValue(e.target.value)}
            className="input-base w-32 font-mono text-sm px-3 py-1.5"
            placeholder={targetSizeUnit === "B" ? "1024" : targetSizeUnit === "KB" ? "500" : "10"}
          />

          {/* Unit Toggle [ MB | KB | B ] */}
          <div className="inline-flex p-0.5 bg-zinc-900/90 border border-white/[0.08] rounded-md">
            <button
              type="button"
              disabled={loading}
              onClick={() => setTargetSizeUnit("MB")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                targetSizeUnit === "MB"
                  ? "bg-zinc-800 text-zinc-100 shadow-xs"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t("compressor_unit_mb")}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setTargetSizeUnit("KB")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                targetSizeUnit === "KB"
                  ? "bg-zinc-800 text-zinc-100 shadow-xs"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t("compressor_unit_kb")}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setTargetSizeUnit("B")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                targetSizeUnit === "B"
                  ? "bg-zinc-800 text-zinc-100 shadow-xs"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t("compressor_unit_b")}
            </button>
          </div>
        </div>
      </div>

      {/* 4. Options */}
      <div className="pt-2 border-t border-white/[0.07] space-y-2">
        <div className="flex items-center gap-2">
          <input
            id="saveNextToOriginal"
            type="checkbox"
            disabled={loading}
            checked={saveNextToOriginal}
            onChange={(e) => setSaveNextToOriginal(e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-900 text-zinc-100 accent-zinc-300 w-3.5 h-3.5 cursor-pointer"
          />
          <label
            htmlFor="saveNextToOriginal"
            className="text-xs text-zinc-300 select-none cursor-pointer"
          >
            {t("compressor_save_next_to_original")}
          </label>
        </div>

        {!saveNextToOriginal && (
          <div className="pt-1 flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={customOutputPath || ""}
              placeholder={t("compressor_output_path")}
              className="input-base flex-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleSelectCustomOutput}
              disabled={loading}
              className="btn-secondary h-7 px-2.5 text-xs shrink-0 cursor-pointer"
            >
              {t("common_browse")}
            </button>
          </div>
        )}
      </div>

      {/* 5. Progress Indicator */}
      {loading && (
        <div className="pt-2 border-t border-white/[0.07] space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>{stageLabel() || t("common_loading")}</span>
            <span className="font-mono text-zinc-300 font-medium">
              {Math.round(progress?.percent || 0)}%
            </span>
          </div>
          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-zinc-200"
              initial={{ width: "0%" }}
              animate={{ width: `${Math.max(2, Math.min(100, progress?.percent || 0))}%` }}
              transition={{ ease: "easeOut", duration: 0.2 }}
            />
          </div>
        </div>
      )}

      {/* 6. Success Result Card */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-3 bg-zinc-900/60 border border-white/[0.08] rounded-lg space-y-2 text-xs"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-200 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{t("compressor_success_title")}</span>
              </div>
              <button
                type="button"
                onClick={() => handleOpenFolder(result.output_path)}
                className="btn-secondary h-6.5 px-2 text-[11px] flex items-center gap-1.5 cursor-pointer"
              >
                <FolderOpen className="w-3 h-3 text-zinc-400" />
                <span>{t("compressor_open_folder")}</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/[0.04] text-[11px] font-mono">
              <div className="bg-zinc-950/40 p-2 rounded border border-white/[0.04]">
                <div className="text-[10px] text-zinc-500">{t("compressor_original_size")}</div>
                <div className="text-zinc-200">{result.original_size_formatted}</div>
              </div>
              <div className="bg-zinc-950/40 p-2 rounded border border-white/[0.04]">
                <div className="text-[10px] text-zinc-500">{t("compressor_compressed_size")}</div>
                <div className="text-zinc-100 font-semibold">{result.compressed_size_formatted}</div>
              </div>
              <div className="bg-zinc-950/40 p-2 rounded border border-white/[0.04]">
                <div className="text-[10px] text-zinc-500">{t("compressor_ratio")}</div>
                <div className="text-emerald-400 font-medium">
                  {result.ratio_percent > 0 ? `+${result.ratio_percent.toFixed(1)}%` : `${result.ratio_percent.toFixed(1)}%`}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 7. Error or Cancelled Notification */}
      {error && (
        <div className="p-2.5 bg-red-950/30 border border-red-900/40 rounded-md text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span>
            {error === "INVALID_TARGET_SIZE"
              ? t("compressor_invalid_size")
              : error}
          </span>
        </div>
      )}

      {cancelNotice && (
        <div className="p-2.5 bg-zinc-900/60 border border-white/[0.08] rounded-md text-xs text-zinc-400 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span>{t("common_cancelled")}</span>
        </div>
      )}

      {/* 8. Action Buttons */}
      <div className="pt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={startCompress}
          disabled={!inputPath || loading}
          className="btn-primary flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Minimize2 className="w-3.5 h-3.5" />
          )}
          <span>{t("compressor_start_btn")}</span>
        </button>

        {loading && (
          <button
            type="button"
            onClick={cancelCompress}
            className="btn-secondary h-8 px-3 text-xs cursor-pointer"
          >
            {t("compressor_cancel_btn")}
          </button>
        )}
      </div>
    </div>
  );
};
