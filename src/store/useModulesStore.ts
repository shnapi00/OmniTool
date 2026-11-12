import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type BuiltinModuleId =
  | "stickers"
  | "bg_remover"
  | "media_downloader"
  | "converter"
  | "ocr"
  | "audio_extractor"
  | "compressor";

export interface PluginField {
  id: string;
  type: string; // "text", "file", "select", "number"
  label: string;
  placeholder?: string;
  options?: string[];
  default_value?: string;
}

export interface PluginDependencies {
  python?: string[];
  npm?: string[];
}

export interface PluginAction {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | string;
  icon?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  icon?: string; // Lucide icon name OR custom Data URL (SVG/PNG)
  description: string;
  version: string;
  fields?: PluginField[];
  action_label?: string;
  command?: string;
  script?: string;
  view?: "terminal" | "gallery" | "custom" | string;
  actions?: PluginAction[];
  settings_label?: string;
  dependencies?: PluginDependencies;
  custom_ui?: boolean;
  ui_entry?: string; // e.g. "index.js"
  permissions?: string[];
  dir_path?: string;
}

export interface SidebarWidgetInfo {
  badge?: string | number;
  status?: "online" | "working" | "idle" | "error";
  color?: string;
}

export interface RuntimeInfo {
  installed: boolean;
  version: string;
  is_portable: boolean;
  path?: string;
}

export interface RuntimesStatus {
  python: RuntimeInfo;
  node: RuntimeInfo;
}

export interface PluginDepsStatus {
  plugin_id: string;
  all_installed: boolean;
  missing_python: string[];
  missing_npm: string[];
}

export interface PluginDepProgressPayload {
  plugin_id: string;
  percent: number;
  status: string;
  log_chunk: string;
  done: boolean;
  has_error: boolean;
}

export interface PluginDepState {
  status: "idle" | "checking" | "installing" | "ready" | "error";
  percent: number;
  currentStatus: string;
  logs: string[];
  isInstalling: boolean;
  isReady: boolean;
  hasError?: boolean;
}

interface ModulesState {
  builtinStatus: Record<BuiltinModuleId, boolean>;
  customPlugins: PluginManifest[];
  enabledCustomPlugins: Record<string, boolean>;
  pluginDeps: Record<string, PluginDepState>;
  runtimes: RuntimesStatus | null;
  loading: boolean;
  runtimesLoading: boolean;
  installingRuntime: string | null;
  runtimeInstallStatus: string | null;
  error: string | null;

  toggleBuiltin: (id: BuiltinModuleId) => void;
  toggleCustom: (id: string) => void;
  loadPlugins: () => Promise<void>;
  createPlugin: (manifest: PluginManifest, scriptContent: string) => Promise<string>;
  deletePlugin: (id: string) => Promise<void>;
  openPluginsFolder: () => Promise<void>;
  checkRuntimes: () => Promise<void>;
  installRuntime: (runtime: "python" | "node") => Promise<void>;
  exportPlugin: (id: string, targetPath: string) => Promise<string>;
  importPlugin: (sourcePath: string) => Promise<PluginManifest>;
  installDependencies: (id: string) => Promise<string>;
  checkAndInstallPluginDeps: (pluginId: string) => Promise<void>;

  sidebarWidgets: Record<string, SidebarWidgetInfo>;
  setSidebarWidget: (pluginId: string, widget: SidebarWidgetInfo) => void;
  clearSidebarWidget: (pluginId: string) => void;
  readPluginFile: (pluginId: string, filename: string) => Promise<string>;
  writePluginFile: (pluginId: string, filename: string, content: string) => Promise<void>;
  executePluginExec: (
    pluginId: string,
    program: string,
    args?: string[],
    cwd?: string,
    execId?: string
  ) => Promise<{ stdout: string; stderr: string; exit_code: number; success: boolean }>;
}

const BUILTIN_STORAGE_KEY = "omnitool_builtin_modules";
const CUSTOM_ENABLED_KEY = "omnitool_custom_plugins_enabled";

const defaultBuiltins: Record<BuiltinModuleId, boolean> = {
  stickers: true,
  bg_remover: true,
  media_downloader: true,
  converter: true,
  ocr: true,
  audio_extractor: true,
  compressor: true,
};

