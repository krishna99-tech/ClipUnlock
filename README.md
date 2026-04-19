<div align="center">

<img src="icons/icon128.png" width="80" alt="ClipUnlock Icon" />

# ClipUnlock

**A production-grade Chrome extension that unblocks copy, cut, paste, right-click, and text selection on any website.**


> Bypass JavaScript event restrictions and CSS `user-select` blocks — on the **first** interaction, every time.

</div>

---

## Table of Contents

- [Why ClipUnlock?](#why-clipunlock)
- [Features](#features)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Installation](#installation)
- [File Structure](#file-structure)
- [Technical Deep Dive](#technical-deep-dive)
- [Bypass Layers Explained](#bypass-layers-explained)
- [Permissions](#permissions)
- [Per-Site Control](#per-site-control)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Why ClipUnlock?

Many websites deliberately block basic browser interactions to "protect" their content:

```js
// Common blocking patterns found in the wild:
document.addEventListener('copy',        e => e.preventDefault());
document.addEventListener('paste',       e => e.stopImmediatePropagation(), true);
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('selectstart', e => e.returnValue = false);
document.oncopy = () => false;
```

These restrictions prevent you from:
- Copying text to paste elsewhere
- Using Ctrl+C / Ctrl+V / Ctrl+X naturally
- Right-clicking to access browser menus
- Selecting text with your mouse
- Dragging and dropping content

ClipUnlock surgically removes all of these barriers **before they are ever registered** by the page, using prototype-level interception at the JavaScript engine layer.

---

## Features

| Feature | Description |
|---|---|
| ✅ **Copy unblocked** | `Ctrl+C`, right-click copy, programmatic copy all work |
| ✅ **Cut unblocked** | `Ctrl+X` and cut actions restored |
| ✅ **Paste unblocked** | `Ctrl+V` works on first keypress — no "second attempt" bug |
| ✅ **Right-click restored** | Context menu appears normally |
| ✅ **Text selection restored** | Click-drag selection works everywhere |
| ✅ **Drag & Drop unblocked** | `dragstart`, `drag`, `drop` events unblocked |
| ✅ **CSS user-select removed** | Overrides `user-select: none` via injected stylesheet |
| ✅ **SPA-safe** | Periodic re-guard defeats React/Vue/Angular re-attachment |
| ✅ **Per-site control** | Enable or disable per domain from the popup |
| ✅ **Global toggle** | One switch to enable/disable everywhere |
| ✅ **iframe support** | Content script runs in `all_frames: true` |

---

## How It Works

### The Core Problem

Browser extensions run in an **isolated world** — a sandboxed JS environment separate from the page's own JavaScript. This means a normal extension cannot intercept event listeners registered by page scripts.

The only way to truly bypass JS-based copy restrictions is to run code in the **page's own JS world**, and to do so **before the page's scripts load**.

### The Solution: Synchronous Inline Injection

```
Chrome loads page
       │
       ▼
content.js fires (document_start, isolated world)
       │
       │  Synchronous XHR reads injector.js as TEXT
       │
       ▼
Inline <script> injected into <html> element
       │
       │  Runs synchronously in PAGE world
       ▼
Event.prototype.stopImmediatePropagation OVERRIDDEN
EventTarget.prototype.addEventListener WRAPPED
document.oncopy / onpaste / etc. NEUTERED
       │
       ▼
Page's own <script> tags begin loading
       │  (too late — our overrides are already in place)
       ▼
Page calls: addEventListener('paste', e => e.stopImmediatePropagation(), true)
       │  Our override silently swallows the stopImmediatePropagation call
       ▼
User presses Ctrl+V → paste works on the FIRST attempt ✓
```



## Architecture

```
clipunlock/
├── manifest.json          # MV3 manifest — permissions, scripts, resources
├── popup.html             # Extension popup UI
├── popup.css              # Popup styles (dark theme, toggles, status card)
├── popup.js               # Popup logic — reads/writes chrome.storage.sync
├── icons/
│   ├── icon16.png         # Active state icons
│   ├── icon32.png
│   ├── icon48.png
│   ├── icon128.png
│   ├── icon16_off.png     # Disabled state icons
│   ├── icon32_off.png
│   ├── icon48_off.png
│   └── icon128_off.png
└── src/
    ├── background.js      # Service worker — install defaults, icon updates
    ├── content.js         # Runs at document_start, performs inline injection
    └── injector.js        # The bypass payload — runs in page's JS world
```

### Data Flow

```
chrome.storage.sync
       │
       │  enabled (bool)
       │  siteOverrides { "example.com": false, ... }
       │
    ┌──┴──────────────────┐
    │      popup.js        │  ← User toggles switches
    └──────────────────────┘
       │ chrome.runtime.sendMessage
       ▼
    background.js          → Updates toolbar icon per tab
       │
    content.js             → Reads storage, decides to inject
       │ synchronous XHR
       ▼
    injector.js            → Runs in page world, overrides prototypes
```

---

## Installation

### Load Unpacked (Developer Mode)

1. Download and unzip `clipunlock-extension.zip`
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** using the toggle in the top-right corner
4. Click **Load unpacked**
5. Select the `clipunlock` folder
6. The ClipUnlock icon will appear in your toolbar

### Verify It's Working

1. Visit any site that blocks copy/paste (e.g. a site with `user-select: none`)
2. Click the ClipUnlock icon — status should show **ON** with a green indicator
3. Try selecting text and pressing `Ctrl+C` — it should work immediately

---

## File Structure

### `manifest.json`
Manifest V3 configuration. Key settings:
- `run_at: "document_start"` — content script fires as early as possible
- `all_frames: true` — injection runs inside iframes too
- `web_accessible_resources` — exposes `injector.js` so content.js can XHR-fetch it

### `src/content.js`
Runs in Chrome's **isolated world** at `document_start`. Its only job is to:
1. Check if the extension is enabled for this origin (via `sessionStorage` cache)
2. Perform a **synchronous XHR** to read `injector.js` as plain text
3. Inject that text as an **inline `<script>`** into `document.documentElement`
4. Listen for messages from the popup

### `src/injector.js`
The actual bypass payload. Runs in the **page's JS world**. Applies 7 layers of protection (see below).

### `src/background.js`
Service worker that:
- Sets default storage values on install (`enabled: true`)
- Updates the toolbar icon to green/grey based on enabled state per tab

### `popup.html` / `popup.css` / `popup.js`
The extension popup UI. Features:
- Live status card with pulse animation
- Per-site domain toggle
- Global enable/disable toggle
- Feature chip indicators (copy, cut, paste, right-click, select, drag)
- Reload prompt when settings change

---

## Technical Deep Dive

### Bypass Layers Explained

ClipUnlock applies **7 independent layers** of protection. If a website defeats one, the others still hold.

#### Layer 1 — Prototype Method Neutralization

The most critical layer. Overrides three `Event.prototype` methods at the JS engine level:

```js
const _stopImmediate = Event.prototype.stopImmediatePropagation;

Event.prototype.stopImmediatePropagation = function () {
  if (CLIP.has(this.type)) return; // ← no-op for clipboard events
  return _stopImmediate.call(this); // ← normal behavior for all other events
};
```

This defeats:
```js
// These patterns are now completely ineffective:
document.addEventListener('paste', e => e.stopImmediatePropagation(), true);
document.addEventListener('copy',  e => e.stopPropagation());
document.addEventListener('copy',  e => e.preventDefault());
```

#### Layer 2 — `addEventListener` Wrapping

All `addEventListener` calls for clipboard events are intercepted. The site's listener still runs (to avoid errors), but after it runs, `defaultPrevented` is forcefully reset to `false`:

```js
EventTarget.prototype.addEventListener = function (type, fn, opts) {
  if (!CLIP.has(type)) return _addEventListener.call(this, type, fn, opts);

  const wrapped = function (e) {
    try { fn.call(this, e); } catch (_) {}
    Object.defineProperty(e, 'defaultPrevented', { get: () => false });
  };
  return _addEventListener.call(this, type, wrapped, opts);
};
```

#### Layer 3 — High-Priority Capture Listeners

ClipUnlock registers its own `capture: true` listeners **before** any page script can. Since we call the native (pre-override) `addEventListener`, these are guaranteed to fire first:

```js
CLIP.forEach(type => {
  _addEventListener.call(document, type, earlyCapture, { capture: true, passive: true });
  _addEventListener.call(window,   type, earlyCapture, { capture: true, passive: true });
});
```

#### Layer 4 — `document.on*` Property Neutralization

Some sites use property assignment rather than `addEventListener`:

```js
document.oncopy = function() { return false; }
window.onpaste  = function() { return false; }
```

ClipUnlock uses `Object.defineProperty` to make these setters no-ops:

```js
Object.defineProperty(document, 'oncopy', {
  get: () => null,
  set: (_fn) => { /* swallow — assignment does nothing */ },
  configurable: true
});
```

#### Layer 5 — CSS `user-select` Override

Injects a `<style>` tag that forces text selection everywhere:

```css
*, *::before, *::after {
  -webkit-user-select: text !important;
  user-select:         text !important;
  pointer-events:      auto !important;
}
```

The style tag is re-injected if missing (some sites remove injected styles).

#### Layer 6 — MutationObserver for Inline Handlers

Watches the DOM for elements with inline `oncopy`, `onpaste`, etc. attributes and neutralizes them as they're added:

```js
const clearNode = (node) => {
  INLINE_ATTRS.forEach(attr => {
    if (node.hasAttribute(attr)) node.setAttribute(attr, 'void 0;');
  });
};
```

This defeats patterns like:
```html
<div oncopy="return false;" oncontextmenu="return false;">...</div>
```

#### Layer 7 — Periodic Re-Guard

A `setInterval` running every 2 seconds re-neutralizes `document.on*` properties and re-injects the CSS. This defeats Single Page Applications (React, Vue, Angular) that re-attach event handlers after client-side navigation:

```js
setInterval(() => {
  docOn.forEach(prop => { try { document[prop] = null; } catch(_) {} });
  injectCSS();
}, 2000);
```

---

## Permissions

| Permission | Why It's Needed |
|---|---|
| `storage` | Save global enabled state and per-site overrides |
| `activeTab` | Read current tab URL to display hostname in popup |
| `scripting` | Execute scripts programmatically in tabs |
| `tabs` | Reload tab after settings change, update icon per tab |
| `host_permissions: <all_urls>` | Allow content script to run on every website |

> **Privacy note:** ClipUnlock does not collect, transmit, or store any browsing data. All state is kept locally in `chrome.storage.sync` (synced across your Chrome profile only).

---

## Per-Site Control

From the popup you can:

- **Disable for a specific site** — toggle off under "THIS SITE". The site's original restrictions are restored after a page reload.
- **Disable globally** — toggle off under "GLOBAL". All sites revert to default behavior. Site-specific overrides still take precedence.
- **Re-enable for one site while globally off** — set a site override to ON while global is OFF.

Settings are stored in `chrome.storage.sync` under:
```json
{
  "enabled": true,
  "siteOverrides": {
    "example.com": false,
    "another.com": true
  }
}
```

---

## Known Limitations

| Limitation | Detail |
|---|---|
| **Server-side rendering** | ClipUnlock only bypasses client-side JS restrictions. If a server strips clipboard data before sending it, that cannot be fixed. |
| **Canvas-rendered text** | Text rendered inside `<canvas>` elements is not selectable — this is a browser limitation, not a JS restriction. | 
| **PDF viewer** | Chrome's built-in PDF viewer has its own security model. ClipUnlock does not affect `chrome-extension://` or `chrome://` pages. |
| **Extension pages** | Cannot inject into other extensions' pages (`chrome-extension://` URLs). |
| **CSP `script-src`** | A strict Content Security Policy that blocks inline scripts may prevent the injector from executing. In practice this is rare, as CSP applies to page-defined policies, and extensions bypass CSP for their own injected content in MV3. |

---

## License

MIT License — do whatever you want with this code. Attribution appreciated but not required.



<div align="center">

Made to give you back control of your own browser.

</div>
