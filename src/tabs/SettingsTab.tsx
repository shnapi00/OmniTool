import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import {
  Check,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  Trash2,
  RefreshCw,
  ArrowDownToLine,
  Eye,
  EyeOff,
  ShieldAlert,
} from "lucide-react";
import { useTheme, AppTheme, APP_THEMES } from "../context/ThemeContext";
import { useTranslation } from "../i18n/useTranslation";
import { Language, LANGUAGE_LABELS } from "../i18n/translations";
import appLogo from "../assets/logo.png";

interface UpdateResult {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  release_notes: string;
  is_staged: boolean;
}

export const SettingsTab: React.FC = () => {
  const {
    atmosphere,
    setAtmosphere,
    wallpaperPath,
    setWallpaper,
    wallpaperDim,
    setWallpaperDim,
    wallpaperBlur,
    setWallpaperBlur,
  } = useTheme();

  const { lang, setLang, t } = useTranslation();

  const [hasBuiltinToken, setHasBuiltinToken] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [showWarnModal, setShowWarnModal] = useState(false);

  useEffect(() => {
    invoke<boolean>("has_builtin_tg_token")
      .then(setHasBuiltinToken)
      .catch(() => {});
  }, []);

  const [autostart, setAutostartState] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [closeToTray, setCloseToTray] = useState(() => {
    return localStorage.getItem("omnitool_close_to_tray") !== "false";
  });
  const [customTgToken, setCustomTgToken] = useState(() => {
    return localStorage.getItem("omnitool_custom_tg_bot_token") || "";
  });
  const [error, setError] = useState<string | null>(null);

  // Updater State
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [autoUpdateOnRestart, setAutoUpdateOnRestart] = useState(true);
  const [stagedInfo, setStagedInfo] = useState<{ version: string; ready: boolean } | null>(null);

  useEffect(() => {
    invoke<any>("get_app_config")
      .then((cfg) => {
        if (cfg && typeof cfg.auto_update_on_restart === "boolean") {
          setAutoUpdateOnRestart(cfg.auto_update_on_restart);
        }
      })
      .catch(() => {});

    invoke<any>("get_staged_update")
      .then((info) => {
        if (info && info.ready) {
          setStagedInfo(info);
        }
      })
      .catch(() => {});
  }, []);

  const toggleAutoUpdateOnRestart = async () => {
    const nextVal = !autoUpdateOnRestart;
    setAutoUpdateOnRestart(nextVal);
    try {
      const cfg: any = await invoke("get_app_config");
      await invoke("save_app_config", {
        config: {
          ...cfg,
          auto_update_on_restart: nextVal,
        },
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleApplyUpdate = async () => {
    try {
      await invoke("apply_update_and_restart");
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    const fetchAutostart = async () => {
      try {
        const status = await invoke<boolean>("get_autostart");
        setAutostartState(status);
      } catch (err) {
        console.error("Не удалось прочитать статус автозагрузки:", err);
      } finally {
        setAutostartLoading(false);
      }
    };
    fetchAutostart();
  }, []);

  const toggleAutostart = async () => {
    const nextVal = !autostart;
    setAutostartLoading(true);
    setError(null);
    try {
      await invoke("set_autostart", { enable: nextVal });
      setAutostartState(nextVal);
    } catch (err) {
      setError(String(err));
    } finally {
      setAutostartLoading(false);
    }
  };

  const toggleCloseToTray = () => {
    const nextVal = !closeToTray;
    setCloseToTray(nextVal);
    localStorage.setItem("omnitool_close_to_tray", String(nextVal));
  };

  const handleToggleShowToken = () => {
    if (showToken) {
      setShowToken(false);
    } else {
      setShowWarnModal(true);
    }
  };

  const handleSelectWallpaper = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("settings_wallpaper_dialog_title"),
        filters: [
          {
            name: t("bg_filter_images"),
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });

      if (typeof selected === "string") {
        setWallpaper(selected);
      }
    } catch (err) {
      console.error("Ошибка выбора обоев:", err);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateResult(null);
    setError(null);

    try {
      const res = await invoke<UpdateResult>("check_app_updates");
      setUpdateResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const themeKeys: AppTheme[] = ["oled", "dark", "graphite", "midnight"];
  const languages: Language[] = ["ru", "uk", "en", "de", "pl", "ja"];

  return (
    <div className="space-y-4 max-w-2xl pb-6">
      {/* Header */}
      <div className="border-b border-white/[0.07] pb-2">
        <h2 className="text-sm font-medium text-zinc-100">
          {t("settings_title")}
        </h2>
        <p className="text-[11px] text-zinc-400 mt-0.5">{t("settings_desc")}</p>
      </div>

      {error && (
        <div className="p-2.5 bg-red-950/30 border border-red-900/40 rounded-md text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Appearance / Theme */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-zinc-300">
          {t("settings_appearance")}
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {themeKeys.map((key) => {
            const config = APP_THEMES[key];
            const isSelected = atmosphere === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setAtmosphere(key)}
                className={`px-3 py-2 rounded-lg border text-left transition-all flex items-center justify-between cursor-pointer ${
                  isSelected
                    ? "bg-white/[0.08] border-white/30 text-white shadow-sm"
                    : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05] hover:border-white/15"
                }`}
              >
                <span className="text-xs font-medium truncate">
                  {t(config.nameKey)}
                </span>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 shrink-0 ml-1.5 text-zinc-300" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Language Selector - Compact Dropdown */}
      <div className="space-y-1.5 pt-1 border-t border-white/[0.06]">
        <label className="block text-xs font-medium text-zinc-300">
          {t("settings_language")}
        </label>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as Language)}
          className="w-full sm:w-60 input-base cursor-pointer"
        >
          {languages.map((item) => (
            <option key={item} value={item} className="bg-zinc-900 text-zinc-100">
              {LANGUAGE_LABELS[item].native} ({LANGUAGE_LABELS[item].label})
            </option>
          ))}
        </select>
      </div>

      {/* Custom Wallpaper Section */}
      <div className="space-y-2 pt-1 border-t border-white/[0.06]">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-zinc-300">
            {t("settings_wallpaper")}
          </label>
          {wallpaperPath && (
            <button
              type="button"
              onClick={() => setWallpaper(null)}
              className="text-[11px] text-zinc-400 hover:text-red-300 flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>{t("settings_wallpaper_clear")}</span>
            </button>
          )}
        </div>

        <div className="flex gap-1.5">
          <input
            type="text"
            readOnly
            value={wallpaperPath || ""}
            placeholder={t("settings_no_wallpaper")}
            className="flex-1 input-base font-mono text-[11px]"
          />
          <button
            type="button"
            onClick={handleSelectWallpaper}
            className="btn-secondary"
          >
            <ImageIcon className="w-3 h-3 text-zinc-400" />
            <span>{t("common_browse")}</span>
          </button>
        </div>

        {wallpaperPath && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>{t("settings_wallpaper_dim")}</span>
                <span className="font-mono">{wallpaperDim}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="90"
                value={wallpaperDim}
                onChange={(e) => setWallpaperDim(Number(e.target.value))}
                className="w-full h-1 bg-zinc-900 rounded appearance-none cursor-pointer accent-zinc-300"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>{t("settings_wallpaper_blur")}</span>
                <span className="font-mono">{wallpaperBlur}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                value={wallpaperBlur}
                onChange={(e) => setWallpaperBlur(Number(e.target.value))}
                className="w-full h-1 bg-zinc-900 rounded appearance-none cursor-pointer accent-zinc-300"
              />
            </div>
          </div>
        )}
      </div>

      {/* System Settings Toggles */}
      <div className="space-y-2 pt-1 border-t border-white/[0.06] divide-y divide-white/[0.04]">
        {/* Autostart */}
        <div className="pt-2 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-zinc-300">{t("settings_autostart")}</div>
            <div className="text-[11px] text-zinc-500">{t("settings_autostart_desc")}</div>
          </div>
          <button
            type="button"
            onClick={toggleAutostart}
            disabled={autostartLoading}
            className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
              autostart ? "bg-emerald-400" : "bg-zinc-800"
            }`}
          >
            {autostartLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-zinc-400 mx-auto" />
            ) : (
              <motion.div
                animate={{ x: autostart ? 16 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="w-4 h-4 rounded-full bg-zinc-950 shadow-xs"
              />
            )}
          </button>
        </div>

        {/* Close to Tray */}
        <div className="pt-2 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-zinc-300">{t("settings_tray")}</div>
            <div className="text-[11px] text-zinc-500">{t("settings_tray_desc")}</div>
          </div>
          <button
            type="button"
            onClick={toggleCloseToTray}
            className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
              closeToTray ? "bg-emerald-400" : "bg-zinc-800"
            }`}
          >
            <motion.div
              animate={{ x: closeToTray ? 16 : 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="w-4 h-4 rounded-full bg-zinc-950 shadow-xs"
            />
          </button>
        </div>

        {/* Global Hotkey */}
        <div className="pt-2 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-zinc-300">{t("settings_hotkey")}</div>
            <div className="text-[11px] text-zinc-500">{t("settings_hotkey_desc")}</div>
          </div>
          <div className="flex items-center gap-1 font-mono text-[11px] text-zinc-400">
            <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-white/[0.08] rounded">
              Ctrl+Shift+X
            </kbd>
            <span className="text-zinc-600">/</span>
            <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-white/[0.08] rounded">
              Alt+Space
            </kbd>
          </div>
        </div>

        {/* Custom Telegram Bot Token */}
        <div className="pt-2.5 border-t border-white/[0.06] space-y-1">
          <label className="block text-[11px] font-medium text-zinc-400">
            {t("settings_bot_token_label")}
          </label>
          <div className="relative flex items-center">
            <input
              type={showToken ? "text" : "password"}
              value={customTgToken}
              onChange={(e) => {
                setCustomTgToken(e.target.value);
                localStorage.setItem("omnitool_custom_tg_bot_token", e.target.value.trim());
              }}
              placeholder={
                hasBuiltinToken
                  ? t("settings_bot_token_placeholder")
                  : t("settings_bot_token_placeholder_empty")
              }
              className="input-base w-full h-8 font-mono text-xs pr-8 placeholder:text-zinc-600 select-all"
            />
            <button
              type="button"
              onClick={handleToggleShowToken}
              className="absolute right-1.5 z-10 p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
              title={showToken ? t("settings_bot_token_hide") : t("settings_bot_token_show")}
            >
              {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[11px] text-zinc-500">
            {hasBuiltinToken
              ? t("settings_bot_token_desc")
              : t("settings_bot_token_desc_empty")}
          </p>
        </div>
      </div>

      {/* App Updates & About */}
      <div className="pt-2 border-t border-white/[0.06] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 select-none">
            <img src={appLogo} alt="OmniTool" className="w-5 h-5 rounded object-contain shadow-xs" />
            <span className="text-xs font-medium text-zinc-300">
              OmniTool v1.0.0
            </span>
            <span className="text-[10px] text-zinc-400 font-mono px-1.5 py-0.5 bg-zinc-900 border border-white/[0.06] rounded">
              Alpha
            </span>
          </div>

          <button
            type="button"
            onClick={handleCheckUpdates}
            disabled={checkingUpdate}
            className="btn-secondary"
          >
            <RefreshCw className={`w-3 h-3 ${checkingUpdate ? "animate-spin" : ""}`} />
            <span>{t("settings_check_updates")}</span>
          </button>
        </div>

        {/* Auto update on restart toggle */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <div className="text-xs font-medium text-zinc-300">
              {t("settings_auto_update_on_restart")}
            </div>
            <div className="text-[11px] text-zinc-500">
              {t("settings_auto_update_on_restart_desc")}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleAutoUpdateOnRestart}
            className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
              autoUpdateOnRestart ? "bg-emerald-400" : "bg-zinc-800"
            }`}
          >
            <motion.div
              animate={{ x: autoUpdateOnRestart ? 16 : 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="w-4 h-4 rounded-full bg-zinc-950 shadow-xs"
            />
          </button>
        </div>

        {/* Staged update ready notification */}
        {(stagedInfo || updateResult?.has_update) && (
          <div className="p-3 bg-emerald-950/25 border border-emerald-500/30 rounded-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <ArrowDownToLine className="w-3.5 h-3.5 animate-bounce" />
              </div>
              <div>
                <div className="text-xs font-medium text-emerald-300">
                  {t("header_update_ready_tooltip")}
                </div>
                <div className="text-[11px] text-zinc-400 font-mono">
                  {t("settings_update_ready_badge", { version: stagedInfo?.version || updateResult?.latest_version || "v1.0.1" })}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleApplyUpdate}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-md text-xs transition-colors shrink-0 cursor-pointer shadow-sm"
            >
              {t("settings_restart_and_update")}
            </button>
          </div>
        )}

        {updateResult && !updateResult.has_update && (
          <div className="p-2 bg-zinc-900/60 border border-white/[0.06] rounded text-[11px] text-zinc-300 flex items-center gap-1.5 font-mono">
            <Check className="w-3 h-3 text-emerald-400" />
            <span>
              {t("settings_up_to_date", { version: updateResult.current_version })}
            </span>
          </div>
        )}
      </div>

      {/* Warning Modal for Revealing Token */}
      {showWarnModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-start gap-3.5">
                <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                  <ShieldAlert className="w-4.5 h-4.5" />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    {t("settings_token_warn_title")}
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {t("settings_token_warn_text")}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setShowWarnModal(false)}
                  className="btn-secondary h-8 px-3 text-xs cursor-pointer"
                >
                  {t("settings_token_warn_cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowWarnModal(false);
                    setShowToken(true);
                  }}
                  className="btn-primary h-8 px-3 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 cursor-pointer"
                >
                  {t("settings_token_warn_proceed")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
