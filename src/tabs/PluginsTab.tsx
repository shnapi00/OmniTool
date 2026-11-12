import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Puzzle,
  FolderOpen,
  Plus,
  Play,
  RefreshCw,
  Trash2,
  HelpCircle,
  Smile,
  Scissors,
  Video,
  FileText,
  Volume2,
  Minimize2,
  Loader2,
  AlertCircle,
  Download,
  Upload,
  ShieldAlert,
} from "lucide-react";
import pythonLogo from "../assets/python-logo.png";
import nodejsLogo from "../assets/nodejs-logo.png";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "../i18n/useTranslation";
import {
  useModulesStore,
  BuiltinModuleId,
  PluginManifest,
} from "../store/useModulesStore";
import { getPluginIcon } from "../utils/getPluginIcon";
import { CreatePluginModal } from "../components/CreatePluginModal";
import { PluginDocsModal } from "../components/PluginDocsModal";
import { CircularProgress } from "../components/CircularProgress";
import { PluginInstallLogsModal } from "../components/PluginInstallLogsModal";
import { TabId } from "../components/Sidebar";

interface PluginsTabProps {
  onNavigateTab?: (tab: TabId) => void;
}

export const PluginsTab: React.FC<PluginsTabProps> = ({ onNavigateTab }) => {
  const { t } = useTranslation();
  const {
    builtinStatus,
    customPlugins,
    enabledCustomPlugins,
    pluginDeps,
    runtimes,
    installingRuntime,
    runtimeInstallStatus,
    loading,
    error,
    toggleBuiltin,
    toggleCustom,
    loadPlugins,
    createPlugin,
    deletePlugin,
    openPluginsFolder,
    checkRuntimes,
    installRuntime,
    exportPlugin,
    importPlugin,
  } = useModulesStore();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pluginToDelete, setPluginToDelete] = useState<PluginManifest | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedLogsPlugin, setSelectedLogsPlugin] = useState<{ id: string; name: string } | null>(null);
  const [customUiWarningPlugin, setCustomUiWarningPlugin] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pluginToDelete && !deletingId) {
        setPluginToDelete(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pluginToDelete, deletingId]);

  const handleDeleteClick = (plugin: PluginManifest) => {
    setPluginToDelete(plugin);
  };

  const handleConfirmDelete = async () => {
    if (!pluginToDelete) return;
    setDeletingId(pluginToDelete.id);
    try {
      await deletePlugin(pluginToDelete.id);
      setPluginToDelete(null);
    } catch (err) {
      console.error("Ошибка при удалении плагина:", err);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    loadPlugins();
    checkRuntimes();

    let unlisten: (() => void) | undefined;
    listen<{ runtime: string; percent: number; status: string }>(
      "runtime-install-progress",
      (event) => {
        useModulesStore.setState({ runtimeInstallStatus: event.payload.status });
      }
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadPlugins, checkRuntimes]);

  const builtinModules: {
    id: BuiltinModuleId;
    name: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      id: "stickers",
      name: t("tab_stickers"),
      desc: t("plugins_stickers_desc"),
      icon: Smile,
    },
    {
      id: "bg_remover",
      name: t("tab_bg_remover"),
      desc: t("plugins_bg_remover_desc"),
      icon: Scissors,
    },
    {
      id: "media_downloader",
      name: t("tab_downloader"),
      desc: t("plugins_downloader_desc"),
      icon: Video,
    },
    {
      id: "converter",
      name: t("tab_converter"),
      desc: t("plugins_converter_desc"),
      icon: RefreshCw,
    },
    {
      id: "ocr",
      name: t("tab_ocr"),
      desc: t("plugins_ocr_desc"),
      icon: FileText,
    },
    {
      id: "audio_extractor",
      name: t("tab_audio_extractor"),
      desc: t("plugins_audio_extractor_desc"),
      icon: Volume2,
    },
    {
      id: "compressor",
      name: t("tab_compressor"),
      desc: t("plugins_compressor_desc"),
      icon: Minimize2,
    },
  ];

  const handleExport = async (plugin: PluginManifest) => {
    try {
      setExportingId(plugin.id);
      const targetPath = await saveDialog({
        defaultPath: `${plugin.id}.omniplugin`,
        filters: [{ name: "OmniTool Plugin", extensions: ["omniplugin", "zip"] }],
      });
      if (typeof targetPath === "string") {
        await exportPlugin(plugin.id, targetPath);
      }
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExportingId(null);
    }
  };

  const handleImport = async () => {
    try {
      setImporting(true);
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "OmniTool Plugin", extensions: ["omniplugin", "zip"] }],
      });
      if (typeof selected === "string") {
        const manifest = await importPlugin(selected);
        if (manifest.custom_ui || manifest.ui_entry) {
          setCustomUiWarningPlugin(manifest.name);
        }
      }
    } catch (err) {
      console.error("Import error:", err);
    } finally {
      setImporting(false);
    }
  };

  const handleInstallRuntime = async (runtime: "python" | "node") => {
    try {
      await installRuntime(runtime);
    } catch (err) {
      console.error("Install runtime error:", err);
    }
  };

  const getRuntimeLabel = (plugin: PluginManifest) => {
    const script = plugin.script?.toLowerCase() || "";
    const command = plugin.command?.toLowerCase() || "";
    if (script.endsWith(".ps1") || command.includes("powershell")) return "powershell";
    if (script.endsWith(".py") || command.includes("python")) return "python";
    if (script.endsWith(".js") || command.includes("node")) return "node";
    return "cli";
  };

  const enabledBuiltinCount = builtinModules.filter((m) => builtinStatus[m.id] !== false).length;
  const enabledCustomCount = customPlugins.filter((p) => enabledCustomPlugins[p.id] !== false).length;

  return (
    <div className="space-y-4 pb-8 max-w-3xl mx-auto">
      {/* Header: Clean & Utilitarian */}
      <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
            <Puzzle className="w-4 h-4 text-zinc-400" />
            {t("plugins_title")}
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {t("plugins_desc")}
          </p>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onNavigateTab ? onNavigateTab("plugin_studio") : setIsCreateOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 hover:bg-white text-zinc-900 text-xs font-medium transition-colors cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t("plugins_create_btn")}</span>
          </button>

          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 text-xs transition-colors border border-white/[0.08] cursor-pointer disabled:opacity-50"
            title={t("plugins_import_btn")}
          >
            {importing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
            ) : (
              <Upload className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <span>{t("plugins_import_btn")}</span>
          </button>

          <button
            type="button"
            onClick={openPluginsFolder}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 text-xs transition-colors border border-white/[0.08] cursor-pointer"
            title={t("plugins_open_folder")}
          >
            <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span>{t("plugins_folder")}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDocsOpen(true)}
            className="w-7 h-7 flex items-center justify-center rounded-md bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors border border-white/[0.08] cursor-pointer"
            title={t("plugins_docs_btn")}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              loadPlugins();
              checkRuntimes();
            }}
            disabled={loading}
            className="w-7 h-7 flex items-center justify-center rounded-md bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors border border-white/[0.08] cursor-pointer disabled:opacity-50"
            title={t("plugins_refresh_btn")}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-zinc-300" : ""}`} />
          </button>
        </div>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="p-2.5 bg-red-950/40 border border-red-500/20 rounded-md text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* SECTION 1: Built-in Tools (Compact List) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 px-1">
          <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
            {t("plugins_builtin_section")}
          </span>
          <span className="text-[10px] text-zinc-600 font-mono">
            {enabledBuiltinCount}/{builtinModules.length}
          </span>
        </div>

        <div className="rounded-lg border border-white/[0.08] bg-zinc-900/40 divide-y divide-white/[0.05] overflow-hidden">
          {builtinModules.map((item) => {
            const Icon = item.icon;
            const isEnabled = builtinStatus[item.id] !== false;

            return (
              <div
                key={item.id}
                className={`min-h-[42px] px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                  isEnabled ? "hover:bg-zinc-800/20" : "opacity-45 bg-zinc-950/20"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span className="text-xs font-medium text-zinc-200 shrink-0">
                    {item.name}
                  </span>
                  <span className="text-zinc-600 shrink-0 text-xs">—</span>
                  <span className="text-[11px] text-zinc-500 truncate">
                    {item.desc}
                  </span>
                </div>

                {/* Minimalist Toggle Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  onClick={() => toggleBuiltin(item.id)}
                  className={`w-7 h-4 rounded-full transition-colors relative shrink-0 cursor-pointer p-0.5 ${
                    isEnabled ? "bg-emerald-600" : "bg-zinc-800"
                  }`}
                  title={isEnabled ? t("common_enabled") : t("common_disabled")}
                >
                  <div
                    className={`w-3 h-3 rounded-full bg-white shadow-xs transition-transform duration-150 ${
                      isEnabled ? "translate-x-3" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION 2: Custom User Extensions (Compact List) */}
      <div className="space-y-1.5 pt-2">
        <div className="flex items-center gap-2 px-1">
          <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
            {t("plugins_custom_section")}
          </span>
          <span className="text-[10px] text-zinc-600 font-mono">
            {enabledCustomCount}/{customPlugins.length}
          </span>
        </div>

        {customPlugins.length === 0 ? (
          /* Raycast-style strict 1-line empty state */
          <div className="rounded-lg border border-white/[0.08] bg-zinc-900/30 px-3 py-2.5 flex items-center justify-between text-xs">
            <span className="text-zinc-500">{t("plugins_custom_empty")}</span>
            <button
              type="button"
              onClick={() => onNavigateTab ? onNavigateTab("plugin_studio") : setIsCreateOpen(true)}
              className="text-[11px] text-zinc-300 hover:text-white font-medium hover:underline cursor-pointer"
            >
              + {t("plugins_add_short")}
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-white/[0.08] bg-zinc-900/40 divide-y divide-white/[0.05] overflow-hidden">
            {customPlugins.map((plugin) => {
              const Icon = getPluginIcon(plugin.icon);
              const isEnabled = enabledCustomPlugins[plugin.id] !== false;
              const runtime = getRuntimeLabel(plugin);
              const isDeleting = deletingId === plugin.id;
              const isExporting = exportingId === plugin.id;
              const depState = pluginDeps[plugin.id];
              const hasDeps =
                Boolean(plugin.dependencies?.python?.length) ||
                Boolean(plugin.dependencies?.npm?.length) ||
                Boolean(depState);

              return (
                <div
                  key={plugin.id}
                  className={`min-h-[42px] px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                    isEnabled ? "hover:bg-zinc-800/20" : "opacity-45 bg-zinc-950/20"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-4 h-4 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-zinc-400" />
                    </div>
                    <span className="text-xs font-medium text-zinc-200 shrink-0">
                      {plugin.name}
                    </span>
                    {plugin.custom_ui || plugin.ui_entry ? (
                      <span
                        className="text-[10px] text-emerald-300 font-mono shrink-0 px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-500/30 flex items-center gap-1 font-medium shadow-xs cursor-help"
                        title={t("plugins_custom_ui_badge_title")}
                      >
                        Custom UI
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-500 font-mono shrink-0 px-1 py-0.5 rounded bg-zinc-800/60 border border-white/[0.04]">
                        {runtime}
                      </span>
                    )}
                    {/* Circular Progress / Status for Dependencies */}
                    {depState && (
                      <div className="shrink-0 flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-zinc-800/60 border border-white/[0.06]">
                        <CircularProgress
                          percent={depState.percent}
                          size={15}
                          strokeWidth={2}
                          isInstalling={depState.isInstalling}
                          isReady={depState.isReady}
                          hasError={depState.hasError}
                          showPercentText={depState.isInstalling}
                          onClick={() => setSelectedLogsPlugin({ id: plugin.id, name: plugin.name })}
                          title={
                            (depState.status === "installing"
                              ? t("deps_installing")
                              : depState.status === "checking"
                              ? t("deps_checking")
                              : depState.status === "ready"
                              ? t("deps_ready")
                              : depState.currentStatus || "")
                              ? `${
                                  depState.status === "installing"
                                    ? t("deps_installing")
                                    : depState.status === "checking"
                                    ? t("deps_checking")
                                    : depState.status === "ready"
                                    ? t("deps_ready")
                                    : depState.currentStatus
                                } (${t("plugins_logs_click_hint")})`
                              : t("plugins_logs_click_hint")
                          }
                        />
                        {depState.isInstalling && (
                          <button
                            type="button"
                            onClick={() => setSelectedLogsPlugin({ id: plugin.id, name: plugin.name })}
                            className="text-[9px] text-zinc-400 hover:text-zinc-200 hover:underline cursor-pointer"
                          >
                            {t("plugins_logs_btn")}
                          </button>
                        )}
                      </div>
                    )}
                    {!depState && hasDeps && (
                      <span className="text-[9px] text-amber-400/90 font-mono shrink-0 px-1 py-0.5 rounded bg-amber-950/30 border border-amber-500/20">
                        deps
                      </span>
                    )}
                    {plugin.description && (
                      <>
                        <span className="text-zinc-600 shrink-0 text-xs">—</span>
                        <span className="text-[11px] text-zinc-500 truncate">
                          {plugin.description}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Actions & Toggle */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onNavigateTab && onNavigateTab(`plugin:${plugin.id}`)}
                      className="p-1 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                      title={t("plugins_run")}
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => handleExport(plugin)}
                      className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
                      title={t("plugins_export_btn")}
                    >
                      {isExporting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {plugin.dir_path && (
                      <button
                        type="button"
                        onClick={() => openPluginsFolder()}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                        title={t("plugins_folder")}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDeleteClick(plugin)}
                      disabled={isDeleting}
                      className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/30 transition-colors cursor-pointer disabled:opacity-50"
                      title={t("plugins_delete")}
                    >
                      {isDeleting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <div className="w-px h-3.5 bg-white/[0.08] mx-0.5" />

                    {/* Minimalist Toggle Switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isEnabled}
                      onClick={() => toggleCustom(plugin.id)}
                      className={`w-7 h-4 rounded-full transition-colors relative shrink-0 cursor-pointer p-0.5 ${
                        isEnabled ? "bg-emerald-600" : "bg-zinc-800"
                      }`}
                      title={isEnabled ? t("common_enabled") : t("common_disabled")}
                    >
                      <div
                        className={`w-3 h-3 rounded-full bg-white shadow-xs transition-transform duration-150 ${
                          isEnabled ? "translate-x-3" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 3: Runtimes (Python & Node.js Management) */}
      <div className="space-y-1.5 pt-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
            {t("plugins_runtimes_title")}
          </span>
          {installingRuntime && (
            <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{runtimeInstallStatus || t("plugins_runtime_installing")}</span>
            </span>
          )}
        </div>

        <div className="rounded-lg border border-white/[0.08] bg-zinc-900/40 divide-y divide-white/[0.05] overflow-hidden text-xs">
          {/* Python Runtime Row */}
          <div className="min-h-[40px] px-3 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={pythonLogo}
                alt="Python"
                className={`w-[18px] h-[18px] object-contain shrink-0 transition-opacity ${
                  runtimes?.python.installed ? "opacity-90" : "opacity-35 grayscale"
                }`}
              />
              <span className="font-medium text-zinc-200 shrink-0">Python</span>
              <span className="text-zinc-600 shrink-0">—</span>
              {runtimes?.python.installed ? (
                <span className="font-mono text-[11px] text-emerald-400 truncate">
                  {runtimes.python.version}
                </span>
              ) : (
                <span className="text-[11px] text-zinc-500 truncate">
                  {t("plugins_runtime_not_installed")}
                </span>
              )}
            </div>

            {!runtimes?.python.installed && (
              <button
                type="button"
                disabled={Boolean(installingRuntime)}
                onClick={() => handleInstallRuntime("python")}
                className="px-2.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium border border-white/[0.08] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
              >
                {installingRuntime === "python" ? (
                  <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                ) : null}
                <span>{t("plugins_runtime_install")}</span>
              </button>
            )}
          </div>

          {/* Node.js Runtime Row */}
          <div className="min-h-[40px] px-3 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={nodejsLogo}
                alt="Node.js"
                className={`w-[18px] h-[18px] object-contain shrink-0 transition-opacity ${
                  runtimes?.node.installed ? "opacity-90" : "opacity-35 grayscale"
                }`}
              />
              <span className="font-medium text-zinc-200 shrink-0">Node.js</span>
              <span className="text-zinc-600">—</span>
              {runtimes?.node.installed ? (
                <span className="font-mono text-[11px] text-emerald-400 truncate">
                  {runtimes.node.version}
                </span>
              ) : (
                <span className="text-[11px] text-zinc-500 truncate">
                  {t("plugins_runtime_not_installed")}
                </span>
              )}
            </div>

            {!runtimes?.node.installed && (
              <button
                type="button"
                disabled={Boolean(installingRuntime)}
                onClick={() => handleInstallRuntime("node")}
                className="px-2.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium border border-white/[0.08] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
              >
                {installingRuntime === "node" ? (
                  <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                ) : null}
                <span>{t("plugins_runtime_install")}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Creation Modal */}
      <CreatePluginModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={async (manifest, script) => {
          await createPlugin(manifest, script);
          setIsCreateOpen(false);
        }}
      />

      {/* Documentation Modal */}
      <PluginDocsModal
        isOpen={isDocsOpen}
        onClose={() => setIsDocsOpen(false)}
        onOpenFolder={openPluginsFolder}
      />

      {/* Dependency Installation Logs Modal */}
      <PluginInstallLogsModal
        isOpen={Boolean(selectedLogsPlugin)}
        onClose={() => setSelectedLogsPlugin(null)}
        pluginName={selectedLogsPlugin?.name || ""}
        depState={selectedLogsPlugin ? pluginDeps[selectedLogsPlugin.id] : undefined}
      />

      {/* Custom Delete Plugin Confirmation Modal */}
      {pluginToDelete &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => !deletingId && setPluginToDelete(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-900 border border-white/[0.1] rounded-xl shadow-2xl w-full max-w-sm overflow-hidden p-4 space-y-3 animate-in zoom-in-95 duration-150"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    {t("plugins_delete_modal_title")}
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {t("plugins_delete_confirm_desc", { name: pluginToDelete.name })}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                <button
                  type="button"
                  disabled={Boolean(deletingId)}
                  onClick={() => setPluginToDelete(null)}
                  className="btn-secondary h-8 px-3 text-xs cursor-pointer disabled:opacity-50"
                >
                  {t("common_cancel")}
                </button>
                <button
                  type="button"
                  disabled={Boolean(deletingId)}
                  onClick={handleConfirmDelete}
                  className="h-8 px-3 text-xs rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 font-medium transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {deletingId ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t("common_loading")}</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t("plugins_delete")}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Custom UI Warning Modal after import */}
      {customUiWarningPlugin &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-zinc-900 border border-amber-500/30 rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    {t("plugins_custom_ui_imported_title")}
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {t("plugins_custom_ui_installed_desc", { name: customUiWarningPlugin })}
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/20 text-xs text-zinc-300 leading-relaxed">
                <p>
                  {t("plugins_custom_ui_security_notice")}
                </p>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setCustomUiWarningPlugin(null)}
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium cursor-pointer shadow-sm"
                >
                  OK
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
