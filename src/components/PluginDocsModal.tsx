import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  HelpCircle,
  Folder,
  Copy,
  Check,
} from "lucide-react";
import { useTranslation } from "../i18n/useTranslation";

interface PluginDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFolder: () => void;
}

export const AI_PLUGIN_SPECIFICATION_PROMPT = `# OmniTool Plugin Development Specification (System Prompt for AI)

You are an expert developer creating an extensible plugin module for **OmniTool** — a modern modular desktop application for Windows built with Tauri and React.

## 1. Plugin Architecture Overview
Every plugin is an isolated folder placed inside:
\`%APPDATA%/OmniTool/plugins/<plugin_id>/\`
(e.g., \`C:\\Users\\<User>\\AppData\\Roaming\\OmniTool\\plugins\\hash_calculator\\\`)

A complete plugin consists of:
1. \`plugin.json\` — The manifest file describing the plugin's metadata, UI form fields, runtime command, and dependencies.
2. The executable script file (e.g. \`main.py\`, \`script.js\`, or \`main.ps1\`).
3. Optional \`icon.svg\` or \`icon.png\` (or any Lucide icon name defined in the manifest).

Plugins can also be exported and imported as a \`.omniplugin\` archive (a zip archive containing \`plugin.json\` and the script files at its root).

---

## 2. Manifest Schema (\`plugin.json\`)
The \`plugin.json\` file must follow this exact JSON schema:

\`\`\`json
{
  "id": "unique_plugin_id",            // Required: lowercase letters, numbers, and underscores (e.g. "hash_calculator")
  "name": "Human-Readable Plugin Name", // Required: Display title in sidebar and lists
  "icon": "Hash",                       // Lucide icon name (e.g., "Code", "Terminal", "Key", "Hash", "FileText", "Sliders", "Wrench", "Cpu", "Zap", "Lock", "Database", "Scissors", "Layers", "Play", "Calculator") OR data URI of custom SVG/PNG
  "version": "1.0.0",                   // Semantic version string
  "description": "Short explanation of what this tool does",
  "view": "gallery",                    // Optional: "terminal" (default) or "gallery" for visual card output (media, recordings, images)
  "actions": [                          // Optional: Quick action buttons rendered in a clean top bar
    { "id": "clip_30s", "label": "⏱️ Record 30s", "variant": "primary" },
    { "id": "toggle_bg", "label": "🔴 Background Mode (F9)", "variant": "secondary" },
    { "id": "open_folder", "label": "📁 Open Videos Folder", "variant": "ghost" }
  ],
  "settings_label": "⚙️ Recording Settings", // Optional: Custom label for the collapsible parameters accordion
  "command": "python",                  // Execution runtime: "powershell", "python", or "node"
  "script": "main.py",                  // Relative entry-point script filename in the plugin directory
  "action_label": "Run Tool",           // Primary button text in UI (e.g., "Calculate", "Convert", "Run")
  "dependencies": {                     // Optional: auto-detected & installed in isolated virtual environment or npm
    "python": ["requests", "pillow"],   // Array of PyPI package names
    "npm": ["axios", "chalk"]           // Array of npm package names
  },
  "fields": [                           // Array of input parameters rendered as a dynamic UI form
    {
      "id": "input_file",               // Argument ID
      "type": "file",                   // Supported types: "file" (file picker button), "text", "number", "select"
      "label": "Select Input File",     // Label shown in UI
      "placeholder": "Choose a file...",// Optional placeholder
      "default_value": ""               // Optional default value
    },
    {
      "id": "mode",
      "type": "select",                 // Dropdown selection
      "label": "Operation Mode",
      "options": ["Fast", "Full", "Deep"],
      "default_value": "Fast"
    },
    {
      "id": "count",
      "type": "number",
      "label": "Repetitions / Count",
      "default_value": "1"
    }
  ]
}
\`\`\`

---

## 3. Execution & Output Models

### 3.1 Parameter Passing & Execution
1. **Positional Arguments**: When the user clicks the action button in OmniTool, the application executes the script using the configured runtime (\`powershell.exe\`, \`python.exe\`, or \`node.exe\`) and passes the values of the form fields as **positional command-line arguments in the exact order declared in the \`fields\` array**.
   - For example, if \`fields\` has \`[input_file, mode, count]\`, OmniTool calls:
     \`python.exe main.py "<value_of_input_file>" "<value_of_mode>" "<value_of_count>"\`
2. **Exit Codes & Error Handling**:
   - Return exit code \`0\` on successful completion.
   - To signal a failure, terminate with exit code \`> 0\` (e.g., \`sys.exit(1)\`, \`process.exit(1)\`, or \`exit 1\`) and print the error message to \`stderr\` or \`stdout\`. OmniTool will flag the execution as an error.

### 3.2 Terminal vs Visual Gallery Output
OmniTool supports two output display modes:
1. **Standard Terminal Output (Default)**:
   - Any raw text printed to \`stdout\` is shown in a monospace terminal viewer.
2. **Visual Gallery View ("view": "gallery")**:
   - If \`"view": "gallery"\` is specified in \`plugin.json\` OR if the script prints a JSON payload to \`stdout\`, OmniTool automatically renders a card Grid (Gallery) instead of a black text console.
   - Hover video preview (\`<video muted loop playsInline>\`), multi-selection checkboxes, batch deletion, and a full lightbox player are built right in.
   - Output format to print to \`stdout\`:
\`\`\`json
{
  "action": "render_gallery",
  "directory": "C:\\\\Users\\\\User\\\\Videos",
  "files": [
    {
      "name": "recording_2026-11-11_12-00-00.mp4",
      "path": "C:\\\\Users\\\\User\\\\Videos\\\\recording_2026-11-11_12-00-00.mp4",
      "size": "14.2 MB",
      "duration": "00:42",
      "type": "video"
    }
  ]
}
\`\`\`
   *(Or alternatively: \`{"type": "gallery", "items": [...]}\`)*.
   - \`files\` items can be file paths or objects with \`name\`, \`path\`, \`size\`, \`duration\`, \`type\` ("video" | "image" | "file"). Relative paths will be resolved against \`"directory"\`.

### 3.3 Quick Actions & Collapsible Parameters
- **Quick Action Buttons (\`actions\`)**: If \`actions\` is declared in \`plugin.json\`, OmniTool renders them as an elegant horizontal button bar at the top of the plugin.
- **First Positional Argument**: Clicking any action button executes the script with the action's \`id\` as the **first positional argument** (\`sys.argv[1]\` in Python, \`process.argv[2]\` in Node.js, or first parameter in PowerShell), followed by the field parameters in order.
  For example, clicking \`clip_30s\` calls:
  \`python.exe main.py "clip_30s" "<value_of_input_file>" "<value_of_mode>" ...\`
- **Collapsible Settings Panel**: When \`actions\` is defined, secondary configuration \`fields\` are automatically collapsed by default into an accordion/popover panel (\`settings_label\` / Parameters), keeping the main screen free of clutter so the user only sees the action buttons and the gallery.

---

## 4. Working Script Templates

### Python (\`main.py\`)
\`\`\`python
import sys
import os

def main():
    # Positional arguments match the order defined in fields:
    input_file = sys.argv[1] if len(sys.argv) > 1 else ""
    mode = sys.argv[2] if len(sys.argv) > 2 else "Fast"
    count = sys.argv[3] if len(sys.argv) > 3 else "1"

    if not input_file or not os.path.exists(input_file):
        print(f"Error: Specified file does not exist: '{input_file}'", file=sys.stderr)
        sys.exit(1)

    print("=== OmniTool Python Plugin ===")
    print(f"Processing: {input_file}")
    print(f"Mode: {mode}, Count: {count}")

    # Your custom processing logic here...

    print("Success: Processing completed.")

if __name__ == "__main__":
    main()
\`\`\`

### Node.js (\`main.js\`)
\`\`\`javascript
const fs = require('fs');
const path = require('path');

// Positional arguments match fields:
const inputFile = process.argv[2] || '';
const mode = process.argv[3] || 'Fast';

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error(\`Error: File not found: "\${inputFile}"\`);
  process.exit(1);
}

console.log('=== OmniTool Node.js Plugin ===');
console.log(\`Processing file: \${inputFile} with mode: \${mode}\`);

// Your custom processing logic here...

console.log('Success: Task completed.');
\`\`\`

### PowerShell (\`main.ps1\`)
\`\`\`powershell
param(
    [string]$InputFile,
    [string]$Mode = "Fast",
    [string]$Count = "1"
)

if (-not (Test-Path $InputFile)) {
    Write-Error "Error: File does not exist: $InputFile"
    exit 1
}

Write-Output "=== OmniTool PowerShell Plugin ==="
Write-Output "Input File: $InputFile"
Write-Output "Mode: $Mode"

# Your custom processing logic here...

Write-Output "Success: Operation completed."
\`\`\`

---

## 5. Custom Script Plugins (Custom UI & window.OmniTool SDK)
OmniTool supports **Custom Script Plugins** where developers have full control over the DOM, styling, and logic:
- In \`plugin.json\`, set \`"custom_ui": true\` and \`"ui_entry": "index.js"\`.
- Inside \`index.js\`, use \`OmniTool.onMount(container)\` and \`OmniTool.onUnmount()\`.
- Access \`window.OmniTool.invoke(cmd, args)\`, \`OmniTool.exec(prog, args)\`, \`OmniTool.storage\`, \`OmniTool.ui.toast()\`, and \`OmniTool.registerSidebarWidget()\`.

---

## 6. Output Instructions
When the user asks you to write a plugin:
1. Provide the complete JSON file content for \`plugin.json\`.
2. Provide the complete code for the script file (\`main.py\`, \`main.js\`, or \`main.ps1\`).
3. Mention any required external packages in \`"dependencies"\`.
`;