const getSavedBuiltins = (): Record<BuiltinModuleId, boolean> => {
  try {
    const raw = localStorage.getItem(BUILTIN_STORAGE_KEY);
    if (raw) {
      return { ...defaultBuiltins, ...JSON.parse(raw) };
    }
  } catch {}
  return defaultBuiltins;
};

const getSavedCustomEnabled = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(CUSTOM_ENABLED_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return {};
};

// Global listener setup flag
let isProgressListening = false;

export const useModulesStore = create<ModulesState>((set, get) => {
  // Setup listener for backend progress events once
  if (!isProgressListening && typeof window !== "undefined") {
    isProgressListening = true;
    listen<PluginDepProgressPayload>("plugin-dep-progress", (event) => {
      const { plugin_id, percent, status, log_chunk, done, has_error } = event.payload;
      const currentDeps = get().pluginDeps;
      const current = currentDeps[plugin_id] || {
        status: "installing",
        percent: 0,
        currentStatus: "",
        logs: [],
        isInstalling: true,
        isReady: false,
      };

      const updatedLogs = log_chunk ? [...current.logs, log_chunk] : current.logs;

      set({
        pluginDeps: {
          ...currentDeps,
          [plugin_id]: {
            status: done ? "ready" : has_error ? "error" : "installing",
            percent,
            currentStatus: status,
            logs: updatedLogs,
            isInstalling: !done && !has_error,
            isReady: done,
            hasError: has_error,
          },
        },
      });
    });
  }

  return {
    builtinStatus: getSavedBuiltins(),
    customPlugins: [],
    enabledCustomPlugins: getSavedCustomEnabled(),
    pluginDeps: {},
    sidebarWidgets: {},
    runtimes: null,
    loading: false,
    runtimesLoading: false,
    installingRuntime: null,
    runtimeInstallStatus: null,
    error: null,

    toggleBuiltin: (id: BuiltinModuleId) => {
      const current = get().builtinStatus;
      const updated = { ...current, [id]: !current[id] };
      localStorage.setItem(BUILTIN_STORAGE_KEY, JSON.stringify(updated));
      set({ builtinStatus: updated });
    },

    toggleCustom: (id: string) => {
      const current = get().enabledCustomPlugins;
      const isCurrentlyEnabled = current[id] !== false;
      const updated = { ...current, [id]: !isCurrentlyEnabled };
      localStorage.setItem(CUSTOM_ENABLED_KEY, JSON.stringify(updated));
      set({ enabledCustomPlugins: updated });
    },

    loadPlugins: async () => {
      set({ loading: true, error: null });
      try {
        const list = await invoke<PluginManifest[]>("get_installed_plugins");
        set({ customPlugins: list, loading: false });

        // Auto-check dependencies for each custom plugin
        for (const p of list) {
          get().checkAndInstallPluginDeps(p.id);
        }
      } catch (err) {
        set({ error: String(err), loading: false });
      }
    },

    checkAndInstallPluginDeps: async (pluginId: string) => {
      try {
        // Set initial checking state
        const currentDeps = get().pluginDeps;
        set({
          pluginDeps: {
            ...currentDeps,
            [pluginId]: {
              status: "checking",
              percent: 5,
              currentStatus: "Checking dependencies...",
              logs: ["Checking installed packages...\n"],
              isInstalling: false,
              isReady: false,
            },
          },
        });

        const status = await invoke<PluginDepsStatus>("check_plugin_dependencies", {
          pluginId,
        });

        if (status.all_installed) {
          set({
            pluginDeps: {
              ...get().pluginDeps,
              [pluginId]: {
                status: "ready",
                percent: 100,
                currentStatus: "All dependencies ready",
                logs: ["All required dependencies are installed.\n"],
                isInstalling: false,
                isReady: true,
              },
            },
          });
        } else {
          // Missing packages found -> start silent installation
          set({
            pluginDeps: {
              ...get().pluginDeps,
              [pluginId]: {
                status: "installing",
                percent: 8,
                currentStatus: "Installing dependencies...",
                logs: [
                  `Missing dependencies detected:\n` +
                    (status.missing_python.length
                      ? `Python: ${status.missing_python.join(", ")}\n`
                      : "") +
                    (status.missing_npm.length
                      ? `NPM: ${status.missing_npm.join(", ")}\n`
                      : "") +
                    `Starting installation...\n`,
                ],
                isInstalling: true,
                isReady: false,
              },
            },
          });

          await invoke<string>("install_plugin_dependencies", { pluginId });
        }
      } catch (err) {
        const currentDeps = get().pluginDeps;
        set({
          pluginDeps: {
            ...currentDeps,
            [pluginId]: {
              status: "error",
              percent: 0,
              currentStatus: `Error: ${String(err)}`,
              logs: [...(currentDeps[pluginId]?.logs || []), `\nError: ${String(err)}\n`],
              isInstalling: false,
              isReady: false,
              hasError: true,
            },
          },
        });
      }
    },

    createPlugin: async (manifest: PluginManifest, scriptContent: string) => {
      set({ loading: true, error: null });
      try {
        const id = await invoke<string>("create_custom_plugin", {
          manifest,
          scriptContent,
        });
        const current = get().enabledCustomPlugins;
        const updated = { ...current, [id]: true };
        localStorage.setItem(CUSTOM_ENABLED_KEY, JSON.stringify(updated));
        set({ enabledCustomPlugins: updated });

        await get().loadPlugins();
        return id;
      } catch (err) {
        set({ error: String(err), loading: false });
        throw err;
      }
    },

    deletePlugin: async (id: string) => {
      set({ loading: true, error: null });
      try {
        await invoke("delete_custom_plugin", { pluginId: id });
        await get().loadPlugins();
      } catch (err) {
        set({ error: String(err), loading: false });
        throw err;
      }
    },

    openPluginsFolder: async () => {
      try {
        const folder = await invoke<string>("get_plugins_folder_path");
        await invoke("open_folder", { path: folder });
      } catch (err) {
        console.error("Failed to open plugins folder:", err);
      }
    },

    checkRuntimes: async () => {
      set({ runtimesLoading: true });
      try {
        const status = await invoke<RuntimesStatus>("check_runtimes_status");
        set({ runtimes: status, runtimesLoading: false });
      } catch (err) {
        console.warn("Failed to check runtimes status:", err);
        set({ runtimesLoading: false });
      }
    },

    installRuntime: async (runtime: "python" | "node") => {
      set({ installingRuntime: runtime, runtimeInstallStatus: null });
      try {
        await invoke("install_portable_runtime", { runtime });
        await get().checkRuntimes();
      } catch (err) {
        set({ error: String(err) });
        throw err;
      } finally {
        set({ installingRuntime: null, runtimeInstallStatus: null });
      }
    },

    exportPlugin: async (id: string, targetPath: string) => {
      return await invoke<string>("export_plugin", { pluginId: id, targetPath });
    },

    importPlugin: async (sourcePath: string) => {
      set({ loading: true, error: null });
      try {
        const manifest = await invoke<PluginManifest>("import_plugin", { sourcePath });
        const current = get().enabledCustomPlugins;
        const updated = { ...current, [manifest.id]: true };
        localStorage.setItem(CUSTOM_ENABLED_KEY, JSON.stringify(updated));
        set({ enabledCustomPlugins: updated });
        await get().loadPlugins();
        // Immediately check and install dependencies for the newly imported plugin
        get().checkAndInstallPluginDeps(manifest.id);
        return manifest;
      } catch (err) {
        set({ error: String(err), loading: false });
        throw err;
      }
    },

    installDependencies: async (id: string) => {
      return await invoke<string>("install_plugin_dependencies", { pluginId: id });
    },

    setSidebarWidget: (pluginId: string, widget: SidebarWidgetInfo) => {
      set((state) => ({
        sidebarWidgets: {
          ...state.sidebarWidgets,
          [pluginId]: widget,
        },
      }));
    },

    clearSidebarWidget: (pluginId: string) => {
      set((state) => {
        const next = { ...state.sidebarWidgets };
        delete next[pluginId];
        return { sidebarWidgets: next };
      });
    },

    readPluginFile: async (pluginId: string, filename: string) => {
      return await invoke<string>("read_plugin_file", { pluginId, filename });
    },

    writePluginFile: async (pluginId: string, filename: string, content: string) => {
      await invoke("write_plugin_file", { pluginId, filename, content });
    },

    executePluginExec: async (
      pluginId: string,
      program: string,
      args?: string[],
      cwd?: string,
      execId?: string
    ) => {
      return await invoke<{
        stdout: string;
        stderr: string;
        exit_code: number;
        success: boolean;
      }>("execute_plugin_exec", {
        pluginId,
        program,
        args,
        cwd,
        execId,
      });
    },
  };
});
