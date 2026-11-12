import React, { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  FileImage,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eraser,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  Brush,
  RotateCcw,
  Sparkles,
  Sliders,
  Eye,
  X,
  Info,
} from "lucide-react";
import { useTranslation } from "../i18n/useTranslation";
import { useTabActivity } from "../context/TabActivityContext";

interface BgResult {
  success: boolean;
  output_path: string;
  orig_path?: string;
  processing_time_ms: number;
  method: string;
  message: string;
}

type ToolType = "smart_eraser" | "smart_brush";

export const BgRemoverTab: React.FC<{ isActive?: boolean }> = ({ isActive = true }) => {
  const { t } = useTranslation();
  const { setTabProcess } = useTabActivity();
  const [inputPath, setInputPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BgResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const isCancelledByUserRef = useRef(false);

  useEffect(() => {
    setTabProcess("bg_remover", loading);
  }, [loading, setTabProcess]);

  // Canvas Editor States
  const [tool, setTool] = useState<ToolType>("smart_eraser");
  const [smartMode, setSmartMode] = useState<boolean>(true);
  const [brushSize, setBrushSize] = useState<number>(30);
  const [feather, setFeather] = useState<number>(2);
  const [showMask, setShowMask] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Cursor indicator on canvas
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });

  // Canvas and Buffer Refs
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const origPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const maskRef = useRef<Uint8Array | null>(null);
  const aiInitialMaskRef = useRef<Uint8Array | null>(null);
  const renderImageDataRef = useRef<ImageData | null>(null);
  const imgDimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // Undo / Redo history of alpha masks
  const historyRef = useRef<Uint8Array[]>([]);
  const redoRef = useRef<Uint8Array[]>([]);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const updateHistoryState = () => {
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(redoRef.current.length > 0);
  };

  const pushHistory = () => {
    if (!maskRef.current) return;
    if (historyRef.current.length >= 25) {
      historyRef.current.shift();
    }
    historyRef.current.push(new Uint8Array(maskRef.current));
    redoRef.current = [];
    updateHistoryState();
  };

  // Re-render a specific rectangular region of the canvas
  const renderRect = useCallback(
    (minX: number, minY: number, maxX: number, maxY: number) => {
      const canvas = canvasRef.current;
      const orig = origPixelsRef.current;
      const mask = maskRef.current;
      const imgData = renderImageDataRef.current;
      if (!canvas || !orig || !mask || !imgData) return;

      const { w, h } = imgDimsRef.current;
      if (w === 0 || h === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const x0 = Math.max(0, Math.floor(minX));
      const y0 = Math.max(0, Math.floor(minY));
      const x1 = Math.min(w - 1, Math.ceil(maxX));
      const y1 = Math.min(h - 1, Math.ceil(maxY));

      const data = imgData.data;

      if (!showMask) {
        // Normal mode: transparent PNG over checkerboard
        for (let y = y0; y <= y1; y++) {
          const rowOffset = y * w;
          for (let x = x0; x <= x1; x++) {
            const idx = rowOffset + x;
            const px = idx * 4;
            data[px] = orig[px];
            data[px + 1] = orig[px + 1];
            data[px + 2] = orig[px + 2];
            data[px + 3] = mask[idx];
          }
        }
      } else {
        // Mask Overlay mode: removed background tinted ruby-red, kept object natural
        for (let y = y0; y <= y1; y++) {
          const rowOffset = y * w;
          for (let x = x0; x <= x1; x++) {
            const idx = rowOffset + x;
            const px = idx * 4;
            const r = orig[px];
            const g = orig[px + 1];
            const b = orig[px + 2];
            const a = mask[idx];

            if (a < 128) {
              // Deleted background: ruby tint
              data[px] = Math.round(r * 0.45 + 239 * 0.55);
              data[px + 1] = Math.round(g * 0.45 + 68 * 0.55);
              data[px + 2] = Math.round(b * 0.45 + 68 * 0.55);
              data[px + 3] = 255;
            } else {
              // Kept object: normal color
              data[px] = r;
              data[px + 1] = g;
              data[px + 2] = b;
              data[px + 3] = 255;
            }
          }
        }
      }

      ctx.putImageData(imgData, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    },
    [showMask]
  );

  // Full re-render when showMask toggles
  useEffect(() => {
    const { w, h } = imgDimsRef.current;
    if (w > 0 && h > 0) {
      renderRect(0, 0, w - 1, h - 1);
    }
  }, [showMask, renderRect]);

  const handleUndo = () => {
    if (!maskRef.current || historyRef.current.length === 0) return;
    const current = new Uint8Array(maskRef.current);
    redoRef.current.push(current);

    const prev = historyRef.current.pop();
    if (prev) {
      maskRef.current.set(prev);
      const { w, h } = imgDimsRef.current;
      renderRect(0, 0, w - 1, h - 1);
    }
    updateHistoryState();
  };

  const handleRedo = () => {
    if (!maskRef.current || redoRef.current.length === 0) return;
    const current = new Uint8Array(maskRef.current);
    historyRef.current.push(current);

    const next = redoRef.current.pop();
    if (next) {
      maskRef.current.set(next);
      const { w, h } = imgDimsRef.current;
      renderRect(0, 0, w - 1, h - 1);
    }
    updateHistoryState();
  };

  const handleResetMask = () => {
    if (!maskRef.current || !aiInitialMaskRef.current) return;
    pushHistory();
    maskRef.current.set(aiInitialMaskRef.current);
    const { w, h } = imgDimsRef.current;
    renderRect(0, 0, w - 1, h - 1);
  };

  // Keyboard shortcuts (Ctrl+Z, Ctrl+Y, [, ])
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      } else if (e.key === "[") {
        setBrushSize((s) => Math.max(5, s - 5));
      } else if (e.key === "]") {
        setBrushSize((s) => Math.min(100, s + 5));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Load transparent PNG and original source image onto canvas buffers
  useEffect(() => {
    if (!result?.output_path || !result.success) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const sourcePath = result.orig_path || inputPath;
    if (!sourcePath) return;

    const origImg = new Image();
    origImg.crossOrigin = "anonymous";
    origImg.src = convertFileSrc(sourcePath);

    origImg.onload = () => {
      const w = origImg.naturalWidth;
      const h = origImg.naturalHeight;
      imgDimsRef.current = { w, h };
      canvas.width = w;
      canvas.height = h;

      // Extract original RGB pixels
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
      if (!offCtx) return;
      offCtx.drawImage(origImg, 0, 0);
      const origData = offCtx.getImageData(0, 0, w, h);
      origPixelsRef.current = new Uint8ClampedArray(origData.data);

      // Load AI transparent cutout to extract initial alpha mask
      const aiImg = new Image();
      aiImg.crossOrigin = "anonymous";
      aiImg.src = convertFileSrc(result.output_path);

      aiImg.onload = () => {
        offCtx.clearRect(0, 0, w, h);
        offCtx.drawImage(aiImg, 0, 0);
        const aiData = offCtx.getImageData(0, 0, w, h);

        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          mask[i] = aiData.data[i * 4 + 3];
        }

        maskRef.current = mask;
        aiInitialMaskRef.current = new Uint8Array(mask);
        renderImageDataRef.current = ctx.createImageData(w, h);

        historyRef.current = [];
        redoRef.current = [];
        updateHistoryState();

        renderRect(0, 0, w - 1, h - 1);
      };
    };
  }, [result, inputPath, renderRect]);

  // Global Ctrl+V clipboard image paste handler
  const handlePasteData = useCallback(async (file: File) => {
    try {
      isCancelledByUserRef.current = false;
      setCancelNotice(null);
      setLoading(true);
      setError(null);
      setSaveSuccess(null);

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        try {
          const res = await invoke<BgResult>("remove_background_base64", {
            base64Data: base64,
          });
          if (isCancelledByUserRef.current) return;
          setInputPath(t("bg_clipboard_screenshot"));
          setResult(res);
        } catch (err) {
          const errStr = String(err);
          if (
            isCancelledByUserRef.current ||
            errStr.includes("TASK_CANCELLED_BY_USER") ||
            errStr.toLowerCase().includes("отменен") ||
            errStr.toLowerCase().includes("cancel")
          ) {
            setError(null);
            const notice = t("bg_cancelled");
            setCancelNotice(notice);
            setTimeout(() => {
              setCancelNotice(null);
              isCancelledByUserRef.current = false;
            }, 2500);
          } else {
            setError(errStr);
          }
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }, [t]);

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

  const handleSelectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("bg_choose_image_title"),
        filters: [
          {
            name: t("bg_filter_images"),
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });

      if (typeof selected === "string") {
        setInputPath(selected);
        setResult(null);
        setError(null);
        setSaveSuccess(null);
      }
    } catch (err) {
      console.error("Ошибка открытия файла:", err);
    }
  };

  const handleCancelProcess = async () => {
    isCancelledByUserRef.current = true;
    setLoading(false);
    setError(null);
    const notice = t("bg_cancelled");
    setCancelNotice(notice);
    setTimeout(() => {
      setCancelNotice(null);
      isCancelledByUserRef.current = false;
    }, 2500);

    try {
      await invoke("cancel_task", { taskType: "bg_remover" });
    } catch (err) {
      console.error(err);
    }
  };

  const handleProcess = async () => {
    if (!inputPath.trim()) {
      setError(t("bg_choose_source_error"));
      return;
    }

    isCancelledByUserRef.current = false;
    setCancelNotice(null);
    setLoading(true);
    setError(null);
    setSaveSuccess(null);

    try {
      const res = await invoke<BgResult>("remove_background", {
        inputPath: inputPath.trim(),
        outputPath: "",
      });
      if (isCancelledByUserRef.current) return;
      setResult(res);
    } catch (err) {
      const errStr = String(err);
      if (
        isCancelledByUserRef.current ||
        errStr.includes("TASK_CANCELLED_BY_USER") ||
        errStr.toLowerCase().includes("отменен") ||
        errStr.toLowerCase().includes("cancel")
      ) {
        setError(null);
        const notice = t("bg_cancelled");
        setCancelNotice(notice);
        setTimeout(() => {
          setCancelNotice(null);
          isCancelledByUserRef.current = false;
        }, 2500);
      } else {
        setError(errStr);
      }
    } finally {
      setLoading(false);
    }
  };

  // Canvas Coordinates from Pointer Event
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // Color Euclidean Distance Helper with Perceptual Weighting
  const colorDist = (
    r1: number,
    g1: number,
    b1: number,
    r2: number,
    g2: number,
    b2: number
  ) => {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
  };

  // Smart Context-Aware Edge-Preserving Brush Stroke
  const applyBrush = (cx: number, cy: number) => {
    const orig = origPixelsRef.current;
    const mask = maskRef.current;
    const { w, h } = imgDimsRef.current;
    if (!orig || !mask || w === 0 || h === 0) return;

    const radius = brushSize / 2;
    const radiusSq = radius * radius;

    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(w - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(h - 1, Math.ceil(cy + radius));

    const centerPx = (Math.round(cy) * w + Math.round(cx)) * 4;
    const seedR = orig[centerPx] ?? 128;
    const seedG = orig[centerPx + 1] ?? 128;
    const seedB = orig[centerPx + 2] ?? 128;

    const lw = maxX - minX + 1;
    const lh = maxY - minY + 1;

    if (!smartMode) {
      // Standard Direct Brush without Edge Snapping
      for (let y = minY; y <= maxY; y++) {
        const dy = y - cy;
        const rowOffset = y * w;
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx;
          const dSq = dx * dx + dy * dy;
          if (dSq <= radiusSq) {
            const d = Math.sqrt(dSq);
            let factor = 1.0;
            if (feather > 0 && d > radius - feather) {
              factor = Math.max(0, (radius - d) / feather);
            }
            const idx = rowOffset + x;
            if (tool === "smart_eraser") {
              const target = Math.round(mask[idx] * (1.0 - factor));
              mask[idx] = Math.min(mask[idx], target);
            } else {
              const target = Math.round(255 * factor);
              mask[idx] = Math.max(mask[idx], target);
            }
          }
        }
      }
    } else {
      // Smart Context-Aware Brush: Local BFS Flood-Fill with Contour Snapping
      const visited = new Uint8Array(lw * lh);
      const queueX: number[] = [];
      const queueY: number[] = [];

      const startLx = Math.round(cx) - minX;
      const startLy = Math.round(cy) - minY;

      if (startLx >= 0 && startLx < lw && startLy >= 0 && startLy < lh) {
        visited[startLy * lw + startLx] = 1;
        queueX.push(startLx);
        queueY.push(startLy);
      }

      // Edge contrast tolerance: allows smooth gradients, strictly halts at sharp object contours
      const maxSeedTolerance = 36;
      const maxEdgeTolerance = 28;

      let head = 0;
      while (head < queueX.length) {
        const lx = queueX[head];
        const ly = queueY[head];
        head++;

        const curGx = minX + lx;
        const curGy = minY + ly;
        const curPx = (curGy * w + curGx) * 4;
        const curR = orig[curPx];
        const curG = orig[curPx + 1];
        const curB = orig[curPx + 2];

        const neighbors = [
          [lx + 1, ly],
          [lx - 1, ly],
          [lx, ly + 1],
          [lx, ly - 1],
        ];

        for (let n = 0; n < 4; n++) {
          const nLx = neighbors[n][0];
          const nLy = neighbors[n][1];

          if (nLx >= 0 && nLx < lw && nLy >= 0 && nLy < lh) {
            const vIdx = nLy * lw + nLx;
            if (visited[vIdx] === 0) {
              const nGx = minX + nLx;
              const nGy = minY + nLy;
              const dx = nGx - cx;
              const dy = nGy - cy;

              if (dx * dx + dy * dy <= radiusSq) {
                const nPx = (nGy * w + nGx) * 4;
                const nr = orig[nPx];
                const ng = orig[nPx + 1];
                const nb = orig[nPx + 2];

                const diffSeed = colorDist(nr, ng, nb, seedR, seedG, seedB);
                const diffEdge = colorDist(nr, ng, nb, curR, curG, curB);

                if (diffEdge <= maxEdgeTolerance && diffSeed <= maxSeedTolerance) {
                  visited[vIdx] = 1;
                  queueX.push(nLx);
                  queueY.push(nLy);
                }
              }
            }
          }
        }
      }

      // Apply alpha modifications to all reached pixels
      for (let ly = 0; ly < lh; ly++) {
        const gy = minY + ly;
        const rowOffset = gy * w;
        for (let lx = 0; lx < lw; lx++) {
          if (visited[ly * lw + lx] === 1) {
            const gx = minX + lx;
            const dx = gx - cx;
            const dy = gy - cy;
            const dist = Math.hypot(dx, dy);

            let factor = 1.0;
            if (feather > 0 && dist > radius - feather) {
              factor = Math.max(0, (radius - dist) / feather);
            }

            const idx = rowOffset + gx;
            if (tool === "smart_eraser") {
              const target = Math.round(mask[idx] * (1.0 - factor));
              mask[idx] = Math.min(mask[idx], target);
            } else {
              const target = Math.round(255 * factor);
              mask[idx] = Math.max(mask[idx], target);
            }
          }
        }
      }
    }

    // High performance dirty rect canvas update
    renderRect(minX, minY, maxX, maxY);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!result || !maskRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pushHistory();
    isDrawingRef.current = true;
    const coords = getCanvasCoords(e);
    lastPosRef.current = coords;
    applyBrush(coords.x, coords.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Update floating circle cursor coordinates
    const viewport = viewportRef.current;
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      setCursorPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        visible: true,
      });
    }

    if (!isDrawingRef.current || !result || !maskRef.current) return;
    const coords = getCanvasCoords(e);

    if (lastPosRef.current) {
      const dx = coords.x - lastPosRef.current.x;
      const dy = coords.y - lastPosRef.current.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(3, brushSize / 4);
      const steps = Math.ceil(dist / step);

      for (let i = 1; i <= steps; i++) {
        const interpX = lastPosRef.current.x + (dx * i) / steps;
        const interpY = lastPosRef.current.y + (dy * i) / steps;
        applyBrush(interpX, interpY);
      }
    } else {
      applyBrush(coords.x, coords.y);
    }

    lastPosRef.current = coords;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDrawingRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      isDrawingRef.current = false;
      lastPosRef.current = null;
    }
  };

  const handlePointerLeave = () => {
    setCursorPos((prev) => ({ ...prev, visible: false }));
  };

  // Save edited canvas to PNG with pristine alpha
  const handleSaveCanvas = async () => {
    const orig = origPixelsRef.current;
    const mask = maskRef.current;
    const { w, h } = imgDimsRef.current;
    if (!orig || !mask || w === 0 || h === 0) return;

    try {
      const defaultFilename =
        inputPath.includes("Буфер") ||
        inputPath.includes("Clipboard") ||
        inputPath.includes(t("bg_clipboard_screenshot"))
          ? "nobg_clipboard.png"
          : inputPath.replace(/\.[^/.]+$/, "") + "_nobg.png";

      const savePath = await save({
        defaultPath: defaultFilename,
        filters: [
          {
            name: "PNG Image",
            extensions: ["png"],
          },
        ],
      });

      if (savePath) {
        // Offscreen export canvas to ensure pure transparent PNG regardless of showMask
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = w;
        exportCanvas.height = h;
        const exportCtx = exportCanvas.getContext("2d");
        if (!exportCtx) return;

        const exportImgData = exportCtx.createImageData(w, h);
        const data = exportImgData.data;

        for (let i = 0; i < w * h; i++) {
          const px = i * 4;
          data[px] = orig[px];
          data[px + 1] = orig[px + 1];
          data[px + 2] = orig[px + 2];
          data[px + 3] = mask[i];
        }

        exportCtx.putImageData(exportImgData, 0, 0);
        const base64Data = exportCanvas.toDataURL("image/png");

        await invoke("save_canvas_image", {
          path: savePath,
          base64Data,
        });
        setSaveSuccess(t("bg_file_saved", { path: savePath }));
      }
    } catch (err) {
      setError(t("bg_save_error", { error: String(err) }));
    }
  };

  return (
    <div className="space-y-3.5">
      {/* Tab Header */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
          <span>{t("bg_title")}</span>
          <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-orange-500/15 text-orange-400 border border-orange-500/25 leading-tight uppercase">
            {t("pre_alpha_badge")}
          </span>
        </h2>
        <p className="text-xs text-zinc-400">{t("bg_desc")}</p>
      </div>

      {/* Input File & Processing Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={inputPath}
            placeholder={t("bg_dropzone")}
            className="input-base flex-1 font-mono text-xs"
          />
          <button
            type="button"
            onClick={handleSelectFile}
            className="btn-secondary h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5"
          >
            <FileImage className="w-3.5 h-3.5 text-zinc-400" />
            <span>{t("common_choose_file")}</span>
          </button>
          {loading && (
            <button
              type="button"
              onClick={handleCancelProcess}
              className="btn-secondary h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5 text-zinc-300 hover:text-red-400 hover:border-red-500/30 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t("common_cancel")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleProcess}
            disabled={!inputPath || loading}
            className="btn-primary h-8 px-3 text-xs shrink-0 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Brush className="w-3.5 h-3.5" />
            )}
            <span>{loading ? t("bg_processing") : t("bg_process_btn")}</span>
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">{t("bg_paste_hint")}</p>
      </div>

      {/* Status alerts */}
      {cancelNotice && (
        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-400 flex items-center gap-2 font-sans transition-all">
          <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span>{cancelNotice}</span>
        </div>
      )}

      {error && !cancelNotice && (
        <div className="p-2.5 bg-red-950/40 border border-red-900/50 rounded text-xs text-red-300 flex items-center gap-2 font-mono">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="p-2.5 bg-emerald-950/40 border border-emerald-900/50 rounded text-xs text-emerald-300 flex items-center gap-2 font-mono">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="break-all">{saveSuccess}</span>
        </div>
      )}

      {/* Interactive Canvas Editor Area with Right Control Panel */}
      {result && (
        <div className="border border-white/[0.08] rounded overflow-hidden flex flex-col md:flex-row bg-zinc-950/40">
          {/* Main Canvas Viewport (Left / Center) */}
          <div
            ref={viewportRef}
            onPointerLeave={handlePointerLeave}
            className="relative flex-1 min-h-[460px] max-h-[560px] overflow-auto flex items-center justify-center p-4 bg-zinc-950/80 cursor-crosshair select-none"
            style={{
              backgroundImage:
                "linear-gradient(45deg, #141417 25%, transparent 25%), linear-gradient(-45deg, #141417 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #141417 75%), linear-gradient(-45deg, transparent 75%, #141417 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
            }}
          >
            {/* Real-time Brush Cursor Preview */}
            {cursorPos.visible && (
              <div
                className="absolute pointer-events-none rounded-full transition-none z-20"
                style={{
                  left: cursorPos.x,
                  top: cursorPos.y,
                  width: brushSize * zoom,
                  height: brushSize * zoom,
                  transform: "translate(-50%, -50%)",
                  border:
                    tool === "smart_eraser"
                      ? "1.5px dashed rgba(248, 113, 113, 0.95)"
                      : "1.5px dashed rgba(52, 211, 153, 0.95)",
                  boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.5)",
                }}
              />
            )}

            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center center",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                touchAction: "none",
              }}
              className="max-w-none transition-transform duration-75 border border-white/[0.1] rounded-sm"
            />
          </div>

          {/* Right Toolbar Panel */}
          <div className="w-full md:w-64 border-t md:border-t-0 md:border-l border-white/[0.08] bg-zinc-900/90 p-3.5 flex flex-col justify-between gap-4 text-xs shrink-0">
            <div className="space-y-4">
              {/* 1. Tools Section */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {t("bg_tools_header")}
                </span>
                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTool("smart_eraser")}
                    className={`px-2.5 py-2 rounded text-xs flex items-center justify-between border transition-all ${
                      tool === "smart_eraser"
                        ? "bg-red-950/50 border-red-800/80 text-red-200 font-medium shadow-sm"
                        : "bg-zinc-950/40 border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Eraser className="w-3.5 h-3.5 text-red-400" />
                      <span>{t("bg_smart_eraser")}</span>
                    </div>
                    {tool === "smart_eraser" && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setTool("smart_brush")}
                    className={`px-2.5 py-2 rounded text-xs flex items-center justify-between border transition-all ${
                      tool === "smart_brush"
                        ? "bg-emerald-950/50 border-emerald-800/80 text-emerald-200 font-medium shadow-sm"
                        : "bg-zinc-950/40 border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Brush className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t("bg_smart_brush")}</span>
                    </div>
                    {tool === "smart_brush" && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    )}
                  </button>
                </div>

                {/* Smart Edge Snapping Toggle */}
                <div className="pt-1">
                  <label className="flex items-center justify-between p-2 rounded bg-zinc-950/30 border border-white/[0.05] cursor-pointer hover:bg-zinc-950/50">
                    <div className="flex items-center gap-1.5 text-zinc-300">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>{t("bg_smart_mode")}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={smartMode}
                      onChange={(e) => setSmartMode(e.target.checked)}
                      className="w-3.5 h-3.5 rounded bg-zinc-800 border-zinc-700 text-zinc-200 accent-zinc-200 cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* 2. Brush Settings */}
              <div className="space-y-2.5 pt-2 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                    <Sliders className="w-3 h-3 text-zinc-500" />
                    {t("bg_brush_settings")}
                  </span>
                </div>

                {/* Size Slider */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>{t("bg_brush_size")}</span>
                    <span className="font-mono text-zinc-300">{brushSize}px</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-zinc-200"
                  />
                </div>

                {/* Feather Slider */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>{t("bg_feather")}</span>
                    <span className="font-mono text-zinc-300">{feather}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={feather}
                    onChange={(e) => setFeather(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-zinc-200"
                  />
                </div>
              </div>

              {/* 3. View Settings */}
              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                  <Eye className="w-3 h-3 text-zinc-500" />
                  {t("bg_view_header")}
                </span>

                {/* Show Mask Overlay Toggle */}
                <label className="flex items-center justify-between p-2 rounded bg-zinc-950/30 border border-white/[0.05] cursor-pointer hover:bg-zinc-950/50">
                  <span className="text-zinc-300 text-xs">{t("bg_show_mask")}</span>
                  <input
                    type="checkbox"
                    checked={showMask}
                    onChange={(e) => setShowMask(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-zinc-800 border-zinc-700 text-zinc-200 accent-zinc-200 cursor-pointer"
                  />
                </label>

                {/* Zoom Controls */}
                <div className="flex items-center justify-between gap-1 pt-1">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))}
                    className="btn-secondary h-7 w-7 p-0 flex items-center justify-center"
                    title={t("bg_zoom_out")}
                  >
                    <ZoomOut className="w-3 h-3" />
                  </button>
                  <span className="text-[11px] text-zinc-400 font-mono text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
                    className="btn-secondary h-7 w-7 p-0 flex items-center justify-center"
                    title={t("bg_zoom_in")}
                  >
                    <ZoomIn className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    className="btn-secondary h-7 w-7 p-0 flex items-center justify-center"
                    title={t("bg_reset_view")}
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* 4. Actions & History */}
            <div className="space-y-2 pt-2 border-t border-white/[0.06]">
              {/* Undo / Redo */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title={t("bg_undo")}
                  className="btn-secondary h-7 flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40 text-xs"
                >
                  <Undo2 className="w-3 h-3" />
                  <span>{t("bg_undo")}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  title={t("bg_redo")}
                  className="btn-secondary h-7 flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40 text-xs"
                >
                  <Redo2 className="w-3 h-3" />
                  <span>{t("bg_redo")}</span>
                </button>
              </div>

              {/* Reset to AI mask */}
              <button
                type="button"
                onClick={handleResetMask}
                className="btn-secondary h-7 w-full flex items-center justify-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t("bg_reset_btn")}</span>
              </button>

              {/* Download Final Result */}
              <button
                type="button"
                onClick={handleSaveCanvas}
                className="btn-primary h-8 w-full flex items-center justify-center gap-1.5 text-xs font-medium cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t("bg_download_btn")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Info */}
      {result && (
        <div className="px-2.5 py-1.5 bg-zinc-900/60 border border-white/[0.08] rounded flex justify-between items-center text-[11px] text-zinc-400">
          <span>{t("bg_manual_edit_tip")}</span>
          <span className="font-mono text-zinc-500">
            {result.method} ({result.processing_time_ms} ms)
          </span>
        </div>
      )}
    </div>
  );
};
