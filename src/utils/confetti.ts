import confetti from "canvas-confetti";

export const triggerSuccessConfetti = () => {
  try {
    confetti({
      particleCount: 42,
      spread: 55,
      origin: { y: 0.8 },
      colors: ["#10b981", "#34d399", "#6ee7b7", "#f4f4f5", "#fbbf24"],
      ticks: 160,
      gravity: 1.1,
      decay: 0.92,
      scalar: 0.85,
      disableForReducedMotion: true,
    });
  } catch {
    // ignore fallback
  }
};
