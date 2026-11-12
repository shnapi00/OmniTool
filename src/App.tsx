import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar, TabId } from "./components/Sidebar";
import { Header } from "./components/Header";
import { SplashScreen } from "./components/SplashScreen";
import { ClipboardToast } from "./components/ClipboardToast";
import { SystemToastContainer } from "./components/SystemToastContainer";
import { StickersTab } from "./tabs/StickersTab";
import { BgRemoverTab } from "./tabs/BgRemoverTab";
import { MediaDownloaderTab } from "./tabs/MediaDownloaderTab";
import { ConverterTab } from "./tabs/ConverterTab";
import { OcrTab } from "./tabs/OcrTab";
import { AudioExtractorTab } from "./tabs/AudioExtractorTab";
import { CompressorTab } from "./tabs/CompressorTab";
import { PluginsTab } from "./tabs/PluginsTab";
import { PluginStudioTab } from "./tabs/PluginStudioTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { CustomPluginRunner } from "./components/CustomPluginRunner";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { TranslationProvider, useTranslation } from "./i18n/useTranslation";
import { TabActivityProvider } from "./context/TabActivityContext";
import { playTactileClick } from "./utils/audioFeedback";
import { useMediaDownloaderStore } from "./store/useMediaDownloaderStore";
import { useStickersStore } from "./store/useStickersStore";
import { useModulesStore, BuiltinModuleId } from "./store/useModulesStore";

