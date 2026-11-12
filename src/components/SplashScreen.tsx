import React, { useEffect, useState } from "react";

interface SplashScreenProps {
  onLoaded: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onLoaded }) => {
  const [fading, setFading] = useState(false);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    // Небольшая задержка (180ms) для гарантии первой отрисовки разметки и стилей
    const timer = setTimeout(() => {
      setFading(true);
      onLoaded();

      const unmountTimer = setTimeout(() => {
        setMounted(false);
      }, 300);

      return () => clearTimeout(unmountTimer);
    }, 180);

    return () => clearTimeout(timer);
  }, [onLoaded]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 bg-dark-950 flex flex-col items-center justify-center select-none transition-opacity duration-300 ease-out ${
        fading ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        {/* Minimalist geometric mark */}
        <div className="w-8 h-8 rounded border border-dark-600 bg-dark-900 flex items-center justify-center shadow-sm">
          <div className="w-3 h-3 bg-zinc-200 rounded-sm"></div>
        </div>

        {/* Utilitarian progress bar */}
        <div className="w-24 h-[1.5px] bg-dark-800 rounded-full overflow-hidden relative">
          <div className="w-1/2 h-full bg-zinc-300 rounded-full animate-loader"></div>
        </div>
      </div>
    </div>
  );
};
