/**
 * ClipUnlock - injector.js
 * IMPORTANT: This file is READ by content.js and injected as an INLINE <script>
 * so it runs synchronously at document_start with ZERO network delay.
 *
 * Execution order guarantee:
 *   1. content.js runs (document_start, extension isolated world)
 *   2. content.js reads this file via fetch() → inlines it as <script> text
 *   3. Inline script runs in PAGE world BEFORE any page JS
 *   4. All prototype overrides are in place before page scripts register handlers
 */
(function (undefined) {
  'use strict';

  // Already injected? Skip (can happen with iframes)
  if (window.__clipunlock_v2) return;
  window.__clipunlock_v2 = true;

  // ─── Events we protect ───────────────────────────────────────────────────────
  const CLIP = new Set([
    'copy', 'cut', 'paste',
    'contextmenu',
    'selectstart', 'select',
    'mousedown', 'mouseup',
    'keydown', 'keyup', 'keypress',
    'dragstart', 'drag', 'dragover', 'drop'
  ]);

  // ─── Save true native references BEFORE anything can tamper with them ────────
  const _addEventListener    = EventTarget.prototype.addEventListener;
  const _removeEventListener = EventTarget.prototype.removeEventListener;
  const _stopProp            = Event.prototype.stopPropagation;
  const _stopImmediate       = Event.prototype.stopImmediatePropagation;
  const _preventDefault      = Event.prototype.preventDefault;

  // ─── 1. Neuter stopImmediatePropagation / stopPropagation / preventDefault ───
  //    These are the exact methods sites call to block paste, copy, etc.
  Event.prototype.stopPropagation = function () {
    if (CLIP.has(this.type)) return; // silently swallow
    return _stopProp.call(this);
  };

  Event.prototype.stopImmediatePropagation = function () {
    if (CLIP.has(this.type)) return; // silently swallow — THIS fixes the first-paste bug
    return _stopImmediate.call(this);
  };

  Event.prototype.preventDefault = function () {
    if (CLIP.has(this.type)) return; // silently swallow
    return _preventDefault.call(this);
  };

  // ─── 2. Wrap addEventListener — neutralise handlers on document/window/body ──
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (!CLIP.has(type)) {
      return _addEventListener.call(this, type, fn, opts);
    }

    // Wrap listener so even if it tries to block, we override after
    const wrappedFn = function (e) {
      try { fn.call(this, e); } catch (_) {}
      // After handler runs, forcefully restore defaultPrevented = false
      try {
        Object.defineProperty(e, 'defaultPrevented', {
          get: () => false, configurable: true
        });
      } catch (_) {}
    };

    wrappedFn.__clipunlock__ = true;
    return _addEventListener.call(this, type, wrappedFn, opts);
  };

  // ─── 3. Install our own HIGH-PRIORITY capture listeners on document + window ──
  const earlyCapture = (_e) => { /* intentional no-op: claims the slot first */ };
  CLIP.forEach(type => {
    _addEventListener.call(document, type, earlyCapture, { capture: true, passive: true });
    _addEventListener.call(window,   type, earlyCapture, { capture: true, passive: true });
  });

  // ─── 4. Neutralise document-level on* properties ─────────────────────────────
  const docOn = [
    'oncopy','oncut','onpaste',
    'oncontextmenu','onselectstart','ondragstart','ondrop'
  ];
  docOn.forEach(prop => {
    try {
      Object.defineProperty(document, prop, {
        get: () => null,
        set: (_fn) => { /* swallow */ },
        configurable: true
      });
      Object.defineProperty(window, prop, {
        get: () => null,
        set: (_fn) => { /* swallow */ },
        configurable: true
      });
    } catch (_) {}
  });

  // ─── 5. CSS: force user-select on everything ──────────────────────────────────
  const injectCSS = () => {
    if (document.getElementById('__clipunlock_css__')) return;
    const s = document.createElement('style');
    s.id = '__clipunlock_css__';
    s.textContent = [
      '*, *::before, *::after {',
      '  -webkit-user-select: text !important;',
      '  -moz-user-select:    text !important;',
      '  -ms-user-select:     text !important;',
      '  user-select:         text !important;',
      '  pointer-events:      auto !important;',
      '}',
      'body { -webkit-user-select: text !important; user-select: text !important; }'
    ].join('\n');
    const target = document.head || document.documentElement;
    if (target) target.appendChild(s);
  };
  injectCSS();
  if (document.readyState === 'loading') {
    _addEventListener.call(document, 'DOMContentLoaded', injectCSS, { once: true });
  }

  // ─── 6. MutationObserver — clear inline on* attrs on every new element ────────
  const INLINE_ATTRS = [
    'oncopy','oncut','onpaste',
    'oncontextmenu','onselectstart',
    'onmousedown','onmouseup',
    'ondragstart','ondragover','ondrop'
  ];

  const clearNode = (node) => {
    if (node.nodeType !== 1) return;
    INLINE_ATTRS.forEach(attr => {
      if (node.hasAttribute(attr)) node.setAttribute(attr, 'void 0;');
    });
  };

  const mo = new MutationObserver((muts) => {
    muts.forEach(m => {
      m.addedNodes.forEach(n => {
        clearNode(n);
        if (n.querySelectorAll) n.querySelectorAll('*').forEach(clearNode);
      });
      if (m.type === 'attributes') clearNode(m.target);
    });
  });

  const startMO = () => {
    const root = document.documentElement || document.body;
    if (!root) return;
    document.querySelectorAll('*').forEach(clearNode);
    mo.observe(root, {
      childList:       true,
      subtree:         true,
      attributes:      true,
      attributeFilter: INLINE_ATTRS
    });
  };

  if (document.readyState === 'loading') {
    _addEventListener.call(document, 'DOMContentLoaded', startMO, { once: true });
  } else {
    startMO();
  }

  // ─── 7. Periodic re-guard (SPAs re-attach handlers after navigation) ──────────
  const reGuard = () => {
    docOn.forEach(prop => {
      try { document[prop] = null; } catch(_) {}
    });
    injectCSS();
  };
  setInterval(reGuard, 2000);

  window.__clipunlock_active = true;

})();
