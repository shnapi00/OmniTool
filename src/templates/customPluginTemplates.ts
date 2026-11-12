import { TranslationKey, translations } from "../i18n/translations";

export type TranslateFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export interface CustomScriptTemplate {
  id: "blank" | "canvas" | "sysmon";
  titleKey: TranslationKey;
  descKey: TranslationKey;
  title: string;
  description: string;
  icon: string;
  code: string;
}

const defaultTranslate: TranslateFn = (key) => translations.ru[key] || String(key);

export function getCustomScriptTemplates(t: TranslateFn = defaultTranslate): CustomScriptTemplate[] {
  return [
    {
      id: "blank",
      titleKey: "template_blank_title",
      descKey: "template_blank_desc",
      title: t("template_blank_title"),
      description: t("template_blank_desc"),
      icon: "FileCode",
      code: `/**
 * OmniTool Custom Script Plugin
 */

OmniTool.onMount((container) => {
  container.innerHTML = \`
    <div class="p-6 max-w-lg mx-auto space-y-4">
      <h2 class="text-sm font-semibold text-zinc-100">\${OmniTool.plugin.name}</h2>
      <p class="text-xs text-zinc-400">${t("tmpl_blank_ready")}</p>
      <button id="btn-action" class="px-3.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 font-medium transition cursor-pointer border border-white/[0.08]">
        ${t("tmpl_blank_btn")}
      </button>
    </div>
  \`;

  // ${t("tmpl_blank_comment_api")}
  container.querySelector("#btn-action")?.addEventListener("click", () => {
    OmniTool.ui.toast("${t("tmpl_blank_toast")}", "success");
  });
});

OmniTool.onUnmount(() => {
  // ${t("tmpl_blank_comment_cleanup")}
});`,
    },
    {
      id: "canvas",
      titleKey: "template_canvas_title",
      descKey: "template_canvas_desc",
      title: t("template_canvas_title"),
      description: t("template_canvas_desc"),
      icon: "Sliders",
      code: `/**
 * OmniTool Custom Script Plugin - Canvas
 */

OmniTool.onMount((container) => {
  container.innerHTML = \`
    <div class="p-4 flex flex-col gap-2 h-full">
      <div class="flex items-center justify-between text-xs text-zinc-400">
        <span>${t("tmpl_canvas_header")}</span>
        <span class="font-mono text-[10px]">60 FPS</span>
      </div>
      <canvas id="cv" class="w-full flex-1 rounded-lg bg-zinc-950 border border-white/[0.08] block min-h-[240px]"></canvas>
    </div>
  \`;

  const canvas = container.querySelector("#cv");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let width = (canvas.width = canvas.clientWidth);
  let height = (canvas.height = canvas.clientHeight);

  const particles = Array.from({ length: 40 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 1.5,
    vy: (Math.random() - 0.5) * 1.5,
    radius: Math.random() * 2 + 1.5,
    color: \`hsl(\${Math.random() * 60 + 150}, 80%, 65%)\`,
  }));

  let animId = null;
  function render() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 90) {
          ctx.beginPath();
          ctx.strokeStyle = \`rgba(52, 211, 153, \${0.25 * (1 - dist / 90)})\`;
          ctx.lineWidth = 1;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }

    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });

    animId = requestAnimationFrame(render);
  }
  render();

  OmniTool.onUnmount(() => {
    if (animId) cancelAnimationFrame(animId);
  });
});`,
    },
    {
      id: "sysmon",
      titleKey: "template_sysmon_title",
      descKey: "template_sysmon_desc",
      title: t("template_sysmon_title"),
      description: t("template_sysmon_desc"),
      icon: "Sliders",
      code: `/**
 * OmniTool Custom Script Plugin - System Exec & Storage
 */

OmniTool.onMount((container) => {
  const count = OmniTool.storage.get("run_count", 0);

  container.innerHTML = \`
    <div class="p-6 max-w-lg mx-auto space-y-4 text-xs">
      <div class="flex items-center justify-between pb-2 border-b border-white/[0.08]">
        <span class="font-medium text-zinc-200">${t("tmpl_sysmon_header")}</span>
        <span id="counter" class="text-zinc-500 font-mono">${t("tmpl_sysmon_runs")}: \${count}</span>
      </div>

      <div class="flex gap-2">
        <input id="cmd-in" type="text" value="hostname" class="flex-1 px-3 py-1.5 rounded-md bg-zinc-950 border border-white/[0.1] text-xs font-mono text-zinc-200 focus:outline-none" />
        <button id="btn-run" class="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition cursor-pointer border border-white/[0.08]">
          ${t("tmpl_sysmon_btn")}
        </button>
      </div>

      <pre id="output" class="p-3 rounded-md bg-zinc-950 border border-white/[0.06] font-mono text-xs text-emerald-400 max-h-48 overflow-y-auto whitespace-pre-wrap">${t("tmpl_sysmon_ready")}</pre>
    </div>
  \`;

  let currentCount = count;
  const outEl = container.querySelector("#output");
  const cntEl = container.querySelector("#counter");

  container.querySelector("#btn-run")?.addEventListener("click", async () => {
    const cmd = container.querySelector("#cmd-in").value.trim();
    if (!cmd) return;
    outEl.textContent = "${t("tmpl_sysmon_running")}" + cmd + "...";
    try {
      const res = await OmniTool.exec("cmd", ["/c", cmd]);
      outEl.textContent = res.stdout || res.stderr || "${t("tmpl_sysmon_no_output")}";
      currentCount++;
      cntEl.textContent = "${t("tmpl_sysmon_runs")}: " + currentCount;
      OmniTool.storage.set("run_count", currentCount);
      OmniTool.ui.toast("${t("tmpl_sysmon_toast_ok")}", "success");
    } catch (e) {
      outEl.textContent = "${t("tmpl_sysmon_err")}" + e;
      OmniTool.ui.toast("${t("tmpl_sysmon_err")}" + e, "error");
    }
  });
});`,
    },
  ];
}

export const CUSTOM_SCRIPT_TEMPLATES: CustomScriptTemplate[] = getCustomScriptTemplates();
