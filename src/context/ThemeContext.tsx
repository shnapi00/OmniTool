import React, { createContext, useContext, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { TranslationKey } from "../i18n/translations";

export type AppTheme = "oled" | "dark" | "graphite" | "midnight";
// Backward compatibility alias
export type AtmosphereTheme = AppTheme;

export interface ThemeConfig {
  id: AppTheme;
  nameKey: TranslationKey;
  bgBase: string;
  bgSurface: string;
  bgCard: string;
  border: string;
  accent: string;
  accentHover: string;
  accentText: string;
  accentRing: string;
  previewColor: string;
}

export const APP_THEMES: Record<AppTheme, ThemeConfig> = {
  oled: {
    id: "oled",
    nameKey: "theme_oled",
    bgBase: "#000000",
    bgSurface: "#0a0a0c",
    bgCard: "#121214",
    border: "rgba(255, 255, 255, 0.08)",
    accent: "#10b981",
    accentHover: "#059669",
    accentText: "#34d399",
    accentRing: "rgba(16, 185, 129, 0.35)",
    previewColor: "#000000",
  },
  dark: {
    id: "dark",
    nameKey: "theme_dark",
    bgBase: "#09090b",
    bgSurface: "#111114",
    bgCard: "#18181b",
    border: "rgba(255, 255, 255, 0.08)",
    accent: "#10b981",
    accentHover: "#059669",
    accentText: "#34d399",
    accentRing: "rgba(16, 185, 129, 0.35)",
    previewColor: "#09090b",
  },
  graphite: {
    id: "graphite",
    nameKey: "theme_graphite",
    bgBase: "#18181b",
    bgSurface: "#202024",
    bgCard: "#27272a",
    border: "rgba(255, 255, 255, 0.10)",
    accent: "#38bdf8",
    accentHover: "#0284c7",
    accentText: "#7dd3fc",
    accentRing: "rgba(56, 189, 248, 0.35)",
    previewColor: "#18181b",
  },
  midnight: {
    id: "midnight",
    nameKey: "theme_midnight",
    bgBase: "#0b0f19",
    bgSurface: "#111827",
    bgCard: "#172033",
    border: "rgba(255, 255, 255, 0.08)",
    accent: "#60a5fa",
    accentHover: "#3b82f6",
    accentText: "#93c5fd",
    accentRing: "rgba(96, 165, 250, 0.35)",
    previewColor: "#0b0f19",
  },
};

// Alias for backwards compatibility
export const ATMOSPHERE_THEMES = APP_THEMES;

interface ThemeContextType {
  atmosphere: AppTheme;
  theme: AppTheme;
  setAtmosphere: (theme: AppTheme) => void;
  setTheme: (theme: AppTheme) => void;
  wallpaperPath: string | null;
  wallpaperUrl: string | null;
  wallpaperDim: number;
  wallpaperBlur: number;
  setWallpaper: (path: string | null) => void;
  setWallpaperDim: (dim: number) => void;
  setWallpaperBlur: (blur: number) => void;
  isRgbMode: boolean;
  toggleRgbMode: () => void;
  themeConfig: ThemeConfig;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [atmosphere, setAtmosphereState] = useState<AppTheme>(() => {
    const saved = localStorage.getItem("omnitool_theme") || localStorage.getItem("omnitool_atmosphere");
    if (saved && APP_THEMES[saved as AppTheme]) {
      return saved as AppTheme;
    }
    // Backward compatibility mappings
    if (saved === "obsidian") return "dark";
    if (saved === "cyberpunk" || saved === "retro") return "graphite";
    return "dark";
  });

  const [wallpaperPath, setWallpaperPathState] = useState<string | null>(() => {
    return localStorage.getItem("omnitool_wallpaper_path") || null;
  });

  const [wallpaperDim, setWallpaperDimState] = useState<number>(() => {
    const saved = localStorage.getItem("omnitool_wallpaper_dim");
    return saved ? Number(saved) : 40;
  });

  const [wallpaperBlur, setWallpaperBlurState] = useState<number>(() => {
    const saved = localStorage.getItem("omnitool_wallpaper_blur");
    return saved ? Number(saved) : 8;
  });

  const [isRgbMode, setIsRgbMode] = useState<boolean>(() => {
    return localStorage.getItem("omnitool_rgb_mode") === "true";
  });

  const applyAtmosphere = (themeId: AppTheme, rgb: boolean) => {
    const config = APP_THEMES[themeId] || APP_THEMES.dark;
    const root = document.documentElement;

    root.dataset.theme = themeId;
    root.style.setProperty("--bg-base", config.bgBase);
    root.style.setProperty("--bg-surface", config.bgSurface);
    root.style.setProperty("--bg-card", config.bgCard);
    root.style.setProperty("--border-color", config.border);

    if (rgb) {
      root.style.setProperty("--accent", "#a855f7");
      root.style.setProperty("--accent-hover", "#9333ea");
      root.style.setProperty("--accent-text", "#c084fc");
      root.style.setProperty("--accent-bg", "rgba(168, 85, 247, 0.15)");
      root.style.setProperty("--accent-border", "rgba(168, 85, 247, 0.4)");
      root.style.setProperty("--accent-ring", "rgba(168, 85, 247, 0.5)");
    } else {
      root.style.setProperty("--accent", config.accent);
      root.style.setProperty("--accent-hover", config.accentHover);
      root.style.setProperty("--accent-text", config.accentText);
      root.style.setProperty("--accent-bg", `${config.accent}1a`);
      root.style.setProperty("--accent-border", `${config.accent}55`);
      root.style.setProperty("--accent-ring", config.accentRing);
    }

    if (document.body) {
      document.body.style.backgroundColor = config.bgBase;
    }
  };

  useEffect(() => {
    applyAtmosphere(atmosphere, isRgbMode);
  }, [atmosphere, isRgbMode]);

  const setTheme = (nextTheme: AppTheme) => {
    setAtmosphereState(nextTheme);
    localStorage.setItem("omnitool_theme", nextTheme);
    localStorage.setItem("omnitool_atmosphere", nextTheme);
    applyAtmosphere(nextTheme, isRgbMode);
  };

  const setWallpaper = (path: string | null) => {
    setWallpaperPathState(path);
    if (path) {
      localStorage.setItem("omnitool_wallpaper_path", path);
    } else {
      localStorage.removeItem("omnitool_wallpaper_path");
    }
  };

  const setWallpaperDim = (dim: number) => {
    setWallpaperDimState(dim);
    localStorage.setItem("omnitool_wallpaper_dim", String(dim));
  };

  const setWallpaperBlur = (blur: number) => {
    setWallpaperBlurState(blur);
    localStorage.setItem("omnitool_wallpaper_blur", String(blur));
  };

  const toggleRgbMode = () => {
    const next = !isRgbMode;
    setIsRgbMode(next);
    localStorage.setItem("omnitool_rgb_mode", String(next));
    applyAtmosphere(atmosphere, next);
  };

  const wallpaperUrl = wallpaperPath ? convertFileSrc(wallpaperPath) : null;

  return (
    <ThemeContext.Provider
      value={{
        atmosphere,
        theme: atmosphere,
        setAtmosphere: setTheme,
        setTheme,
        wallpaperPath,
        wallpaperUrl,
        wallpaperDim,
        wallpaperBlur,
        setWallpaper,
        setWallpaperDim,
        setWallpaperBlur,
        isRgbMode,
        toggleRgbMode,
        themeConfig: APP_THEMES[atmosphere] || APP_THEMES.dark,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
