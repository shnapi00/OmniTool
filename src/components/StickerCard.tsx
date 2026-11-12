import React, { useRef, useEffect, useState } from "react";
import lottie, { AnimationItem } from "lottie-web";
import { invoke } from "@tauri-apps/api/core";
import { Check } from "lucide-react";
import { StickerPreviewItem } from "../store/useStickersStore";
import { loadTgsAnimation } from "../utils/tgsLoader";

// In-memory cache for WebM Blob URLs
const webmBlobCache = new Map<string, string>();
const inFlightWebm = new Map<string, Promise<string | null>>();

async function loadWebmBlobUrl(fileId: string, rawUrl?: string): Promise<string | null> {
  if (webmBlobCache.has(fileId)) {
    return webmBlobCache.get(fileId)!;
  }
  if (inFlightWebm.has(fileId)) {
    return inFlightWebm.get(fileId)!;
  }

  const fetchPromise = (async () => {
    try {
      let arrayBuffer: ArrayBuffer | null = null;

      // 1. Try direct fetch
      if (rawUrl) {
        try {
          const resp = await fetch(rawUrl);
          if (resp.ok) {
            arrayBuffer = await resp.arrayBuffer();
          }
        } catch {
          // Fall back to Rust
        }
      }

      // 2. Fetch via Rust backend if direct fetch failed
      if (!arrayBuffer) {
        const userToken = localStorage.getItem("omnitool_custom_tg_bot_token")?.trim() || null;
        const bytes = await invoke<number[]>("fetch_sticker_bytes", {
          token: userToken,
          fileId,
        });
        arrayBuffer = new Uint8Array(bytes).buffer;
      }

      // 3. Create Blob with explicit video/webm MIME type so Chromium decodes VP9 without header issues
      const blob = new Blob([arrayBuffer], { type: "video/webm" });
      const blobUrl = URL.createObjectURL(blob);
      webmBlobCache.set(fileId, blobUrl);
      return blobUrl;
    } catch (err) {
      console.warn("Failed to load WebM video for", fileId, err);
      return rawUrl || null;
    } finally {
      inFlightWebm.delete(fileId);
    }
  })();

  inFlightWebm.set(fileId, fetchPromise);
  return fetchPromise;
}

interface StickerCardProps {
  sticker: StickerPreviewItem;
  isSelected: boolean;
  onToggle: () => void;
}

export const StickerCard: React.FC<StickerCardProps> = ({
  sticker,
  isSelected,
  onToggle,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lottieContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isInView, setIsInView] = useState(false);
  const [animLoaded, setAnimLoaded] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string>("");

  // IntersectionObserver: Only animate/play when in or near viewport!
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(entry.isIntersecting);
      },
      { rootMargin: "150px" } // Preload 150px ahead of scroll
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // WebM Video Loader
  useEffect(() => {
    if (!sticker.is_video) return;
    let active = true;

    loadWebmBlobUrl(sticker.file_id, sticker.raw_url).then((url) => {
      if (active && url) {
        setVideoSrc(url);
      }
    });

    return () => {
      active = false;
    };
  }, [sticker.is_video, sticker.file_id, sticker.raw_url]);

  // Video Autoplay and Loop Management
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    // Enforce muted property programmatically to bypass Chromium autoplay policy
    video.defaultMuted = true;
    video.muted = true;

    if (isInView) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {});
      }
    } else {
      video.pause();
    }
  }, [videoSrc, isInView]);

  // Lottie Animation for TGS
  useEffect(() => {
    if (!sticker.is_animated) return;
    if (!isInView) return;

    let anim: AnimationItem | null = null;
    let active = true;

    loadTgsAnimation(sticker.file_id, sticker.raw_url).then((animData) => {
      if (!active || !animData || !lottieContainerRef.current) return;

      lottieContainerRef.current.innerHTML = "";
      anim = lottie.loadAnimation({
        container: lottieContainerRef.current,
        renderer: "canvas",
        loop: true,
        autoplay: true,
        animationData: animData,
      });

      setAnimLoaded(true);
    });

    return () => {
      active = false;
      if (anim) {
        anim.destroy();
      }
      setAnimLoaded(false);
    };
  }, [isInView, sticker.file_id, sticker.raw_url, sticker.is_animated]);

  return (
    <div
      ref={containerRef}
      onClick={onToggle}
      style={{
        backgroundImage:
          "linear-gradient(45deg, #141416 25%, transparent 25%), linear-gradient(-45deg, #141416 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #141416 75%), linear-gradient(-45deg, transparent 75%, #141416 75%)",
        backgroundSize: "12px 12px",
        backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0px",
      }}
      className={`group relative aspect-square rounded border transition-all p-1 flex items-center justify-center cursor-pointer select-none overflow-hidden ${
        isSelected
          ? "border-emerald-500/90 ring-1 ring-emerald-500/50 bg-emerald-950/20"
          : "border-white/[0.08] hover:border-white/[0.2] bg-zinc-950/50 opacity-80 hover:opacity-100"
      }`}
    >
      {/* Checkbox indicator */}
      <div
        className={`absolute top-1 right-1 w-4 h-4 rounded flex items-center justify-center z-20 transition-colors ${
          isSelected
            ? "bg-emerald-500 text-zinc-950"
            : "bg-zinc-900/80 border border-white/[0.1] text-transparent group-hover:border-white/[0.3]"
        }`}
      >
        <Check className="w-3 h-3 stroke-[3]" />
      </div>

      {/* Format pill (TGS/WEBM) */}
      {sticker.is_animated && (
        <span className="absolute top-1 left-1 text-[8px] font-mono px-1 py-0.2 rounded bg-purple-950/80 border border-purple-500/40 text-purple-300 z-20">
          TGS
        </span>
      )}
      {sticker.is_video && (
        <span className="absolute top-1 left-1 text-[8px] font-mono px-1 py-0.2 rounded bg-blue-950/80 border border-blue-500/40 text-blue-300 z-20">
          WEBM
        </span>
      )}

      {/* Dynamic Animated/Video/Image Content */}
      {sticker.is_video ? (
        <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-contain pointer-events-none transition-transform group-hover:scale-105"
            />
          ) : (
            sticker.preview_url && (
              <img
                src={sticker.preview_url}
                alt=""
                loading="lazy"
                className="w-full h-full object-contain pointer-events-none"
              />
            )
          )}
        </div>
      ) : sticker.is_animated ? (
        <div className="w-full h-full relative flex items-center justify-center pointer-events-none">
          {/* Lottie Canvas Animation */}
          <div
            ref={lottieContainerRef}
            className={`w-full h-full flex items-center justify-center transition-transform group-hover:scale-105 ${
              animLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
          {/* Static WebP placeholder while uncompressing or when scrolled out */}
          {!animLoaded && sticker.preview_url && (
            <img
              src={sticker.preview_url}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            />
          )}
        </div>
      ) : (
        /* Static WebP Sticker */
        <img
          src={sticker.preview_url}
          loading="lazy"
          alt=""
          className="max-w-full max-h-full object-contain pointer-events-none transition-transform group-hover:scale-105"
          onError={(e) => {
            (e.target as HTMLElement).style.display = "none";
          }}
        />
      )}

      {/* Emoji badge */}
      {sticker.emoji && (
        <span className="absolute bottom-1 right-1 text-[11px] px-1 py-0.2 rounded bg-black/75 backdrop-blur-xs font-sans leading-tight z-20">
          {sticker.emoji}
        </span>
      )}
    </div>
  );
};
