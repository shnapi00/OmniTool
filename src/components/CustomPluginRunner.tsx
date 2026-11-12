import React, { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Play,
  Loader2,
  Copy,
  Check,
  FolderOpen,
  AlertCircle,
  CheckCircle2,
  Terminal,
  Grid,
  FileUp,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "../i18n/useTranslation";
import { useTabActivity } from "../context/TabActivityContext";
import { PluginManifest } from "../store/useModulesStore";
import { getPluginIcon } from "../utils/getPluginIcon";
import { PluginGalleryView, parseGalleryOutput } from "./PluginGalleryView";
import { CustomScriptPluginView } from "./CustomScriptPluginView";

interface CustomPluginRunnerProps {
  plugin: PluginManifest;
}

export const CustomPluginRunner: React.FC<CustomPluginRunnerProps> = ({ plugin }) => {
  const isCustomUi = Boolean(plugin.custom_ui || plugin.ui_entry || plugin.view === "custom");

  if (isCustomUi) {
    return <CustomScriptPluginView plugin={plugin} />;
  }

  const { t } = useTranslation();
  const { setTabProcess } = useTabActivity();

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"gallery" | "terminal">("gallery");

  const hasActions = Boolean(plugin.actions && plugin.actions.length > 0);
  const hasFields = Boolean(plugin.fields && plugin.fields.length > 0);

  // By default, collapse settings if quick actions are present
  const [showSettings, setShowSettings] = useState<boolean>(!hasActions);

  useEffect(() => {
    setViewMode("gallery");
    setShowSettings(!hasActions);
  }, [plugin.id, hasActions]);

  const galleryData = useMemo(() => {
    return parseGalleryOutput(output, plugin.dir_path);
  }, [output, plugin.dir_path]);

  useEffect(() => {
    setTabProcess(`plugin:${plugin.id}`, running || installingDeps);
  }, [plugin.id, running, installingDeps, setTabProcess]);

  // Initialize fields with default values
  useEffect(() => {
    const init: Record<string, string> = {};
    if (plugin.fields) {
      plugin.fields.forEach((f) => {
        init[f.id] = f.default_value || (f.options && f.options[0]) || "";
      });
    }
    setFieldValues(init);
    setOutput(null);
    setError(null);
  }, [plugin]);

  const handleSelectFile = async (fieldId: string) => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: t("common_choose_file"),
      });
      if (typeof selected === "string") {
        setFieldValues((prev) => ({ ...prev, [fieldId]: selected }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenFolder = async () => {
    if (!plugin.dir_path) return;
    try {
      await invoke("open_folder", { path: plugin.dir_path });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRunAction = async (actionId: string) => {
    setRunning(true);
    setRunningAction(actionId);
    setOutput(null);
    setError(null);

    try {
      // First positional argument is actionId, followed by fields in order
      const argsArray: string[] = [actionId];
      if (plugin.fields) {
        plugin.fields.forEach((f) => {
          argsArray.push(fieldValues[f.id] ?? "");
        });
      }

      const out = await invoke<string>("execute_plugin", {
        pluginId: plugin.id,
        args: argsArray,
      });
      setOutput(out);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
      setRunningAction(null);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setRunningAction("default");
    setOutput(null);
    setError(null);

    try {
      let argsPayload: any;
      if (hasActions) {
        const primaryAct =
          plugin.actions?.find((a) => a.variant === "primary") || plugin.actions?.[0];
        const argsArray: string[] = [primaryAct?.id || "run"];
        if (plugin.fields) {
          plugin.fields.forEach((f) => {
            argsArray.push(fieldValues[f.id] ?? "");
          });
        }
        argsPayload = argsArray;
      } else {
        argsPayload = fieldValues;
      }

      const out = await invoke<string>("execute_plugin", {
        pluginId: plugin.id,
        args: argsPayload,
      });
      setOutput(out);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
      setRunningAction(null);
    }
  };

  const handleInstallDeps = async () => {
    setInstallingDeps(true);
    setOutput(null);
    setError(null);

    try {
      const log = await invoke<string>("install_plugin_dependencies", {
        pluginId: plugin.id,
      });
      setOutput(log);
    } catch (err) {
      setError(String(err));
    } finally {
      setInstallingDeps(false);
    }
  };

  const handleCopyOutput = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const getActionVariantClass = (variant?: string) => {
    switch (variant) {
      case "primary":
        return "bg-emerald-600 hover:bg-emerald-500 text-white font-medium border border-emerald-500/40 shadow-sm";
      case "secondary":
        return "bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-200 border border-white/[0.08] shadow-xs";
      case "ghost":
        return "bg-transparent hover:bg-white/[0.06] text-zinc-300 hover:text-white border border-white/[0.08]";
      case "danger":
        return "bg-red-950/50 hover:bg-red-900/50 text-red-300 border border-red-800/40";
      default:
        return "bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-200 border border-white/[0.08]";
    }
  };

  const Icon = getPluginIcon(plugin.icon);

  return (
    <div className="space-y-4">
      {/* Plugin Header */}
      <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-zinc-800/80 border border-white/[0.08] flex items-center justify-center text-zinc-200">
            <Icon className="w-5 h-5 text-zinc-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">{plugin.name}</h2>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-white/[0.06]">
                v{plugin.version}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">{plugin.description}</p>
          </div>
        </div>

        {plugin.dir_path && (
          <button
            type="button"
            onClick={handleOpenFolder}
            className="btn-secondary h-7 px-2 text-xs flex items-center gap-1.5 cursor-pointer"
            title={t("plugins_open_folder")}
          >
            <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span>{t("common_browse")}</span>
          </button>
        )}
      </div>

      {/* Dependencies Alert / Action */}
      {((plugin.dependencies?.python && plugin.dependencies.python.length > 0) ||
        (plugin.dependencies?.npm && plugin.dependencies.npm.length > 0)) && (
        <div className="flex items-center justify-between p-2.5 rounded-lg border border-amber-500/20 bg-amber-950/20 text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="text-amber-400 font-medium">{t("plugins_deps_label")}</span>
            <span className="font-mono text-[11px] text-zinc-400">
              {[
                ...(plugin.dependencies?.python || []).map((p) => `py:${p}`),
                ...(plugin.dependencies?.npm || []).map((n) => `npm:${n}`),
              ].join(", ")}
            </span>
          </div>
          <button
            type="button"
            disabled={installingDeps}
            onClick={handleInstallDeps}
            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            {installingDeps ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{t("plugins_installing_deps")}</span>
              </>
            ) : (
              <span>{t("plugins_install_deps_btn")}</span>
            )}
          </button>
        </div>
      )}

      {/* Quick Actions & Settings Bar */}
      {(hasActions || hasFields) && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Quick Action Buttons */}
          {hasActions ? (
            <div className="flex flex-wrap items-center gap-2">
              {plugin.actions!.map((act) => {
                const isThisRunning = running && runningAction === act.id;
                return (
                  <motion.button
                    key={act.id}
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    disabled={running}
                    onClick={() => handleRunAction(act.id)}
                    className={`h-8 px-3 text-xs rounded-lg flex items-center gap-1.5 cursor-pointer transition-all duration-150 disabled:opacity-50 select-none ${getActionVariantClass(
                      act.variant
                    )}`}
                  >
                    {isThisRunning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    <span>{act.label}</span>
                  </motion.button>
                );
              })}
            </div>
          ) : (
            <div />
          )}

          {/* Toggle Collapsible Parameters Panel */}
          {hasFields && (
            <button
              type="button"
              onClick={() => setShowSettings((prev) => !prev)}
              className={`h-8 px-2.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer border select-none ${
                showSettings
                  ? "bg-zinc-800 text-zinc-100 border-white/[0.15]"
                  : "bg-zinc-900/60 hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 border-white/[0.06]"
              }`}
              title={plugin.settings_label || t("plugins_settings_toggle")}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
              <span>{plugin.settings_label || t("plugins_settings_toggle")}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  showSettings ? "rotate-180 text-zinc-200" : "text-zinc-500"
                }`}
              />
            </button>
          )}
        </div>
      )}

      {/* Collapsible Secondary Fields Form */}
      <AnimatePresence>
        {showSettings && hasFields && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 bg-zinc-900/40 border border-white/[0.06] p-3.5 rounded-lg">
              <div className="space-y-3">
                {plugin.fields!.map((field) => (
                  <div key={field.id} className="space-y-1">
                    <label className="block text-xs font-medium text-zinc-300">
                      {field.label}
                    </label>

                    {field.type === "file" ? (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          readOnly
                          value={fieldValues[field.id] || ""}
                          placeholder={field.placeholder || t("common_choose_file")}
                          className="input-base flex-1 h-8 text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => handleSelectFile(field.id)}
                          className="btn-secondary h-8 px-2.5 text-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          <FileUp className="w-3.5 h-3.5 text-zinc-400" />
                          <span>{t("common_browse")}</span>
                        </button>
                      </div>
                    ) : field.type === "select" ? (
                      <select
                        value={fieldValues[field.id] || ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        className="input-base w-full h-8 text-xs cursor-pointer"
                      >
                        {field.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === "number" ? "number" : "text"}
                        value={fieldValues[field.id] || ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        placeholder={field.placeholder || ""}
                        className="input-base w-full h-8 text-xs font-mono"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Execution Button inside Settings */}
              <div className="pt-2 flex justify-end">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleRun}
                  disabled={running}
                  className="btn-primary h-8 px-3.5 text-xs flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  {running && (runningAction === "default" || !runningAction) ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t("common_loading")}</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>{plugin.action_label || t("plugins_run_btn")}</span>
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fallback Single Execution Button if plugin has neither actions nor fields */}
      {!hasActions && !hasFields && (
        <div className="flex justify-end pt-1">
          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={handleRun}
            disabled={running}
            className="btn-primary h-8 px-3.5 text-xs flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            {running ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t("common_loading")}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>{plugin.action_label || t("plugins_run_btn")}</span>
              </>
            )}
          </motion.button>
        </div>
      )}

      {/* Errors */}
      {error && (
        <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-lg text-xs text-red-300 flex items-start gap-2 font-mono">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="whitespace-pre-wrap break-all">{error}</div>
        </div>
      )}

      {/* Output: Gallery or Terminal */}
      {output !== null && (
        galleryData && viewMode === "gallery" ? (
          <PluginGalleryView
            initialFiles={galleryData.files}
            directory={galleryData.directory || plugin.dir_path}
            rawOutput={output}
            onSwitchToTerminal={() => setViewMode("terminal")}
          />
        ) : (
          <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-zinc-950/50 flex flex-col">
            <div className="h-8 px-3 bg-zinc-900/80 border-b border-white/[0.08] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-zinc-400">
                <Terminal className="w-3.5 h-3.5" />
                <span className="font-medium text-zinc-300">{t("plugins_output_title")}</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />

                {galleryData && (
                  <div className="ml-2 flex items-center bg-zinc-800/80 rounded-md p-0.5 border border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => setViewMode("gallery")}
                      className="px-2 py-0.5 rounded text-[11px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors flex items-center gap-1 cursor-pointer"
                      title={t("gallery_view_grid")}
                    >
                      <Grid className="w-3 h-3" />
                      <span>{t("gallery_view_grid")}</span>
                    </button>
                    <button
                      type="button"
                      className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 cursor-default"
                      title={t("gallery_view_terminal")}
                    >
                      <Terminal className="w-3 h-3" />
                      <span>{t("gallery_view_terminal")}</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleCopyOutput}
                className="btn-secondary h-6 px-2 text-[11px] flex items-center gap-1 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">{t("ocr_copied")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-zinc-400" />
                    <span>{t("ocr_copy_btn")}</span>
                  </>
                )}
              </button>
            </div>

            <pre className="p-3.5 text-xs font-mono text-zinc-200 whitespace-pre-wrap break-all overflow-x-auto max-h-[360px] leading-relaxed bg-black/30">
              {output || t("plugins_empty_output")}
            </pre>
          </div>
        )
      )}
    </div>
  );
};
