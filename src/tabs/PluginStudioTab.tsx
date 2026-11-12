import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import confetti from "canvas-confetti";
import {
  Wrench,
  Play,
  FolderOpen,
  Trash2,
  ChevronUp,
  ChevronDown,
  Copy,
  Check,
  Type,
  ListFilter,
  ToggleLeft,
  Sliders,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Settings,
  ArrowRight,
  ArrowLeft,
  Download,
  X,
  FileUp,
  FileCode,
  RotateCw,
  Terminal,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useModulesStore, PluginManifest, PluginField, PluginAction } from "../store/useModulesStore";
import { getPluginIcon } from "../utils/getPluginIcon";
import { TabId } from "../components/Sidebar";
import { useTranslation } from "../i18n/useTranslation";
import { getCustomScriptTemplates } from "../templates/customPluginTemplates";
import { CustomScriptPluginView } from "../components/CustomScriptPluginView";

export interface CanvasElement {
  id: string;
  category: "input" | "action";
  type: "text" | "file" | "select" | "toggle" | "slider" | "action_button";
  label: string;
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  variant?: "primary" | "secondary" | "danger";
  icon?: string;
}

const PRESET_ICONS = [
  "Sparkles",
  "Wrench",
  "Camera",
  "Cpu",
  "Terminal",
  "Scissors",
  "Code",
  "Layers",
  "Video",
  "Palette",
  "Folder",
  "Sliders",
  "Box",
  "Zap",
  "Play",
  "Search",
  "Download",
  "FileText",
  "Volume2",
  "RefreshCw",
];

const BUTTON_ICONS = [
  "Play",
  "Zap",
  "Sparkles",
  "RefreshCw",
  "Scissors",
  "Camera",
  "Check",
  "Download",
  "Eye",
  "FolderOpen",
  "Trash2",
];

const slugify = (text: string) => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "_")
    .replace(/^-+|-+$/g, "");
};

// Generates boilerplate code matching OmniTool's execution conventions
function generateBoilerplate(
  runtime: "python" | "node" | "powershell",
  name: string,
  id: string,
  elements: CanvasElement[]
): string {
  const inputElements = elements.filter((e) => e.category === "input");
  const actionElements = elements.filter((e) => e.type === "action_button");

  if (runtime === "python") {
    const inputArgParsers = inputElements
      .map((el, idx) => {
        const argIdx = idx + 2; // sys.argv[1] is action_id, sys.argv[2..] are fields
        const fallback = el.defaultValue ? `"${el.defaultValue}"` : '""';
        return `        "${el.id}": args[${argIdx - 1}] if len(args) >= ${argIdx} else ${fallback},`;
      })
      .join("\n");

    const actionBranches = actionElements.length > 0
      ? actionElements
          .map((a) => {
            return `    elif action_id == "${a.id}":\n        handle_${slugify(a.id)}(inputs)`;
          })
          .join("\n")
      : "";

    const actionStubs = actionElements.length > 0
      ? actionElements
          .map((a) => {
            return `def handle_${slugify(a.id)}(inputs):
    print(f"\\n[ACTION: ${a.label}] Running...")
    for k, v in inputs.items():
        print(f"  * {k} = {v}")
    print("[OK] Completed successfully.\\n")\n`;
          })
          .join("\n")
      : `def handle_default(inputs):
    print("\\n[ACTION: Execute]")
    for k, v in inputs.items():
        print(f"  * {k} = {v}")
    print("[OK] Completed successfully.\\n")\n`;

    return `# OmniTool Plugin: ${name} (${id})
import sys
import os
import time

${actionStubs}
def main():
    args = sys.argv[1:]
    action_id = args[0] if len(args) > 0 else "default"

    print(f"[{time.strftime('%H:%M:%S')}] Starting '{name}' (Action: '{action_id}')")

    inputs = {
${inputArgParsers || '        # No parameters'}
    }

    if action_id == "default":
        handle_default(inputs)
${actionBranches}
    else:
        print(f"[WARN] Unknown action: '{action_id}'")

if __name__ == "__main__":
    main()
`;
  }

  if (runtime === "node") {
    const inputArgParsers = inputElements
      .map((el, idx) => {
        const argIdx = idx + 1;
        const fallback = el.defaultValue ? `"${el.defaultValue}"` : '""';
        return `        "${el.id}": args[${argIdx}] || ${fallback},`;
      })
      .join("\n");

    const actionBranches = actionElements.length > 0
      ? actionElements
          .map((a) => {
            return `    } else if (actionId === "${a.id}") {\n        handle${slugify(a.id).charAt(0).toUpperCase() + slugify(a.id).slice(1)}(inputs);`;
          })
          .join("\n")
      : "";

    const actionStubs = actionElements.length > 0
      ? actionElements
          .map((a) => {
            const funcName = `handle${slugify(a.id).charAt(0).toUpperCase() + slugify(a.id).slice(1)}`;
            return `function ${funcName}(inputs) {
    console.log("\\n[ACTION: ${a.label}] Running...");
    for (const [k, v] of Object.entries(inputs)) {
        console.log(\`  * \${k} = \${v}\`);
    }
    console.log("[OK] Completed successfully.\\n");
}\n`;
          })
          .join("\n")
      : `function handleDefault(inputs) {
    console.log("\\n[ACTION: Execute]");
    for (const [k, v] of Object.entries(inputs)) {
        console.log(\`  * \${k} = \${v}\`);
    }
    console.log("[OK] Completed successfully.\\n");
}\n`;

    return `// OmniTool Plugin: ${name} (${id})
const process = require('process');

${actionStubs}
function main() {
    const args = process.argv.slice(2);
    const actionId = args[0] || "default";

    const timestamp = new Date().toLocaleTimeString();
    console.log(\`[\${timestamp}] Starting '\${name}' (Action: '\${actionId}')\`);

    const inputs = {
${inputArgParsers || '        // No parameters'}
    };

    if (actionId === "default") {
        handleDefault(inputs);
${actionBranches}
    } else {
        console.log(\`[WARN] Unknown action: '\${actionId}'\`);
    }
}

main();
`;
  }

  // PowerShell
  const psParams = inputElements
    .map((el) => {
      const fallback = el.defaultValue ? ` = "${el.defaultValue}"` : "";
      return `    [string]$${el.id}${fallback}`;
    })
    .join(",\n");

  const psActionCases = actionElements
    .map((a) => {
      return `    "${a.id}" {
        Write-Host "\\n[ACTION: ${a.label}] Running..."
        Write-Host "[OK] Completed successfully."
    }`;
    })
    .join("\n");

  return `# OmniTool Plugin: ${name} (${id})
param(
    [string]$Action = "default"${psParams ? ",\n" + psParams : ""}
)

$timestamp = Get-Date -Format "HH:mm:ss"
Write-Host "[$timestamp] Starting '$name' (Action: '$Action')"

switch ($Action) {
${psActionCases || '    "default" {\n        Write-Host "[ACTION: Execute]"\n        Write-Host "[OK] Completed successfully."\n    }'}
    default {
        Write-Host "Executing command with arguments..."
    }
}

Write-Host "[$timestamp] Done."
`;
}

