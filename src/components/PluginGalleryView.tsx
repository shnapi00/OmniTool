import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  FolderOpen,
  Trash2,
  Play,
  CheckSquare,
  Square,
  ExternalLink,
  Film,
  FileText,
  Terminal,
  Grid,
  X,
  Check,
  Maximize2,
  AlertTriangle,
} from "lucide-react";
import { useTranslation } from "../i18n/useTranslation";

export interface GalleryItem {
  id: string;
  name: string;
  path: string;
  size?: string;
  duration?: string;
  type?: "video" | "image" | "audio" | "file";
  thumbnail?: string;
}

export interface GalleryPayload {
  action?: string;
  type?: string;
  directory?: string;
  title?: string;
  files?: (GalleryItem | string)[];
  items?: (GalleryItem | string)[];
}

export function parseGalleryOutput(
  output: string | null,
  fallbackDir?: string
): { isGallery: boolean; directory?: string; files: GalleryItem[] } | null {
  if (!output || typeof output !== "string") return null;

  let parsed: any = null;

  // 1. Try direct parse
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    // 2. Try regex extraction of JSON block
    const match = output.match(/(\{[\s\S]*\})/);
    if (match) {
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        const jsonStart = output.lastIndexOf("{");
        const jsonEnd = output.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          try {
            parsed = JSON.parse(output.substring(jsonStart, jsonEnd + 1));
          } catch {
            // failed
          }
        }
      }
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const isGalleryAction =
    parsed.action === "render_gallery" ||
    parsed.type === "gallery" ||
    parsed.view === "gallery";

  const rawList = parsed.files || parsed.items || (Array.isArray(parsed) ? parsed : null);

  if (!isGalleryAction && !rawList) return null;

  const directory: string | undefined =
    typeof parsed.directory === "string" ? parsed.directory : fallbackDir;
  const list = Array.isArray(rawList) ? rawList : [];

  const files: GalleryItem[] = list.map((item: any, idx: number) => {
    let p = typeof item === "string" ? item : item.path || item.url || item.name || "";
    let n =
      typeof item === "object" && item.name
        ? item.name
        : p.split(/[/\\]/).pop() || `File ${idx + 1}`;

    // Resolve relative path if directory given
    if (directory && !p.includes(":\\") && !p.startsWith("/")) {
      const sep = directory.includes("/") ? "/" : "\\";
      p = `${directory.replace(/[/\\]+$/, "")}${sep}${p.replace(/^[/\\]+/, "")}`;
    }

    const ext = (n || p).split(".").pop()?.toLowerCase() || "";
    let itemType: "video" | "image" | "audio" | "file" = "file";
    if (["mp4", "webm", "mkv", "mov", "avi", "wmv", "flv", "m4v"].includes(ext)) {
      itemType = "video";
    } else if (["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"].includes(ext)) {
      itemType = "image";
    } else if (["mp3", "wav", "flac", "ogg", "m4a", "aac"].includes(ext)) {
      itemType = "audio";
    }

    if (typeof item === "object" && item.type) {
      itemType = item.type;
    }

    return {
      id: p || `item-${idx}`,
      name: n,
      path: p,
      size: typeof item === "object" ? item.size : undefined,
      duration: typeof item === "object" ? item.duration : undefined,
      type: itemType,
      thumbnail: typeof item === "object" ? item.thumbnail : undefined,
    };
  });

  return {
    isGallery: true,
    directory,
    files,
  };
}

interface PluginGalleryViewProps {
  initialFiles: GalleryItem[];
  directory?: string;
  rawOutput?: string;
  onSwitchToTerminal?: () => void;
}

