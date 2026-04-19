/**
 * ClipUnlock - content.js
 * Runs at document_start in the extension's isolated world.
 *
 * KEY FIX: We inject the bypass code as an INLINE <script> text node,
 * not via script.src. This means:
 *   - ZERO network round-trip delay
 *   - Code runs synchronously before ANY page script
 *   - First paste/copy works immediately, not on second attempt
 *
 * We also do NOT await chrome.storage before injecting — we inject
 * immediately and check storage separately (disabled state handled via
 * a flag the inline script reads from sessionStorage).
 */
(function () {
  'use strict';

  const origin = location.hostname;

  // ─── Check enabled state synchronously from sessionStorage ───────────────────
  // We cache the enabled state in sessionStorage so we don't have to wait
  // for chrome.storage.sync (which is async and would cause the delay).
  // The popup updates sessionStorage via scripting.executeScript when toggled.

  function isEnabledSync() {
    try {
      const cached = sessionStorage.getItem('__clipunlock_enabled__');
      if (cached !== null) return cached === '1';
    } catch (_) {}
    return true; // default: enabled
  }

  // ─── Inject external script to bypass CSP ───────────────
  function injectExternal() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('src/injector.js');
      script.setAttribute('data-clipunlock', '2');
      (document.head || document.documentElement).appendChild(script);
      script.onload = function() { script.remove(); };
    } catch (_) {}
  }

  // ─── Main: check state then inject ───────────────────────────────────────────
  // Inject immediately — don't wait for storage
  if (isEnabledSync()) {
    injectExternal();
  }

  // Then verify with actual storage (and update sessionStorage cache)
  chrome.storage.sync.get(['enabled', 'siteOverrides'], (data) => {
    const globalEnabled = data.enabled !== false;
    const overrides     = data.siteOverrides || {};
    const enabled       = (origin in overrides) ? overrides[origin] : globalEnabled;

    // Cache for next page load
    try {
      sessionStorage.setItem('__clipunlock_enabled__', enabled ? '1' : '0');
    } catch (_) {}

    // If storage says disabled but we already injected — signal the page script
    // to stand down (it checks window.__clipunlock_disabled)
    if (!enabled) {
      try {
        const s = document.createElement('script');
        s.textContent = 'window.__clipunlock_disabled=true;window.__clipunlock_active=false;';
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      } catch (_) {}
    }
  });

  // ─── Message listener (popup communication) ───────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ alive: true });
    }
    if (msg.action === 'getStatus') {
      sendResponse({ active: !!window.__clipunlock_active });
    }
    return true;
  });

})();
