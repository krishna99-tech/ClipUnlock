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

  // HARD: site handlers DROPPED entirely
  const HARD = new Set(['copy', 'cut', 'paste', 'visibilitychange', 'webkitvisibilitychange', 'pagehide', 'beforeunload']);

  // ROOT_ONLY: Only blocked on window/document (to protect elements like inputs)
  const ROOT_ONLY = new Set(['blur', 'focus', 'focusin', 'focusout', 'mouseleave', 'mouseout']);

  // SOFT: site handlers run but cannot preventDefault/stopPropagation
  const SOFT = new Set([
    'contextmenu',
    'selectstart', 'select',
    'mousedown', 'mouseup',
    'keydown', 'keyup', 'keypress',
    'dragstart', 'drag', 'dragover', 'drop'
  ]);

  const ALL = new Set([...HARD, ...ROOT_ONLY, ...SOFT]);

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

  // ─── Layer 1.5: Visibility Mocking (Forceful) ────────────────────────────────
  // Bypasses tab-switching detection by forcing visibility properties to always
  // indicate the page is focused and visible.
  try {
    const fakeVisible = { get: () => 'visible', set: () => {}, configurable: false };
    const fakeHidden = { get: () => false, set: () => {}, configurable: false };
    
    Object.defineProperty(document, 'visibilityState', fakeVisible);
    Object.defineProperty(document, 'webkitVisibilityState', fakeVisible);
    Object.defineProperty(document, 'hidden', fakeHidden);
    Object.defineProperty(document, 'webkitHidden', fakeHidden);
    
    // Some sites use document.hasFocus() to check activity
    document.hasFocus = function() { return true; };
    
    // Prevent sites from calling window.blur() to hide or track
    Window.prototype.blur = function() { return; };
  } catch (_) {}

  // ─── Layer 2: Intercept addEventListener ──────────────────────────────────────
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    // Not a protected event — pass through untouched
    if (!ALL.has(type)) {
      return _addEL.call(this, type, fn, opts);
    }

    // HARD_BLOCK: clipboard / visibility
    if (HARD.has(type)) {
      return _addEL.call(this, type, function () {}, opts);
    }

    // ROOT_ONLY_BLOCK: window blur / focus / mouseleave
    // We block these specifically on window/document to hide tab-switching.
    if (ROOT_ONLY.has(type) && (this === window || this === document)) {
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
  // Register on document + window to silence events before site handlers fire.
  
  HARD.forEach(type => {
    _addEL.call(document, type, e => _stopImmed.call(e), { capture: true });
    _addEL.call(window,   type, e => _stopImmed.call(e), { capture: true });
  });

  ROOT_ONLY.forEach(type => {
    _addEL.call(window, type, function(e) {
      if (e.target === window || e.target === document) _stopImmed.call(e);
    }, { capture: true });
    _addEL.call(document, type, function(e) {
      if (e.target === window || e.target === document) _stopImmed.call(e);
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
    'ondragstart', 'ondragover', 'ondrop',
    'onblur', 'onfocus', 'onvisibilitychange', 'onwebkitvisibilitychange',
    'onmouseleave', 'onmouseout', 'onbeforeunload'
  ];

  ON_PROPS.forEach(prop => {
    const descriptor = { get: () => null, set: () => {}, configurable: false };
    try { Object.defineProperty(document, prop, descriptor); } catch (_) {}
    try { Object.defineProperty(window,   prop, descriptor); } catch (_) {}
  });

  // ─── Layer 5: CSS user-select override ────────────────────────────────────────
  const CSS_ID = '__clipunlock_css__';

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    
    // Get base URL from DOM (set by content script)
    const baseUrl = document.documentElement.getAttribute('data-clipunlock-base-url') || '';
    
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = baseUrl + 'src/injector.css';
    
    (document.head || document.documentElement).appendChild(link);
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
    ON_PROPS.forEach(p => { 
      try { document[p] = null; } catch (_) {} 
      try { window[p] = null; } catch (_) {} 
    });
    injectCSS();
  }, 2000);

  // ─── Done ─────────────────────────────────────────────────────────────────────
  window.__clipunlock_active = true;

})();
