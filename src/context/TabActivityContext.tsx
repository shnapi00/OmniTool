import React, { createContext, useContext, useState } from "react";
import { TabId } from "../components/Sidebar";

interface TabActivityContextType {
  activeProcesses: Record<TabId, boolean>;
  setTabProcess: (tab: TabId, isRunning: boolean) => void;
}

const TabActivityContext = createContext<TabActivityContextType | undefined>(undefined);

export const TabActivityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeProcesses, setActiveProcesses] = useState<Record<TabId, boolean>>({
    stickers: false,
    bg_remover: false,
    media_downloader: false,
    converter: false,
    ocr: false,
    audio_extractor: false,
    compressor: false,
    plugins: false,
    plugin_studio: false,
    settings: false,
  });

  const setTabProcess = (tab: TabId, isRunning: boolean) => {
    setActiveProcesses((prev) => ({
      ...prev,
      [tab]: isRunning,
    }));
  };

  return (
    <TabActivityContext.Provider value={{ activeProcesses, setTabProcess }}>
      {children}
    </TabActivityContext.Provider>
  );
};

export const useTabActivity = () => {
  const context = useContext(TabActivityContext);
  if (!context) {
    throw new Error("useTabActivity must be used within a TabActivityProvider");
  }
  return context;
};