function MainContent() {
  const { t } = useTranslation();
  const { wallpaperUrl, wallpaperDim, wallpaperBlur, isRgbMode } = useTheme();
  const { builtinStatus, customPlugins, enabledCustomPlugins } = useModulesStore();

  const [activeTab, setActiveTab] = useState<TabId>("stickers");
  const [pendingMediaUrl, setPendingMediaUrl] = useState<string>("");
  const [pendingStickerPack, setPendingStickerPack] = useState<string>("");

  // Subtle Linear-style tactile UI audio feedback on button clicks
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (localStorage.getItem("omnitool_tactile_sounds") !== "true") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.closest(
          "button, [role='button'], input[type='checkbox'], select, .cursor-pointer"
        )
      ) {
        playTactileClick();
      }
    };

    window.addEventListener("click", handleGlobalClick, true);
    return () => window.removeEventListener("click", handleGlobalClick, true);
  }, []);

  // Signal Rust backend to reveal window without white flash
  const handleSplashLoaded = useCallback(() => {
    invoke("app_ready").catch(() => {});
  }, []);

  useEffect(() => {
    invoke("app_ready").catch(() => {});
  }, []);

  // Fallback to first available enabled tab if the current active tab gets disabled
  useEffect(() => {
    const builtinIds: BuiltinModuleId[] = [
      "stickers",
      "bg_remover",
      "media_downloader",
      "converter",
      "ocr",
      "audio_extractor",
      "compressor",
    ];

    if (builtinIds.includes(activeTab as BuiltinModuleId)) {
      if (builtinStatus[activeTab as BuiltinModuleId] === false) {
        const firstEnabled = builtinIds.find((id) => builtinStatus[id] !== false);
        if (firstEnabled) {
          setActiveTab(firstEnabled);
        } else {
          const firstCustom = customPlugins.find(
            (p) => enabledCustomPlugins[p.id] !== false
          );
          if (firstCustom) {
            setActiveTab(`plugin:${firstCustom.id}` as TabId);
          } else {
            setActiveTab("plugins");
          }
        }
      }
    } else if (activeTab.startsWith("plugin:")) {
      const pluginId = activeTab.replace("plugin:", "");
      const exists = customPlugins.some((p) => p.id === pluginId);
      const isEnabled = enabledCustomPlugins[pluginId] !== false;
      if (!exists || !isEnabled) {
        setActiveTab("plugins");
      }
    }
  }, [builtinStatus, customPlugins, enabledCustomPlugins, activeTab]);

  const handlePasteMedia = (url: string, targetTab: TabId) => {
    if (targetTab === "stickers") {
      setPendingStickerPack(url);
      useStickersStore.getState().setPackName(url);
    } else {
      setPendingMediaUrl(url);
      useMediaDownloaderStore.getState().setUrl(url);
    }
    setActiveTab(targetTab);
  };

  const getTabTitle = (tab: TabId): string => {
    if (tab.startsWith("plugin:")) {
      const pluginId = tab.replace("plugin:", "");
      const found = customPlugins.find((p) => p.id === pluginId);
      return found ? found.name : t("tab_plugins");
    }

    switch (tab) {
      case "stickers":
        return t("tab_stickers");
      case "bg_remover":
        return t("tab_bg_remover");
      case "media_downloader":
        return t("tab_downloader");
      case "converter":
        return t("tab_converter");
      case "ocr":
        return t("tab_ocr");
      case "audio_extractor":
        return t("tab_audio_extractor");
      case "compressor":
        return t("tab_compressor");
      case "plugins":
        return t("tab_plugins");
      case "plugin_studio":
        return t("tab_plugin_studio");
      case "settings":
        return t("tab_settings");
      default:
        return t("tab_plugins");
    }
  };

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden font-sans text-zinc-100 antialiased relative transition-colors duration-200 ${
        isRgbMode ? "rgb-active" : ""
      }`}
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {/* Dynamic Custom Wallpaper & Frosted Glass Layer */}
      {wallpaperUrl && (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div
            className="w-full h-full bg-cover bg-center transform scale-105 transition-all duration-300"
            style={{ backgroundImage: `url(${wallpaperUrl})` }}
          />
          <div
            className="absolute inset-0 transition-all duration-300"
            style={{
              backdropFilter: `blur(${wallpaperBlur}px)`,
              WebkitBackdropFilter: `blur(${wallpaperBlur}px)`,
              backgroundColor: `rgba(0, 0, 0, ${wallpaperDim / 100})`,
            }}
          />
        </div>
      )}

      {/* Startup Splashscreen */}
      <SplashScreen onLoaded={handleSplashLoaded} />

      {/* Floating Clipboard Media Link Toast */}
      <ClipboardToast onPasteMedia={handlePasteMedia} />

      {/* Global System Toast Notifications for Plugins & App */}
      <SystemToastContainer />

      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-transparent z-10">
        <Header title={getTabTitle(activeTab)} activeTab={activeTab} />

        <main
          className={`flex-1 min-h-0 ${
            activeTab === "plugin_studio"
              ? "p-0 overflow-hidden flex flex-col"
              : "overflow-y-auto p-3.5"
          }`}
        >
          <div
            className={`h-full ${
              activeTab === "plugin_studio"
                ? "w-full flex-1 flex flex-col min-h-0"
                : "max-w-4xl mx-auto"
            }`}
          >
            {/*
              Persistent Tab Rendering: All tabs stay mounted in DOM!
              Switching tabs simply hides/shows them without unmounting,
              keeping downloads, canvas edits, inputs, and state 100% intact.
            */}
            <div className={activeTab === "stickers" ? "tab-pane-active" : "hidden"}>
              <StickersTab isActive={activeTab === "stickers"} initialPack={pendingStickerPack} />
            </div>

            <div className={activeTab === "bg_remover" ? "tab-pane-active" : "hidden"}>
              <BgRemoverTab isActive={activeTab === "bg_remover"} />
            </div>

            <div className={activeTab === "media_downloader" ? "tab-pane-active" : "hidden"}>
              <MediaDownloaderTab isActive={activeTab === "media_downloader"} initialUrl={pendingMediaUrl} />
            </div>

            <div className={activeTab === "converter" ? "tab-pane-active" : "hidden"}>
              <ConverterTab />
            </div>

            <div className={activeTab === "ocr" ? "tab-pane-active" : "hidden"}>
              <OcrTab isActive={activeTab === "ocr"} />
            </div>

            <div className={activeTab === "audio_extractor" ? "tab-pane-active" : "hidden"}>
              <AudioExtractorTab isActive={activeTab === "audio_extractor"} />
            </div>

            <div className={activeTab === "compressor" ? "tab-pane-active" : "hidden"}>
              <CompressorTab isActive={activeTab === "compressor"} />
            </div>

            <div className={activeTab === "plugins" ? "tab-pane-active" : "hidden"}>
              <PluginsTab onNavigateTab={setActiveTab} />
            </div>

            <div
              className={
                activeTab === "plugin_studio"
                  ? "tab-pane-active h-full w-full !flex !flex-col min-h-0"
                  : "hidden"
              }
            >
              <PluginStudioTab onNavigateTab={setActiveTab} />
            </div>

            <div className={activeTab === "settings" ? "tab-pane-active" : "hidden"}>
              <SettingsTab />
            </div>

            {/* Custom Dynamic Plugin Tab Runner */}
            {activeTab.startsWith("plugin:") && (() => {
              const pluginId = activeTab.replace("plugin:", "");
              const currentPlugin = customPlugins.find((p) => p.id === pluginId);
              return currentPlugin ? (
                <div className="tab-pane-active">
                  <CustomPluginRunner plugin={currentPlugin} />
                </div>
              ) : null;
            })()}
          </div>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <TranslationProvider>
        <TabActivityProvider>
          <MainContent />
        </TabActivityProvider>
      </TranslationProvider>
    </ThemeProvider>
  );
}

export default App;
