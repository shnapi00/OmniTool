import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Terminal, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { PluginDepState } from "../store/useModulesStore";
import { useTranslation } from "../i18n/useTranslation";

interface PluginInstallLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  pluginName: string;
  depState?: PluginDepState;
}

export const PluginInstallLogsModal: React.FC<PluginInstallLogsModalProps> = ({
  isOpen,
  onClose,
  pluginName,
  depState,
}) => {
  const { t } = useTranslation();
  const logContainerRef = useRef<HTMLPreElement | null>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [depState?.logs]);

  if (!isOpen) return null;

  const isInstalling = depState?.isInstalling ?? false;
  const isReady = depState?.isReady ?? false;
  const hasError = depState?.hasError ?? false;
  const percent = depState?.percent ?? 0;
  
  const getLocalizedCurrentStatus = () => {
    if (!depState) return t("plugins_logs_init");
    if (depState.status === "checking") return t("deps_checking");
    if (depState.status === "ready") return t("deps_ready");
    if (depState.status === "installing" && (!depState.currentStatus || depState.currentStatus.includes("докачка") || depState.currentStatus.includes("Automatic") || depState.currentStatus.includes("Installing dependencies"))) {
      return t("deps_installing");
    }
    return depState.currentStatus || t("plugins_logs_init");
  };

  const currentStatus = getLocalizedCurrentStatus();
  const fullLog = (depState?.logs || []).join("") || t("plugins_logs_waiting");

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl rounded-xl border border-white/[0.1] bg-zinc-900/95 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-zinc-950/40">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-medium text-zinc-100">
              {t("plugins_logs_title", { name: pluginName })}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Bar */}
        <div className="px-4 py-2.5 bg-zinc-950/60 border-b border-white/[0.06] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            {isInstalling && <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />}
            {isReady && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
            {hasError && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
            <span className="text-zinc-300 truncate font-mono text-[11px]">{currentStatus}</span>
          </div>
          <span className="font-mono text-zinc-400 text-[11px] shrink-0 ml-2">
            {Math.round(percent)}%
          </span>
        </div>

        {/* Live Terminal Log Stream */}
        <div className="p-3 flex-1 overflow-hidden bg-black/70">
          <pre
            ref={logContainerRef}
            className="h-72 overflow-y-auto font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap select-text p-2 rounded bg-zinc-950/90 border border-white/[0.05]"
          >
            {fullLog}
          </pre>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-white/[0.08] bg-zinc-950/40 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary h-7 px-3 text-xs cursor-pointer"
          >
            {t("common_close")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
