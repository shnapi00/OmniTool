import React, { createContext, useContext, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { translations, Language } from "./translations";

interface TranslationContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: keyof typeof translations.ru, vars?: Record<string, string | number>) => string;
}

const TranslationContext = createContext<TranslationContextType | undefined>(undefined);

export const TranslationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem("omnitool_lang") as Language;
    const supported: Language[] = ["ru", "uk", "en", "de", "pl", "ja"];
    return supported.includes(saved) ? saved : "ru";
  });

  useEffect(() => {
    // Синхронизируем с общим config.json если он установлен инсталлером
    invoke<{ language?: string }>("get_app_config")
      .then((cfg) => {
        const supported: Language[] = ["ru", "uk", "en", "de", "pl", "ja"];
        if (cfg?.language && supported.includes(cfg.language as Language)) {
          if (!localStorage.getItem("omnitool_lang")) {
            setLangState(cfg.language as Language);
            localStorage.setItem("omnitool_lang", cfg.language);
          }
        }
      })
      .catch(() => {});
  }, []);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem("omnitool_lang", newLang);
    invoke("get_app_config")
      .then((cfg: any) => {
        const updated = {
          language: newLang,
          auto_update_on_restart: cfg?.auto_update_on_restart ?? true,
          close_to_tray: cfg?.close_to_tray ?? true,
        };
        invoke("save_app_config", { config: updated }).catch(() => {});
      })
      .catch(() => {});
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = (key: keyof typeof translations.ru, vars?: Record<string, string | number>): string => {
    const dict = (translations[lang] || translations.ru) as Record<string, string>;
    let str = dict[key] || translations.ru[key] || (key as string);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return str;
  };

  return (
    <TranslationContext.Provider value={{ lang, setLang, t }}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error("useTranslation must be used within a TranslationProvider");
  }
  return context;
};
