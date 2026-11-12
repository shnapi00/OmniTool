import lottie, { AnimationItem } from "lottie-web";

export interface TgsRenderResult {
  frames: string[];
  fps: number;
}

export async function renderTgsFrames(
  animationData: object,
  targetFps = 30
): Promise<TgsRenderResult> {
  return new Promise((resolve, reject) => {
    // 1. Offscreen container in DOM to ensure canvas is properly mounted
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    container.style.width = "512px";
    container.style.height = "512px";
    container.style.visibility = "hidden";
    container.style.pointerEvents = "none";
    document.body.appendChild(container);

    let anim: AnimationItem | null = null;
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (anim) {
        try {
          anim.destroy();
        } catch {
          // ignore
        }
        anim = null;
      }
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };

    // Safety timeout in case lottie-web stalls
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timeout rendering Lottie animation frames"));
    }, 15000);

    try {
      anim = lottie.loadAnimation({
        container,
        renderer: "canvas",
        loop: false,
        autoplay: false,
        animationData,
        rendererSettings: {
          clearCanvas: true,
          preserveAspectRatio: "xMidYMid meet",
        },
      });

      const executeRender = () => {
        try {
          if (!anim) {
            cleanup();
            reject(new Error("Lottie animation instance lost"));
            return;
          }

          const canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
          if (!canvas) {
            cleanup();
            reject(new Error("Canvas element not found in Lottie container"));
            return;
          }

          // Force 512x512 resolution
          if (canvas.width !== 512) canvas.width = 512;
          if (canvas.height !== 512) canvas.height = 512;

          const nativeFps = anim.frameRate || 60;
          const totalFrames = Math.max(1, Math.round(anim.totalFrames));

          // Step to achieve ~30 fps or keep target
          const step = nativeFps > 35 ? Math.max(1, Math.round(nativeFps / targetFps)) : 1;
          const effectiveFps = Math.max(1, Math.round(nativeFps / step));

          const frames: string[] = [];

          for (let f = 0; f < totalFrames; f += step) {
            anim.goToAndStop(f, true);
            const dataUrl = canvas.toDataURL("image/png");
            frames.push(dataUrl);
          }

          cleanup();
          resolve({ frames, fps: effectiveFps });
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      if ((anim as any).isLoaded) {
        // Small delay to ensure canvas context is ready
        setTimeout(executeRender, 20);
      } else {
        anim.addEventListener("DOMLoaded", () => {
          setTimeout(executeRender, 20);
        });
      }
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}
