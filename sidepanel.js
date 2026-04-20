/**
 * sidepanel.js — Stay Side Panel coordinator
 *
 * Runs inside chrome-extension://…/sidepanel.html. This is the side-panel
 * equivalent of the "shell" that content.js previously built in the page's
 * Shadow DOM. It defines the shared `_Stay` namespace base (so notes.js /
 * draw.js / game.js work unchanged), handles tab switching, syncs with the
 * active browser tab, and shows the answer-ready notification — but only
 * while the Play tab is active.
 *
 * Load order (see sidepanel.html):
 *   1. notes.js     → S.renderNotesTab, S.setupNotesDropZone
 *   2. game.js      → S.renderColorGame
 *   3. draw.js      → S.renderDrawTab
 *   4. sidepanel.js (this file) → namespace base + bootstrap
 */
(function (S) {
  'use strict';

  var LOG = '[Stay/side]';

  // ── Per-tab info text shown in Row 3 of the header ───────────────────────
  // Mirrors the inspiration design — a short instruction line that explains
  // how each section of Stay works.
  var INFO_TEXT = {
    notes: 'Select any text in the chat and drag here to make a note.',
    draw:  'Draw anything in the space below, then copy/paste the art to the chat.',
    game:  'A quick mini-game to keep you engaged while your answer streams in.',
  };

  // ── Namespace base (mirrors what content.js sets in the page) ─────────────

  S.PLATFORM           = 'chatgpt';   // updated by refreshTabInfo()
  S.activeTab          = 'notes';
  S.lastSentPromptText = '';
  S.cwgInternalDrag    = false;
  S.shadowRoot         = null;        // we ARE the document — no shadow root

  /**
   * Element lookup that mirrors content.js's S.el. Notes/draw/game use this.
   * In the side panel we have no shadow root, so it's just getElementById.
   */
  S.el = function (id) { return document.getElementById(id); };

  S.storageContextOk = function () {
    try {
      return (
        typeof chrome !== 'undefined' &&
        chrome.storage && chrome.storage.local &&
        chrome.runtime && typeof chrome.runtime.id === 'string' &&
        chrome.runtime.id.length > 0
      );
    } catch (e) { return false; }
  };

  // ── Per-tab context (URL, chatId, platform) ──────────────────────────────

  var currentTabId    = null;
  var currentTabUrl   = '';
  var currentTabTitle = '';
  var currentChatId   = '/';

  S.pageContext = {
    href: '', pathname: '', title: '', selection: '',
    hostname: '', chatId: '', platform: '',
  };

  S.getPageContext = function () { return S.pageContext; };

  /** Used by notes.js to bucket blocks per chat. */
  S.getCurrentChatId = function () { return currentChatId; };

  function deriveChatIdFromUrl(url) {
    try {
      var u = new URL(url);
      var p = u.pathname;
      if (u.hostname === 'gemini.google.com') {
        var m2 = p.match(/\/app\/([^/?#]+)/);
        return m2 ? '/app/' + m2[1] : '/app';
      }
      if (u.hostname === 'claude.ai') {
        var m3 = p.match(/\/chat\/([^/?#]+)/);
        return m3 ? '/chat/' + m3[1] : p;
      }
      // chatgpt.com / chat.openai.com
      var m = p.match(/\/c\/([^/?#]+)/);
      return m ? '/c/' + m[1] : p;
    } catch (e) { return '/'; }
  }

  function derivePlatformFromUrl(url) {
    try {
      var h = new URL(url).hostname;
      if (h === 'gemini.google.com') return 'gemini';
      if (h === 'claude.ai')         return 'claude';
      return 'chatgpt';
    } catch (e) { return 'chatgpt'; }
  }

  function refreshTabInfo() {
    if (!chrome.tabs) return;
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) return;
      var prevChatId = currentChatId;

      currentTabId    = tab.id;
      currentTabUrl   = tab.url   || '';
      currentTabTitle = tab.title || '';
      currentChatId   = deriveChatIdFromUrl(currentTabUrl);
      S.PLATFORM      = derivePlatformFromUrl(currentTabUrl);

      var hostname = '';
      try { hostname = new URL(currentTabUrl).hostname; } catch (_) {}

      S.pageContext = {
        href: currentTabUrl,
        pathname: '',
        title: currentTabTitle,
        selection: S.pageContext.selection || '',
        hostname: hostname,
        chatId: currentChatId,
        platform: S.PLATFORM,
      };

      // Switching chats invalidates a stale "answer ready" badge.
      if (prevChatId !== currentChatId) {
        answerReady = false;
        hideReadyBadge();
      }

      // Re-render notes if that's the active tab so per-chat blocks load.
      if (S.activeTab === 'notes' && typeof S.renderNotesTab === 'function') {
        S.renderNotesTab();
      }
    });
  }

  // ── Tab switching ────────────────────────────────────────────────────────

  function setInfoText(tab) {
    var el = document.getElementById('cwg-info-text');
    if (!el) return;
    el.textContent = INFO_TEXT[tab] || '';
  }

  S.switchTab = function (tab) {
    S.activeTab = tab;

    ['notes', 'draw', 'game'].forEach(function (t) {
      var btn = document.getElementById('cwg-tab-' + t);
      if (btn) btn.classList.toggle('cwg-tab--active', t === tab);
    });

    setInfoText(tab);

    var scoreline = document.getElementById('cwg-panel-scoreline');
    var header    = document.getElementById('cwg-panel-header');
    if (scoreline) scoreline.hidden = (tab !== 'game');
    if (header)    header.classList.toggle('cwg-panel-header--color', tab === 'game');

    // Show the "answer ready" badge ONLY in Play.
    if (tab === 'game' && answerReady) showReadyBadge();
    else hideReadyBadge();

    if      (tab === 'game') S.renderColorGame();
    else if (tab === 'draw') S.renderDrawTab();
    else                     S.renderNotesTab();
  };

  document.getElementById('cwg-tab-notes').addEventListener('click', function () { S.switchTab('notes'); });
  document.getElementById('cwg-tab-draw') .addEventListener('click', function () { S.switchTab('draw');  });
  document.getElementById('cwg-tab-game') .addEventListener('click', function () { S.switchTab('game');  });

  // ── Pin / minimize handlers ──────────────────────────────────────────────
  //
  // The custom brand-bar (with pin + chevron-down) was removed to eliminate
  // duplication with Chrome's native side-panel chrome, which already provides
  // pin and close controls. The listeners below remain as a safety net in case
  // the markup is ever restored; they're null-safe.

  var pinBtn = document.getElementById('cwg-pin-btn');
  if (pinBtn) {
    pinBtn.addEventListener('click', function () {
      var pressed = pinBtn.getAttribute('aria-pressed') === 'true';
      pinBtn.setAttribute('aria-pressed', pressed ? 'false' : 'true');
    });
  }

  var minimizeBtn = document.getElementById('cwg-minimize-btn');
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', function () {
      try { window.close(); }
      catch (e) { /* some Chromium builds: noop, user closes via panel header */ }
    });
  }

  // ── Answer-ready badge ───────────────────────────────────────────────────
  // The badge belongs to the Play tab — it should not appear while the user
  // is taking notes or drawing. We track readiness in `answerReady` and only
  // mount the badge in the DOM when the active tab is Play.

  var readyBadge  = document.getElementById('cwg-ready-badge');
  var answerReady = false;

  function showReadyBadge() { if (readyBadge) readyBadge.classList.add('cwg-show'); }
  function hideReadyBadge() { if (readyBadge) readyBadge.classList.remove('cwg-show'); }

  document.getElementById('cwg-ready-close').addEventListener('click', function (e) {
    e.stopPropagation();
    answerReady = false;
    hideReadyBadge();
  });

  document.getElementById('cwg-ready-take-me').addEventListener('click', function (e) {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'STAY_SCROLL_TO_BOTTOM' }).catch(function () {});
    answerReady = false;
    hideReadyBadge();
  });

  // ── Notes drop zone (file/text drop into the notes column) ───────────────

  if (typeof S.setupNotesDropZone === 'function') {
    S.setupNotesDropZone(document.getElementById('cwg-panel-body'));
  }

  // ── Messages from background.js / content script ─────────────────────────

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'STAY_TAB_UPDATED')  { refreshTabInfo(); return; }
    if (msg.type === 'STAY_ANSWER_READY') {
      answerReady = true;
      // Only surface the badge if the user is currently in the Play tab —
      // otherwise it sits ready and appears the moment they switch over.
      if (S.activeTab === 'game') showReadyBadge();
      return;
    }
  });

  // ── Bootstrap ────────────────────────────────────────────────────────────

  refreshTabInfo();
  S.switchTab('notes');

  console.log(LOG, 'side panel ready');

})(window._Stay = window._Stay || {});
