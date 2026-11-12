// Linear-style subtle tactile mechanical click synthesizer using Web Audio API
let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function playTactileClick(): void {
  try {
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Low transient thock (damped low-frequency click ~140Hz -> 40Hz, 20ms)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.02);

    oscGain.gain.setValueAtTime(0.04, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.025);

    // 2. High transient mechanical snap (bandpassed white noise burst, 6ms)
    const sampleLength = Math.floor(ctx.sampleRate * 0.006);
    const buffer = ctx.createBuffer(1, sampleLength, ctx.sampleRate);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < sampleLength; i++) {
      channelData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleLength * 0.3));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2800;
    filter.Q.value = 1.2;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.035, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.006);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noise.start(now);
  } catch {
    // Audio autoplay policy
  }
}
