/**
 * background.js — Stay extension service worker (MV3)
 *
 * Responsibilities:
 *   1. Toolbar action click → open the Chrome Side Panel.
 *   2. Edge-trigger click in the page → open the Chrome Side Panel for that tab.
 *      (chrome.sidePanel.open requires a user gesture; the content script's
 *       click is a gesture, and the gesture is preserved across sendMessage
 *       in Chrome 116+.)
 *   3. "Take me to my answer" in the side panel → scroll the active tab to the
 *      bottom of the chat (via chrome.scripting.executeScript).
 *   4. Forward ANSWER_READY notifications from the content script to the side
 *      panel, and notify the side panel when the active tab changes URL/title
 *      so it can refresh its per-chat notes context.
 */

'use strict';

const LOG = '[Stay/bg]';

// ── 1. Default behavior: opening the toolbar action opens the side panel ────

try {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn(LOG, 'setPanelBehavior failed', err));
} catch (err) {
  console.warn(LOG, 'sidePanel API unavailable', err);
}

// ── 2 + 3 + Forwarders. Single message hub. ────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  switch (msg.type) {

    // From content script edge trigger → open side panel for the sender's tab.
    // Must run synchronously in the message handler to preserve the user gesture.
    case 'STAY_OPEN_SIDE_PANEL': {
      const tabId = sender.tab && sender.tab.id;
      const windowId = sender.tab && sender.tab.windowId;
      try {
        if (tabId != null) {
          chrome.sidePanel.open({ tabId }).catch((err) => {
            // Fallback: per-window open if per-tab fails for any reason.
            if (windowId != null) {
              chrome.sidePanel.open({ windowId }).catch((e2) => {
                console.warn(LOG, 'sidePanel.open failed', err, e2);
              });
            }
          });
        } else if (windowId != null) {
          chrome.sidePanel.open({ windowId }).catch((err) => {
            console.warn(LOG, 'sidePanel.open(windowId) failed', err);
          });
        }
      } catch (err) {
        console.warn(LOG, 'sidePanel.open threw', err);
      }
      sendResponse({ ok: true });
      return false;
    }

    // From side panel "Take me to my answer" → scroll the active tab.
    case 'STAY_SCROLL_TO_BOTTOM': {
      scrollActiveTabToBottom();
      sendResponse({ ok: true });
      return false;
    }

    // From content script when the AI finishes answering → forward to side panel.
    case 'STAY_ANSWER_READY': {
      chrome.runtime
        .sendMessage({ type: 'STAY_ANSWER_READY', tabId: sender.tab && sender.tab.id })
        .catch(() => { /* side panel might be closed; that's fine */ });
      sendResponse({ ok: true });
      return false;
    }

    // From side panel asking the active tab's content script to scroll its
    // own scroll container (chat scroll, not page scroll). Falls through to
    // a page-level scroll if the content script isn't there.
    case 'STAY_REQUEST_TAB_SCROLL_BOTTOM': {
      requestContentScriptScrollOrFallback();
      sendResponse({ ok: true });
      return false;
    }

    // From side panel (draw.js "Drag" button) → relay the PNG dataUrl to the
    // active tab's content script, which drops it into the chat composer.
    case 'STAY_PASTE_IMAGE_TO_CHAT': {
      relayPasteImageToActiveTab(msg.dataUrl)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, err: String(err) }));
      return true; // async sendResponse
    }
  }

  return false;
});

async function relayPasteImageToActiveTab(dataUrl) {
  if (!dataUrl) return { ok: false, err: 'no dataUrl' };
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || tab.id == null) return { ok: false, err: 'no active tab' };
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'STAY_PASTE_IMAGE_TO_CHAT',
      dataUrl,
    });
    return res || { ok: false, err: 'no response' };
  } catch (err) {
    return { ok: false, err: String(err) };
  }
}

async function scrollActiveTabToBottom() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;

    // Prefer asking the content script (it knows the chat's scroll container).
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'STAY_SCROLL_CHAT_BOTTOM' });
      if (res && res.ok) return;
    } catch (_) { /* no listener — fall through */ }

    // Fallback: scroll the document itself.
    if (!tab.url || /^(chrome|about|edge|chrome-extension):/.test(tab.url)) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }),
    });
  } catch (err) {
    console.warn(LOG, 'scrollActiveTabToBottom failed', err);
  }
}

async function requestContentScriptScrollOrFallback() {
  scrollActiveTabToBottom();
}

// ── 4. Tab change → notify side panel so it can re-bind notes context ──────

function notifyPanelTabChanged(tab) {
  if (!tab) return;
  chrome.runtime
    .sendMessage({ type: 'STAY_TAB_UPDATED', url: tab.url || '', title: tab.title || '', tabId: tab.id })
    .catch(() => { /* panel closed → ignore */ });
}

chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs.get(info.tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    notifyPanelTabChanged(tab);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title && changeInfo.status !== 'complete') return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].id === tabId) notifyPanelTabChanged(tab);
  });
});
