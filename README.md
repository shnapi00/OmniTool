# OmniTool

A lightweight, modular desktop multitool built with **Tauri (Rust + React/TypeScript)**. Combines media processing, AI/OCR utilities, Telegram helpers, and an extensible plugin system with full custom UI & system API control.

[Русская версия ниже](#omnitool-ru)

---

## Features

- **Media & Audio Processing:** Video/audio conversion, compression, and audio extraction powered by FFmpeg.
- **AI & OCR Utilities:** Local background removal and optical character recognition (OCR).
- **Telegram Tools:** Sticker pack downloader and media utilities.
- **Extensible Plugin System:**
  - **Visual Constructor:** Build simple tools from ready-made UI components and Python scripts.
  - **Custom UI / Script Mode:** Write standalone JavaScript/Canvas interfaces with full access to `window.OmniTool` SDK (`invoke`, `exec`, `storage`, `ui.toast`).
- **Auto-Updater:** Built-in update checker integrated with GitHub Releases.

## Installation

1. Go to the [Releases](https://github.com/shnapi00/OmniTool/releases) page.
2. Download the latest `OmniTool_Setup.exe` from the **Assets** section.
3. Run the installer and follow the on-screen instructions.

## Custom UI Plugin Example

Plugins in **Custom Script Mode** can render arbitrary DOM/Canvas interfaces and execute system commands via `OmniTool`:

```javascript
OmniTool.onMount((container) => {
  container.innerHTML = `
    <div style="padding: 16px; font-family: Consolas, monospace;">
      <h3>System Info</h3>
      <button id="scan-btn">Run System Check</button>
      <pre id="output"></pre>
    </div>
  `;

  container.querySelector('#scan-btn').onclick = async () => {
    const res = await OmniTool.exec('cmd', ['/c', 'whoami']);
    container.querySelector('#output').textContent = res;
    OmniTool.ui.toast('Done!');
  };
});
```

## Building from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://rustup.rs/)
- Windows WebView2 & MSVC Build Tools

### Setup
```bash
git clone https://github.com/shnapi00/OmniTool.git
cd OmniTool
cp .env.example .env
npm install
npm run tauri dev
```

To build the production installer:
```bash
npm run tauri build
```

---

<a name="omnitool-ru"></a>
# OmniTool (RU)

Лёгкий модульный десктопный мультитул на базе **Tauri (Rust + React/TypeScript)**. Объединяет работу с медиа, локальные нейросети и OCR, утилиты для Telegram, а также систему плагинов с полным контролем над интерфейсом и системным API.

## Возможности

- **Работа с медиа и аудио:** конвертация видео и аудио, сжатие файлов и извлечение аудиодорожек на базе FFmpeg.
- **Нейросети и OCR:** удаление фона на изображениях и оптическое распознавание текста.
- **Инструменты для Telegram:** скачивание стикерпаков и работа с медиафайлами.
- **Гибкая система плагинов:**
  - **Визуальный конструктор:** быстрая сборка инструментов из готовых UI-элементов и Python-скриптов.
  - **Режим Custom UI (Скриптовые плагины):** создание полностью кастомных интерфейсов (HTML/CSS/Canvas) с прямым доступом к `window.OmniTool` API (`invoke`, `exec`, `storage`, `ui.toast`).
- **Автообновление:** встроенная проверка и установка новых версий через GitHub Releases.

## Установка

1. Перейдите в раздел [Releases](https://github.com/shnapi00/OmniTool/releases).
2. Скачайте актуальный файл `OmniTool_Setup.exe` из блока **Assets**.
3. Запустите установщик.

## Пример Custom UI плагина

В режиме **Custom UI** плагин не ограничен стандартными компонентами и может рендерить любой интерфейс и вызывать системные команды:

```javascript
OmniTool.onMount((container) => {
  container.innerHTML = `
    <div style="padding: 16px; font-family: Consolas, monospace;">
      <h3>Проверка системы</h3>
      <button id="scan-btn">Запустить</button>
      <pre id="output"></pre>
    </div>
  `;

  container.querySelector('#scan-btn').onclick = async () => {
    const res = await OmniTool.exec('cmd', ['/c', 'whoami']);
    container.querySelector('#output').textContent = res;
    OmniTool.ui.toast('Готово!');
  };
});
```

## Сборка из исходников

### Требования
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://rustup.rs/)
- Windows WebView2 и компоненты сборки C++ (MSVC)

### Запуск и сборка
```bash
git clone https://github.com/shnapi00/OmniTool.git
cd OmniTool
cp .env.example .env
npm install
npm run tauri dev
```

Для сборки релизного `.exe`-установщика:
```bash
npm run tauri build
```