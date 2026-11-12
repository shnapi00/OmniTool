import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Plus,
  Trash2,
  FileCode,
  Loader2,
  Check,
  Upload,
  Image as ImageIcon,
  Sliders,
} from "lucide-react";
import { PluginManifest, PluginField } from "../store/useModulesStore";
import { getPluginIcon } from "../utils/getPluginIcon";
import { useTranslation } from "../i18n/useTranslation";
import { getCustomScriptTemplates } from "../templates/customPluginTemplates";

interface CreatePluginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (manifest: PluginManifest, scriptContent: string) => Promise<void>;
}

const AVAILABLE_ICONS = [
  "Code",
  "Terminal",
  "Key",
  "Hash",
  "FileText",
  "Sliders",
  "Wrench",
  "Cpu",
  "Zap",
  "Sparkles",
  "Lock",
  "Database",
  "Search",
  "Scissors",
  "Layers",
  "Play",
  "Calculator",
];

const DEFAULT_TEMPLATES: Record<string, { scriptName: string; code: string }> = {
  powershell: {
    scriptName: "script.ps1",
    code: `param($inputFile, $count = "5")
Write-Output "=== Plugin Execution (PowerShell) ==="
Write-Output "Input file: $inputFile"
Write-Output "Parameter count: $count"
Write-Output "Processing completed successfully."`,
  },
  python: {
    scriptName: "script.py",
    code: `import sys

input_file = sys.argv[1] if len(sys.argv) > 1 else ""
count = sys.argv[2] if len(sys.argv) > 2 else "1"

print("=== Plugin Execution (Python) ===")
print(f"Input file: {input_file}")
print(f"Parameter count: {count}")
print("Processing completed successfully.")`,
  },
  node: {
    scriptName: "script.js",
    code: `const inputFile = process.argv[2] || "";
const count = process.argv[3] || "1";

console.log("=== Plugin Execution (Node.js) ===");
console.log(\`Input file: \${inputFile}\`);
console.log(\`Parameter count: \${count}\`);
console.log("Processing completed successfully.");`,
  },
};

