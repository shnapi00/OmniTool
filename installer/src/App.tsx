import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Folder,
  Check,
  Minus,
  X,
  AlertCircle,
  Wrench,
  Trash2,
  Globe,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import logoImg from "./assets/logo.png";
import {
  InstallerLanguage,
  INSTALLER_LANG_LABELS,
  translations,
} from "./translations";

interface ProgressEvent {
  percent: number;
  message: string;
}

interface ExistingInstallInfo {
  install_path: string;
  is_installed: boolean;
}

export function App() {
  const [appMode, setAppMode] = useState<"install" | "uninstall">("install");
  const [lang, setLang] = useState<InstallerLanguage>("ru");

  const [installPath, setInstallPath] = useState<string>("");
  const [createShortcut, setCreateShortcut] = useState<boolean>(true);
  const [isExistingInstall, setIsExistingInstall] = useState<boolean>(false);
  const [isCleanReinstall, setIsCleanReinstall] = useState<boolean>(false);

  // Uninstaller states
  const [keepPlugins, setKeepPlugins] = useState<boolean>(true);
  const [keepDeps, setKeepDeps] = useState<boolean>(true);

  // Wizard steps
  const [step, setStep] = useState<"config" | "progress" | "finished">("config");
  const [percent, setPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Prevent right-click context menu everywhere
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu, { capture: true });
    document.addEventListener("contextmenu", handleContextMenu, { capture: true });

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu, { capture: true });
      document.removeEventListener("contextmenu", handleContextMenu, { capture: true });
    };
  }, []);

  // Initialize mode, language, and existing install check
  useEffect(() => {
    // 1. Detect app mode
    invoke<string>("get_app_mode")
      .then((mode) => {
        if (mode === "uninstall") {
          setAppMode("uninstall");
        }
      })
      .catch(() => {});

    // 2. Detect language
    invoke<string>("detect_system_language")
      .then((detected) => {
        const supported: InstallerLanguage[] = ["ru", "uk", "en", "de", "pl", "ja"];
        if (supported.includes(detected as InstallerLanguage)) {
          setLang(detected as InstallerLanguage);
        }
      })
      .catch(() => {});

    // 3. Check existing installation
    invoke<ExistingInstallInfo>("check_existing_install")
      .then((info) => {
        if (info.install_path) {
          setInstallPath(info.install_path);
        }
        if (info.is_installed) {
          setIsExistingInstall(true);
        }
      })
      .catch(() => {
        invoke<string>("get_default_install_dir")
          .then((path) => setInstallPath(path))
          .catch(() => {});
      });

    // 4. Progress listener
    const unlisten = listen<ProgressEvent>("install-progress", (event) => {
      setPercent(event.payload.percent);
      setStatusMessage(event.payload.message);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const t = (key: string): string => {
    return translations[lang]?.[key] || translations.ru?.[key] || key;
  };

  const handleLanguageChange = (newLang: InstallerLanguage) => {
    setLang(newLang);
    invoke("save_installer_language", { lang: newLang }).catch(() => {});
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("select_folder_title"),
      });
      if (typeof selected === "string") {
        setInstallPath(selected);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleStartInstall = async () => {
    if (!installPath.trim()) return;
    setStep("progress");
    setPercent(5);
    setStatusMessage(t("installing_status"));
    setError(null);

    try {
      await invoke("install_app", {
        targetDir: installPath.trim(),
        createShortcut,
        lang,
      });
      setPercent(100);
      setStep("finished");
    } catch (err) {
      setError(String(err));
      setStep("config");
    }
  };

  const handleStartRepair = async () => {
    if (!installPath.trim()) return;
    setStep("progress");
    setPercent(5);
    setStatusMessage(t("repairing_status"));
    setError(null);

    try {
      await invoke("repair_app", {
        targetDir: installPath.trim(),
        createShortcut,
        lang,
      });
      setPercent(100);
      setStep("finished");
    } catch (err) {
      setError(String(err));
      setStep("config");
    }
  };

  const handleStartUninstall = async () => {
    if (!installPath.trim()) return;
    setStep("progress");
    setPercent(5);
    setStatusMessage(t("uninstalling_status"));
    setError(null);

    try {
      await invoke("uninstall_app", {
        targetDir: installPath.trim(),
        keepPlugins,
        keepDeps,
      });
      setPercent(100);
      setStep("finished");
    } catch (err) {
      setError(String(err));
      setStep("config");
    }
  };

  const handleCancelInstall = async () => {
    try {
      await invoke("cancel_installation", { targetDir: installPath.trim() });
    } catch (err) {
      console.error(err);
    }
    setStep("config");
    setPercent(0);
    setStatusMessage("");
  };

  const handleLaunchApp = async () => {
    try {
      await invoke("launch_installed_app", {
        targetDir: installPath.trim(),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleClose = async () => {
    try {
      await invoke("close_installer");
    } catch {
      window.close();
    }
  };

  const handleMinimize = async () => {
    try {
      await invoke("minimize_installer");
    } catch (err) {
      console.error(err);
    }
  };

  const handleDragMouseDown = async (e: React.MouseEvent) => {
    if (
      e.button === 0 &&
      !(e.target as HTMLElement).closest(
        'button, input, select, a, [data-tauri-drag-region="false"]'
      )
    ) {
      try {
        const win = getCurrentWindow();
        await win.startDragging();
      } catch {
        try {
          await invoke("drag_installer");
        } catch (err) {
          console.error("Window drag error:", err);
        }
      }
    }
  };

  const isRepairMode = appMode === "install" && isExistingInstall && !isCleanReinstall;

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="w-full h-full bg-[#09090b] border border-[#27272a] flex flex-col justify-between overflow-hidden select-none antialiased text-zinc-100"
    >
      {/* Frameless Header - Draggable Header */}
      <header
        className="h-10 bg-[#09090b] border-b border-[#27272a] flex items-center justify-between px-3.5 select-none shrink-0 relative cursor-default"
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
      >
        {/* Full-width drag backdrop */}
        <div
          className="absolute inset-0 z-0 cursor-default"
          data-tauri-drag-region
          onMouseDown={handleDragMouseDown}
        />

        {/* Left: Branding */}
        <div
          className="flex items-center select-none relative z-10 pointer-events-none"
          data-tauri-drag-region
        >
          <span
            className="text-xs font-mono text-zinc-400 select-none pointer-events-none"
            data-tauri-drag-region
          >
            {appMode === "uninstall" ? t("uninstall_title") : t("setup_title")}
          </span>
        </div>

        {/* Right: Language Selector + Window Controls */}
        <div
          className="flex items-center gap-2 relative z-20"
          data-tauri-drag-region="false"
        >
          {/* Language selector dropdown */}
          <div className="relative flex items-center">
            <Globe className="w-3 h-3 text-zinc-500 mr-1 pointer-events-none" />
            <select
              value={lang}
              onChange={(e) => handleLanguageChange(e.target.value as InstallerLanguage)}
              onMouseDown={(e) => e.stopPropagation()}
              data-tauri-drag-region="false"
              className="bg-black border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100 text-[11px] font-mono rounded px-1.5 py-0.5 focus:outline-none cursor-pointer"
            >
              {(["ru", "uk", "en", "de", "pl", "ja"] as InstallerLanguage[]).map((l) => (
                <option key={l} value={l} className="bg-zinc-900 text-zinc-200">
                  {INSTALLER_LANG_LABELS[l]}
                </option>
              ))}
            </select>
          </div>

          <div className="h-3.5 w-px bg-zinc-800 mx-0.5" />

          {/* Window Buttons */}
          <button
            type="button"
            data-tauri-drag-region="false"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleMinimize}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            data-tauri-drag-region="false"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-950/80 hover:text-red-300 text-zinc-400 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 p-6 flex flex-col justify-between">
        {step === "config" && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Header / Branding */}
            <div className="flex items-center gap-3.5">
              <img
                src={logoImg}
                alt="OmniTool"
                className="w-11 h-11 rounded-xl border border-[#27272a] shadow-md shrink-0 object-contain p-0.5 bg-black"
              />
              <div>
                <h1 className="text-base font-semibold text-zinc-100 tracking-tight">
                  {appMode === "uninstall"
                    ? t("uninstall_title")
                    : isRepairMode
                    ? t("repair_heading")
                    : t("install_heading")}
                </h1>
                <p className="text-xs text-zinc-400 mt-0.5 font-mono">
                  {t("version_label")}
                </p>
              </div>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-900/60 text-xs text-red-300 flex items-center gap-2 font-mono">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            {/* UNINSTALL MODE CONFIG */}
            {appMode === "uninstall" && (
              <div className="space-y-3.5 pt-1">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {t("uninstall_prompt")}
                </p>

                <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-400 truncate">
                  {installPath}
                </div>

                <div className="space-y-2 pt-1">
                  {/* Keep plugins checkbox */}
                  <div
                    onClick={() => setKeepPlugins(!keepPlugins)}
                    className="inline-flex items-center gap-2.5 cursor-pointer group select-none py-0.5"
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-150 ${
                        keepPlugins
                          ? "bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-950"
                          : "bg-black border-zinc-700/80 group-hover:border-zinc-500 text-transparent"
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                    <span className="text-xs text-zinc-300 group-hover:text-zinc-100 transition-colors">
                      {t("keep_plugins_label")}
                    </span>
                  </div>

                  {/* Keep dependencies checkbox */}
                  <div
                    onClick={() => setKeepDeps(!keepDeps)}
                    className="inline-flex items-center gap-2.5 cursor-pointer group select-none py-0.5"
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-150 ${
                        keepDeps
                          ? "bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-950"
                          : "bg-black border-zinc-700/80 group-hover:border-zinc-500 text-transparent"
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                    <span className="text-xs text-zinc-300 group-hover:text-zinc-100 transition-colors">
                      {t("keep_deps_label")}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* REPAIR MODE CONFIG */}
            {isRepairMode && (
              <div className="space-y-3 pt-1">
                <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-zinc-300 flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-medium text-emerald-300">
                      {t("existing_detected")}
                    </div>
                    <div className="text-[11px] text-zinc-400 leading-relaxed">
                      {t("existing_detected_desc")}
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-zinc-400">
                    {t("folder_label")}
                  </label>
                  <div className="p-2 rounded-lg bg-black border border-zinc-800 text-xs font-mono text-zinc-200">
                    {installPath}
                  </div>
                </div>

                {/* Desktop shortcut checkbox */}
                <div
                  onClick={() => setCreateShortcut(!createShortcut)}
                  className="inline-flex items-center gap-2.5 cursor-pointer group select-none py-1"
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-150 ${
                      createShortcut
                        ? "bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-950"
                        : "bg-black border-zinc-700/80 group-hover:border-zinc-500 text-transparent"
                    }`}
                  >
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                  <span className="text-xs text-zinc-300 group-hover:text-zinc-100 transition-colors">
                    {t("shortcut_label")}
                  </span>
                </div>
              </div>
            )}

            {/* NORMAL INSTALL / CLEAN REINSTALL MODE CONFIG */}
            {appMode === "install" && !isRepairMode && (
              <div className="space-y-3.5 pt-1">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-400">
                    {t("folder_label")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={installPath}
                      onChange={(e) => setInstallPath(e.target.value)}
                      className="flex-1 bg-black border border-zinc-800 hover:border-zinc-700 focus:border-emerald-500/60 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={handleSelectFolder}
                      className="px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Folder className="w-3.5 h-3.5 text-zinc-400" />
                      <span>{t("browse_btn")}</span>
                    </button>
                  </div>
                </div>

                {/* Custom Checkbox */}
                <div className="pt-0.5">
                  <div
                    onClick={() => setCreateShortcut(!createShortcut)}
                    className="inline-flex items-center gap-2.5 cursor-pointer group select-none py-1"
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-150 ${
                        createShortcut
                          ? "bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-950"
                          : "bg-black border-zinc-700/80 group-hover:border-zinc-500 text-transparent"
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                    <span className="text-xs text-zinc-300 group-hover:text-zinc-100 transition-colors">
                      {t("shortcut_label")}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PROGRESS STEP */}
        {step === "progress" && (
          <div className="my-auto space-y-5 text-center animate-in fade-in duration-200 max-w-md mx-auto w-full">
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-zinc-100">
                {appMode === "uninstall"
                  ? t("uninstalling_status")
                  : isRepairMode
                  ? t("repairing_status")
                  : t("installing_status")}
              </div>
              <div className="text-xs text-zinc-400 font-mono truncate px-2">
                {statusMessage}
              </div>
            </div>

            {/* Smooth Progress Bar */}
            <div className="space-y-1.5">
              <div className="w-full h-2 bg-black rounded-full overflow-hidden border border-zinc-800 shadow-inner">
                <div
                  className={`h-full transition-all duration-300 ease-out ${
                    appMode === "uninstall"
                      ? "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]"
                      : "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="text-[11px] font-mono text-zinc-500 text-right">
                {percent}%
              </div>
            </div>
          </div>
        )}

        {/* FINISHED STEP */}
        {step === "finished" && (
          <div className="my-auto text-center space-y-4 animate-in fade-in duration-300">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-sm">
              <Check className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">
                {appMode === "uninstall"
                  ? t("uninstall_success")
                  : isRepairMode
                  ? t("repair_success")
                  : t("install_success")}
              </h2>
              <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto font-mono">
                {appMode === "uninstall"
                  ? t("uninstall_success_desc")
                  : isRepairMode
                  ? t("repair_success_desc")
                  : `${installPath}`}
              </p>
            </div>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="pt-3 border-t border-[#27272a] flex items-center justify-between">
          <div className="text-[11px] text-zinc-500 font-mono">
            {t("version_label")}
          </div>

          <div className="flex gap-2.5">
            {step === "config" && (
              <>
                {/* UNINSTALL MODE BUTTONS */}
                {appMode === "uninstall" && (
                  <>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="border border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 font-medium px-4 py-2 rounded-lg text-xs transition-colors cursor-pointer"
                    >
                      {t("btn_cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleStartUninstall}
                      className="bg-red-600 hover:bg-red-500 text-white font-medium px-5 py-2 rounded-lg text-xs transition-colors shadow-sm cursor-pointer flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t("btn_uninstall")}</span>
                    </button>
                  </>
                )}

                {/* REPAIR MODE BUTTONS */}
                {isRepairMode && (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsCleanReinstall(true)}
                      className="border border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 font-medium px-3.5 py-2 rounded-lg text-xs transition-colors cursor-pointer"
                    >
                      {t("btn_clean_reinstall")}
                    </button>
                    <button
                      type="button"
                      onClick={handleStartRepair}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-5 py-2 rounded-lg text-xs transition-colors shadow-sm cursor-pointer flex items-center gap-1.5"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>{t("btn_repair")}</span>
                    </button>
                  </>
                )}

                {/* NORMAL INSTALL BUTTONS */}
                {appMode === "install" && !isRepairMode && (
                  <>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="border border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 font-medium px-4 py-2 rounded-lg text-xs transition-colors cursor-pointer"
                    >
                      {t("btn_cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleStartInstall}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-5 py-2 rounded-lg text-xs transition-colors shadow-sm cursor-pointer"
                    >
                      {t("btn_install")}
                    </button>
                  </>
                )}
              </>
            )}

            {step === "progress" && (
              <>
                <button
                  type="button"
                  onClick={handleCancelInstall}
                  className="border border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 font-medium px-4 py-2 rounded-lg text-xs transition-colors cursor-pointer"
                >
                  {t("btn_cancel")}
                </button>
                <button
                  type="button"
                  disabled
                  className="bg-zinc-800 text-zinc-500 font-medium px-5 py-2 rounded-lg text-xs cursor-not-allowed opacity-60"
                >
                  {percent}%
                </button>
              </>
            )}

            {step === "finished" && (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  className="border border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 font-medium px-4 py-2 rounded-lg text-xs transition-colors cursor-pointer"
                >
                  {t("btn_close")}
                </button>
                {appMode !== "uninstall" && (
                  <button
                    type="button"
                    onClick={handleLaunchApp}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-5 py-2 rounded-lg text-xs transition-colors shadow-sm cursor-pointer flex items-center gap-1.5"
                  >
                    <span>{t("btn_launch")}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
