import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

interface ToastItem {
  id: string;
  message: string;
  type: "success" | "info" | "warning" | "error";
  source?: string;
}

export const SystemToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handleToastEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{
        message: string;
        type?: "success" | "info" | "warning" | "error";
        source?: string;
      }>;

      if (!customEvent.detail || !customEvent.detail.message) return;

      const newToast: ToastItem = {
        id: Math.random().toString(36).substring(2, 9),
        message: customEvent.detail.message,
        type: customEvent.detail.type || "info",
        source: customEvent.detail.source,
      };

      setToasts((prev) => [...prev.slice(-4), newToast]);

      // Auto dismiss after 4 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
      }, 4000);
    };

    window.addEventListener("omnitool-toast", handleToastEvent);
    return () => window.removeEventListener("omnitool-toast", handleToastEvent);
  }, []);

  const handleDismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm pointer-events-none select-none">
      <AnimatePresence>
        {toasts.map((toast) => {
          const isSuccess = toast.type === "success";
          const isError = toast.type === "error";
          const isWarning = toast.type === "warning";

          const bgClass = isSuccess
            ? "bg-zinc-900/95 border-emerald-500/40 text-emerald-200"
            : isError
            ? "bg-zinc-900/95 border-red-500/40 text-red-200"
            : isWarning
            ? "bg-zinc-900/95 border-amber-500/40 text-amber-200"
            : "bg-zinc-900/95 border-white/[0.12] text-zinc-200";

          const Icon = isSuccess
            ? CheckCircle2
            : isError
            ? AlertCircle
            : isWarning
            ? AlertTriangle
            : Info;

          const iconColor = isSuccess
            ? "text-emerald-400"
            : isError
            ? "text-red-400"
            : isWarning
            ? "text-amber-400"
            : "text-blue-400";

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.18 }}
              className={`p-3 rounded-xl border shadow-2xl backdrop-blur-md flex items-start gap-2.5 pointer-events-auto ${bgClass}`}
            >
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
              <div className="flex-1 min-w-0">
                {toast.source && (
                  <div className="text-[10px] font-mono text-zinc-400 mb-0.5">
                    {toast.source}
                  </div>
                )}
                <div className="text-xs leading-relaxed break-words">{toast.message}</div>
              </div>
              <button
                type="button"
                onClick={() => handleDismiss(toast.id)}
                className="text-zinc-400 hover:text-zinc-100 p-0.5 rounded cursor-pointer transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
