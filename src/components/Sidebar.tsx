import React, { useEffect, useState, useRef } from "react";
import {
  Smile,
  Scissors,
  Video,
  RefreshCw,
  FileText,
  Volume2,
  Minimize2,
  Puzzle,
  Settings,
  Loader2,
  Wrench,
} from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "../i18n/useTranslation";
import { useTabActivity } from "../context/TabActivityContext";
import { useModulesStore, BuiltinModuleId } from "../store/useModulesStore";
import { useSidebarStore } from "../store/useSidebarStore";
import { getPluginIcon } from "../utils/getPluginIcon";
import { CircularProgress } from "./CircularProgress";

export type TabId =
  | "stickers"
  | "bg_remover"
  | "media_downloader"
  | "converter"
  | "ocr"
  | "audio_extractor"
  | "compressor"
  | "plugins"
  | "plugin_studio"
  | "settings"
  | `plugin:${string}`;

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
}) => {
  const { t } = useTranslation();
  const { activeProcesses } = useTabActivity();
  const { builtinStatus, customPlugins, enabledCustomPlugins, pluginDeps, sidebarWidgets, loadPlugins } =
    useModulesStore();
  const { isCollapsed, sidebarWidth, setSidebarWidth, setIsCollapsed } =
    useSidebarStore();

  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ startX: number; startWidth: number }>({
    startX: 0,
    startWidth: sidebarWidth,
  });

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  // Handle manual dragging of right border to resize sidebar
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartRef.current = {
      startX: e.clientX,
      startWidth: sidebarWidth,
    };
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizeStartRef.current.startX;
      const targetWidth = resizeStartRef.current.startWidth + deltaX;

      if (targetWidth < 140) {
        setIsCollapsed(true);
      } else {
        if (isCollapsed) {
          setIsCollapsed(false);
        }
        setSidebarWidth(targetWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, isCollapsed, setIsCollapsed, setSidebarWidth]);

  // Built-in tools that are currently enabled
  const builtinItems = [
    {
      id: "stickers" as TabId,
      name: t("tab_stickers"),
      icon: Smile,
      pluginId: undefined,
      isPreAlpha: false,
    },
    {
      id: "bg_remover" as TabId,
      name: t("tab_bg_remover"),
      icon: Scissors,
      pluginId: undefined,
      isPreAlpha: true,
    },
    {
      id: "media_downloader" as TabId,
      name: t("tab_downloader"),
      icon: Video,
      pluginId: undefined,
      isPreAlpha: false,
    },
    {
      id: "converter" as TabId,
      name: t("tab_converter"),
      icon: RefreshCw,
      pluginId: undefined,
      isPreAlpha: false,
    },
    {
      id: "ocr" as TabId,
      name: t("tab_ocr"),
      icon: FileText,
      pluginId: undefined,
      isPreAlpha: true,
    },
    {
      id: "audio_extractor" as TabId,
      name: t("tab_audio_extractor"),
      icon: Volume2,
      pluginId: undefined,
      isPreAlpha: false,
    },
    {
      id: "compressor" as TabId,
      name: t("tab_compressor"),
      icon: Minimize2,
      pluginId: undefined,
      isPreAlpha: false,
    },
  ].filter((item) => builtinStatus[item.id as BuiltinModuleId] !== false);

  // Custom user plugins that are currently enabled
  const customItems = customPlugins
    .filter((p) => enabledCustomPlugins[p.id] !== false)
    .map((p) => ({
      id: `plugin:${p.id}` as TabId,
      name: p.name,
      icon: getPluginIcon(p.icon),
      pluginId: p.id,
      isPreAlpha: false,
    }));

  const allNavItems = [...builtinItems, ...customItems];

  return (
    <motion.aside
      initial={false}
      animate={{ width: isCollapsed ? 56 : sidebarWidth }}
      transition={
        isResizing
          ? { duration: 0 }
          : { type: "spring", stiffness: 380, damping: 32 }
      }
      className={`backdrop-blur-md border-r flex flex-col justify-between p-2 select-none shrink-0 z-20 relative overflow-hidden ${
        isCollapsed ? "items-center" : ""
      }`}
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-color)",
      }}
    >
      {/* Resizer Handle on right border (only active when not collapsed) */}
      {!isCollapsed && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-emerald-500/40 active:bg-emerald-500 transition-colors z-30 group"
          title={t("sidebar_resize_tooltip")}
        >
          <div className="w-[1.5px] h-full mx-auto group-hover:bg-emerald-500 transition-colors" />
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 w-full pt-1 sidebar-scroll-container">
        {/* Navigation items */}
        <nav className="space-y-0.5 w-full">
          {allNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isRunning = activeProcesses[item.id];
            const depState = item.pluginId ? pluginDeps[item.pluginId] : undefined;
            const widget = item.pluginId ? sidebarWidgets[item.pluginId] : undefined;

            if (isCollapsed) {
              return (
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  title={item.name}
                  className="w-full flex items-center justify-center p-2 rounded-md cursor-pointer relative group"
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeNavPillCollapsed"
                      className="absolute inset-0 bg-zinc-800 rounded-md shadow-xs border border-white/[0.08]"
                      transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    />
                  )}
                  <Icon
                    className={`w-4 h-4 shrink-0 relative z-10 transition-all group-hover:scale-110 ${
                      isActive ? "text-emerald-400" : "text-zinc-400 group-hover:text-zinc-200"
                    }`}
                  />

                  {/* Plugin Custom Widget Badge (Collapsed) */}
                  {widget?.badge !== undefined && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full text-[9px] font-mono bg-emerald-500 text-black font-bold flex items-center justify-center leading-none z-20 shadow-xs">
                      {widget.badge}
                    </span>
                  )}

                  {/* Plugin Custom Widget Status dot (Collapsed) */}
                  {widget?.status && !widget?.badge && (
                    <span
                      className={`absolute bottom-1 right-1 w-2 h-2 rounded-full z-20 ${
                        widget.status === "error"
                          ? "bg-red-500"
                          : widget.status === "working"
                          ? "bg-amber-400 animate-pulse"
                          : "bg-emerald-400"
                      }`}
                      style={widget.color ? { backgroundColor: widget.color } : undefined}
                    />
                  )}

                  {/* Pre-alpha indicator dot */}
                  {item.isPreAlpha && (
                    <span
                      className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-orange-400 z-20"
                      title={t("pre_alpha_badge")}
                    />
                  )}

                  {/* Activity spinner */}
                  {isRunning && (
                    <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping z-20" />
                  )}

                  {/* Plugin install progress */}
                  {depState?.isInstalling && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-md z-20">
                      <CircularProgress
                        percent={depState.percent}
                        size={16}
                        strokeWidth={2}
                        isInstalling={true}
                      />
                    </div>
                  )}
                </motion.button>
              );
            }

            return (
              <motion.button
                whileTap={{ scale: 0.98 }}
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer relative group"
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNavPillExpanded"
                    className="absolute inset-0 bg-zinc-800/85 rounded-md border border-white/[0.08] shadow-xs"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 relative z-10 transition-all group-hover:translate-x-0.5 ${
                    isActive ? "text-emerald-400" : "text-zinc-400 group-hover:text-zinc-200"
                  }`}
                />
                <span
                  className={`truncate flex-1 min-w-0 relative z-10 transition-all group-hover:translate-x-0.5 ${
                    isActive
                      ? "text-zinc-100 font-medium"
                      : "text-zinc-400 group-hover:text-zinc-200 font-normal"
                  }`}
                >
                  {item.name}
                </span>

                {item.isPreAlpha && (
                  <span className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/25 leading-none uppercase shrink-0 whitespace-nowrap relative z-10">
                    {t("pre_alpha_badge")}
                  </span>
                )}

                {/* Plugin Custom Widget Badge / Status (Expanded) */}
                {widget?.badge !== undefined && (
                  <span
                    className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 leading-none shrink-0 relative z-10"
                    style={widget.color ? { borderColor: `${widget.color}55`, color: widget.color } : undefined}
                  >
                    {widget.badge}
                  </span>
                )}
                {widget?.status && widget?.badge === undefined && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 relative z-10 ${
                      widget.status === "error"
                        ? "bg-red-400"
                        : widget.status === "working"
                        ? "bg-amber-400 animate-ping"
                        : "bg-emerald-400"
                    }`}
                    style={widget.color ? { backgroundColor: widget.color } : undefined}
                  />
                )}

                {/* Circular Progress for Plugin Dependency Installation */}
                {(() => {
                  if (depState?.isInstalling) {
                    return (
                      <div className="relative z-10">
                        <CircularProgress
                          percent={depState.percent}
                          size={14}
                          strokeWidth={2}
                          isInstalling={true}
                          title={
                            depState.status === "installing"
                              ? t("deps_installing")
                              : depState.status === "checking"
                              ? t("deps_checking")
                              : depState.status === "ready"
                              ? t("deps_ready")
                              : depState.currentStatus
                          }
                        />
                      </div>
                    );
                  }
                  if (isRunning) {
                    return (
                      <Loader2 className="w-3 h-3 text-emerald-400 animate-spin shrink-0 relative z-10" />
                    );
                  }
                  return null;
                })()}
              </motion.button>
            );
          })}
        </nav>
      </div>

      {/* Bottom section with Settings & Plugins Manager */}
      <div
        className="space-y-0.5 border-t pt-1.5 shrink-0 transition-colors duration-200 w-full overflow-hidden"
        style={{ borderColor: "var(--border-color)" }}
      >
        {isCollapsed ? (
          <>
            {/* Plugin Studio Button */}
            <motion.button
              whileTap={{ scale: 0.94 }}
              type="button"
              onClick={() => onTabChange("plugin_studio")}
              title={t("tab_plugin_studio")}
              className="w-full flex items-center justify-center p-2 rounded-md cursor-pointer relative group"
            >
              {activeTab === "plugin_studio" && (
                <motion.div
                  layoutId="activeBottomPillCollapsed"
                  className="absolute inset-0 bg-zinc-800 rounded-md shadow-xs border border-white/[0.08]"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <Wrench
                className={`w-4 h-4 shrink-0 relative z-10 transition-all group-hover:scale-110 ${
                  activeTab === "plugin_studio" ? "text-emerald-400" : "text-zinc-400 group-hover:text-zinc-200"
                }`}
              />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.94 }}
              type="button"
              onClick={() => onTabChange("plugins")}
              title={t("tab_plugins")}
              className="w-full flex items-center justify-center p-2 rounded-md cursor-pointer relative group"
            >
              {activeTab === "plugins" && (
                <motion.div
                  layoutId="activeBottomPillCollapsed"
                  className="absolute inset-0 bg-zinc-800 rounded-md shadow-xs border border-white/[0.08]"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <Puzzle
                className={`w-4 h-4 shrink-0 relative z-10 transition-all group-hover:scale-110 ${
                  activeTab === "plugins" ? "text-emerald-400" : "text-zinc-400 group-hover:text-zinc-200"
                }`}
              />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.94 }}
              type="button"
              onClick={() => onTabChange("settings")}
              title={t("tab_settings")}
              className="w-full flex items-center justify-center p-2 rounded-md cursor-pointer relative group"
            >
              {activeTab === "settings" && (
                <motion.div
                  layoutId="activeBottomPillCollapsed"
                  className="absolute inset-0 bg-zinc-800 rounded-md shadow-xs border border-white/[0.08]"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <Settings
                className={`w-4 h-4 shrink-0 relative z-10 transition-all group-hover:scale-110 ${
                  activeTab === "settings" ? "text-emerald-400" : "text-zinc-400 group-hover:text-zinc-200"
                }`}
              />
            </motion.button>
          </>
        ) : (
          <>
            {/* Plugin Studio Button */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => onTabChange("plugin_studio")}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer relative group"
            >
              {activeTab === "plugin_studio" && (
                <motion.div
                  layoutId="activeBottomPillExpanded"
                  className="absolute inset-0 bg-zinc-800/85 rounded-md border border-white/[0.08] shadow-xs"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <Wrench
                className={`w-3.5 h-3.5 shrink-0 relative z-10 transition-all group-hover:translate-x-0.5 ${
                  activeTab === "plugin_studio" ? "text-emerald-400" : "text-zinc-400 group-hover:text-zinc-200"
                }`}
              />
              <span className={`truncate relative z-10 transition-all group-hover:translate-x-0.5 ${
                activeTab === "plugin_studio" ? "text-zinc-100 font-medium" : "text-zinc-400 group-hover:text-zinc-200"
              }`}>
                {t("tab_plugin_studio")}
              </span>
            </motion.button>

            {/* Plugins Manager Button */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => onTabChange("plugins")}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer relative group"
            >
              {activeTab === "plugins" && (
                <motion.div
                  layoutId="activeBottomPillExpanded"
                  className="absolute inset-0 bg-zinc-800/85 rounded-md border border-white/[0.08] shadow-xs"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <Puzzle
                className={`w-3.5 h-3.5 shrink-0 relative z-10 transition-all group-hover:translate-x-0.5 ${
                  activeTab === "plugins" ? "text-emerald-400" : "text-zinc-400 group-hover:text-zinc-200"
                }`}
              />
              <span className={`truncate relative z-10 transition-all group-hover:translate-x-0.5 ${
                activeTab === "plugins" ? "text-zinc-100 font-medium" : "text-zinc-400 group-hover:text-zinc-200"
              }`}>
                {t("tab_plugins")}
              </span>
            </motion.button>

            {/* Settings Button */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => onTabChange("settings")}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer relative group"
            >
              {activeTab === "settings" && (
                <motion.div
                  layoutId="activeBottomPillExpanded"
                  className="absolute inset-0 bg-zinc-800/85 rounded-md border border-white/[0.08] shadow-xs"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <Settings
                className={`w-3.5 h-3.5 shrink-0 relative z-10 transition-all group-hover:translate-x-0.5 ${
                  activeTab === "settings" ? "text-emerald-400" : "text-zinc-400 group-hover:text-zinc-200"
                }`}
              />
              <span className={`truncate relative z-10 transition-all group-hover:translate-x-0.5 ${
                activeTab === "settings" ? "text-zinc-100 font-medium" : "text-zinc-400 group-hover:text-zinc-200"
              }`}>
                {t("tab_settings")}
              </span>
            </motion.button>
          </>
        )}
      </div>
    </motion.aside>
  );
};
