import React, { useState, useEffect, useRef } from "react";
import {
  Volume2,
  VolumeX,
  FileVideo,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Folder,
  Music,
  Clock,
  HardDrive,
  Film,
  X,
  Info,
  Mic,
  Check,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { useTranslation } from "../i18n/useTranslation";
import { useAudioExtractorStore } from "../store/useAudioExtractorStore";
import { useTabActivity } from "../context/TabActivityContext";
import { triggerSuccessConfetti } from "../utils/confetti";
import { FileDropzone } from "../components/FileDropzone";

interface AudioExtractorTabProps {
  isActive?: boolean;
}

export const AudioExtractorTab: React.FC<AudioExtractorTabProps> = ({ isActive = true }) => {
  const { t } = useTranslation();
  const { setTabProcess } = useTabActivity();

  const {
    inputPath,
    mediaInfo,
    probing,
    mode,
    audioFormat,
    saveNextToOriginal,
    customOutputDir,
    loading,
    result,
    error,
    cancelNotice,
    setInputPath,
    setMode,
    setAudioFormat,
    setSaveNextToOriginal,
    setCustomOutputDir,
    startProcess,
    cancelProcess,
    reset,
  } = useAudioExtractorStore();

  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync active task state with Sidebar activity badge
  useEffect(() => {
    setTabProcess("audio_extractor", loading);
  }, [loading, setTabProcess]);

  // Support Ctrl+V paste of file path from clipboard
  useEffect(() => {
    if (!isActive) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text")?.trim();
      if (text) {
        // Strip surrounding quotes if present
        const clean = text.replace(/^["']|["']$/g, "").trim();
        const videoExtensions = [".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".ts", ".m4v"];
        if (videoExtensions.some((ext) => clean.toLowerCase().endsWith(ext))) {
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
        title: t("audio_ext_choose_file_title"),
        filters: [
          {
            name: "Video Files",
            extensions: ["mp4", "mkv", "avi", "mov", "webm", "flv", "ts", "m4v"],
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

  // Choose custom destination folder
  const handleSelectFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("audio_ext_select_dest"),
      });

      if (typeof selected === "string") {
        setCustomOutputDir(selected);
      }
    } catch (err) {
      console.error("Select folder error:", err);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      // On Tauri, files dropped often have file.path
      const filePath = (file as any).path || file.name;
      if (filePath) {
        await setInputPath(filePath);
      }
    }
  };

  const [addingToSoundpad, setAddingToSoundpad] = useState(false);
  const [soundpadSuccess, setSoundpadSuccess] = useState(false);
  const [soundpadError, setSoundpadError] = useState<string | null>(null);

  const handleAddToSoundpad = async (filePath: string) => {
    if (addingToSoundpad) return;
    setAddingToSoundpad(true);
    setSoundpadError(null);

    try {
      await invoke("add_to_soundpad", { filePath });
      setSoundpadSuccess(true);
      triggerSuccessConfetti();
      setTimeout(() => {
        setSoundpadSuccess(false);
      }, 2500);
    } catch (err: unknown) {
      const errStr = String(err || "");
      if (errStr.includes("SOUNDPAD_NOT_RUNNING") || errStr.includes("SOUNDPAD_PIPE_UNAVAILABLE")) {
        setSoundpadError(t("audio_ext_soundpad_not_running"));
      } else if (errStr.includes("SOUNDPAD_TRIAL_RESTRICTION")) {
        setSoundpadError(t("audio_ext_soundpad_trial_notice"));
      } else {
        setSoundpadError(errStr || t("audio_ext_soundpad_not_running"));
      }
    } finally {
      setAddingToSoundpad(false);
    }
  };

  const handleOpenOutputFolder = async (filePath: string) => {
    try {
      await invoke("open_folder", { path: filePath });
    } catch (err) {
      console.error("Open folder error:", err);
    }
  };

  return (
    <div ref={containerRef} className="space-y-3.5 pb-8 max-w-3xl mx-auto">
      {/* Header - Minimal & Clean */}
      <div className="border-b border-white/[0.07] pb-2">
        <h2 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-zinc-400" />
          <span>{t("audio_ext_title")}</span>
        </h2>
      </div>

      {/* File Dropzone / Selected File Card */}
      {!inputPath ? (
        <FileDropzone
          onChoose={handleChooseFile}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          isDragOver={isDragOver}
          title={t("audio_ext_drop_title")}
          subtitle="MP4, MKV, AVI, MOV, WEBM"
        />
      ) : (
        <div className="p-3 rounded-lg border border-white/[0.08] bg-zinc-900/60 backdrop-blur-xs space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-md bg-zinc-800/80 border border-white/[0.06] flex items-center justify-center shrink-0">
                <FileVideo className="w-4 h-4 text-zinc-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-100 truncate" title={inputPath}>
                  {mediaInfo?.filename || inputPath.split(/[\\/]/).pop()}
                </p>
                <p className="text-[10px] font-mono text-zinc-500 truncate" title={inputPath}>
                  {inputPath}
                </p>
              </div>
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

          {/* Probing or Media Metadata details */}
          {probing ? (
            <div className="flex items-center gap-2 text-[11px] text-zinc-400 py-0.5">
              <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin" />
              <span>{t("common_loading")}</span>
            </div>
          ) : mediaInfo ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1 border-t border-white/[0.06] text-xs">
              <div className="bg-zinc-950/40 p-1.5 rounded border border-white/[0.04]">
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5">
                  <Clock className="w-2.5 h-2.5 text-zinc-400" />
                  <span>{t("audio_ext_duration")}</span>
                </div>
                <span className="font-mono text-[11px] text-zinc-200">
                  {mediaInfo.duration_formatted}
                </span>
              </div>

              <div className="bg-zinc-950/40 p-1.5 rounded border border-white/[0.04]">
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5">
                  <HardDrive className="w-2.5 h-2.5 text-zinc-400" />
                  <span>{t("audio_ext_size")}</span>
                </div>
                <span className="font-mono text-[11px] text-zinc-200">
                  {mediaInfo.size_formatted}
                </span>
              </div>

              <div className="bg-zinc-950/40 p-1.5 rounded border border-white/[0.04]">
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5">
                  <Film className="w-2.5 h-2.5 text-zinc-400" />
                  <span>{t("audio_ext_video_codec")}</span>
                </div>
                <span className="font-mono text-[11px] text-zinc-200 uppercase">
                  {mediaInfo.video_codec || "—"}
                </span>
              </div>

              <div className="bg-zinc-950/40 p-1.5 rounded border border-white/[0.04]">
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5">
                  <Music className="w-2.5 h-2.5 text-zinc-400" />
                  <span>{t("audio_ext_audio_codec")}</span>
                </div>
                <span className="font-mono text-[11px] text-zinc-200 uppercase">
                  {mediaInfo.has_audio ? mediaInfo.audio_codec || "OK" : t("audio_ext_no_audio")}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Operation Mode Selector: Segmented Control */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium text-zinc-400">
          {t("audio_ext_mode_label")}
        </label>
        <div className="inline-flex w-full p-0.5 bg-zinc-900/90 border border-white/[0.08] rounded-lg relative">
          <button
            type="button"
            onClick={() => setMode("extract")}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer relative z-10 text-zinc-300"
          >
            {mode === "extract" && (
              <motion.div
                layoutId="audioExtModePill"
                className="absolute inset-0 bg-zinc-800 rounded-md shadow-xs border border-white/[0.08]"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <span className="relative z-10">{t("audio_ext_mode_extract")}</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("mute")}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer relative z-10 text-zinc-300"
          >
            {mode === "mute" && (
              <motion.div
                layoutId="audioExtModePill"
                className="absolute inset-0 bg-zinc-800 rounded-md shadow-xs border border-white/[0.08]"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <span className="relative z-10">{t("audio_ext_mode_mute")}</span>
          </button>
        </div>
      </div>

      {/* Audio Format Selector (Only in Extract Mode) */}
      {mode === "extract" && (
        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-zinc-400">
            {t("audio_ext_format_label")}
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { id: "original" as const, label: t("audio_ext_fmt_original") },
              { id: "mp3" as const, label: t("audio_ext_fmt_mp3") },
              { id: "wav" as const, label: t("audio_ext_fmt_wav") },
              { id: "flac" as const, label: t("audio_ext_fmt_flac") },
            ].map((f) => {
              const isSelected = audioFormat === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setAudioFormat(f.id)}
                  className={`py-1.5 px-2 rounded-md border text-center text-xs font-medium transition-colors cursor-pointer relative ${
                    isSelected
                      ? "border-emerald-500/50 text-emerald-300"
                      : "bg-zinc-900/50 border-white/[0.06] text-zinc-400 hover:border-white/[0.12] hover:text-zinc-200"
                  }`}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="audioExtFormatPill"
                      className="absolute inset-0 bg-zinc-800 rounded-md shadow-xs -z-0"
                      transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10">{f.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Destination Folder Options & Actions */}
      <div className="space-y-2.5 pt-1 border-t border-white/[0.06]">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={saveNextToOriginal}
              onChange={(e) => setSaveNextToOriginal(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 w-3.5 h-3.5 cursor-pointer"
            />
            <span>{t("audio_ext_save_next_to")}</span>
          </label>
        </div>

        {!saveNextToOriginal && (
          <div className="flex gap-1.5">
            <input
              type="text"
              value={customOutputDir}
              onChange={(e) => setCustomOutputDir(e.target.value)}
              placeholder={t("audio_ext_select_dest")}
              className="flex-1 input-base font-mono text-xs h-7.5"
            />
            <button
              type="button"
              onClick={handleSelectFolder}
              className="btn-secondary h-7.5 px-2.5 text-xs shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("common_browse")}</span>
            </button>
          </div>
        )}

        {/* Action Buttons - Tight and Compact */}
        <div className="pt-1 flex justify-end gap-2">
          {loading && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => cancelProcess(t("audio_ext_cancelled"))}
              className="btn-secondary h-8 px-3 text-xs flex items-center gap-1.5 text-zinc-300 hover:text-red-400 hover:border-red-500/30 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t("common_cancel")}</span>
            </motion.button>
          )}

          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => startProcess(t("audio_ext_cancelled"), t("audio_ext_empty_input"))}
            disabled={loading || !inputPath.trim()}
            className="btn-primary h-8 px-4 text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t("audio_ext_processing")}</span>
              </>
            ) : (
              <>
                {mode === "extract" ? (
                  <Volume2 className="w-3.5 h-3.5" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5" />
                )}
                <span>{t("audio_ext_btn_start")}</span>
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
            {error.toLowerCase().includes("ffmpeg")
              ? t("conv_ffmpeg_missing_hint")
              : error}
          </span>
        </div>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="p-3 bg-emerald-950/30 border border-emerald-900/40 rounded-lg text-xs text-emerald-300 flex items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium text-emerald-200">
                {result.mode === "mute"
                  ? t("audio_ext_success_mute")
                  : t("audio_ext_success_extract")}
              </p>
              <p className="text-[11px] text-zinc-400 mt-0.5 font-mono truncate" title={result.output_path}>
                {result.output_path}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {result.mode === "extract" && (
              <button
                type="button"
                onClick={() => handleAddToSoundpad(result.output_path)}
                disabled={addingToSoundpad}
                className={`h-7 px-2.5 text-[11px] rounded-md border flex items-center gap-1.5 transition-all cursor-pointer font-medium ${
                  soundpadSuccess
                    ? "bg-emerald-600/25 border-emerald-500/50 text-emerald-200 shadow-xs"
                    : "bg-zinc-800 hover:bg-zinc-700/80 border-white/[0.08] text-zinc-200 hover:text-white"
                }`}
                title={t("audio_ext_add_to_soundpad")}
              >
                {addingToSoundpad ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                ) : soundpadSuccess ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Mic className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>
                  {soundpadSuccess
                    ? t("audio_ext_soundpad_added")
                    : t("audio_ext_add_to_soundpad")}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleOpenOutputFolder(result.output_path)}
              className="btn-secondary h-7 px-2.5 text-[11px] flex items-center gap-1.5 cursor-pointer"
            >
              <Folder className="w-3 h-3 text-zinc-400" />
              <span>{t("audio_ext_open_folder")}</span>
            </button>
          </div>
        </motion.div>
      )}

      {soundpadError && (
        <div className="p-2.5 bg-amber-950/30 border border-amber-900/40 rounded-md text-xs text-amber-300 flex items-center justify-between gap-2 transition-all">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">{soundpadError}</span>
          </div>
          <button
            type="button"
            onClick={() => setSoundpadError(null)}
            className="text-amber-400/60 hover:text-amber-200 p-0.5 rounded cursor-pointer shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};