interface PluginStudioTabProps {
  onNavigateTab?: (tab: TabId) => void;
}

export const PluginStudioTab: React.FC<PluginStudioTabProps> = ({ onNavigateTab }) => {
  const { t, lang } = useTranslation();
  const { loadPlugins } = useModulesStore();

  const customScriptTemplates = useMemo(() => getCustomScriptTemplates(t), [lang, t]);

  const [activeSubTab, setActiveSubTab] = useState<"visual" | "logic">("visual");

  // Manifest Metadata
  const [pluginName, setPluginName] = useState(() => t("studio_default_plugin_name") || "My Tool");
  const [pluginId, setPluginId] = useState("my_tool");
  const [pluginDesc, setPluginDesc] = useState("");
  const [pluginVersion, setPluginVersion] = useState("1.0.0");
  const [pluginIcon, setPluginIcon] = useState("Sparkles");
  const [runtime, setRuntime] = useState<"python" | "node" | "powershell">("python");

  // Architecture Mode: Declarative (form builder) vs Custom UI (JS script)
  const [pluginArchitecture, setPluginArchitecture] = useState<"declarative" | "custom_ui">("declarative");
  const [customTemplateId, setCustomTemplateId] = useState<string>("blank");
  const [customScriptCode, setCustomScriptCode] = useState<string>(() => getCustomScriptTemplates(t)[0].code);
  const [isCustomScriptModified, setIsCustomScriptModified] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewShowConsole, setPreviewShowConsole] = useState(false);
  const [showSdkCheatsheet, setShowSdkCheatsheet] = useState(false);

  // Sync unmodified template code when language changes
  useEffect(() => {
    if (!isCustomScriptModified) {
      const tmpl = customScriptTemplates.find((item) => item.id === customTemplateId) || customScriptTemplates[0];
      setCustomScriptCode(tmpl.code);
      setPreviewRefreshKey((k) => k + 1);
    }
  }, [lang, customTemplateId, isCustomScriptModified, customScriptTemplates]);

  const handleSelectCustomTemplate = (tmplId: string) => {
    const tmpl = customScriptTemplates.find((item) => item.id === tmplId);
    if (!tmpl) return;
    if (isCustomScriptModified) {
      if (!window.confirm(t("studio_confirm_replace_template"))) {
        return;
      }
    }
    setCustomTemplateId(tmplId);
    setCustomScriptCode(tmpl.code);
    setIsCustomScriptModified(false);
    setPreviewRefreshKey((k) => k + 1);
  };

  const previewCustomManifest = useMemo<PluginManifest>(() => {
    return {
      id: slugify(pluginId) || "custom_plugin",
      name: pluginName.trim() || "Custom Script Plugin",
      description: pluginDesc.trim() || t("studio_default_custom_desc"),
      version: pluginVersion.trim() || "1.0.0",
      icon: pluginIcon || "Sparkles",
      custom_ui: true,
      ui_entry: "index.js",
      view: "custom",
    };
  }, [pluginId, pluginName, pluginDesc, pluginVersion, pluginIcon, t]);

  // Form Elements
  const [elements, setElements] = useState<CanvasElement[]>(() => [
    {
      id: "input_file",
      category: "input",
      type: "file",
      label: t("studio_default_input_file") || "Source File",
      placeholder: t("studio_default_choose_file") || "Select file...",
      defaultValue: "",
    },
    {
      id: "format",
      category: "input",
      type: "select",
      label: t("studio_default_output_format") || "Output Format",
      options: ["PNG", "JPEG", "WebP"],
      defaultValue: "PNG",
    },
    {
      id: "quality",
      category: "input",
      type: "slider",
      label: t("studio_default_quality") || "Quality",
      min: 1,
      max: 100,
      step: 1,
      defaultValue: "85",
    },
    {
      id: "process_btn",
      category: "action",
      type: "action_button",
      label: t("studio_default_process_btn") || "Process",
      variant: "primary",
      icon: "Play",
    },
  ]);

  // Inspector State
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  // Script Code State
  const [customCode, setCustomCode] = useState<string>("");
  const [isCodeModified, setIsCodeModified] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Testing & Build State
  const [isTesting, setIsTesting] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [showTestModal, setShowTestModal] = useState(false);

  // Creation State
  const [isBuilding, setIsBuilding] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);

  // Interactive preview input values
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});

  // Synchronize script boilerplate
  const generatedCode = useMemo(() => {
    return generateBoilerplate(runtime, pluginName, pluginId, elements);
  }, [runtime, pluginName, pluginId, elements]);

  useEffect(() => {
    if (!isCodeModified) {
      setCustomCode(generatedCode);
    }
  }, [generatedCode, isCodeModified]);

  useEffect(() => {
    const nextVals: Record<string, string> = {};
    elements.forEach((el) => {
      if (el.category === "input") {
        nextVals[el.id] = el.defaultValue || (el.options && el.options[0]) || "";
      }
    });
    setPreviewValues(nextVals);
  }, [elements]);

  const selectedElement = useMemo(() => {
    return elements.find((e) => e.id === selectedElementId) || null;
  }, [elements, selectedElementId]);

  // Add Element to Canvas
  const handleAddElement = (type: CanvasElement["type"]) => {
    const category: CanvasElement["category"] = type === "action_button" ? "action" : "input";
    const count = elements.filter((e) => e.type === type).length + 1;
    let newEl: CanvasElement;

    if (type === "text") {
      newEl = {
        id: `param_${count}`,
        category,
        type: "text",
        label: t("studio_default_text_field", { count: String(count) }) || `Text Field ${count}`,
        placeholder: t("studio_default_text_placeholder") || "Enter value...",
        defaultValue: "",
      };
    } else if (type === "file") {
      newEl = {
        id: `file_${count}`,
        category,
        type: "file",
        label: t("studio_default_file_field", { count: String(count) }) || `File ${count}`,
        placeholder: t("studio_default_choose_file") || "Select file...",
        defaultValue: "",
      };
    } else if (type === "select") {
      newEl = {
        id: `choice_${count}`,
        category,
        type: "select",
        label: t("studio_default_select_field", { count: String(count) }) || `Select ${count}`,
        options: [
          t("studio_default_option_item", { count: "1" }) || "Option 1",
          t("studio_default_option_item", { count: "2" }) || "Option 2",
        ],
        defaultValue: t("studio_default_option_item", { count: "1" }) || "Option 1",
      };
    } else if (type === "toggle") {
      newEl = {
        id: `check_${count}`,
        category,
        type: "toggle",
        label: t("studio_default_toggle_field", { count: String(count) }) || `Option ${count}`,
        defaultValue: "true",
      };
    } else if (type === "slider") {
      newEl = {
        id: `num_${count}`,
        category,
        type: "slider",
        label: t("studio_default_slider_field", { count: String(count) }) || `Number ${count}`,
        min: 0,
        max: 100,
        step: 5,
        defaultValue: "50",
      };
    } else {
      newEl = {
        id: `btn_${count}`,
        category,
        type: "action_button",
        label: t("studio_default_button_field", { count: String(count) }) || `Button ${count}`,
        variant: "primary",
        icon: "Play",
      };
    }

    setElements((prev) => [...prev, newEl]);
    setSelectedElementId(newEl.id);
    setIsInspectorOpen(true);
  };

  const handleUpdateSelected = (patch: Partial<CanvasElement>) => {
    if (!selectedElementId) return;
    setElements((prev) =>
      prev.map((el) => (el.id === selectedElementId ? { ...el, ...patch } : el))
    );
  };

  const handleMoveElement = (id: string, direction: "up" | "down") => {
    setElements((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      if (idx === -1) return prev;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  };

  const handleDeleteElement = (id: string) => {
    setElements((prev) => prev.filter((e) => e.id !== id));
    if (selectedElementId === id) {
      setSelectedElementId(null);
    }
  };

  const buildManifest = (): PluginManifest => {
    const inputElements = elements.filter((e) => e.category === "input");
    const actionElements = elements.filter((e) => e.type === "action_button");

    const fields: PluginField[] = inputElements.map((el) => ({
      id: el.id,
      type: el.type === "slider" ? "number" : el.type,
      label: el.label,
      placeholder: el.placeholder,
      options: el.options,
      default_value: el.defaultValue,
    }));

    const actions: PluginAction[] = actionElements.map((el) => ({
      id: el.id,
      label: el.label,
      variant: el.variant || "secondary",
      icon: el.icon || "Play",
    }));

    const scriptExtension =
      runtime === "python" ? "main.py" : runtime === "node" ? "main.js" : "script.ps1";

    return {
      id: slugify(pluginId) || "custom_plugin",
      name: pluginName.trim() || t("studio_default_plugin_name") || "Custom Plugin",
      description: pluginDesc.trim(),
      version: pluginVersion.trim() || "1.0.0",
      icon: pluginIcon,
      command: runtime,
      script: scriptExtension,
      view: "terminal",
      action_label: actions.length === 0 ? "Execute" : undefined,
      fields: fields.length > 0 ? fields : undefined,
      actions: actions.length > 0 ? actions : undefined,
    };
  };

  // Run Test
  const handleRunTest = async (specificActionId?: string) => {
    if (pluginArchitecture === "custom_ui") {
      setPreviewRefreshKey((k) => k + 1);
      return;
    }

    setIsTesting(true);
    setTestOutput(null);
    setTestError(null);
    setShowTestModal(true);

    try {
      const manifest = buildManifest();
      const testPluginId = `__sandbox_${manifest.id}__`;
      manifest.id = testPluginId;

      const codeToRun = isCodeModified ? customCode : generatedCode;
      await invoke("create_custom_plugin", {
        manifest,
        scriptContent: codeToRun,
      });

      const actionId =
        specificActionId ||
        (manifest.actions && manifest.actions[0]?.id) ||
        "default";

      const argsArray: string[] = [actionId];
      if (manifest.fields) {
        manifest.fields.forEach((f) => {
          argsArray.push(previewValues[f.id] ?? f.default_value ?? "");
        });
      }

      const out = await invoke<string>("execute_plugin", {
        pluginId: testPluginId,
        args: argsArray,
      });

      setTestOutput(out);
    } catch (err) {
      setTestError(String(err));
    } finally {
      setIsTesting(false);
    }
  };

  const handleCloseTestModal = async () => {
    setShowTestModal(false);
    try {
      const manifest = buildManifest();
      await invoke("delete_custom_plugin", { pluginId: `__sandbox_${manifest.id}__` });
    } catch {}
  };

  // Save Plugin
  const handleCreatePlugin = async () => {
    setIsBuilding(true);
    setToastMessage(null);

    try {
      if (pluginArchitecture === "custom_ui") {
        const cleanId = slugify(pluginId) || "custom_plugin";
        const manifest: PluginManifest = {
          id: cleanId,
          name: pluginName.trim() || "Custom Script Plugin",
          description: pluginDesc.trim() || t("studio_default_custom_desc"),
          version: pluginVersion.trim() || "1.0.0",
          icon: pluginIcon || "Sparkles",
          custom_ui: true,
          ui_entry: "index.js",
          view: "custom",
        };

        try {
          await invoke("delete_custom_plugin", { pluginId: `__sandbox_${manifest.id}__` });
        } catch {}

        const createdId = await invoke<string>("create_custom_plugin", {
          manifest,
          scriptContent: customScriptCode,
        });

        const current = useModulesStore.getState().enabledCustomPlugins;
        const updated = { ...current, [createdId]: true };
        localStorage.setItem("omnitool_custom_plugins_enabled", JSON.stringify(updated));
        useModulesStore.setState({ enabledCustomPlugins: updated });

        await loadPlugins();
        setLastCreatedId(createdId);
        setToastMessage(t("studio_toast_saved", { name: manifest.name }));

        confetti({
          particleCount: 60,
          spread: 50,
          origin: { y: 0.8 },
        });
        return;
      }

      const manifest = buildManifest();
      try {
        await invoke("delete_custom_plugin", { pluginId: `__sandbox_${manifest.id}__` });
      } catch {}

      const codeToRun = isCodeModified ? customCode : generatedCode;

      const createdId = await invoke<string>("create_custom_plugin", {
        manifest,
        scriptContent: codeToRun,
      });

      const current = useModulesStore.getState().enabledCustomPlugins;
      const updated = { ...current, [createdId]: true };
      localStorage.setItem("omnitool_custom_plugins_enabled", JSON.stringify(updated));
      useModulesStore.setState({ enabledCustomPlugins: updated });

      await loadPlugins();
      setLastCreatedId(createdId);
      setToastMessage(t("studio_toast_saved", { name: manifest.name }));

      confetti({
        particleCount: 60,
        spread: 50,
        origin: { y: 0.8 },
      });
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setIsBuilding(false);
    }
  };

  // Export to .omniplugin
  const handleExportPlugin = async () => {
    try {
      if (pluginArchitecture === "custom_ui") {
        const cleanId = slugify(pluginId) || "custom_plugin";
        const manifest: PluginManifest = {
          id: cleanId,
          name: pluginName.trim() || "Custom Script Plugin",
          description: pluginDesc.trim() || t("studio_default_custom_desc"),
          version: pluginVersion.trim() || "1.0.0",
          icon: pluginIcon || "Sparkles",
          custom_ui: true,
          ui_entry: "index.js",
          view: "custom",
        };

        const createdId = await invoke<string>("create_custom_plugin", {
          manifest,
          scriptContent: customScriptCode,
        });

        const targetPath = await save({
          defaultPath: `${manifest.id}.omniplugin`,
          filters: [{ name: "OmniTool Plugin", extensions: ["omniplugin"] }],
        });

        if (!targetPath) return;

        await invoke("export_plugin", {
          pluginId: createdId,
          targetPath,
        });

        setToastMessage(t("studio_toast_exported", { path: targetPath }));
        return;
      }

      const manifest = buildManifest();
      const codeToRun = isCodeModified ? customCode : generatedCode;

      const createdId = await invoke<string>("create_custom_plugin", {
        manifest,
        scriptContent: codeToRun,
      });

      const targetPath = await save({
        defaultPath: `${manifest.id}.omniplugin`,
        filters: [{ name: "OmniTool Plugin", extensions: ["omniplugin"] }],
      });

      if (!targetPath) return;

      await invoke("export_plugin", {
        pluginId: createdId,
        targetPath,
      });

      setToastMessage(t("studio_toast_exported", { path: targetPath }));
    } catch (err) {
      alert(`Export error: ${err}`);
    }
  };

  const getCommandLine = () => {
    if (runtime === "python") return `python main.py`;
    if (runtime === "node") return `node main.js`;
    return `powershell -File script.ps1`;
  };

  return (
    <div
      className="h-full w-full flex-1 min-h-0 flex flex-col text-zinc-100 overflow-hidden select-none transition-colors duration-200"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {/* 1. Sleek OmniTool Standard Header */}
      <header
        className="flex items-center justify-between border-b px-5 py-2.5 shrink-0 transition-colors duration-200"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-color)",
        }}
      >
        {/* Title */}
        <div className="flex items-center gap-2.5">
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab("plugins")}
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer mr-0.5"
              title={t("studio_back_to_plugins")}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <Wrench className="w-4 h-4 text-zinc-400" />
          <h2 className="text-xs font-semibold text-zinc-100 leading-none">
            {t("tab_plugin_studio") || "Plugin Studio"}
          </h2>
        </div>

        {/* Center / Right controls */}
        {/* Center / Right controls */}
        <div className="flex items-center gap-2">
          {/* Architecture Switcher */}
          <div
            className="flex items-center gap-1 bg-white/[0.04] p-0.5 rounded-md border"
            style={{ borderColor: "var(--border-color)" }}
          >
            <button
              type="button"
              onClick={() => setPluginArchitecture("declarative")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                pluginArchitecture === "declarative"
                  ? "bg-white/[0.12] text-zinc-100 shadow-xs"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
              }`}
            >
              <Sliders className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("studio_arch_declarative")}</span>
            </button>
            <button
              type="button"
              onClick={() => setPluginArchitecture("custom_ui")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                pluginArchitecture === "custom_ui"
                  ? "bg-white/[0.12] text-zinc-100 shadow-xs"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
              }`}
            >
              <FileCode className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("studio_arch_custom_ui")}</span>
            </button>
          </div>

          {pluginArchitecture === "declarative" && (
            <>
              <div
                className="h-4 w-px mx-0.5"
                style={{ backgroundColor: "var(--border-color)" }}
              />

              {/* Subtab Toggle for Declarative mode */}
              <div
                className="flex items-center gap-1 bg-white/[0.04] p-0.5 rounded-md border"
                style={{ borderColor: "var(--border-color)" }}
              >
                <button
                  type="button"
                  onClick={() => setActiveSubTab("visual")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                    activeSubTab === "visual"
                      ? "bg-white/[0.12] text-zinc-100 shadow-xs"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                  }`}
                >
                  {t("studio_subtab_ui")}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab("logic")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                    activeSubTab === "logic"
                      ? "bg-white/[0.12] text-zinc-100 shadow-xs"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                  }`}
                >
                  {t("studio_subtab_logic")}
                </button>
              </div>
            </>
          )}

          <div
            className="h-4 w-px mx-0.5"
            style={{ backgroundColor: "var(--border-color)" }}
          />

          {/* Actions */}
          {pluginArchitecture === "declarative" && (
            <button
              type="button"
              onClick={() => handleRunTest()}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-xs transition-colors border cursor-pointer"
              style={{ borderColor: "var(--border-color)" }}
            >
              <Play className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("studio_btn_test")}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExportPlugin}
            title={t("studio_btn_export")}
            className="w-7 h-7 flex items-center justify-center rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors border cursor-pointer"
            style={{ borderColor: "var(--border-color)" }}
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedElementId(null);
              setIsInspectorOpen(!isInspectorOpen);
            }}
            title={t("studio_btn_settings")}
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors border cursor-pointer ${
              isInspectorOpen && !selectedElementId
                ? "bg-white/[0.12] text-zinc-100 border-white/20"
                : "bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200"
            }`}
            style={{
              borderColor:
                isInspectorOpen && !selectedElementId
                  ? undefined
                  : "var(--border-color)",
            }}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={isBuilding}
            onClick={handleCreatePlugin}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium transition-colors shadow-sm cursor-pointer disabled:opacity-50"
          >
            <span>{isBuilding ? t("studio_btn_saving") : t("studio_btn_save")}</span>
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {pluginArchitecture === "custom_ui" ? (
          /* Custom UI Workspace: Split Code Editor + Live Interactive Preview */
          <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
            {/* Left Column: Code Editor & SDK Guides */}
            <div
              className="w-full md:w-1/2 flex flex-col min-h-0 border-r"
              style={{
                backgroundColor: "var(--bg-base)",
                borderColor: "var(--border-color)",
              }}
            >
              {/* Template Switcher & Top Toolbar */}
              <div
                className="p-3 border-b space-y-2 shrink-0 bg-white/[0.01]"
                style={{ borderColor: "var(--border-color)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                    {t("studio_starter_templates")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSdkCheatsheet(!showSdkCheatsheet)}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                  >
                    <span>OmniTool SDK</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${showSdkCheatsheet ? "rotate-180" : ""}`} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {customScriptTemplates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => handleSelectCustomTemplate(tmpl.id)}
                      className={`p-2 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                        customTemplateId === tmpl.id
                          ? "bg-white/[0.08] border-white/20 text-zinc-100 shadow-xs"
                          : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:border-white/10"
                      }`}
                    >
                      <div className="font-semibold text-xs text-zinc-200 truncate">
                        {tmpl.title}
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                        {tmpl.description}
                      </div>
                    </button>
                  ))}
                </div>

                {/* SDK Cheatsheet Drawer */}
                {showSdkCheatsheet && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-3 rounded-lg bg-zinc-950/80 border border-white/[0.08] text-xs font-mono space-y-1.5 text-zinc-300"
                  >
                    <div className="text-zinc-200 font-semibold text-[11px] pb-1 border-b border-white/[0.06]">
                      {t("studio_sdk_methods_title")}
                    </div>
                    <div><span className="text-zinc-300 font-semibold">OmniTool.invoke(cmd, args)</span> &bull; {t("studio_sdk_invoke_desc")}</div>
                    <div><span className="text-zinc-300 font-semibold">OmniTool.exec(prog, args, opts)</span> &bull; {t("studio_sdk_exec_desc")}</div>
                    <div><span className="text-zinc-300 font-semibold">OmniTool.storage.get/set/remove</span> &bull; {t("studio_sdk_storage_desc")}</div>
                    <div><span className="text-zinc-300 font-semibold">OmniTool.ui.toast(msg, type)</span> &bull; {t("studio_sdk_toast_desc")}</div>
                    <div><span className="text-zinc-300 font-semibold">OmniTool.registerSidebarWidget(opts)</span> &bull; {t("studio_sdk_widget_desc")}</div>
                    <div><span className="text-zinc-300 font-semibold">OmniTool.onMount / onUnmount</span> &bull; {t("studio_sdk_lifecycle_desc")}</div>
                  </motion.div>
                )}
              </div>

              {/* Code File Header */}
              <div
                className="h-9 border-b px-3 flex items-center justify-between shrink-0 bg-white/[0.02]"
                style={{ borderColor: "var(--border-color)" }}
              >
                <div className="flex items-center gap-2 text-xs">
                  <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-mono text-zinc-200">index.js</span>
                  {isCustomScriptModified && (
                    <span className="text-[10px] text-amber-400 font-mono">
                      {t("studio_code_modified_status")}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(customScriptCode);
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(
                          new CustomEvent("omnitool-toast", {
                            detail: { message: t("studio_code_copied_toast"), type: "success" },
                          })
                        );
                      }
                    }}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition cursor-pointer"
                    title={t("studio_copy_code_tooltip")}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const tmpl = customScriptTemplates.find((item) => item.id === customTemplateId) || customScriptTemplates[0];
                      setCustomScriptCode(tmpl.code);
                      setIsCustomScriptModified(false);
                      setPreviewRefreshKey((k) => k + 1);
                    }}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition cursor-pointer"
                    title={t("studio_code_reset_hint")}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Textarea Editor */}
              <div className="flex-1 min-h-0 flex overflow-hidden">
                <textarea
                  value={customScriptCode}
                  onChange={(e) => {
                    setCustomScriptCode(e.target.value);
                    setIsCustomScriptModified(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const start = e.currentTarget.selectionStart;
                      const end = e.currentTarget.selectionEnd;
                      const next = customScriptCode.substring(0, start) + "  " + customScriptCode.substring(end);
                      setCustomScriptCode(next);
                      setIsCustomScriptModified(true);
                      setTimeout(() => {
                        e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
                      }, 0);
                    }
                  }}
                  spellCheck={false}
                  placeholder={t("studio_code_placeholder")}
                  className="flex-1 min-h-0 text-zinc-200 font-mono text-xs p-4 leading-relaxed outline-none resize-none overflow-auto border-none selection:bg-emerald-500/20 bg-zinc-950"
                />
              </div>
            </div>

            {/* Right Column: Live Interactive Preview */}
            <div className="w-full md:w-1/2 flex flex-col min-h-0 bg-zinc-950/40">
              <div
                className="h-10 border-b px-4 flex items-center justify-between shrink-0 bg-white/[0.02]"
                style={{ borderColor: "var(--border-color)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-200">
                    {t("studio_preview_title")}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewRefreshKey((k) => k + 1)}
                    className="btn-secondary h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer hover:text-white transition"
                    title={t("studio_btn_restart")}
                  >
                    <RotateCw className="w-3.5 h-3.5 text-zinc-400" />
                    <span>{t("studio_btn_restart")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewShowConsole((v) => !v)}
                    className={`btn-secondary h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer transition ${
                      previewShowConsole ? "bg-zinc-800 text-white border-emerald-500/40" : ""
                    }`}
                    title={t("studio_btn_console")}
                  >
                    <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                    <span>{t("studio_btn_console")}</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col">
                <CustomScriptPluginView
                  key={previewRefreshKey}
                  plugin={previewCustomManifest}
                  inlineCode={customScriptCode}
                  hideHeader={true}
                  externalShowConsole={previewShowConsole}
                  onToggleConsole={() => setPreviewShowConsole((v) => !v)}
                />
              </div>
            </div>
          </div>
        ) : activeSubTab === "visual" ? (
          <>
            {/* 2. Flat Sidebar Palette */}
            <aside
              className="w-48 border-r p-3 flex flex-col gap-0.5 shrink-0 transition-colors duration-200"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-color)",
              }}
            >
              <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider px-2 py-1 mb-1">
                {t("studio_components_title")}
              </div>

              <button
                type="button"
                onClick={() => handleAddElement("text")}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer text-left"
              >
                <Type className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>{t("studio_component_text")}</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddElement("file")}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer text-left"
              >
                <FolderOpen className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>{t("studio_component_file")}</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddElement("select")}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer text-left"
              >
                <ListFilter className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>{t("studio_component_select")}</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddElement("toggle")}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer text-left"
              >
                <ToggleLeft className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>{t("studio_component_toggle")}</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddElement("slider")}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer text-left"
              >
                <Sliders className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>{t("studio_component_slider")}</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddElement("action_button")}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer text-left mt-1 pt-1.5 border-t"
                style={{ borderColor: "var(--border-color)" }}
              >
                <Play className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>{t("studio_component_button")}</span>
              </button>
            </aside>

            {/* 3. Center Canvas with Subtle Horizontal Dividers */}
            <main
              onClick={() => {
                setSelectedElementId(null);
              }}
              className="flex-1 min-h-0 overflow-y-auto p-6 md:p-8 flex flex-col items-center transition-colors duration-200"
              style={{ backgroundColor: "var(--bg-base)" }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-xl"
              >
                {/* Form Elements */}
                {elements.filter((e) => e.category === "input").length === 0 &&
                elements.filter((e) => e.type === "action_button").length === 0 ? (
                  <div className="py-20 text-center text-xs text-zinc-500">
                    {t("studio_empty_canvas")}
                  </div>
                ) : (
                  <div
                    className="divide-y"
                    style={{ borderColor: "var(--border-color)" }}
                  >
                    {elements
                      .filter((e) => e.category === "input")
                      .map((el) => {
                        const isSelected = selectedElementId === el.id;

                        return (
                          <div
                            key={el.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedElementId(el.id);
                              setIsInspectorOpen(true);
                            }}
                            className={`py-3.5 transition-colors relative group cursor-pointer ${
                              isSelected
                                ? "bg-white/[0.04] -mx-3 px-3 rounded-lg ring-1 ring-white/10"
                                : "hover:bg-white/[0.02] -mx-3 px-3 rounded-lg"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="text-xs font-medium text-zinc-300">
                                {el.label}
                              </label>

                              {/* Subtle Reorder/Delete Toolbar on Hover */}
                              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveElement(el.id, "up");
                                  }}
                                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200"
                                  title={t("studio_move_up")}
                                >
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveElement(el.id, "down");
                                  }}
                                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200"
                                  title={t("studio_move_down")}
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteElement(el.id);
                                  }}
                                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-950/60 text-zinc-400 hover:text-red-400"
                                  title={t("studio_delete")}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Standard Native OmniTool Input Views */}
                            {el.type === "text" && (
                              <input
                                type="text"
                                placeholder={el.placeholder || t("studio_default_text_placeholder")}
                                value={previewValues[el.id] || ""}
                                onChange={(e) =>
                                  setPreviewValues((prev) => ({
                                    ...prev,
                                    [el.id]: e.target.value,
                                  }))
                                }
                                className="w-full border rounded-md px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-white/30"
                                style={{
                                  backgroundColor: "var(--bg-surface)",
                                  borderColor: "var(--border-color)",
                                }}
                              />
                            )}

                            {el.type === "file" && (
                              <div className="flex gap-1.5">
                                <input
                                  type="text"
                                  placeholder={el.placeholder || t("studio_default_choose_file")}
                                  value={previewValues[el.id] || ""}
                                  onChange={(e) =>
                                    setPreviewValues((prev) => ({
                                      ...prev,
                                      [el.id]: e.target.value,
                                    }))
                                  }
                                  className="flex-1 border rounded-md px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-white/30"
                                  style={{
                                    backgroundColor: "var(--bg-surface)",
                                    borderColor: "var(--border-color)",
                                  }}
                                />
                                <button
                                  type="button"
                                  className="px-2.5 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border rounded-md text-xs text-zinc-300 flex items-center gap-1.5 cursor-pointer shrink-0"
                                  style={{ borderColor: "var(--border-color)" }}
                                >
                                  <FileUp className="w-3.5 h-3.5 text-zinc-400" />
                                  <span>{t("studio_browse_file")}</span>
                                </button>
                              </div>
                            )}

                            {el.type === "select" && (
                              <select
                                value={previewValues[el.id] || (el.options && el.options[0]) || ""}
                                onChange={(e) =>
                                  setPreviewValues((prev) => ({
                                    ...prev,
                                    [el.id]: e.target.value,
                                  }))
                                }
                                className="w-full border rounded-md px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-white/30 cursor-pointer"
                                style={{
                                  backgroundColor: "var(--bg-surface)",
                                  borderColor: "var(--border-color)",
                                }}
                              >
                                {el.options?.map((opt, i) => (
                                  <option key={i} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            )}

                            {el.type === "toggle" && (
                              <div
                                onClick={() =>
                                  setPreviewValues((prev) => ({
                                    ...prev,
                                    [el.id]: prev[el.id] === "false" ? "true" : "false",
                                  }))
                                }
                                className="flex items-center gap-2.5 cursor-pointer py-0.5"
                              >
                                <div
                                  className={`w-8 h-4.5 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                                    previewValues[el.id] !== "false"
                                      ? "bg-white/20"
                                      : "bg-white/10"
                                  }`}
                                >
                                  <div
                                    className={`w-3.5 h-3.5 rounded-full shadow-xs transform transition-transform duration-200 ease-in-out ${
                                      previewValues[el.id] !== "false"
                                        ? "bg-white translate-x-3.5"
                                        : "bg-zinc-400 translate-x-0"
                                    }`}
                                  />
                                </div>
                                <span className="text-xs text-zinc-400">
                                  {previewValues[el.id] !== "false" ? t("studio_toggle_enabled") : t("studio_toggle_disabled")}
                                </span>
                              </div>
                            )}

                            {el.type === "slider" && (
                              <div className="space-y-1.5">
                                <div className="flex justify-between text-[11px] text-zinc-500">
                                  <span>{el.min ?? 0}</span>
                                  <span className="text-zinc-200 font-mono font-medium">
                                    {previewValues[el.id] || el.defaultValue || "50"}
                                  </span>
                                  <span>{el.max ?? 100}</span>
                                </div>
                                <input
                                  type="range"
                                  min={el.min ?? 0}
                                  max={el.max ?? 100}
                                  step={el.step ?? 1}
                                  value={previewValues[el.id] || el.defaultValue || "50"}
                                  onChange={(e) =>
                                    setPreviewValues((prev) => ({
                                      ...prev,
                                      [el.id]: e.target.value,
                                    }))
                                  }
                                  className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-zinc-200"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Action Buttons */}
                {elements.some((e) => e.type === "action_button") && (
                  <div className="pt-4 flex flex-wrap gap-2">
                    {elements
                      .filter((e) => e.type === "action_button")
                      .map((btn) => {
                        const BtnIcon = getPluginIcon(btn.icon);
                        const isSelected = selectedElementId === btn.id;

                        return (
                          <div
                            key={btn.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedElementId(btn.id);
                              setIsInspectorOpen(true);
                            }}
                            className={`relative group rounded-md transition-all ${
                              isSelected
                                ? "ring-2 ring-white/50"
                                : "hover:ring-1 hover:ring-white/20"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleRunTest(btn.id)}
                              className={`px-3.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                                btn.variant === "primary"
                                  ? "bg-zinc-100 hover:bg-white text-zinc-950 font-medium shadow-sm"
                                  : btn.variant === "danger"
                                  ? "bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-800/40 shadow-xs"
                                  : "bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 border"
                              }`}
                              style={{
                                borderColor:
                                  btn.variant === "primary" || btn.variant === "danger"
                                    ? undefined
                                    : "var(--border-color)",
                              }}
                            >
                              <BtnIcon className="w-3.5 h-3.5" />
                              <span>{btn.label}</span>
                            </button>

                            {/* Small Action Button Controls on Hover */}
                            <div
                              className="absolute -top-3 -right-2 hidden group-hover:flex items-center gap-0.5 border rounded px-1 py-0.5 shadow-md z-10"
                              style={{
                                backgroundColor: "var(--bg-surface)",
                                borderColor: "var(--border-color)",
                              }}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveElement(btn.id, "up");
                                }}
                                className="p-0.5 hover:text-zinc-200 text-zinc-400"
                                title={t("studio_move_left")}
                              >
                                <ChevronUp className="w-3 h-3 -rotate-90" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveElement(btn.id, "down");
                                }}
                                className="p-0.5 hover:text-zinc-200 text-zinc-400"
                                title={t("studio_move_right")}
                              >
                                <ChevronDown className="w-3 h-3 -rotate-90" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteElement(btn.id);
                                }}
                                className="p-0.5 hover:text-red-400 text-zinc-400"
                                title={t("studio_delete")}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </main>

            {/* 4. Collapsible Settings Inspector */}
            <AnimatePresence>
              {isInspectorOpen && (
                <motion.aside
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 270, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="border-l flex flex-col shrink-0 overflow-hidden transition-colors duration-200"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-color)",
                  }}
                >
                  <div
                    className="p-3 border-b flex items-center justify-between shrink-0"
                    style={{ borderColor: "var(--border-color)" }}
                  >
                    <span className="text-xs font-medium text-zinc-200">
                      {selectedElement ? t("studio_inspector_field_props") : t("studio_inspector_plugin_props")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsInspectorOpen(false)}
                      className="text-zinc-500 hover:text-zinc-200 p-0.5 rounded transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
                    {selectedElement ? (
                      /* Field Properties */
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            {t("studio_field_name")}
                          </label>
                          <input
                            type="text"
                            value={selectedElement.label}
                            onChange={(e) => handleUpdateSelected({ label: e.target.value })}
                            className="w-full border rounded-md px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-white/30"
                            style={{
                              backgroundColor: "var(--bg-card)",
                              borderColor: "var(--border-color)",
                            }}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            {t("studio_field_arg_id")}
                          </label>
                          <input
                            type="text"
                            value={selectedElement.id}
                            onChange={(e) => handleUpdateSelected({ id: slugify(e.target.value) })}
                            className="w-full border rounded-md px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-white/30"
                            style={{
                              backgroundColor: "var(--bg-card)",
                              borderColor: "var(--border-color)",
                            }}
                          />
                        </div>

                        {selectedElement.category === "input" && (
                          <div className="space-y-1">
                            <label className="text-[11px] font-medium text-zinc-400">
                              {t("studio_field_placeholder")}
                            </label>
                            <input
                              type="text"
                              value={selectedElement.placeholder || ""}
                              onChange={(e) => handleUpdateSelected({ placeholder: e.target.value })}
                              className="w-full border rounded-md px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-white/30"
                              style={{
                                backgroundColor: "var(--bg-card)",
                                borderColor: "var(--border-color)",
                              }}
                            />
                          </div>
                        )}

                        {selectedElement.type === "select" && (
                          <div className="space-y-1.5">
                            <label className="text-[11px] font-medium text-zinc-400">
                              {t("studio_field_options")}
                            </label>
                            <div className="space-y-1">
                              {selectedElement.options?.map((opt, i) => (
                                <div key={i} className="flex gap-1">
                                  <input
                                    type="text"
                                    value={opt}
                                    onChange={(e) => {
                                      const next = [...(selectedElement.options || [])];
                                      next[i] = e.target.value;
                                      handleUpdateSelected({ options: next });
                                    }}
                                    className="flex-1 border rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none"
                                    style={{
                                      backgroundColor: "var(--bg-card)",
                                      borderColor: "var(--border-color)",
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = selectedElement.options?.filter((_, idx) => idx !== i);
                                      handleUpdateSelected({ options: next });
                                    }}
                                    className="px-1.5 bg-white/[0.04] hover:bg-red-950/60 text-zinc-400 hover:text-red-400 rounded cursor-pointer"
                                  >
                                    &times;
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => {
                                  const next = [
                                    ...(selectedElement.options || []),
                                    t("studio_default_option_item", {
                                      count: String((selectedElement.options?.length || 0) + 1),
                                    }) || `Option ${(selectedElement.options?.length || 0) + 1}`,
                                  ];
                                  handleUpdateSelected({ options: next });
                                }}
                                className="w-full py-1 bg-white/[0.05] hover:bg-white/[0.1] border text-zinc-300 rounded text-[11px] transition-colors cursor-pointer"
                                style={{ borderColor: "var(--border-color)" }}
                              >
                                {t("studio_field_add_option")}
                              </button>
                            </div>
                          </div>
                        )}

                        {selectedElement.type === "slider" && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] text-zinc-400">{t("studio_field_min")}</label>
                              <input
                                type="number"
                                value={selectedElement.min ?? 0}
                                onChange={(e) => handleUpdateSelected({ min: Number(e.target.value) })}
                                className="w-full border rounded px-2 py-1 text-xs text-zinc-200 font-mono focus:outline-none"
                                style={{
                                  backgroundColor: "var(--bg-card)",
                                  borderColor: "var(--border-color)",
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-zinc-400">{t("studio_field_max")}</label>
                              <input
                                type="number"
                                value={selectedElement.max ?? 100}
                                onChange={(e) => handleUpdateSelected({ max: Number(e.target.value) })}
                                className="w-full border rounded px-2 py-1 text-xs text-zinc-200 font-mono focus:outline-none"
                                style={{
                                  backgroundColor: "var(--bg-card)",
                                  borderColor: "var(--border-color)",
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {selectedElement.type === "action_button" && (
                          <>
                            <div className="space-y-1">
                              <label className="text-[11px] font-medium text-zinc-400">
                                {t("studio_field_btn_color")}
                              </label>
                              <select
                                value={selectedElement.variant || "primary"}
                                onChange={(e) =>
                                  handleUpdateSelected({
                                    variant: e.target.value as "primary" | "secondary" | "danger",
                                  })
                                }
                                className="w-full border rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none cursor-pointer"
                                style={{
                                  backgroundColor: "var(--bg-card)",
                                  borderColor: "var(--border-color)",
                                }}
                              >
                                <option value="primary">{t("studio_btn_color_primary")}</option>
                                <option value="secondary">{t("studio_btn_color_secondary")}</option>
                                <option value="danger">{t("studio_btn_color_danger")}</option>
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[11px] font-medium text-zinc-400">
                                {t("studio_field_icon")}
                              </label>
                              <div
                                className="grid grid-cols-4 gap-1 p-1 rounded-lg border"
                                style={{
                                  backgroundColor: "var(--bg-card)",
                                  borderColor: "var(--border-color)",
                                }}
                              >
                                {BUTTON_ICONS.map((icName) => {
                                  const IconBtn = getPluginIcon(icName);
                                  const isCur = (selectedElement.icon || "Play") === icName;
                                  return (
                                    <button
                                      key={icName}
                                      type="button"
                                      onClick={() => handleUpdateSelected({ icon: icName })}
                                      className={`p-1.5 rounded flex items-center justify-center transition-all cursor-pointer ${
                                        isCur
                                          ? "bg-zinc-100 text-zinc-950 font-medium"
                                          : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.08]"
                                      }`}
                                      title={icName}
                                    >
                                      <IconBtn className="w-3.5 h-3.5" />
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </>
                        )}

                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => handleDeleteElement(selectedElement.id)}
                            className="w-full py-1.5 px-3 bg-red-950/30 hover:bg-red-900/50 border border-red-900/50 text-red-300 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{t("studio_delete_field")}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Basic Plugin Settings */
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            {t("studio_plugin_name")}
                          </label>
                          <input
                            type="text"
                            value={pluginName}
                            onChange={(e) => {
                              setPluginName(e.target.value);
                              if (!pluginId || pluginId === "my_tool") {
                                setPluginId(slugify(e.target.value));
                              }
                            }}
                            className="w-full border rounded-md px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-white/30"
                            style={{
                              backgroundColor: "var(--bg-card)",
                              borderColor: "var(--border-color)",
                            }}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            {t("studio_plugin_id")}
                          </label>
                          <input
                            type="text"
                            value={pluginId}
                            onChange={(e) => setPluginId(slugify(e.target.value))}
                            className="w-full border rounded-md px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-white/30"
                            style={{
                              backgroundColor: "var(--bg-card)",
                              borderColor: "var(--border-color)",
                            }}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            {t("studio_plugin_desc")}
                          </label>
                          <input
                            type="text"
                            value={pluginDesc}
                            onChange={(e) => setPluginDesc(e.target.value)}
                            placeholder={t("studio_plugin_desc_placeholder")}
                            className="w-full border rounded-md px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-white/30"
                            style={{
                              backgroundColor: "var(--bg-card)",
                              borderColor: "var(--border-color)",
                            }}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            {t("studio_plugin_version")}
                          </label>
                          <input
                            type="text"
                            value={pluginVersion}
                            onChange={(e) => setPluginVersion(e.target.value)}
                            className="w-full border rounded-md px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-white/30"
                            style={{
                              backgroundColor: "var(--bg-card)",
                              borderColor: "var(--border-color)",
                            }}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            {t("studio_plugin_runtime")}
                          </label>
                          <div className="flex gap-1.5">
                            <select
                              value={runtime}
                              onChange={(e) =>
                                setRuntime(e.target.value as "python" | "node" | "powershell")
                              }
                              className="w-full border rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none cursor-pointer"
                              style={{
                                backgroundColor: "var(--bg-card)",
                                borderColor: "var(--border-color)",
                              }}
                            >
                              <option value="python">Python (main.py)</option>
                              <option value="node">Node.js (main.js)</option>
                              <option value="powershell">PowerShell (script.ps1)</option>
                            </select>
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono pt-0.5">
                            $ {getCommandLine()}
                          </div>
                        </div>

                        {/* Compact Preset Icons Grid */}
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            {t("studio_field_icon")}
                          </label>
                          <div
                            className="grid grid-cols-5 gap-1 p-1 rounded-lg border"
                            style={{
                              backgroundColor: "var(--bg-card)",
                              borderColor: "var(--border-color)",
                            }}
                          >
                            {PRESET_ICONS.map((icName) => {
                              const IconPreset = getPluginIcon(icName);
                              const isCur = pluginIcon === icName;
                              return (
                                <button
                                  key={icName}
                                  type="button"
                                  onClick={() => setPluginIcon(icName)}
                                  className={`p-1.5 rounded flex items-center justify-center transition-all cursor-pointer ${
                                    isCur
                                      ? "bg-zinc-100 text-zinc-950 font-medium"
                                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.08]"
                                  }`}
                                  title={icName}
                                >
                                  <IconPreset className="w-3.5 h-3.5" />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
          </>
        ) : (
          /* Logic / Code Editor Tab */
          <div
            className="flex-1 min-h-0 flex flex-col transition-colors duration-200"
            style={{ backgroundColor: "var(--bg-base)" }}
          >
            <div
              className="h-10 border-b px-4 flex items-center justify-between shrink-0 transition-colors duration-200"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-color)",
              }}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-zinc-300">
                  {runtime === "python"
                    ? "main.py"
                    : runtime === "node"
                    ? "main.js"
                    : "script.ps1"}
                </span>
                {isCodeModified && (
                  <span className="text-[10px] text-amber-400 font-mono">
                    {t("studio_code_modified")}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setCustomCode(generatedCode);
                    setIsCodeModified(false);
                  }}
                  className="px-2.5 py-1 rounded border bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  style={{ borderColor: "var(--border-color)" }}
                  title={t("studio_code_reset_hint")}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{t("studio_code_reset")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(isCodeModified ? customCode : generatedCode);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 1500);
                  }}
                  className="px-2.5 py-1 rounded bg-white/[0.08] hover:bg-white/[0.12] border text-zinc-200 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  style={{ borderColor: "var(--border-color)" }}
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3 h-3 text-zinc-300" />
                      <span>{t("studio_code_copied")}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>{t("studio_code_copy")}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
              <textarea
                value={isCodeModified ? customCode : generatedCode}
                onChange={(e) => {
                  setCustomCode(e.target.value);
                  setIsCodeModified(true);
                }}
                spellCheck={false}
                className="flex-1 min-h-0 text-zinc-200 font-mono text-xs p-4 leading-relaxed outline-none resize-none overflow-auto border-none selection:bg-white/20"
                style={{ backgroundColor: "var(--bg-base)" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sandbox Test Modal */}
      {showTestModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div
              className="w-full max-w-xl border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-150"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-color)",
              }}
            >
                <div
                  className="h-10 border-b px-4 flex items-center justify-between bg-white/[0.02]"
                  style={{ borderColor: "var(--border-color)" }}
                >
                  <span className="text-xs font-semibold text-zinc-200">
                    {t("studio_test_title", { name: pluginName })}
                  </span>
                  <button
                    type="button"
                    onClick={handleCloseTestModal}
                    className="text-zinc-400 hover:text-zinc-200 text-sm font-bold px-1.5 py-0.5 rounded hover:bg-white/[0.08] cursor-pointer"
                  >
                    &times;
                  </button>
                </div>

                <div className="p-4 flex-1 overflow-y-auto space-y-2 font-mono text-xs">
                  {isTesting ? (
                    <div className="flex items-center gap-2.5 text-zinc-400 py-6 justify-center">
                      <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                      <span>{t("studio_test_running")}</span>
                    </div>
                  ) : testError ? (
                    <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-lg text-red-300 whitespace-pre-wrap">
                      <div className="font-semibold text-red-400 flex items-center gap-1.5 mb-1">
                        <AlertCircle className="w-4 h-4" />
                        <span>{t("studio_test_error")}</span>
                      </div>
                      {testError}
                    </div>
                  ) : (
                    <pre
                      className="p-3 border rounded-lg text-zinc-200 whitespace-pre-wrap leading-relaxed overflow-x-auto selection:bg-white/20"
                      style={{
                        backgroundColor: "var(--bg-base)",
                        borderColor: "var(--border-color)",
                      }}
                    >
                      {testOutput || t("studio_test_no_output")}
                    </pre>
                  )}
                </div>

                <div
                  className="h-10 border-t px-4 flex items-center justify-end bg-white/[0.02]"
                  style={{ borderColor: "var(--border-color)" }}
                >
                  <button
                    type="button"
                    onClick={handleCloseTestModal}
                    className="px-3 py-1 rounded-md bg-white/[0.08] hover:bg-white/[0.12] border text-xs text-zinc-200 font-medium transition-colors cursor-pointer"
                    style={{ borderColor: "var(--border-color)" }}
                  >
                    {t("studio_test_close")}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

      {/* Subtle Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 border rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 max-w-sm"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-color)",
            }}
          >
            <div className="w-6 h-6 rounded-full bg-white/10 text-zinc-200 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="flex-1 text-xs text-zinc-200 whitespace-pre-line">
              {toastMessage}
            </div>
            {lastCreatedId && onNavigateTab && (
              <button
                type="button"
                onClick={() => {
                  onNavigateTab(`plugin:${lastCreatedId}` as TabId);
                  setToastMessage(null);
                }}
                className="px-2.5 py-1 bg-zinc-100 hover:bg-white text-zinc-950 rounded-md text-xs font-medium flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
              >
                <span>{t("studio_toast_navigate")}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-zinc-500 hover:text-zinc-300 text-sm ml-1 cursor-pointer"
            >
              &times;
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PluginStudioTab;
