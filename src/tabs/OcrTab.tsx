import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Loader2,
  Copy,
  Check,
  Trash2,
  AlertCircle,
  FileImage,
  Download,
  ScanText,
} from "lucide-react";
import { useTranslation } from "../i18n/useTranslation";
import { useTabActivity } from "../context/TabActivityContext";

export interface OcrLangOption {
  code: string;
  name: string;
  native: string;
}

export const OCR_LANGUAGES: OcrLangOption[] = [
  { code: "ukr", name: "Ukrainian", native: "Українська" },
  { code: "rus", name: "Russian", native: "Русский" },
  { code: "eng", name: "English", native: "English" },
  { code: "pol", name: "Polish", native: "Polski" },
  { code: "deu", name: "German", native: "Deutsch" },
  { code: "fra", name: "French", native: "Français" },
  { code: "spa", name: "Spanish", native: "Español" },
  { code: "ita", name: "Italian", native: "Italiano" },
  { code: "por", name: "Portuguese", native: "Português" },
  { code: "nld", name: "Dutch", native: "Nederlands" },
  { code: "ces", name: "Czech", native: "Čeština" },
  { code: "slk", name: "Slovak", native: "Slovenčina" },
  { code: "hun", name: "Hungarian", native: "Magyar" },
  { code: "ron", name: "Romanian", native: "Română" },
  { code: "bul", name: "Bulgarian", native: "Български" },
  { code: "srp", name: "Serbian", native: "Српски" },
  { code: "hrv", name: "Croatian", native: "Hrvatski" },
  { code: "ell", name: "Greek", native: "Ελληνικά" },
  { code: "tur", name: "Turkish", native: "Türkçe" },
  { code: "ara", name: "Arabic", native: "العربية" },
  { code: "heb", name: "Hebrew", native: "עברית" },
  { code: "hin", name: "Hindi", native: "हिन्दी" },
  { code: "kor", name: "Korean", native: "한국어" },
  { code: "jpn", name: "Japanese", native: "日本語" },
  { code: "chi_sim", name: "Chinese (Simplified)", native: "简体中文" },
  { code: "chi_tra", name: "Chinese (Traditional)", native: "繁體中文" },
  { code: "dan", name: "Danish", native: "Dansk" },
  { code: "swe", name: "Swedish", native: "Svenska" },
  { code: "nor", name: "Norwegian", native: "Norsk" },
  { code: "fin", name: "Finnish", native: "Suomi" },
  { code: "kaz", name: "Kazakh", native: "Қазақша" },
  { code: "bel", name: "Belarusian", native: "Беларуская" },
  { code: "vie", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "tha", name: "Thai", native: "ไทย" },
];