export const PluginGalleryView: React.FC<PluginGalleryViewProps> = ({
  initialFiles,
  directory,
  onSwitchToTerminal,
}) => {
  const { t } = useTranslation();

  const [files, setFiles] = useState<GalleryItem[]>(initialFiles);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);
  const [confirmDeleteModal, setConfirmDeleteModal] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    setFiles(initialFiles);
    setSelectedPaths(new Set());
  }, [initialFiles]);

  const allSelected = files.length > 0 && selectedPaths.size === files.length;

  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(files.map((f) => f.path)));
    }
  };

  const handleToggleItem = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleOpenFolder = async (targetPath?: string) => {
    const pathToOpen = targetPath || directory;
    if (!pathToOpen) return;
    try {
      await invoke("open_folder", { path: pathToOpen });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  const handleOpenFileInPlayer = async (filePath: string) => {
    try {
      await invoke("open_file", { path: filePath });
    } catch (err) {
      console.error("Failed to open file in external player:", err);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedPaths.size === 0) return;
    setDeleting(true);
    try {
      const pathsToDelete = Array.from(selectedPaths);
      const deleted = await invoke<string[]>("delete_files", { paths: pathsToDelete });
      const deletedSet = new Set(deleted);
      setFiles((prev) => prev.filter((f) => !deletedSet.has(f.path)));
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        deleted.forEach((p) => next.delete(p));
        return next;
      });
      setConfirmDeleteModal(false);
      if (lightboxItem && deletedSet.has(lightboxItem.path)) {
        setLightboxItem(null);
      }
    } catch (err) {
      console.error("Failed to delete files:", err);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteSingle = async (filePath: string) => {
    try {
      await invoke<string[]>("delete_files", { paths: [filePath] });
      setFiles((prev) => prev.filter((f) => f.path !== filePath));
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
      if (lightboxItem?.path === filePath) {
        setLightboxItem(null);
      }
    } catch (err) {
      console.error("Failed to delete file:", err);
    }
  };

  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-zinc-950/50 flex flex-col">
      {/* Gallery Header Toolbar */}
      <div className="h-10 px-3 bg-zinc-900/80 border-b border-white/[0.08] flex items-center justify-between text-xs gap-2 select-none">
        {/* Left: Title & File Count & View Mode */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-medium text-zinc-200">
            <Film className="w-4 h-4 text-emerald-400" />
            <span>{t("gallery_title")}</span>
          </div>

          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-white/[0.06]">
            {t("gallery_files_count", { count: files.length })}
          </span>

          {/* Toggle between Gallery and Terminal */}
          {onSwitchToTerminal && (
            <div className="ml-2 flex items-center bg-zinc-800/80 rounded-md p-0.5 border border-white/[0.06]">
              <button
                type="button"
                className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 cursor-default"
                title={t("gallery_view_grid")}
              >
                <Grid className="w-3 h-3" />
                <span>{t("gallery_view_grid")}</span>
              </button>
              <button
                type="button"
                onClick={onSwitchToTerminal}
                className="px-2 py-0.5 rounded text-[11px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors flex items-center gap-1 cursor-pointer"
                title={t("gallery_view_terminal")}
              >
                <Terminal className="w-3 h-3" />
                <span>{t("gallery_view_terminal")}</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5">
          {files.length > 0 && (
            <>
              {/* Select All / Deselect All */}
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="btn-secondary h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
                title={allSelected ? t("gallery_deselect_all") : t("gallery_select_all")}
              >
                {allSelected ? (
                  <>
                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="hidden sm:inline">{t("gallery_deselect_all")}</span>
                  </>
                ) : (
                  <>
                    <Square className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="hidden sm:inline">{t("gallery_select_all")}</span>
                  </>
                )}
              </button>

              {/* Delete Selected (Visible when items selected) */}
              {selectedPaths.size > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteModal(true)}
                  className="h-7 px-2.5 text-xs rounded bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-800/60 flex items-center gap-1.5 transition-colors cursor-pointer"
                  title={t("gallery_delete_selected", { count: selectedPaths.size })}
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>{t("gallery_delete_selected", { count: selectedPaths.size })}</span>
                </button>
              )}
            </>
          )}

          {/* Open Folder in Explorer */}
          {directory && (
            <button
              type="button"
              onClick={() => handleOpenFolder()}
              className="btn-secondary h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
              title={t("gallery_open_folder")}
            >
              <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden sm:inline">{t("gallery_open_folder")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Gallery Cards Grid */}
      <div className="p-3 max-h-[480px] overflow-y-auto">
        {files.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center text-zinc-500">
            <Film className="w-10 h-10 stroke-[1.2] mb-2 opacity-50" />
            <p className="text-xs font-mono">{t("gallery_empty")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {files.map((file) => {
              const isSelected = selectedPaths.has(file.path);
              const fileSrc = convertFileSrc(file.path);

              return (
                <div
                  key={file.id}
                  className={`group relative rounded-lg border overflow-hidden flex flex-col transition-all duration-150 ${
                    isSelected
                      ? "bg-emerald-950/20 border-emerald-500/60 ring-1 ring-emerald-500/40"
                      : "bg-zinc-900/60 border-white/[0.08] hover:border-white/[0.2] hover:bg-zinc-900/90"
                  }`}
                >
                  {/* Media Preview Box */}
                  <div
                    className="relative w-full h-32 bg-black/60 flex items-center justify-center overflow-hidden cursor-pointer select-none"
                    onClick={() => setLightboxItem(file)}
                  >
                    {file.type === "video" ? (
                      <video
                        src={fileSrc}
                        muted
                        playsInline
                        loop
                        preload="metadata"
                        onMouseEnter={(e) => {
                          e.currentTarget.play().catch(() => {});
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : file.type === "image" ? (
                      <img
                        src={fileSrc}
                        alt={file.name}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-zinc-500">
                        <FileText className="w-8 h-8 stroke-[1.5] mb-1" />
                        <span className="text-[10px] uppercase font-mono tracking-wider">
                          {file.type}
                        </span>
                      </div>
                    )}

                    {/* Play watermark badge for video */}
                    {file.type === "video" && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-60 group-hover:opacity-0 transition-opacity">
                        <div className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-xs flex items-center justify-center border border-white/20">
                          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                        </div>
                      </div>
                    )}

                    {/* Duration badge */}
                    {file.duration && (
                      <span className="absolute bottom-1.5 right-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/80 text-zinc-300 backdrop-blur-xs border border-white/10 pointer-events-none">
                        {file.duration}
                      </span>
                    )}

                    {/* Hover overlay quick actions */}
                    <div
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 pointer-events-none"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxItem(file);
                        }}
                        className="w-7 h-7 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center border border-white/20 pointer-events-auto cursor-pointer shadow-md"
                        title={t("gallery_view_grid")}
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFileInPlayer(file.path);
                        }}
                        className="w-7 h-7 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center border border-white/20 pointer-events-auto cursor-pointer shadow-md"
                        title={t("gallery_open_in_player")}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFolder(file.path);
                        }}
                        className="w-7 h-7 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center border border-white/20 pointer-events-auto cursor-pointer shadow-md"
                        title={t("gallery_reveal")}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSingle(file.path);
                        }}
                        className="w-7 h-7 rounded-full bg-red-950/90 hover:bg-red-800 text-red-200 flex items-center justify-center border border-red-500/40 pointer-events-auto cursor-pointer shadow-md"
                        title={t("gallery_delete_file")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Corner Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleItem(file.path);
                    }}
                    className={`absolute top-2 left-2 z-10 w-5 h-5 rounded flex items-center justify-center border transition-colors cursor-pointer backdrop-blur-md ${
                      isSelected
                        ? "bg-emerald-500 border-emerald-400 text-zinc-950 shadow-sm"
                        : "bg-black/60 border-white/20 hover:border-white/50 text-transparent"
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </button>

                  {/* Card Info Footer */}
                  <div className="p-2 flex flex-col gap-1 border-t border-white/[0.06] bg-zinc-950/40">
                    <span
                      className="text-xs font-medium text-zinc-200 truncate cursor-pointer hover:text-white"
                      title={file.name}
                      onClick={() => setLightboxItem(file)}
                    >
                      {file.name}
                    </span>

                    <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                      <span>{file.size || ""}</span>
                      <span className="uppercase text-[9px] text-zinc-500">
                        {file.type || ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {lightboxItem &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200"
            onClick={() => setLightboxItem(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-4xl w-full bg-zinc-900 border border-white/[0.1] rounded-xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-150"
            >
              {/* Modal Header */}
              <div className="h-11 px-4 bg-zinc-800/80 border-b border-white/[0.08] flex items-center justify-between">
                <div className="flex items-center gap-2 truncate pr-4">
                  <span className="text-xs font-semibold text-zinc-100 truncate">
                    {lightboxItem.name}
                  </span>
                  {lightboxItem.size && (
                    <span className="text-[11px] font-mono text-zinc-400">
                      ({lightboxItem.size})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenFileInPlayer(lightboxItem.path)}
                    className="btn-secondary h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
                    title={t("gallery_open_in_player")}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t("gallery_open_in_player")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenFolder(lightboxItem.path)}
                    className="btn-secondary h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
                    title={t("gallery_reveal")}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t("gallery_reveal")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLightboxItem(null)}
                    className="w-7 h-7 rounded-md hover:bg-white/[0.1] text-zinc-400 hover:text-zinc-100 flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Modal Viewer Area */}
              <div className="w-full max-h-[70vh] bg-black flex items-center justify-center p-2">
                {lightboxItem.type === "video" ? (
                  <video
                    src={convertFileSrc(lightboxItem.path)}
                    controls
                    autoPlay
                    className="max-h-[65vh] max-w-full rounded"
                  />
                ) : lightboxItem.type === "image" ? (
                  <img
                    src={convertFileSrc(lightboxItem.path)}
                    alt={lightboxItem.name}
                    className="max-h-[65vh] max-w-full object-contain rounded"
                  />
                ) : (
                  <div className="py-16 text-center text-zinc-400">
                    <FileText className="w-12 h-12 stroke-[1.2] mx-auto mb-2 opacity-60" />
                    <p className="text-xs font-mono">{lightboxItem.path}</p>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Confirmation Modal for Delete Selected */}
      {confirmDeleteModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={() => setConfirmDeleteModal(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-w-md w-full bg-zinc-900 border border-white/[0.1] rounded-xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
            >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-950/60 border border-red-800/60 flex items-center justify-center text-red-400 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      {t("gallery_delete_file")}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {t("gallery_delete_confirm", { count: selectedPaths.size })}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteModal(false)}
                    disabled={deleting}
                    className="btn-secondary h-8 px-3 text-xs cursor-pointer"
                  >
                    {t("common_cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    disabled={deleting}
                    className="h-8 px-3 text-xs rounded bg-red-600 hover:bg-red-500 text-white font-medium transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>
                      {deleting
                        ? t("common_loading")
                        : t("gallery_delete_selected", { count: selectedPaths.size })}
                    </span>
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
    </div>
  );
};
