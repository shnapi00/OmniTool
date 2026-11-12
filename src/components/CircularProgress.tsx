import React from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

interface CircularProgressProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  isInstalling?: boolean;
  isReady?: boolean;
  hasError?: boolean;
  onClick?: () => void;
  title?: string;
  showPercentText?: boolean;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({
  percent,
  size = 18,
  strokeWidth = 2,
  isInstalling = false,
  isReady = false,
  hasError = false,
  onClick,
  title,
  showPercentText = false,
}) => {
  if (isReady && !isInstalling) {
    return (
      <div
        onClick={onClick}
        title={title || "Ready"}
        className="inline-flex items-center justify-center cursor-pointer text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
      </div>
    );
  }

  if (hasError && !isInstalling) {
    return (
      <div
        onClick={onClick}
        title={title || "Error"}
        className="inline-flex items-center justify-center cursor-pointer text-red-400 hover:text-red-300 transition-colors"
      >
        <AlertCircle className="w-3.5 h-3.5" />
      </div>
    );
  }

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const offset = circumference - (circumference * clampedPercent) / 100;

  // Indeterminate phase (0% or unknown): perfectly seamless 360° spin without jumping
  if (isInstalling && clampedPercent <= 0) {
    return (
      <div
        onClick={onClick}
        title={title}
        className="inline-flex items-center gap-1.5 cursor-pointer group"
      >
        <div
          className="relative inline-flex items-center justify-center animate-spin"
          style={{ width: size, height: size, animationDuration: "0.9s", animationTimingFunction: "linear" }}
        >
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="rgba(255, 255, 255, 0.12)"
              strokeWidth={strokeWidth}
              fill="none"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="#10b981"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * 0.7}
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </div>
      </div>
    );
  }

  // Determinate progress ring (> 0%):
  // Statically oriented at 12 o'clock, smoothly fills clockwise with easing
  return (
    <div
      onClick={onClick}
      title={title || `${Math.round(clampedPercent)}%`}
      className="inline-flex items-center gap-1.5 cursor-pointer group"
    >
      <div
        className="relative inline-flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "center",
          }}
        >
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="rgba(255, 255, 255, 0.12)"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Active progress stroke with smooth transition */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#10b981"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            fill="none"
            style={{
              transition: "stroke-dashoffset 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />
        </svg>
      </div>

      {showPercentText && (
        <span className="text-[10px] font-mono text-emerald-400 group-hover:underline">
          {Math.round(clampedPercent)}%
        </span>
      )}
    </div>
  );
};
