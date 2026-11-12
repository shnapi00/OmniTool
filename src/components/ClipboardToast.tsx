import React, { useEffect, useState, useRef } from "react";
import { Link2, ArrowRight, X } from "lucide-react";
import { TabId } from "./Sidebar";
import { useTranslation } from "../i18n/useTranslation";

interface ClipboardToastProps {
  onPasteMedia: (url: string, targetTab: TabId) => void;
}

interface ServiceMatch {
  name: string;
  tab: TabId;
}

const matchMediaService = (input: string, defaultMediaText: string): ServiceMatch | null => {
  const text = input.trim();
  if (!text) return null;

  // 0. Telegram stickers
  if (
    /^https?:\/\/(t\.me|telegram\.me)\/addstickers\/[a-zA-Z0-9_-]+/i.test(text) ||
    /^t\.me\/addstickers\/[a-zA-Z0-9_-]+/i.test(text)
  ) {
    return { name: "Telegram", tab: "stickers" };
  }

  // Quick check: must have http://, https:// or look like a domain link
  const isUrl = /^https?:\/\/[^\s]+/i.test(text) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\/[^\s]*/i.test(text);
  if (!isUrl) return null;

  // 1. YouTube (videos, shorts, playlists, music, youtu.be)
  if (/(?:youtube\.com\/(?:watch\?|shorts\/|playlist\?|embed\/|v\/|live\/)|youtu\.be\/)/i.test(text)) {
    return { name: "YouTube", tab: "media_downloader" };
  }

  // 2. TikTok (video, reels, direct shortlinks)
  if (/(?:tiktok\.com\/|vm\.tiktok\.com\/|vt\.tiktok\.com\/)/i.test(text)) {
    return { name: "TikTok", tab: "media_downloader" };
  }

  // 3. Pinterest (pins, boards, pin.it)
  if (/(?:pinterest\.[a-z.]+|pin\.it\/)/i.test(text)) {
    return { name: "Pinterest", tab: "media_downloader" };
  }

  // 4. Instagram (Reels, posts, stories, IGTV)
  if (/(?:instagram\.com\/(?:p|reel|reels|tv|stories)\/|instagr\.am\/)/i.test(text)) {
    return { name: "Instagram", tab: "media_downloader" };
  }

  // 5. Twitter / X (tweets, status, videos)
  if (/(?:(?:twitter\.com|x\.com)\/[^/]+\/status\/|t\.co\/)/i.test(text)) {
    return { name: "Twitter / X", tab: "media_downloader" };
  }

  // 6. Reddit (posts, comments, v.redd.it)
  if (/(?:reddit\.com\/r\/|redd\.it\/|v\.redd\.it\/)/i.test(text)) {
    return { name: "Reddit", tab: "media_downloader" };
  }

  // 7. Twitch (clips, videos, vods)
  if (/(?:twitch\.tv\/|clips\.twitch\.tv\/)/i.test(text)) {
    return { name: "Twitch", tab: "media_downloader" };
  }

  // 8. Vimeo (videos, showcases)
  if (/(?:vimeo\.com\/|player\.vimeo\.com\/)/i.test(text)) {
    return { name: "Vimeo", tab: "media_downloader" };
  }

  // 9. VK (Video, Clips, wall posts)
  if (/(?:vk\.com\/(?:video|clip-|clips|wall)|vkvideo\.ru\/)/i.test(text)) {
    return { name: "VK", tab: "media_downloader" };
  }

  // 10. Rutube (videos, shorts)
  if (/(?:rutube\.ru\/(?:video|shorts|play)\/)/i.test(text)) {
    return { name: "Rutube", tab: "media_downloader" };
  }

  // 11. Facebook (Watch, Reels, videos)
  if (/(?:(?:facebook\.com|fb\.watch|fb\.com)\/(?:watch|reel|videos|[^\s]+\/videos))/i.test(text)) {
    return { name: "Facebook", tab: "media_downloader" };
  }

  // 12. Bilibili (videos, shortlinks b23.tv)
  if (/(?:bilibili\.com\/video\/|b23\.tv\/)/i.test(text)) {
    return { name: "Bilibili", tab: "media_downloader" };
  }

  // 13. SoundCloud (tracks, sets, on.soundcloud.com)
  if (/(?:soundcloud\.com\/|on\.soundcloud\.com\/)/i.test(text)) {
    return { name: "SoundCloud", tab: "media_downloader" };
  }

  // 14. Bandcamp (tracks, albums)
  if (/(?:bandcamp\.com\/(?:track|album)\/|[a-zA-Z0-9_-]+\.bandcamp\.com)/i.test(text)) {
    return { name: "Bandcamp", tab: "media_downloader" };
  }

  // 15. Generic video/media hosting or direct video files
  if (
    /(?:dailymotion\.com|rumble\.com|streamable\.com|odysee\.com|coub\.com)\//i.test(text) ||
    /\.(mp4|webm|mkv|mov|m3u8|mp3|flac|wav|m4a|aac)(\?.*)?$/i.test(text)
  ) {
    return { name: defaultMediaText, tab: "media_downloader" };
  }

  return null;
};

export const ClipboardToast: React.FC<ClipboardToastProps> = ({ onPasteMedia }) => {
  const { t } = useTranslation();
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string>("");
  const [targetTab, setTargetTab] = useState<TabId>("media_downloader");
  const lastProcessedRef = useRef<string>("");

  const checkClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) return;
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();

      if (!trimmed || trimmed === lastProcessedRef.current) return;

      const match = matchMediaService(trimmed, t("toast_src_media"));
      if (match) {
        setDetectedUrl(trimmed);
        setSourceName(match.name);
        setTargetTab(match.tab);
      }
    } catch {
      // Ignore clipboard permission errors silently
    }
  };

  useEffect(() => {
    const handleFocus = () => {
      checkClipboard();
    };

    window.addEventListener("focus", handleFocus);
    // Initial check on startup
    const timer = setTimeout(checkClipboard, 1000);

    return () => {
      window.removeEventListener("focus", handleFocus);
      clearTimeout(timer);
    };
  }, []);

  const handleApply = () => {
    if (detectedUrl) {
      lastProcessedRef.current = detectedUrl;
      onPasteMedia(detectedUrl, targetTab);
      setDetectedUrl(null);
    }
  };

  const handleDismiss = () => {
    if (detectedUrl) {
      lastProcessedRef.current = detectedUrl;
    }
    setDetectedUrl(null);
  };

  if (!detectedUrl) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="bg-dark-900 border border-dark-600 rounded-lg shadow-2xl p-3 flex items-center gap-3 text-xs max-w-sm backdrop-blur-md">
        <div className="p-1.5 bg-dark-800 rounded text-accent shrink-0">
          <Link2 className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-zinc-200 font-medium">
            {t("toast_detected", { source: sourceName })}
          </p>
          <p className="text-[11px] text-zinc-400 truncate font-mono mt-0.5">{detectedUrl}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleApply}
            className="px-2.5 py-1 btn-accent rounded text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>{t("toast_paste_btn")}</span>
            <ArrowRight className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-dark-800 rounded transition-colors cursor-pointer"
            title={t("toast_dismiss")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
