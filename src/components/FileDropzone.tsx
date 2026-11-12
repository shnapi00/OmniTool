import React from "react";
import { Upload } from "lucide-react";

export interface FileDropzoneProps {
  onChoose: () => void;
  title: string;
  subtitle?: string;
  isDragOver?: boolean;
  icon?: React.ReactNode;
  className?: string;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  onChoose,
  title,
  subtitle,
  isDragOver = false,
  icon,
  className = "",
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  return (
    <div
      onClick={onChoose}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver?.(e);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        onDragLeave?.(e);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.(e);
      }}
      className={`border border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-150 select-none ${
        isDragOver
          ? "border-zinc-300 bg-white/[0.05]"
          : "border-white/[0.1] hover:border-white/[0.2] bg-zinc-900/40 hover:bg-zinc-900/60"
      } ${className}`}
    >
      <div className="w-10 h-10 rounded-full bg-zinc-800/80 border border-white/[0.06] flex items-center justify-center mb-2.5 text-zinc-400">
        {icon || <Upload className="w-4 h-4" />}
      </div>
      <div className="text-xs font-medium text-zinc-200">
        {title}
      </div>
      {subtitle && (
        <div className="text-[11px] text-zinc-500 mt-1 font-mono">
          {subtitle}
        </div>
      )}
    </div>
  );
};