export const PluginDocsModal: React.FC<PluginDocsModalProps> = ({
  isOpen,
  onClose,
  onOpenFolder,
}) => {
  const { t } = useTranslation();
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  if (!isOpen) return null;

  const handleCopyAiPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_PLUGIN_SPECIFICATION_PROMPT);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2500);
    } catch (err) {
      console.error("Failed to copy AI prompt:", err);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-white/[0.1] rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-zinc-950/60">
          <div className="flex items-center gap-2 text-zinc-100">
            <HelpCircle className="w-4 h-4 text-zinc-400" />
            <h3 className="text-sm font-semibold">{t("docs_title")}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyAiPrompt}
              className="btn-secondary h-6 px-2.5 text-[11px] flex items-center gap-1.5 text-zinc-300 hover:text-white cursor-pointer"
              title={t("docs_copy_ai_prompt")}
            >
              {copiedPrompt ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">{t("docs_copied_ai_prompt")}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-zinc-400" />
                  <span>{t("docs_copy_ai_prompt")}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-100 p-1 rounded-md transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300 leading-relaxed">
          {/* Quick Concept */}
          <div className="space-y-1.5 bg-zinc-950/40 p-3 rounded-lg border border-white/[0.06]">
            <h4 className="font-medium text-zinc-100 text-xs">
              {t("docs_concept_title")}
            </h4>
            <p className="text-zinc-400">
              {t("docs_concept_desc", {
                path: "%APPDATA%/OmniTool/plugins/<id>/",
                manifest: "plugin.json",
              })}
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={onOpenFolder}
                className="btn-secondary h-6 px-2 text-[11px] flex items-center gap-1.5 text-zinc-300 hover:text-white cursor-pointer"
              >
                <Folder className="w-3 h-3 text-zinc-400" />
                <span>{t("docs_open_folder")}</span>
              </button>
            </div>
          </div>

          {/* Manifest Structure */}
          <div className="space-y-1.5">
            <h4 className="font-medium text-zinc-100 text-xs">
              {t("docs_manifest_title")}
            </h4>
            <pre className="p-3 bg-black/50 border border-white/[0.07] rounded-lg font-mono text-[11px] text-zinc-300 overflow-x-auto leading-normal">
{`{
  "id": "my_tool",
  "name": "My Utility Tool",
  "icon": "Key",           // Lucide icon name (Key, Hash, Code, Terminal, FileText, etc.)
  "version": "1.0.0",
  "description": "Script tool description",
  "view": "gallery",       // Optional: "terminal" (default) or "gallery" (media cards)
  "actions": [             // Optional: Quick action buttons
    { "id": "clip_30s", "label": "⏱️ Record 30s", "variant": "primary" }
  ],
  "settings_label": "Parameters", // Optional: Collapsible panel button label
  "command": "powershell", // powershell, python, node
  "script": "main.ps1",    // Script filename located next to plugin.json
  "action_label": "Run",
  "fields": [
    {
      "id": "input_file",
      "type": "file",      // "file", "text", "number", "select"
      "label": "Select file"
    },
    {
      "id": "mode",
      "type": "select",
      "label": "Mode",
      "options": ["Fast", "Full"]
    }
  ]
}`}
            </pre>
          </div>

          {/* Script Arguments & Output */}
          <div className="space-y-1.5">
            <h4 className="font-medium text-zinc-100 text-xs">
              {t("docs_args_title")}
            </h4>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>{t("docs_args_p1")}</li>
              <li>{t("docs_args_p2")}</li>
              <li>{t("docs_args_p3")}</li>
            </ul>
          </div>

          {/* Ready Examples */}
          <div className="space-y-2">
            <h4 className="font-medium text-zinc-100 text-xs">
              {t("docs_examples_title")}
            </h4>

            {/* PowerShell */}
            <div className="space-y-1">
              <span className="text-[11px] font-mono text-zinc-400">PowerShell (main.ps1):</span>
              <pre className="p-2.5 bg-black/40 border border-white/[0.06] rounded font-mono text-[11px] text-emerald-300 overflow-x-auto">
{`param($filePath, $mode = "Fast")
Write-Output "Processing file: $filePath (mode: $mode)"
$info = Get-Item $filePath
Write-Output "Size: $($info.Length) bytes"`}
              </pre>
            </div>

            {/* Python */}
            <div className="space-y-1">
              <span className="text-[11px] font-mono text-zinc-400">Python (main.py):</span>
              <pre className="p-2.5 bg-black/40 border border-white/[0.06] rounded font-mono text-[11px] text-amber-300 overflow-x-auto">
{`import sys
file_path = sys.argv[1] if len(sys.argv) > 1 else "no file"
print(f"File processed: {file_path}")`}
              </pre>
            </div>

            {/* Custom Script UI Mode */}
            <div className="space-y-1">
              <span className="text-[11px] font-mono text-zinc-400">{t("docs_custom_script_label")}</span>
              <pre className="p-2.5 bg-black/40 border border-white/[0.06] rounded font-mono text-[11px] text-teal-300 overflow-x-auto">
{`OmniTool.onMount((container) => {
  container.innerHTML = '<button id="btn" class="btn-primary">${t("docs_custom_script_run_btn")}</button>';
  container.querySelector("#btn").onclick = async () => {
    const res = await OmniTool.exec("cmd", ["/c", "hostname"]);
    OmniTool.ui.toast("${t("docs_custom_script_done_toast")}" + res.stdout, "success");
    OmniTool.registerSidebarWidget({ badge: "1", status: "online" });
  };
});
OmniTool.onUnmount(() => console.log("Cleanup"));`}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-white/[0.08] bg-zinc-950/60 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary h-7 px-3 text-xs cursor-pointer"
          >
            {t("docs_got_it")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