export const CreatePluginModal: React.FC<CreatePluginModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const { t } = useTranslation();
  const customScriptTemplates = getCustomScriptTemplates(t);

  const [pluginMode, setPluginMode] = useState<"standard" | "custom_ui">("standard");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [iconMode, setIconMode] = useState<"preset" | "custom">("preset");
  const [icon, setIcon] = useState("Code");
  const [customIcon, setCustomIcon] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [version] = useState("1.0.0");
  const [command, setCommand] = useState("powershell");
  const [viewType, setViewType] = useState<"terminal" | "gallery">("terminal");
  const [scriptName, setScriptName] = useState(DEFAULT_TEMPLATES.powershell.scriptName);
  const [actionLabel] = useState("Run");
  const [scriptCode, setScriptCode] = useState(DEFAULT_TEMPLATES.powershell.code);
  const [pythonDeps, setPythonDeps] = useState("");
  const [npmDeps, setNpmDeps] = useState("");
  const [selectedCustomTemplate, setSelectedCustomTemplate] = useState<string>("blank");

  const handleSelectCustomTemplate = (tmplId: string) => {
    const tmpl = customScriptTemplates.find((item) => item.id === tmplId);
    if (tmpl) {
      setSelectedCustomTemplate(tmplId);
      setScriptCode(tmpl.code);
    }
  };

  const handleModeChange = (mode: "standard" | "custom_ui") => {
    setPluginMode(mode);
    if (mode === "custom_ui") {
      setScriptName("index.js");
      const tmpl = customScriptTemplates.find((item) => item.id === selectedCustomTemplate) || customScriptTemplates[0];
      setScriptCode(tmpl.code);
      setIcon("Sparkles");
    } else {
      const tmpl = DEFAULT_TEMPLATES[command] || DEFAULT_TEMPLATES.powershell;
      setScriptName(tmpl.scriptName);
      setScriptCode(tmpl.code);
      setIcon("Code");
    }
  };

  const [fields, setFields] = useState<PluginField[]>([
    {
      id: "input_file",
      type: "file",
      label: "Input File",
      placeholder: "",
    },
  ]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCommandChange = (cmd: string) => {
    setCommand(cmd);
    const tmpl = DEFAULT_TEMPLATES[cmd] || DEFAULT_TEMPLATES.powershell;
    setScriptName(tmpl.scriptName);
    setScriptCode(tmpl.code);
  };

  const handleCustomIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/") && !file.name.endsWith(".svg")) {
      setError(t("create_plugin_err_image"));
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError(t("create_plugin_err_size"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setCustomIcon(result);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleAddField = () => {
    const newId = `param_${fields.length + 1}`;
    setFields((prev) => [
      ...prev,
      {
        id: newId,
        type: "text",
        label: t("create_plugin_default_param", { num: fields.length + 1 }),
        placeholder: "",
      },
    ]);
  };

  const handleRemoveField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFieldChange = (index: number, patch: Partial<PluginField>) => {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanId) {
      setError(t("create_plugin_err_id"));
      return;
    }
    if (!name.trim()) {
      setError(t("create_plugin_err_name"));
      return;
    }

    setLoading(true);
    setError(null);

    const pyList = pythonDeps
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const npmList = npmDeps
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const dependencies =
      pyList.length > 0 || npmList.length > 0
        ? {
            python: pyList.length > 0 ? pyList : undefined,
            npm: npmList.length > 0 ? npmList : undefined,
          }
        : undefined;

    const finalIcon = iconMode === "custom" && customIcon ? customIcon : icon;

    const manifest: PluginManifest =
      pluginMode === "custom_ui"
        ? {
            id: cleanId,
            name: name.trim(),
            icon: finalIcon,
            description: description.trim() || t("studio_default_custom_desc"),
            version: version.trim() || "1.0.0",
            custom_ui: true,
            ui_entry: "index.js",
            view: "custom",
            command: undefined,
            script: undefined,
            fields: [],
          }
        : {
            id: cleanId,
            name: name.trim(),
            icon: finalIcon,
            description: description.trim() || t("create_plugin_default_desc"),
            version: version.trim() || "1.0.0",
            view: viewType,
            command,
            script: scriptName.trim(),
            action_label: actionLabel.trim() || t("plugins_run"),
            dependencies,
            fields,
          };

    try {
      await onCreate(manifest, scriptCode);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const CurrentIcon = getPluginIcon(iconMode === "custom" && customIcon ? customIcon : icon);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-white/[0.1] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-zinc-950/60">
          <div className="flex items-center gap-2 text-zinc-100">
            <h3 className="text-sm font-semibold">{t("create_plugin_title")}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 p-1 rounded-md transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 bg-red-950/40 border border-red-900/50 rounded text-red-300 font-mono">
              {error}
            </div>
          )}

          {/* Plugin Architecture Mode Selector */}
          <div className="p-1 rounded-xl bg-zinc-950 border border-white/[0.08] grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => handleModeChange("standard")}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition cursor-pointer ${
                pluginMode === "standard"
                  ? "bg-zinc-800 text-white shadow-xs border border-white/[0.08]"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Sliders className="w-3.5 h-3.5 text-zinc-400" />
              <span>{t("studio_mode_declarative_label")}</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeChange("custom_ui")}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition cursor-pointer ${
                pluginMode === "custom_ui"
                  ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 shadow-xs"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <FileCode className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t("studio_mode_custom_ui_label")}</span>
            </button>
          </div>

          {pluginMode === "custom_ui" && (
            <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-950/20 text-zinc-300 space-y-1">
              <div className="text-emerald-400 font-semibold text-xs">
                Custom Script Mode
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                {t("studio_mode_custom_ui_desc")}
              </p>
            </div>
          )}

          {/* Main Info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-300">
                {t("create_plugin_id")}
              </label>
              <input
                type="text"
                required
                value={id}
                onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                placeholder={t("create_plugin_id_placeholder")}
                className="input-base w-full h-8 font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-300">
                {t("create_plugin_name")}
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("create_plugin_name_placeholder")}
                className="input-base w-full h-8 text-xs"
              />
            </div>
          </div>

          {/* Icon Selector: Catalog vs Custom File */}
          <div className="space-y-1.5 p-3 rounded-lg border border-white/[0.06] bg-zinc-950/40">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-zinc-300">{t("create_plugin_icon")}</label>
              <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setIconMode("preset")}
                  className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                    iconMode === "preset"
                      ? "bg-zinc-800 text-zinc-100 font-medium shadow-xs"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t("create_plugin_icon_catalog")}
                </button>
                <button
                  type="button"
                  onClick={() => setIconMode("custom")}
                  className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                    iconMode === "custom"
                      ? "bg-zinc-800 text-zinc-100 font-medium shadow-xs"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t("create_plugin_icon_custom")}
                </button>
              </div>
            </div>

            {iconMode === "preset" ? (
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="input-base flex-1 h-8 text-xs cursor-pointer"
                >
                  {AVAILABLE_ICONS.map((ic) => (
                    <option key={ic} value={ic}>
                      {ic}
                    </option>
                  ))}
                </select>
                <div className="w-8 h-8 rounded border border-white/[0.1] bg-zinc-800 flex items-center justify-center text-emerald-400 shrink-0">
                  <CurrentIcon className="w-4 h-4" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-xs border border-white/[0.08] cursor-pointer transition-colors shrink-0">
                  <Upload className="w-3.5 h-3.5 text-zinc-400" />
                  <span>{t("create_plugin_icon_upload_btn")}</span>
                  <input
                    type="file"
                    accept=".svg,.png,.webp,.jpg"
                    onChange={handleCustomIconUpload}
                    className="hidden"
                  />
                </label>
                <span className="text-[11px] text-zinc-500 truncate flex-1">
                  {customIcon ? t("create_plugin_icon_loaded") : t("create_plugin_icon_default_hint")}
                </span>
                <div className="w-8 h-8 rounded border border-white/[0.1] bg-zinc-800 flex items-center justify-center shrink-0 p-1">
                  {customIcon ? (
                    <img src={customIcon} alt="" className="w-5 h-5 object-contain" />
                  ) : (
                    <ImageIcon className="w-4 h-4 text-zinc-500" />
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-300">
              {t("create_plugin_desc")}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("create_plugin_desc_placeholder")}
              className="input-base w-full h-8 text-xs"
            />
          </div>

          {pluginMode === "standard" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-300">
                    {t("create_plugin_runtime")}
                  </label>
                  <select
                    value={command}
                    onChange={(e) => handleCommandChange(e.target.value)}
                    className="input-base w-full h-8 text-xs cursor-pointer"
                  >
                    <option value="powershell">PowerShell (.ps1)</option>
                    <option value="python">Python (.py)</option>
                    <option value="node">Node.js (.js)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-300">
                    {t("create_plugin_script_name")}
                  </label>
                  <input
                    type="text"
                    required
                    value={scriptName}
                    onChange={(e) => setScriptName(e.target.value)}
                    className="input-base w-full h-8 font-mono text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-300">
                    {t("create_plugin_view_mode")}
                  </label>
                  <select
                    value={viewType}
                    onChange={(e) => setViewType(e.target.value as "terminal" | "gallery")}
                    className="input-base w-full h-8 text-xs cursor-pointer"
                  >
                    <option value="terminal">{t("gallery_view_terminal")}</option>
                    <option value="gallery">{t("gallery_view_grid")}</option>
                  </select>
                </div>
              </div>

              {/* Dependencies (Optional) */}
              {(command === "python" || command === "node") && (
                <div className="space-y-2 p-3 rounded-lg border border-white/[0.06] bg-zinc-950/40">
                  <label className="text-[11px] font-medium text-zinc-300 block">
                    {t("create_plugin_deps")}
                  </label>
                  {command === "python" && (
                    <div className="space-y-1">
                      <span className="text-[10px] text-zinc-400">
                        {t("create_plugin_py_deps_hint")}
                      </span>
                      <input
                        type="text"
                        value={pythonDeps}
                        onChange={(e) => setPythonDeps(e.target.value)}
                        placeholder="requests, urllib3"
                        className="input-base w-full h-8 font-mono text-xs"
                      />
                    </div>
                  )}
                  {command === "node" && (
                    <div className="space-y-1">
                      <span className="text-[10px] text-zinc-400">
                        {t("create_plugin_npm_deps_hint")}
                      </span>
                      <input
                        type="text"
                        value={npmDeps}
                        onChange={(e) => setNpmDeps(e.target.value)}
                        placeholder="axios"
                        className="input-base w-full h-8 font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Argument Fields Builder */}
              <div className="space-y-2 border-t border-white/[0.08] pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">
                    {t("create_plugin_fields_title")}
                  </span>
                  <button
                    type="button"
                    onClick={handleAddField}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{t("create_plugin_add_field")}</span>
                  </button>
                </div>

                {fields.map((field, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 p-2 bg-zinc-950/50 border border-white/[0.05] rounded-lg items-center"
                  >
                    <div className="col-span-3">
                      <input
                        type="text"
                        value={field.id}
                        onChange={(e) => handleFieldChange(idx, { id: e.target.value })}
                        placeholder={t("create_plugin_field_id_placeholder")}
                        className="input-base w-full h-7 font-mono text-[11px]"
                      />
                    </div>
                    <div className="col-span-3">
                      <select
                        value={field.type}
                        onChange={(e) => handleFieldChange(idx, { type: e.target.value })}
                        className="input-base w-full h-7 text-[11px] cursor-pointer"
                      >
                        <option value="file">{t("create_plugin_type_file")}</option>
                        <option value="text">{t("create_plugin_type_text")}</option>
                        <option value="number">{t("create_plugin_type_number")}</option>
                        <option value="select">{t("create_plugin_type_select")}</option>
                      </select>
                    </div>
                    <div className="col-span-5">
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => handleFieldChange(idx, { label: e.target.value })}
                        placeholder={t("create_plugin_field_label_placeholder")}
                        className="input-base w-full h-7 text-[11px]"
                      />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleRemoveField(idx)}
                        className="text-zinc-500 hover:text-red-400 p-1 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Script Editor */}
          <div className="space-y-1.5 border-t border-white/[0.08] pt-3">
            {pluginMode === "custom_ui" && (
              <div className="space-y-1.5 pb-2">
                <span className="text-[11px] font-medium text-zinc-300">
                  {t("studio_starter_templates")}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {customScriptTemplates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => handleSelectCustomTemplate(tmpl.id)}
                      className={`p-2 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                        selectedCustomTemplate === tmpl.id
                          ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200"
                          : "bg-zinc-950/60 border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:border-white/10"
                      }`}
                    >
                      <div className="font-semibold text-xs text-zinc-200 truncate">
                        {tmpl.title}
                      </div>
                      <div className="text-[10px] text-zinc-500 line-clamp-2 mt-0.5 leading-tight">
                        {tmpl.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-zinc-300 flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-zinc-400" />
                <span>
                  {pluginMode === "custom_ui"
                    ? t("studio_arch_custom_ui")
                    : t("create_plugin_code_title")}
                </span>
              </label>
              <span className="text-[10px] text-zinc-500 font-mono">
                {pluginMode === "custom_ui" ? "index.js (ES6 / Vanilla / Canvas)" : scriptName}
              </span>
            </div>
            <textarea
              rows={pluginMode === "custom_ui" ? 14 : 7}
              value={scriptCode}
              onChange={(e) => setScriptCode(e.target.value)}
              className="w-full bg-zinc-950 font-mono text-xs text-zinc-200 p-3 rounded-lg border border-white/[0.08] focus:border-emerald-500/50 focus:outline-none"
              spellCheck={false}
            />
          </div>

          {/* Submit Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.08] pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
            >
              {t("common_cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t("create_plugin_submitting")}</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>{t("create_plugin_submit")}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
