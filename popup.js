/**
 * ClipUnlock - popup.js
 * Controls the extension popup UI and storage state.
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ─── Elements ─────────────────────────────────────────────────────
  const statusCard      = document.getElementById('statusCard');
  const statusLabel     = document.getElementById('statusLabel');
  const statusSub       = document.getElementById('statusSub');
  const statusBadge     = document.getElementById('statusBadge');
  const siteHostname    = document.getElementById('siteHostname');
  const siteToggle      = document.getElementById('siteToggle');
  const globalToggle    = document.getElementById('globalToggle');
  const reloadNotice    = document.getElementById('reloadNotice');
  const reloadBtn       = document.getElementById('reloadBtn');

  const chips = {
    copy:       document.getElementById('chip-copy'),
    cut:        document.getElementById('chip-cut'),
    paste:      document.getElementById('chip-paste'),
    rightclick: document.getElementById('chip-rightclick'),
    select:     document.getElementById('chip-select'),
    drag:       document.getElementById('chip-drag')
  };

  // ─── Get current tab ──────────────────────────────────────────────
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let currentTab = tab;
  let origin = '';

  try {
    origin = new URL(tab.url || '').hostname;
  } catch (_) {
    origin = 'this page';
  }

  siteHostname.textContent = origin || 'this page';

  // ─── Load state ───────────────────────────────────────────────────
  const data = await chrome.storage.sync.get(['enabled', 'siteOverrides']);
  const globalEnabled = data.enabled !== false;
  const siteOverrides = data.siteOverrides || {};

  let siteEnabled;
  if (origin in siteOverrides) {
    siteEnabled = siteOverrides[origin];
  } else {
    siteEnabled = globalEnabled;
  }

  // Set initial UI
  globalToggle.checked = globalEnabled;
  siteToggle.checked   = siteEnabled;
  updateStatusUI(siteEnabled);

  // ─── Site toggle ──────────────────────────────────────────────────
  siteToggle.addEventListener('change', async () => {
    const val = siteToggle.checked;
    const overrides = (await chrome.storage.sync.get('siteOverrides')).siteOverrides || {};
    overrides[origin] = val;
    await chrome.storage.sync.set({ siteOverrides: overrides });
    updateStatusUI(val);
    showReload();
    notifyBackground(val);
  });

  // ─── Global toggle ────────────────────────────────────────────────
  globalToggle.addEventListener('change', async () => {
    const val = globalToggle.checked;
    await chrome.storage.sync.set({ enabled: val });
    // Only update site toggle UI if no site-specific override exists
    const overrides = (await chrome.storage.sync.get('siteOverrides')).siteOverrides || {};
    if (!(origin in overrides)) {
      siteToggle.checked = val;
      updateStatusUI(val);
    }
    showReload();
    notifyBackground(val);
  });

  // ─── Reload button ────────────────────────────────────────────────
  reloadBtn.addEventListener('click', () => {
    chrome.tabs.reload(currentTab.id);
    window.close();
  });

  // ─── Helper: Update status UI ─────────────────────────────────────
  function updateStatusUI(enabled) {
    if (enabled) {
      statusCard.classList.remove('off');
      statusLabel.textContent = 'Active on this page';
      statusSub.textContent   = 'All restrictions removed';
      statusBadge.textContent = 'ON';
      Object.values(chips).forEach(c => {
        c.classList.add('active');
        c.classList.remove('inactive');
      });
    } else {
      statusCard.classList.add('off');
      statusLabel.textContent = 'Disabled on this page';
      statusSub.textContent   = 'Native site behavior restored';
      statusBadge.textContent = 'OFF';
      Object.values(chips).forEach(c => {
        c.classList.remove('active');
        c.classList.add('inactive');
      });
    }
  }

  // ─── Helper: Show reload notice ───────────────────────────────────
  let reloadShown = false;
  function showReload() {
    if (!reloadShown) {
      reloadShown = true;
      reloadNotice.style.display = 'flex';
    }
  }

  // ─── Helper: Notify background to update icon ─────────────────────
  function notifyBackground(enabled) {
    chrome.runtime.sendMessage({
      action: 'updateIcon',
      tabId: currentTab.id,
      enabled
    });
  }

});
