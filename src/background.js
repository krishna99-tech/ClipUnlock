/**
 * ClipUnlock - background.js (Service Worker)
 * Handles install defaults, icon state, and cross-tab messaging.
 */

// ─── On install: set defaults ─────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.sync.set({
      enabled: true,
      siteOverrides: {},
      totalUnlocks: 0
    });
  }
});

// ─── Update extension icon based on enabled state ────────────────────────────
async function updateIcon(tabId, enabled) {
  const suffix = enabled ? '' : '_off';
  try {
    await chrome.action.setIcon({
      tabId,
      path: {
        16: `icons/icon16${suffix}.png`,
        32: `icons/icon32${suffix}.png`,
        48: `icons/icon48${suffix}.png`,
        128: `icons/icon128${suffix}.png`
      }
    });
  } catch (_) {
    // Tab may have closed — ignore
  }
}

// ─── Listen for tab activation to update icon ────────────────────────────────
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const origin = new URL(tab.url || '').hostname;
    const data = await chrome.storage.sync.get(['enabled', 'siteOverrides']);
    const overrides = data.siteOverrides || {};
    const enabled = origin in overrides ? overrides[origin] : (data.enabled !== false);
    updateIcon(tabId, enabled);
  } catch (_) {}
});

// ─── Listen for messages from popup ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'reloadTab') {
    chrome.tabs.reload(msg.tabId);
    sendResponse({ ok: true });
  }
  if (msg.action === 'updateIcon') {
    updateIcon(msg.tabId, msg.enabled);
    sendResponse({ ok: true });
  }
  return true;
});
