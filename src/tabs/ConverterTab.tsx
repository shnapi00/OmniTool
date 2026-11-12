import React, { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  FileUp,
  Folder,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRightLeft,
  FolderOpen,
  X,
  Info,
} from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "../i18n/useTranslation";
import { useTabActivity } from "../context/TabActivityContext";
import { useConverterStore } from "../store/useConverterStore";

export const ConverterTab: React.FC = () => {
  const { t } = useTranslation();
  const { setTabProcess } = useTabActivity();

  const {
    inputPath,
    outputPath,
    targetFormat,
    startTime,
    endTime,
    loading,
    result,
    error,
    cancelNotice,
    setInputPath,
    setOutputPath,
    setTargetFormat,
    setStartTime,
    setEndTime,
    startConvert,
    cancelConvert,
  } = useConverterStore();

  useEffect(() => {
    setTabProcess("converter", loading);
  }, [loading, setTabProcess]);

  const handleSelectInput = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("conv_choose_file_title"),
      });

      if (typeof selected === "string") {
        setInputPath(selected);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectOutput = async () => {
    try {
      const target = await save({
        title: t("conv_save_file_title"),
        defaultPath: outputPath || `converted.${targetFormat}`,
      });

      if (typeof target === "string") {
        setOutputPath(target);
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

  const formats = [
    { group: t("conv_group_video"), items: ["mp4", "mkv", "webm", "avi", "mov", "gif"] },
    { group: t("conv_group_audio"), items: ["mp3", "flac", "wav", "ogg", "m4a", "aac"] },
    { group: t("conv_group_images"), items: ["png", "jpg", "webp", "bmp"] },
  ];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="border-b border-white/[0.07] pb-2">
        <h2 className="text-sm font-medium text-zinc-100">{t("conv_title")}</h2>
        <p className="text-[11px] text-zinc-400 mt-0.5">{t("conv_desc")}</p>
      </div>

      <div className="space-y-2.5 pt-0.5">
        {/* Input File */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-300 mb-1">
            {t("conv_file_label")}
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              readOnly
              value={inputPath}
              placeholder={t("conv_placeholder_file")}
              className="flex-1 input-base font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleSelectInput}
              className="btn-secondary h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("common_browse")}</span>
            </button>
          </div>
        </div>

        {/* Format Selector */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-300 mb-1">
            {t("conv_target_fmt")}
          </label>
          <div className="flex flex-wrap gap-1">
            {formats.map((group) => (
              <div key={group.group} className="flex items-center gap-1 bg-zinc-900/60 p-1 rounded border border-white/[0.06]">
                <span className="text-[10px] text-zinc-500 px-1 font-medium">{group.group}:</span>
                {group.items.map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setTargetFormat(fmt)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer ${
                      targetFormat === fmt
                        ? "bg-zinc-700 text-zinc-100 font-medium"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Trim options */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-medium text-zinc-400 mb-0.5">
              {t("conv_trim_start")}
            </label>
            <input
              type="text"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder={t("conv_time_placeholder_start")}
              className="w-full input-base font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-zinc-400 mb-0.5">
              {t("conv_trim_end")}
            </label>
            <input
              type="text"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder={t("conv_time_placeholder_end")}
              className="w-full input-base font-mono text-xs"
            />
          </div>
        </div>

        {/* Output Path */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-300 mb-1">
            {t("conv_save_path_label")}
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              className="flex-1 input-base font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleSelectOutput}
              className="btn-secondary h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("common_browse")}</span>
            </button>
          </div>
        </div>

        <div className="pt-2 flex justify-end gap-2">
          {loading && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => cancelConvert(t("conv_cancelled"))}
              className="btn-secondary h-8 px-3 text-xs flex items-center gap-1.5 text-zinc-300 hover:text-red-400 hover:border-red-500/30 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t("common_cancel")}</span>
            </motion.button>
          )}

          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => startConvert(t("conv_cancelled"), t("conv_placeholder_file"))}
            disabled={loading || !inputPath.trim()}
            className="btn-primary"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t("conv_processing_background")}</span>
              </>
            ) : (
              <>
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>{t("conv_btn")}</span>
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
          <span className="break-all whitespace-pre-wrap">
            {error.includes("Gyan.FFmpeg") || error.includes("требуется FFmpeg") || error.toLowerCase().includes("ffmpeg")
              ? t("conv_ffmpeg_missing_hint")
              : error}
          </span>
        </div>
      )}

      {result && (
        <div className="p-2.5 bg-emerald-950/30 border border-emerald-900/40 rounded-md text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{result.message}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5 font-mono">
                {result.output_path}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleOpenFolder(result.output_path)}
            className="btn-secondary h-6 px-2 text-[11px] flex items-center gap-1 text-zinc-200 cursor-pointer shrink-0"
          >
            <FolderOpen className="w-3 h-3 text-zinc-400" />
            <span>{t("conv_open_folder")}</span>
          </button>
        </div>
      )}
    </div>
  );
};
