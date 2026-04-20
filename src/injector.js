/**
 * ClipUnlock - injector.js
 * Runs in the PAGE's JS world via synchronous inline injection from content.js.
 *
 * ⚠️  DO NOT put ANY code outside the IIFE below.
 *     Anything outside runs in the raw page scope before our protections
 *     are set up and can BREAK paste/copy on first attempt.
 *
 * HARD_BLOCK  (copy, cut, paste)
 *   → Site's addEventListener handler is replaced with a no-op.
 *     We NEVER call the site's handler — it steals clipboardData
 *     and shows a fake "copied N chars" toast instead of real paste.
 *
 * SOFT_BLOCK  (contextmenu, selectstart, drag, mousedown…)
 *   → Site's handler runs for UI side-effects, but cannot cancel the event.
 */
(function () {
  'use strict';

  // Guard: skip if already injected (iframes, re-navigation)
  if (window.__clipunlock_v3) return;
  window.__clipunlock_v3 = true;
  
  // Set DOM marker for status reporting (visible to isolated world)
  document.documentElement.setAttribute('data-clipunlock-status', 'active');


  // ─── Event categories ─────────────────────────────────────────────────────────

  // HARD: site handlers DROPPED entirely — clipboardData must not be touched
  const HARD = new Set(['copy', 'cut', 'paste']);

  // SOFT: site handlers run but cannot preventDefault/stopPropagation
  const SOFT = new Set([
    'contextmenu',
    'selectstart', 'select',
    'mousedown', 'mouseup',
    'keydown', 'keyup', 'keypress',
    'dragstart', 'drag', 'dragover', 'drop'
  ]);

  const ALL = new Set([...HARD, ...SOFT]);

  // ─── Save native references FIRST before any page script can touch them ───────
  const _addEL      = EventTarget.prototype.addEventListener;
  const _removeEL   = EventTarget.prototype.removeEventListener;
  const _stopProp   = Event.prototype.stopPropagation;
  const _stopImmed  = Event.prototype.stopImmediatePropagation;
  const _prevDef    = Event.prototype.preventDefault;

  // ─── Layer 1: Neuter Event prototype methods ───────────────────────────────────
  // Any site calling e.stopImmediatePropagation() / e.preventDefault() on a
  // clipboard event gets a silent no-op.

  Event.prototype.stopPropagation = function () {
    if (ALL.has(this.type)) return;
    return _stopProp.call(this);
  };

  Event.prototype.stopImmediatePropagation = function () {
    if (ALL.has(this.type)) return;
    return _stopImmed.call(this);
  };

  Event.prototype.preventDefault = function () {
    if (ALL.has(this.type)) return;
    return _prevDef.call(this);
  };

  // ─── Layer 2: Intercept addEventListener ──────────────────────────────────────
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    // Not a protected event — pass through untouched
    if (!ALL.has(type)) {
      return _addEL.call(this, type, fn, opts);
    }

    // HARD_BLOCK: copy / cut / paste
    // Replace the site's handler with a silent no-op.
    // Never call fn() — it reads clipboardData and blocks the real action.
    if (HARD.has(type)) {
      return _addEL.call(this, type, function () {}, opts);
    }

    // SOFT_BLOCK: contextmenu, selectstart, drag…
    // Call the site handler for legitimate UI effects,
    // but forcibly reset defaultPrevented so the browser still acts normally.
    const safe = function (e) {
      try { fn.call(this, e); } catch (_) {}
      try {
        Object.defineProperty(e, 'defaultPrevented', {
          get: () => false,
          configurable: true
        });
      } catch (_) {}
    };
    safe.__clipunlock__ = true;
    return _addEL.call(this, type, safe, opts);
  };

  // ─── Layer 3: High-priority capture listeners ─────────────────────────────────
  // Register on document + window before any page script loads.
  // For HARD events, call native stopImmediatePropagation to silence any
  // capture handlers that somehow got in before us (edge cases / iframes).

  HARD.forEach(type => {
    // Non-passive so we can call stopImmediatePropagation
    _addEL.call(document, type, function (e) {
      _stopImmed.call(e); // silence any earlier capture handler
    }, { capture: true });

    _addEL.call(window, type, function (e) {
      _stopImmed.call(e);
    }, { capture: true });
  });

  SOFT.forEach(type => {
    _addEL.call(document, type, function () {}, { capture: true, passive: true });
    _addEL.call(window,   type, function () {}, { capture: true, passive: true });
  });

  // ─── Layer 4: Neutralise document/window on* property assignments ─────────────
  // Defeats: document.oncopy = () => false
  const ON_PROPS = [
    'oncopy', 'oncut', 'onpaste',
    'oncontextmenu', 'onselectstart',
    'ondragstart', 'ondragover', 'ondrop'
  ];

  ON_PROPS.forEach(prop => {
    const descriptor = { get: () => null, set: () => {}, configurable: true };
    try { Object.defineProperty(document, prop, descriptor); } catch (_) {}
    try { Object.defineProperty(window,   prop, descriptor); } catch (_) {}
  });

  // ─── Layer 5: CSS user-select override ────────────────────────────────────────
  const CSS_ID = '__clipunlock_css__';

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent =
      '*, *::before, *::after {' +
      '  -webkit-user-select: text !important;' +
      '  -moz-user-select: text !important;' +
      '  user-select: text !important;' +
      '  pointer-events: auto !important;' +
      '}';
    (document.head || document.documentElement || document.body)
      .appendChild(s);
  }

  // Inject now; also after DOM is ready (some sites wipe <head>)
  injectCSS();
  _addEL.call(document, 'DOMContentLoaded', injectCSS, { once: true });

  // ─── Layer 6: MutationObserver — strip inline on* attributes ─────────────────
  const INLINE = [
    'oncopy', 'oncut', 'onpaste',
    'oncontextmenu', 'onselectstart',
    'onmousedown', 'onmouseup',
    'ondragstart', 'ondragover', 'ondrop'
  ];

  function clearEl(el) {
    if (!el || el.nodeType !== 1) return;
    INLINE.forEach(a => { if (el.hasAttribute(a)) el.setAttribute(a, 'void 0'); });
  }

  const mo = new MutationObserver(muts => {
    muts.forEach(m => {
      if (m.type === 'attributes') {
        clearEl(m.target);
      } else {
        m.addedNodes.forEach(n => {
          clearEl(n);
          if (n.querySelectorAll) n.querySelectorAll('*').forEach(clearEl);
        });
      }
    });
  });

  function startMO() {
    const root = document.documentElement || document.body;
    if (!root) return;
    document.querySelectorAll && document.querySelectorAll('*').forEach(clearEl);
    mo.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: INLINE
    });
  }

  if (document.readyState === 'loading') {
    _addEL.call(document, 'DOMContentLoaded', startMO, { once: true });
  } else {
    startMO();
  }

  // ─── Layer 7: Periodic re-guard for SPAs ──────────────────────────────────────
  // React/Vue/Angular re-attach handlers on client navigation — re-neutralise every 2s.
  setInterval(() => {
    ON_PROPS.forEach(p => { try { document[p] = null; } catch (_) {} });
    injectCSS();
  }, 2000);

  // ─── Done ─────────────────────────────────────────────────────────────────────
  window.__clipunlock_active = true;

})();
