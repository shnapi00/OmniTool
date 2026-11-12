import React, { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  RotateCw,
  FolderOpen,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Copy,
  Trash2,
  ChevronDown,
  FileCode,
} from "lucide-react";
import { PluginManifest, useModulesStore } from "../store/useModulesStore";
import { getPluginIcon } from "../utils/getPluginIcon";
import { useTabActivity } from "../context/TabActivityContext";
import { useTranslation } from "../i18n/useTranslation";
import { getCustomScriptTemplates } from "../templates/customPluginTemplates";

interface CustomScriptPluginViewProps {
  plugin: PluginManifest;
  inlineCode?: string;
  hideHeader?: boolean;
  externalShowConsole?: boolean;
  onToggleConsole?: () => void;
}

interface LogEntry {
  id: string;
  time: string;
  level: "log" | "info" | "warn" | "error";
  text: string;
}

export const CustomScriptPluginView: React.FC<CustomScriptPluginViewProps> = ({
  plugin,
  inlineCode,
  hideHeader = false,
  externalShowConsole,
  onToggleConsole,
}) => {
  const { t } = useTranslation();
  const { setTabProcess } = useTabActivity();
  const {
    readPluginFile,
    writePluginFile,
    executePluginExec,
    setSidebarWidget,
    clearSidebarWidget,
  } = useModulesStore();

  const mountContainerRef = useRef<HTMLDivElement>(null);
  const unmountCallbacksRef = useRef<Array<() => void | Promise<void>>>([]);
  const eventUnlistenersRef = useRef<Array<() => void>>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [reloading, setReloading] = useState(false);

  const appendLog = useCallback(
    (level: "log" | "info" | "warn" | "error", ...args: any[]) => {
      const now = new Date();
      const timeStr = now.toTimeString().split(" ")[0];
      const text = args
        .map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)))
        .join(" ");

      setLogs((prev) => [
        ...prev.slice(-150),
        {
          id: Math.random().toString(36).substring(2, 9),
          time: timeStr,
          level,
          text,
        },
      ]);
    },
    []
  );

  const cleanupCurrentInstance = useCallback(async () => {
    // 1. Run unmount callbacks registered by plugin
    for (const cb of unmountCallbacksRef.current) {
      try {
        await cb();
      } catch (err) {
        console.error("Plugin onUnmount error:", err);
      }
    }
    unmountCallbacksRef.current = [];

    // 2. Unsubscribe any event listeners
    for (const unlisten of eventUnlistenersRef.current) {
      try {
        unlisten();
      } catch {}
    }
    eventUnlistenersRef.current = [];

    // 3. Remove injected style tag if exists
    const styleEl = document.getElementById(`omnitool-plugin-style-${plugin.id}`);
    if (styleEl) {
      styleEl.remove();
    }

    // 4. Clean window.OmniTool if it references this plugin
    if (typeof window !== "undefined" && (window as any).OmniTool?.plugin?.id === plugin.id) {
      delete (window as any).OmniTool;
    }

    // 5. Clear mount container DOM
    if (mountContainerRef.current) {
      mountContainerRef.current.innerHTML = "";
    }
  }, [plugin.id]);

  const loadAndMountPlugin = useCallback(async () => {
    setError(null);
    setLoading(true);

    await cleanupCurrentInstance();

    const entryFilename = plugin.ui_entry || "index.js";

    try {
      // 1. Check & Read UI entry script
      let scriptCode = "";
      if (inlineCode !== undefined) {
        scriptCode = inlineCode;
      } else {
        try {
          scriptCode = await readPluginFile(plugin.id, entryFilename);
        } catch (readErr: any) {
          const errMsg = String(readErr);
          if (errMsg.includes("не существует") || errMsg.includes("not exist")) {
            setLoading(false);
            setError(`ENTRY_NOT_FOUND:${entryFilename}`);
            return;
          }
          throw readErr;
        }
      }

      // 2. Read and inject optional style.css
      try {
        const cssCode = await readPluginFile(plugin.id, "style.css");
        if (cssCode.trim()) {
          const styleEl = document.createElement("style");
          styleEl.id = `omnitool-plugin-style-${plugin.id}`;
          styleEl.textContent = cssCode;
          document.head.appendChild(styleEl);
        }
      } catch {
        // style.css is optional, ignore if not present
      }

      if (!mountContainerRef.current) {
        setLoading(false);
        return;
      }

      const container = mountContainerRef.current;
      container.innerHTML = "";

      // 3. Build OmniTool SDK Object
      const sdk = {
        plugin: {
          id: plugin.id,
          name: plugin.name,
          version: plugin.version,
          dirPath: plugin.dir_path,
        },
        container,
        invoke: async <T = any,>(cmd: string, args?: Record<string, any>): Promise<T> => {
          return await invoke<T>(cmd, args);
        },
        exec: async (
          program: string,
          args: string[] = [],
          options?: { cwd?: string; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void }
        ) => {
          const execId = "exec_" + Math.random().toString(36).substring(2, 9);
          let unlistenStdout: (() => void) | undefined;
          let unlistenStderr: (() => void) | undefined;

          if (options?.onStdout) {
            unlistenStdout = await listen<string>(`plugin-exec:${execId}:stdout`, (e) => {
              options.onStdout!(e.payload);
            });
            eventUnlistenersRef.current.push(unlistenStdout);
          }
          if (options?.onStderr) {
            unlistenStderr = await listen<string>(`plugin-exec:${execId}:stderr`, (e) => {
              options.onStderr!(e.payload);
            });
            eventUnlistenersRef.current.push(unlistenStderr);
          }

          try {
            const res = await executePluginExec(
              plugin.id,
              program,
              args,
              options?.cwd,
              execId
            );
            return res;
          } finally {
            if (unlistenStdout) unlistenStdout();
            if (unlistenStderr) unlistenStderr();
          }
        },
        readFile: async (filename: string): Promise<string> => {
          return await readPluginFile(plugin.id, filename);
        },
        writeFile: async (filename: string, content: string): Promise<void> => {
          await writePluginFile(plugin.id, filename, content);
        },
        storage: {
          get: <T = any,>(key: string, defaultValue?: T): T => {
            const k = `omnitool_plugin_${plugin.id}_${key}`;
            const val = localStorage.getItem(k);
            if (val === null) return defaultValue as T;
            try {
              return JSON.parse(val);
            } catch {
              return val as unknown as T;
            }
          },
          set: (key: string, val: any): void => {
            const k = `omnitool_plugin_${plugin.id}_${key}`;
            const str = typeof val === "string" ? val : JSON.stringify(val);
            localStorage.setItem(k, str);
          },
          remove: (key: string): void => {
            const k = `omnitool_plugin_${plugin.id}_${key}`;
            localStorage.removeItem(k);
          },
          clear: (): void => {
            const prefix = `omnitool_plugin_${plugin.id}_`;
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith(prefix)) {
                keysToRemove.push(k);
              }
            }
            keysToRemove.forEach((k) => localStorage.removeItem(k));
          },
          getAll: (): Record<string, any> => {
            const prefix = `omnitool_plugin_${plugin.id}_`;
            const result: Record<string, any> = {};
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith(prefix)) {
                const subKey = k.replace(prefix, "");
                const val = localStorage.getItem(k);
                try {
                  result[subKey] = JSON.parse(val || "");
                } catch {
                  result[subKey] = val;
                }
              }
            }
            return result;
          },
        },
        ui: {
          toast: (
            message: string,
            type: "success" | "info" | "warning" | "error" = "info"
          ) => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("omnitool-toast", {
                  detail: { message, type, source: plugin.name },
                })
              );
            }
          },
          openDialog: async (opts?: any) => {
            return await openDialog(opts);
          },
          saveDialog: async (opts?: any) => {
            return await saveDialog(opts);
          },
          alert: async (message: string) => {
            window.alert(message);
          },
          confirm: async (message: string) => {
            return window.confirm(message);
          },
          setActivity: (isActive: boolean) => {
            setTabProcess(`plugin:${plugin.id}`, isActive);
          },
        },
        registerSidebarWidget: (widget: {
          badge?: string | number;
          status?: "online" | "working" | "idle" | "error";
          color?: string;
        }) => {
          setSidebarWidget(plugin.id, widget);
        },
        clearSidebarWidget: () => {
          clearSidebarWidget(plugin.id);
        },
        onMount: (cb: (c: HTMLElement) => void | Promise<void>) => {
          try {
            const res = cb(container);
            if (res && typeof (res as any).then === "function") {
              (res as any).catch((err: any) => {
                console.error("Plugin onMount async error:", err);
                appendLog("error", "onMount error: " + String(err));
              });
            }
          } catch (err) {
            console.error("Plugin onMount error:", err);
            appendLog("error", "onMount error: " + String(err));
          }
        },
        onUnmount: (cb: () => void | Promise<void>) => {
          unmountCallbacksRef.current.push(cb);
        },
        events: {
          on: (event: string, handler: (payload: any) => void) => {
            let unlisten: (() => void) | undefined;
            listen(event, (e) => handler(e.payload)).then((fn) => {
              unlisten = fn;
              eventUnlistenersRef.current.push(fn);
            });
            return () => {
              if (unlisten) unlisten();
            };
          },
          emit: (event: string, payload?: any) => {
            emit(event, payload);
          },
        },
      };

      // Set global OmniTool object on window
      (window as any).OmniTool = sdk;

      // Custom scoped console for plugin execution
      const scopedConsole = {
        log: (...args: any[]) => {
          console.log(`[Plugin:${plugin.id}]`, ...args);
          appendLog("log", ...args);
        },
        info: (...args: any[]) => {
          console.info(`[Plugin:${plugin.id}]`, ...args);
          appendLog("info", ...args);
        },
        warn: (...args: any[]) => {
          console.warn(`[Plugin:${plugin.id}]`, ...args);
          appendLog("warn", ...args);
        },
        error: (...args: any[]) => {
          console.error(`[Plugin:${plugin.id}]`, ...args);
          appendLog("error", ...args);
        },
      };

      // Execute plugin script with sdk and container
      const runFn = new Function(
        "OmniTool",
        "container",
        "console",
        `"use strict";\n${scriptCode}`
      );

      const mountReturn = runFn(sdk, container, scopedConsole);
      if (mountReturn && typeof mountReturn.then === "function") {
        await mountReturn;
      }
    } catch (err: any) {
      console.error("Custom script plugin error:", err);
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      setError(msg);
      appendLog("error", msg);
    } finally {
      setLoading(false);
    }
  }, [
    plugin,
    inlineCode,
    cleanupCurrentInstance,
    readPluginFile,
    executePluginExec,
    setSidebarWidget,
    clearSidebarWidget,
    setTabProcess,
    appendLog,
  ]);

  // Initial load
  useEffect(() => {
    loadAndMountPlugin();
    return () => {
      cleanupCurrentInstance();
    };
  }, [plugin.id, inlineCode]);

  const handleReload = async () => {
    setReloading(true);
    await loadAndMountPlugin();
    setReloading(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("omnitool-toast", {
          detail: {
            message: t("custom_plugin_reloaded_toast", { name: plugin.name }),
            type: "info",
          },
        })
      );
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

  const handleCreateDefaultTemplate = async () => {
    const entryFilename = plugin.ui_entry || "index.js";
    const templateCode = getCustomScriptTemplates(t)[0].code;

    try {
      await writePluginFile(plugin.id, entryFilename, templateCode);
      await loadAndMountPlugin();
    } catch (err: any) {
      setError(String(err));
    }
  };

  const handleCopyLogs = async () => {
    const text = logs.map((l) => `[${l.time}] [${l.level.toUpperCase()}] ${l.text}`).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const isConsoleOpen = externalShowConsole !== undefined ? externalShowConsole : showConsole;
  const toggleConsole = onToggleConsole || (() => setShowConsole((v) => !v));

  const Icon = getPluginIcon(plugin.icon);

  return (
    <div className="space-y-3 flex flex-col flex-1 min-h-0">
      {/* Plugin Header Bar */}
      {!hideHeader && (
        <div className="flex items-center justify-between border-b border-white/[0.07] pb-2.5 shrink-0">
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

          {/* Action Controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReload}
              disabled={reloading}
              className="btn-secondary h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer transition hover:text-white"
              title={t("custom_plugin_reload")}
            >
              <RotateCw className={`w-3.5 h-3.5 text-zinc-400 ${reloading ? "animate-spin" : ""}`} />
              <span>{t("custom_plugin_reload")}</span>
            </button>

            {plugin.dir_path && (
              <button
                type="button"
                onClick={handleOpenFolder}
                className="btn-secondary h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer transition hover:text-white"
                title={t("custom_plugin_folder")}
              >
                <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
                <span>{t("custom_plugin_folder")}</span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleConsole}
              className={`btn-secondary h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer transition ${
                isConsoleOpen ? "bg-zinc-800 text-white border-emerald-500/40" : ""
              }`}
              title={t("custom_plugin_console")}
            >
              <Terminal className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("custom_plugin_console")}</span>
              {logs.length > 0 && (
                <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-zinc-700/80 text-zinc-300">
                  {logs.length}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error state if index.js is missing */}
      {error && error.startsWith("ENTRY_NOT_FOUND:") && (
        <div className="p-6 rounded-xl border border-amber-500/30 bg-amber-950/20 text-center space-y-3 max-w-xl mx-auto my-8">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
            <FileCode className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              {t("custom_plugin_entry_not_found_title")}
            </h3>
            <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
              {t("custom_plugin_entry_not_found_desc", {
                entry: error.replace("ENTRY_NOT_FOUND:", ""),
              })}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleCreateDefaultTemplate}
              className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium cursor-pointer shadow-sm flex items-center gap-1.5 border border-white/10"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>{t("custom_plugin_create_template_btn")}</span>
            </button>
            {plugin.dir_path && (
              <button
                type="button"
                onClick={handleOpenFolder}
                className="btn-secondary h-8 px-3 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{t("custom_plugin_open_folder_btn")}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Script Execution Runtime Error Banner */}
      {error && !error.startsWith("ENTRY_NOT_FOUND:") && (
        <div className="p-3.5 rounded-xl border border-red-500/40 bg-red-950/30 text-xs text-red-200 flex items-start gap-3 shadow-lg">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            <div className="font-semibold text-red-300">{t("custom_plugin_error_title")}</div>
            <pre className="font-mono text-[11px] whitespace-pre-wrap bg-red-950/60 p-2 rounded border border-red-900/40 text-red-200 overflow-x-auto max-h-40">
              {error}
            </pre>
          </div>
          <button
            type="button"
            onClick={handleReload}
            className="btn-secondary h-7 px-2 text-xs shrink-0 cursor-pointer"
          >
            {t("custom_plugin_retry_btn")}
          </button>
        </div>
      )}

      {/* Main Plugin Custom Mount Container */}
      <div className="relative flex-1 w-full min-h-[460px] flex flex-col">
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/30 backdrop-blur-xs rounded-xl z-10 pointer-events-none">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <RotateCw className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
              <span>{t("custom_plugin_loading")}</span>
            </div>
          </div>
        )}

        <div
          id={`omnitool-plugin-${plugin.id}-root`}
          ref={mountContainerRef}
          className="omnitool-custom-plugin-mount flex-1 w-full h-full relative overflow-y-auto"
        />
      </div>

      {/* Collapsible Plugin Logs Drawer / Console */}
      {isConsoleOpen && (
        <div className="border border-white/[0.08] bg-zinc-950/90 rounded-xl overflow-hidden shadow-2xl flex flex-col shrink-0 max-h-56">
          <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-white/[0.06] text-xs">
            <div className="flex items-center gap-2 text-zinc-300 font-mono text-[11px]">
              <Terminal className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("custom_plugin_console_title", { id: plugin.id })}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyLogs}
                disabled={logs.length === 0}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-white/[0.06] transition text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-40"
                title={t("custom_plugin_copy_logs")}
              >
                {copiedLogs ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedLogs ? t("custom_plugin_copied_logs") : t("custom_plugin_copy_logs")}</span>
              </button>
              <button
                type="button"
                onClick={() => setLogs([])}
                disabled={logs.length === 0}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-white/[0.06] transition text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-40"
                title={t("custom_plugin_clear_logs")}
              >
                <Trash2 className="w-3 h-3" />
                <span>{t("custom_plugin_clear_logs")}</span>
              </button>
              <button
                type="button"
                onClick={toggleConsole}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-white/[0.06] transition cursor-pointer"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="p-2 font-mono text-[11px] overflow-y-auto space-y-1 flex-1 min-h-[80px] bg-black/40">
            {logs.length === 0 ? (
              <div className="text-zinc-500 italic py-2 text-center">{t("custom_plugin_no_logs")}</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-zinc-500 shrink-0 select-none">{log.time}</span>
                  <span
                    className={`font-semibold shrink-0 uppercase text-[9px] px-1 rounded ${
                      log.level === "error"
                        ? "bg-red-950 text-red-400 border border-red-800/40"
                        : log.level === "warn"
                        ? "bg-amber-950 text-amber-400 border border-amber-800/40"
                        : log.level === "info"
                        ? "bg-blue-950 text-blue-400 border border-blue-800/40"
                        : "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {log.level}
                  </span>
                  <span
                    className={`flex-1 break-all whitespace-pre-wrap ${
                      log.level === "error"
                        ? "text-red-300"
                        : log.level === "warn"
                        ? "text-amber-300"
                        : log.level === "info"
                        ? "text-blue-300"
                        : "text-zinc-300"
                    }`}
                  >
                    {log.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