export const getLocalizedLangName = (
  code: string,
  currentLocale: string,
  short: boolean = false
): string => {
  try {
    const intlCode =
      code === "chi_sim"
        ? (short ? "zh" : "zh-Hans")
        : code === "chi_tra"
        ? (short ? "zh" : "zh-Hant")
        : code;
    const dn = new Intl.DisplayNames([currentLocale], { type: "language" });
    const name = dn.of(intlCode);
    if (name) {
      const clean = short ? name.split(/[,(]/)[0].trim() : name;
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    }
  } catch {
    // fallback to default
  }
  const fallback = OCR_LANGUAGES.find((l) => l.code === code);
  return fallback ? fallback.native : code;
};

const QUICK_PRESETS = [
  { code: "ukr+rus+eng" },
  { code: "ukr" },
  { code: "rus" },
  { code: "eng" },
  { code: "pol" },
  { code: "deu" },
  { code: "fra" },
  { code: "spa" },
  { code: "chi_sim" },
  { code: "jpn" },
];

interface DownloadPayload {
  percent: number;
  lang: string;
  status: string;
}

export const OcrTab: React.FC<{ isActive?: boolean }> = ({ isActive = true }) => {
  const { t, lang: appLang } = useTranslation();
  const { setTabProcess } = useTabActivity();
  const [imagePath, setImagePath] = useState<string>("");
  const [lang, setLang] = useState<string>("ukr+rus+eng");
  const [availableLangs, setAvailableLangs] = useState<string[]>(["ukr", "rus", "eng"]);
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadPayload | null>(null);
  const [downloadingLang, setDownloadingLang] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTabProcess("ocr", loading || !!downloadProgress);
  }, [loading, downloadProgress, setTabProcess]);

  const refreshAvailableLangs = useCallback(async () => {
    try {
      const langs = await invoke<string[]>("get_available_ocr_languages");
      setAvailableLangs(langs);
    } catch (err) {
      console.warn("Не удалось получить список языков OCR:", err);
    }
  }, []);

  useEffect(() => {
    refreshAvailableLangs();

    let unlisten: (() => void) | undefined;
    listen<DownloadPayload>("ocr-download-progress", (event) => {
      setDownloadProgress(event.payload);
      if (event.payload.percent >= 100) {
        setTimeout(() => {
          setDownloadProgress(null);
          setDownloadingLang(null);
          refreshAvailableLangs();
        }, 1200);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshAvailableLangs]);

  const handleSelectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("ocr_choose_image_title"),
        filters: [
          {
            name: t("bg_filter_images"),
            extensions: ["png", "jpg", "jpeg", "bmp", "webp"],
          },
        ],
      });

      if (typeof selected === "string") {
        setImagePath(selected);
        setError(null);
      }
    } catch (err) {
      console.error("Ошибка выбора файла:", err);
    }
  };

  const handleProcess = async (pathOverride?: string) => {
    const targetPath = pathOverride || imagePath;
    if (!targetPath.trim()) {
      setError(t("ocr_select_image_error"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const recognized = await invoke<string>("recognize_text", {
        imagePath: targetPath.trim(),
        lang: lang || "ukr+rus+eng",
      });
      setText(recognized);
      refreshAvailableLangs();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setDownloadProgress(null);
    }
  };

  const handlePasteData = useCallback(
    async (file: File) => {
      try {
        setLoading(true);
        setError(null);

        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          try {
            const recognized = await invoke<string>("recognize_base64", {
              base64Data: base64,
              lang: lang || "ukr+rus+eng",
            });
            setImagePath(t("ocr_clipboard_screenshot"));
            setText(recognized);
            refreshAvailableLangs();
          } catch (err) {
            setError(String(err));
          } finally {
            setLoading(false);
            setDownloadProgress(null);
          }
        };
        reader.readAsDataURL(file);
      } catch (err) {
        setError(String(err));
        setLoading(false);
      }
    },
    [lang, refreshAvailableLangs]
  );

  useEffect(() => {
    if (!isActive) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            handlePasteData(file);
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isActive, handlePasteData]);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Ошибка копирования:", err);
    }
  };

  const handleDownloadModel = async (code: string) => {
    try {
      setDownloadingLang(code);
      setError(null);
      await invoke("download_ocr_language", { langCode: code });
      refreshAvailableLangs();
    } catch (err) {
      setError(String(err));
      setDownloadingLang(null);
    }
  };

  // Проверяем, загружены ли все языки для текущего выбора
  const currentLangCodes = lang
    .split(/[\+,]/)
    .map((s) => s.trim())
    .filter((s) => Boolean(s) && s !== "auto");
  const missingLangs = currentLangCodes.filter((code) => !availableLangs.includes(code));
  const isCurrentDownloaded = missingLangs.length === 0;

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-3.5">
      {/* Header */}
      <div className="flex flex-col gap-0.5 border-b border-white/[0.07] pb-2">
        <h2 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
          <span>{t("ocr_title")}</span>
          <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-orange-500/15 text-orange-400 border border-orange-500/25 leading-tight uppercase">
            {t("pre_alpha_badge")}
          </span>
        </h2>
        <p className="text-xs text-zinc-400">
          {t("ocr_desc")}
        </p>
      </div>

      {/* Language Quick Presets */}
      <div className="space-y-1.5 bg-zinc-900/60 border border-white/[0.06] p-2.5 rounded-lg">
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span className="font-medium text-zinc-300">
            {t("ocr_quick_presets")}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            {isCurrentDownloaded ? (
              <span className="text-emerald-400">{t("ocr_status_ready")}</span>
            ) : (
              <span className="text-amber-400">{t("ocr_status_needs_download", { langs: missingLangs.join(", ") })}</span>
            )}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_PRESETS.map((p) => {
            const isSelected = lang === p.code;
            const label =
              p.code === "ukr+rus+eng"
                ? t("ocr_preset_auto")
                : getLocalizedLangName(p.code, appLang, true);
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => setLang(p.code)}
                className={`h-7 px-2.5 text-[11px] rounded transition-colors cursor-pointer border ${
                  isSelected
                    ? "bg-zinc-800 border-zinc-500 text-zinc-100 font-medium shadow-sm"
                    : "bg-zinc-900/50 border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Detailed Dropdown and Download Button */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.05] mt-2">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <span>{t("ocr_all_languages")}</span>
          </div>

          <div className="flex-1 min-w-[200px] flex items-center gap-1.5">
            <select
              value={OCR_LANGUAGES.some((l) => l.code === lang) ? lang : ""}
              onChange={(e) => {
                if (e.target.value) setLang(e.target.value);
              }}
              className="input-base flex-1 h-7 text-[11px] cursor-pointer"
            >
              <option value="" disabled>
                {t("ocr_select_single_lang")}
              </option>
              {OCR_LANGUAGES.map((l) => {
                const isCached = availableLangs.includes(l.code);
                const localizedName = getLocalizedLangName(l.code, appLang);
                return (
                  <option key={l.code} value={l.code}>
                    {localizedName} ({l.native}) {isCached ? "✓" : "↓"}
                  </option>
                );
              })}
            </select>

            {!isCurrentDownloaded && missingLangs.length === 1 && (
              <button
                type="button"
                onClick={() => handleDownloadModel(missingLangs[0])}
                disabled={downloadingLang === missingLangs[0]}
                className="btn-secondary h-7 px-2 text-[11px] shrink-0 flex items-center gap-1.5 text-zinc-300 hover:text-zinc-100 cursor-pointer"
                title={t("ocr_download_pack_title")}
              >
                {downloadingLang === missingLangs[0] ? (
                  <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />
                ) : (
                  <Download className="w-3 h-3 text-zinc-400" />
                )}
                <span>{t("ocr_download_pack_btn", { lang: missingLangs[0] })}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Download Progress Banner */}
      {downloadProgress && (
        <div className="p-2.5 rounded-md bg-blue-950/40 border border-blue-900/50 text-xs text-blue-200 flex flex-col gap-1.5 animate-in fade-in">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              <span>{downloadProgress.status}</span>
            </span>
            <span className="font-mono text-blue-400">{Math.round(downloadProgress.percent)}%</span>
          </div>
          <div className="w-full bg-blue-950/80 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-200"
              style={{ width: `${downloadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          {/* File input */}
          <div className="md:col-span-9 flex gap-1.5">
            <input
              type="text"
              readOnly
              value={imagePath}
              placeholder={t("ocr_dropzone")}
              className="input-base flex-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleSelectFile}
              className="btn-secondary h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              <FileImage className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("common_choose_file")}</span>
            </button>
          </div>

          {/* Recognize button */}
          <div className="md:col-span-3">
            <button
              type="button"
              onClick={() => handleProcess()}
              disabled={!imagePath || loading || !!downloadProgress}
              className="btn-primary w-full h-8 text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ScanText className="w-3.5 h-3.5" />
              )}
              <span>{loading ? t("ocr_recognizing") : t("ocr_process_btn")}</span>
            </button>
          </div>
        </div>

        <p className="text-[11px] text-zinc-500">{t("ocr_paste_hint")}</p>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-2.5 bg-red-950/40 border border-red-900/50 rounded text-xs text-red-300 flex items-center gap-2 font-mono">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Recognized text editor */}
      <div className="border border-white/[0.08] rounded overflow-hidden flex flex-col bg-zinc-950/30">
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-900/80 border-b border-white/[0.08] text-xs">
          <span className="text-zinc-500 font-mono text-[11px]">
            {t("ocr_stats", { chars: charCount, words: wordCount })}
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!text}
              className="btn-secondary h-6 px-2 text-xs flex items-center gap-1 disabled:opacity-40 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">{t("ocr_copied")}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-zinc-400" />
                  <span>{t("ocr_copy_btn")}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setText("")}
              disabled={!text}
              className="btn-secondary h-6 w-6 p-0 flex items-center justify-center disabled:opacity-40 cursor-pointer"
              title={t("ocr_clear_btn")}
            >
              <Trash2 className="w-3 h-3 text-zinc-400" />
            </button>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("ocr_placeholder_text")}
          rows={12}
          className="w-full bg-zinc-950/40 p-3 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none resize-none leading-relaxed"
        />
      </div>
    </div>
  );
};
