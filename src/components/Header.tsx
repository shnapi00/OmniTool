import React, { useState, useEffect } from "react";
import {
  Minus,
  Square,
  X,
  ArrowDownToLine,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "../i18n/useTranslation";
import { useSidebarStore } from "../store/useSidebarStore";

interface HeaderProps {
  title: string;
  activeTab?: string;
}

export const Header: React.FC<HeaderProps> = ({ title }) => {
  const { t } = useTranslation();
  const { isCollapsed, toggleCollapsed } = useSidebarStore();
  const [updateInfo, setUpdateInfo] = useState<{ version: string; ready: boolean } | null>(null);

  useEffect(() => {
    invoke<{ version: string; ready: boolean } | null>("get_staged_update")
      .then((res) => {
        if (res && res.ready) setUpdateInfo(res);
      })
      .catch(() => {});

    const unlisten = listen<{ version: string; ready: boolean }>(
      "update-staged-ready",
      (event) => {
        if (event.payload && event.payload.ready) {
          setUpdateInfo(event.payload);
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleApplyUpdate = async () => {
    try {
      await invoke("apply_update_and_restart");
    } catch (err) {
      console.error("Apply update error:", err);
    }
  };

  const handleHideToTray = async () => {
    try {
      await invoke("hide_window");
    } catch {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.hide();
      } catch (e) {
        console.error("Tray hide error:", e);
      }
    }
  };

  const handleMinimize = async () => {
    try {
      await invoke("minimize_window");
    } catch {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.minimize();
      } catch (e) {
        console.error("Window minimize error:", e);
      }
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await invoke("toggle_maximize_window");
    } catch {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.toggleMaximize();
      } catch (e) {
        console.error("Window maximize error:", e);
      }
    }
  };

  const handleClose = async () => {
    const closeToTray = localStorage.getItem("omnitool_close_to_tray") !== "false";
    if (closeToTray) {
      await handleHideToTray();
    } else {
      try {
        await invoke("close_window");
      } catch {
        try {
          const appWindow = getCurrentWindow();
          await appWindow.destroy();
        } catch (e) {
          console.error("Window close error:", e);
        }
      }
    }
  };

  const handleDragMouseDown = async (e: React.MouseEvent) => {
    // Тягаем только левой кнопкой мыши и только если клик не по кнопкам управления
    if (
      e.button === 0 &&
      !(e.target as HTMLElement).closest(
        'button, input, select, a, [data-tauri-drag-region="false"]'
      )
    ) {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.startDragging();
      } catch (err) {
        console.error("Window drag error:", err);
      }
    }
  };

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
      onDoubleClick={(e) => {
        if (
          e.button === 0 &&
          !(e.target as HTMLElement).closest(
            'button, input, select, a, [data-tauri-drag-region="false"]'
          )
        ) {
          handleToggleMaximize();
        }
      }}
      className="h-8 border-b flex items-center justify-between px-2.5 select-none shrink-0 relative z-30 transition-colors duration-200 cursor-default"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-color)",
      }}
    >
      {/* Left: Sidebar toggle button + Active Section Title */}
      <div
        className="flex items-center gap-2 h-full z-20 text-xs font-medium text-zinc-300"
        data-tauri-drag-region
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          data-tauri-drag-region="false"
          onMouseDown={(e) => e.stopPropagation()}
          title={isCollapsed ? t("sidebar_expand") : t("sidebar_collapse")}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          {isCollapsed ? (
            <PanelLeft className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <PanelLeftClose className="w-3.5 h-3.5" />
          )}
        </button>

        <span
          data-tauri-drag-region
          className="font-medium text-zinc-200 truncate max-w-[200px]"
        >
          {title}
        </span>
      </div>

      {/* Center: OMNITOOL Logo (Geometric Center) */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none z-10"
        data-tauri-drag-region
      >
        <span
          className="text-xs font-semibold tracking-widest text-zinc-400 select-none uppercase pointer-events-none"
          data-tauri-drag-region
        >
          OMNITOOL
        </span>
      </div>

      {/* Right: Window Action Controls */}
      <div
        className="flex items-center gap-1.5 shrink-0 z-40 relative"
        data-tauri-drag-region="false"
      >
        {/* Discord-style Staged Update Indicator */}
        {updateInfo && (
          <button
            type="button"
            onClick={handleApplyUpdate}
            title={t("header_update_ready_tooltip")}
            data-tauri-drag-region="false"
            onMouseDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 hover:border-emerald-400/60 transition-all shadow-[0_0_12px_rgba(16,185,129,0.25)] animate-pulse cursor-pointer group"
          >
            <ArrowDownToLine className="w-3 h-3 text-emerald-400 group-hover:scale-110 transition-transform" />
            <span className="text-[10px] font-mono leading-none">{updateInfo.version || t("header_update_ready")}</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleHideToTray}
          title={t("header_hide_to_tray")}
          data-tauri-drag-region="false"
          onMouseDown={(e) => e.stopPropagation()}
          className="px-1.5 py-0.5 text-[10px] rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1 cursor-pointer"
        >
          <ArrowDownToLine className="w-2.5 h-2.5 text-zinc-400" />
          <span>{t("header_hide_to_tray")}</span>
        </button>

        <button
          type="button"
          onClick={handleMinimize}
          title={t("header_minimize")}
          data-tauri-drag-region="false"
          onMouseDown={(e) => e.stopPropagation()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={handleToggleMaximize}
          title={t("header_maximize")}
          data-tauri-drag-region="false"
          onMouseDown={(e) => e.stopPropagation()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <Square className="w-3 h-3" />
        </button>

        <button
          type="button"
          onClick={handleClose}
          title={t("header_close")}
          data-tauri-drag-region="false"
          onMouseDown={(e) => e.stopPropagation()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-950/70 hover:text-red-300 text-zinc-400 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
