/**
 * ClipUnlock - content.js
 * Runs at document_start in Chrome's ISOLATED world.
 *
 * CRITICAL: We use synchronous XMLHttpRequest to read injector.js as plain
 * text and inject it as an INLINE <script>. This guarantees our prototype
 * overrides run BEFORE the page's own scripts — making copy/paste/cut work
 * on the very first attempt.
 */
(function () {
  'use strict';

  const CACHE_KEY = '__clipunlock_enabled__';
  const ATTR_STATUS = 'data-clipunlock-status';

  /**
   * Synchronous check for enabled state using sessionStorage cache.
   * This is fast enough to run at document_start without perceived delay.
   */
  function isEnabledSync() {
    try {
      const v = sessionStorage.getItem(CACHE_KEY);
      if (v !== null) return v === '1';
    } catch (_) {}
    return true; // Default ON
  }

  // ─── Immediate Injection ─────────────────────────────────────────────────────
  // (Now handled by manifest.json with world: "MAIN" for CSP compliance)
  if (isEnabledSync()) {
    // We still ensure the session storage is primed
    try { sessionStorage.setItem(CACHE_KEY, '1'); } catch(_) {}
  }

  // ─── Async Storage Sync & Cache Update ───────────────────────────────────────
  const origin = location.hostname;

  chrome.storage.sync.get(['enabled', 'siteOverrides'], (data) => {
    const globalEnabled = data.enabled !== false;
    const overrides     = data.siteOverrides || {};
    const enabled       = (origin in overrides) ? overrides[origin] : globalEnabled;

    // Update sessionStorage cache for the next page load or navigation
    try {
      sessionStorage.setItem(CACHE_KEY, enabled ? '1' : '0');
    } catch (_) {}

    // If the user just disabled it, signal any active scripts to stand down.
    // Note: Prototype overrides are hard to undo without reload, hence why 
    // the popup recommends a reload.
    if (!enabled) {
      document.documentElement.removeAttribute(ATTR_STATUS);
      try {
        const s = document.createElement('script');
        s.textContent = 'window.__clipunlock_disabled = true; window.__clipunlock_active = false;';
        document.documentElement.appendChild(s);
        s.remove();
      } catch (_) {}
    }
  });

  // ─── Message Handler (Status bridge between worlds) ──────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ alive: true });
    } else if (msg.action === 'getStatus') {
      // The isolated world checks the DOM marker set by the main world script
      const active = document.documentElement.getAttribute(ATTR_STATUS) === 'active';
      sendResponse({ active: active });
    }
    return true;
  });

})();

