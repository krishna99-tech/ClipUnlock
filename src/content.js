/**
 * ClipUnlock - content.js
 * Runs at document_start in Chrome's ISOLATED world.
 *
 * CRITICAL: We use synchronous XMLHttpRequest to read injector.js as plain
 * text and inject it as an INLINE <script>. This guarantees our prototype
 * overrides run BEFORE the page's own scripts — making copy/paste/cut work
 * on the very first attempt.
 *
 * Using script.src instead would introduce an async network delay, allowing
 * the page's blocking handlers to register first → first paste shows a count
 * toast instead of actually pasting.
 */
(function () {
  'use strict';

  // ─── Synchronous enabled check (no async storage wait) ───────────────────────
  // We cache the state in sessionStorage so document_start injection is instant.
  // chrome.storage.sync updates the cache asynchronously for the next load.
  function isEnabledSync() {
    try {
      const v = sessionStorage.getItem('__clipunlock_enabled__');
      if (v !== null) return v === '1';
    } catch (_) {}
    return true; // default ON
  }

  // ─── Inline injection via synchronous XHR ────────────────────────────────────
  // Reads injector.js as a text string and inserts it as an inline <script>.
  // Inline scripts execute synchronously and immediately — zero network delay.
  function injectInline() {
    try {
      const url = chrome.runtime.getURL('src/injector.js');

      // Synchronous XHR (false = sync) — blocks until file is read
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);

      if (xhr.status === 200 && xhr.responseText) {
        const script = document.createElement('script');
        script.textContent = xhr.responseText; // ← INLINE, not src=
        script.setAttribute('data-clipunlock', 'v3');

        // Insert as FIRST child of <html> — before any page <script> can load
        const root = document.documentElement;
        root.insertBefore(script, root.firstChild);

        // Remove the tag immediately after it executes (keep DOM clean)
        script.remove();
        return true;
      }
    } catch (err) {
      // XHR failed (rare) — fall back to script.src as last resort
      try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('src/injector.js');
        document.documentElement.appendChild(script);
      } catch (_) {}
    }
    return false;
  }

  // ─── Inject immediately — before any page JS runs ────────────────────────────
  if (isEnabledSync()) {
    injectInline();
  }

  // ─── Async: verify with real storage and update cache ────────────────────────
  const origin = location.hostname;

  chrome.storage.sync.get(['enabled', 'siteOverrides'], (data) => {
    const globalEnabled = data.enabled !== false;
    const overrides     = data.siteOverrides || {};
    const enabled       = (origin in overrides) ? overrides[origin] : globalEnabled;

    // Update sessionStorage cache for next page load
    try {
      sessionStorage.setItem('__clipunlock_enabled__', enabled ? '1' : '0');
    } catch (_) {}

    // If disabled: signal injector to stand down
    if (!enabled) {
      try {
        const s = document.createElement('script');
        s.textContent =
          'window.__clipunlock_disabled = true;' +
          'window.__clipunlock_active = false;';
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      } catch (_) {}
    }
  });

  // ─── Message handler (popup ↔ content communication) ─────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping')      { sendResponse({ alive: true }); }
    if (msg.action === 'getStatus') { sendResponse({ active: !!window.__clipunlock_active }); }
    return true;
  });

})();
