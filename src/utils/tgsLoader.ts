import { ungzip } from "pako";
import { invoke } from "@tauri-apps/api/core";

// In-memory cache for decompressed Lottie JSON objects
export const tgsCache = new Map<string, object>();
const inFlightTgs = new Map<string, Promise<object | null>>();

export async function loadTgsAnimation(fileId: string, rawUrl?: string): Promise<object | null> {
  if (tgsCache.has(fileId)) {
    return tgsCache.get(fileId)!;
  }
  if (inFlightTgs.has(fileId)) {
    return inFlightTgs.get(fileId)!;
  }

  const fetchPromise = (async () => {
    try {
      let arrayBuffer: ArrayBuffer | null = null;

      // 1. Try direct fetch if rawUrl is available
      if (rawUrl) {
        try {
          const resp = await fetch(rawUrl);
          if (resp.ok) {
            arrayBuffer = await resp.arrayBuffer();
          }
        } catch {
          // Fall back to Rust backend if CORS or network issue
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

      // 3. Decompress GZIP Lottie JSON via pako
      const unzipped = (ungzip as any)(new Uint8Array(arrayBuffer), { to: "string", toText: true });
      const jsonString = typeof unzipped === "string" ? unzipped : new TextDecoder().decode(unzipped);
      const animationData = JSON.parse(jsonString);

      tgsCache.set(fileId, animationData);
      return animationData;
    } catch (err) {
      console.warn("Failed to load TGS animation for", fileId, err);
      return null;
    } finally {
      inFlightTgs.delete(fileId);
    }
  })();

  inFlightTgs.set(fileId, fetchPromise);
  return fetchPromise;
}
