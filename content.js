/**
 * content.js — Stay extension core
 *
 * Defines the shared _Stay namespace and wires together:
 *   - Platform detection & shared state
 *   - Dock / FAB positioning
 *   - Panel DOM (built once)
 *   - Tab routing  →  notes.js / game.js / draw.js
 *   - Navigation hooks & answer-ready observer
 *
 * Load order (manifest.json):
 *   1. notes.js   — adds _Stay.renderNotesTab, _Stay.setupNotesDropZone
 *   2. game.js    — adds _Stay.renderColorGame
 *   3. draw.js    — adds _Stay.renderDrawTab
 *   4. content.js — shared core + init  (this file, loaded LAST)
 */
(function (S) {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────

  var LOG           = '[Stay]';
  var PANEL_WIDTH_PX = 360;

  /** Show promo popup only after AI takes this long (ms) — keeps it quiet for fast responses. */
  var DOCK_SHOW_CARD_MS = 4000;
  /** Show FAB after this many ms of streaming (catches missed-send edge cases). */
  var STREAMING_DOCK_MIN_MS = 1000;
  /** Pixels left of the viewport edge to keep the FAB clear of the scrollbar. */
  var DOCK_SCROLLBAR_GAP_PX = 18;
  /** Gap between top chrome and panel top edge. */
  var PANEL_TOP_GAP_PX = 8;
  /** CSS class applied to fixed top-chrome elements to shift them left when panel is open. */
  var TOP_CHROME_SHIFT_CLASS = 'cwg-topchrome-shift';

  // ── Platform detection ───────────────────────────────────────────────────────

  S.PLATFORM = (function () {
    var h = location.hostname;
    if (h === 'gemini.google.com') return 'gemini';
    if (h === 'claude.ai')         return 'claude';
    return 'chatgpt';
  })();

  /** Platform-specific textarea / editor selectors. */
  var PLATFORM_COMPOSER_SELECTORS = {
    chatgpt: '[data-testid="prompt-textarea"], #prompt-textarea',
    gemini:  'rich-textarea, .ql-editor',
    claude:  '.ProseMirror',
  };

  // ── Shared mutable state ─────────────────────────────────────────────────────

  var dockFlowTimers   = [];
  var streamingDockTimer = null;
  var dockAlignRaf     = null;
  var panelGeomT       = null;

  S.activeTab           = 'notes';
  S.lastSentPromptText  = '';
  S.cwgInternalDrag     = false;

  var panelOpen         = false;
  var userSentThisTurn  = false;
  var answerInFlight    = false;

  // ── Shared utilities ─────────────────────────────────────────────────────────

  S.storageContextOk = function storageContextOk() {
    try {
      return (
        typeof chrome !== 'undefined' &&
        chrome.storage && chrome.storage.local &&
        chrome.runtime && typeof chrome.runtime.id === 'string' && chrome.runtime.id.length > 0
      );
    } catch (err) { return false; }
  };

  S.getCurrentChatId = function getCurrentChatId() {
    var p = location.pathname;
    if (S.PLATFORM === 'chatgpt') {
      var m = p.match(/\/c\/([^/?#]+)/);
      return m ? '/c/' + m[1] : p;
    }
    if (S.PLATFORM === 'gemini') {
      var m2 = p.match(/\/app\/([^/?#]+)/);
      return m2 ? '/app/' + m2[1] : '/app';
    }
    if (S.PLATFORM === 'claude') {
      var m3 = p.match(/\/chat\/([^/?#]+)/);
      return m3 ? '/chat/' + m3[1] : p;
    }
    return p;
  };

  function gameWidthPx() {
    return Math.min(PANEL_WIDTH_PX, window.innerWidth);
  }

  // ── Composer bar detection ───────────────────────────────────────────────────

  function findComposerBarRect() {
    var platformSel = PLATFORM_COMPOSER_SELECTORS[S.PLATFORM] || '';
    var genericSel  = 'textarea[placeholder], [contenteditable="true"]';
    var combined    = platformSel ? platformSel + ', ' + genericSel : genericSel;
    var probes = document.querySelectorAll(combined);
    var el = null;
    for (var i = 0; i < probes.length; i++) {
      if (probes[i] && !probes[i].closest('#cwg-root')) { el = probes[i]; break; }
    }
    if (!el) return null;
    var ih = window.innerHeight;
    var minH = ih * 0.52;
    var walk = el, best = null, bestH = Infinity, d;
    for (d = 0; d < 18 && walk; d++) {
      var r = walk.getBoundingClientRect();
      if (r.width > 240 && r.bottom > ih * 0.28 && r.height >= 32 && r.height < minH && r.height < bestH) {
        bestH = r.height; best = r;
      }
      walk = walk.parentElement;
    }
    if (best) return best;
    walk = el; best = null; bestH = Infinity; minH = ih * 0.62;
    for (d = 0; d < 18 && walk; d++) {
      var r2 = walk.getBoundingClientRect();
      if (r2.width > 240 && r2.bottom > ih * 0.28 && r2.height >= 28 && r2.height < minH && r2.height < bestH) {
        bestH = r2.height; best = r2;
      }
      walk = walk.parentElement;
    }
    return best || el.getBoundingClientRect();
  }

  // ── Prompt capture ───────────────────────────────────────────────────────────

  function capturePromptText() {
    var sel      = PLATFORM_COMPOSER_SELECTORS[S.PLATFORM] || '';
    var fallback = 'textarea[placeholder], [contenteditable="true"]';
    var combined = sel ? sel + ', ' + fallback : fallback;
    var ta = null;
    var nodes = document.querySelectorAll(combined);
    for (var j = 0; j < nodes.length; j++) {
      if (!nodes[j].closest('#cwg-root')) { ta = nodes[j]; break; }
    }
    var text = ta ? (ta.value || ta.innerText || ta.textContent || '').trim() : '';
    if (text) { S.lastSentPromptText = text.slice(0, 200); return; }

    // Fallback: last user-turn message visible in the conversation DOM
    var userSelectors = [
      '[data-message-author-role="user"] .whitespace-pre-wrap',
      '[data-testid="user-message"]',
      '.human-turn p', '.human p',
      '[class*="UserMessage"] p',
    ];
    for (var si = 0; si < userSelectors.length; si++) {
      var els = document.querySelectorAll(userSelectors[si]);
      if (els.length > 0) {
        var last = els[els.length - 1];
        var t = (last.innerText || last.textContent || '').trim();
        if (t) { S.lastSentPromptText = t.slice(0, 200); return; }
      }
    }
  }

  // ── Dock alignment ───────────────────────────────────────────────────────────

  function updateDockAlign() {
    // Bottom is fixed at 60px via CSS; only manage right clearance for scrollbar
    document.documentElement.style.setProperty('--cwg-dock-right', DOCK_SCROLLBAR_GAP_PX + 'px');
  }

  function scheduleDockAlignRefresh() {
    if (dockAlignRaf) cancelAnimationFrame(dockAlignRaf);
    dockAlignRaf = requestAnimationFrame(function () { dockAlignRaf = null; updateDockAlign(); });
  }

  // ── Panel geometry ────────────────────────────────────────────────────────────

  function collectTopChromeRoots() {
    var shells = [document.getElementById('__next'), document.getElementById('root')].filter(Boolean);
    if (shells.length === 0) return [];
    var candidates = [];
    shells.forEach(function (shell) {
      var q = shell.querySelectorAll('*');
      for (var i = 0; i < q.length; i++) {
        var el = q[i];
        if (!el || el.id === 'cwg-root' || el.closest('#cwg-root')) continue;
        var cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        var r = el.getBoundingClientRect();
        if (r.top > 100 || r.width < window.innerWidth * 0.45 || r.height > 200 || r.height < 16) continue;
        candidates.push(el);
      }
    });
    return candidates.filter(function (a) {
      return !candidates.some(function (b) { return b !== a && b.contains(a); });
    });
  }

  function applyPanelSafeGeometry(roots) {
    // Panel bottom is fixed at 60px (CSS). Only compute top to clear fixed top chrome.
    var i, headerBottom = 0;
    for (i = 0; i < roots.length; i++) {
      var bb = roots[i].getBoundingClientRect().bottom;
      if (bb > headerBottom) headerBottom = bb;
    }
    var topPx = (roots.length === 0 && headerBottom < 12)
      ? PANEL_TOP_GAP_PX
      : Math.ceil(headerBottom) + PANEL_TOP_GAP_PX;
    topPx = Math.max(0, Math.min(topPx, window.innerHeight - 120));
    document.documentElement.style.setProperty('--cwg-panel-top', topPx + 'px');
  }

  function refreshTopChromeShift() {
    document.querySelectorAll('.' + TOP_CHROME_SHIFT_CLASS).forEach(function (el) { el.classList.remove(TOP_CHROME_SHIFT_CLASS); });
    if (!document.body.classList.contains('llm-game-open')) {
      document.documentElement.style.removeProperty('--cwg-panel-top');
      return;
    }
    var roots = collectTopChromeRoots();
    roots.forEach(function (node) { node.classList.add(TOP_CHROME_SHIFT_CLASS); });
    applyPanelSafeGeometry(roots);
  }

  function setPanelOpenLayout(on) {
    var html = document.documentElement, body = document.body;
    if (!body) return;
    if (!on) {
      body.classList.remove('llm-game-open');
      html.classList.remove('llm-game-squeeze');
      html.style.removeProperty('--llm-panel-w');
      html.style.removeProperty('--cwg-panel-top');
      refreshTopChromeShift();
      return;
    }
    html.style.setProperty('--llm-panel-w', gameWidthPx() + 'px');
    body.classList.add('llm-game-open');
    html.classList.add('llm-game-squeeze');
    requestAnimationFrame(function () {
      if (!body.classList.contains('llm-game-open')) return;
      html.style.setProperty('--llm-panel-w', gameWidthPx() + 'px');
      refreshTopChromeShift();
      setTimeout(refreshTopChromeShift, 350);
      setTimeout(refreshTopChromeShift, 900);
    });
  }

  // ── Stop button detection ────────────────────────────────────────────────────

  function findStopButton() {
    var candidates = document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var b    = candidates[i];
      if (b.closest('#cwg-root')) continue;
      var r    = b.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      var text = (b.textContent || '').trim().toLowerCase();
      var aria = (b.getAttribute('aria-label') || '').toLowerCase();
      var tid  = (b.getAttribute('data-testid') || '').toLowerCase();
      if (tid.includes('stop') && (tid.includes('generat') || tid.includes('stream') || tid === 'stop-button' || tid.endsWith('stop-button'))) return b;
      if (aria.includes('stop generating') || aria === 'stop' || aria.endsWith(' stop')) return b;
      if (text === 'stop' || (text.length < 48 && (text.includes('stop generating') || text === 'stop streaming'))) return b;
    }
    return null;
  }

  function isLikelyChatInput(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    if (el.closest('[contenteditable="true"]')) return true;
    if (el.closest('#prompt-textarea')) return true;
    if (el.closest('[data-testid="prompt-textarea"]')) return true;
    return false;
  }

  function isLikelySendClick(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('#cwg-root')) return false;
    var btn = el.closest('button, [role="button"]');
    if (!btn) return false;
    var aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    var tid  = (btn.getAttribute('data-testid') || '').toLowerCase();
    var title = (btn.getAttribute('title') || '').toLowerCase();
    if (tid.indexOf('send') !== -1) return true;
    if (tid === 'composer-send-button' || tid === 'send-button') return true;
    if (aria.indexOf('send') !== -1 && aria.indexOf('feedback') === -1) return true;
    if (title.indexOf('send') !== -1) return true;
    if ((btn.textContent || '').trim().toLowerCase() === 'send') return true;
    return false;
  }

  // ── Dock / panel helpers ──────────────────────────────────────────────────────

  function syncFabSpin() {
    var fab  = document.getElementById('cwg-fab');
    var dock = document.getElementById('cwg-dock');
    if (!fab || !dock) return;
    if (!dock.classList.contains('cwg-visible') || dock.classList.contains('cwg-expanded')) return;
    fab.classList.toggle('cwg-fab--waiting', answerInFlight || !!findStopButton());
  }

  function hideDock() {
    clearDockFlowTimers();
    var dock = document.getElementById('cwg-dock');
    var fab  = document.getElementById('cwg-fab');
    if (!dock || !fab) return;
    dock.classList.remove('cwg-visible', 'cwg-expanded', 'cwg-dock--card-reveal');
    fab.classList.remove('cwg-fab--waiting');
  }

  function showWaitingFab() {
    var dock = document.getElementById('cwg-dock');
    var fab  = document.getElementById('cwg-fab');
    if (!dock || !fab) return;
    dock.classList.add('cwg-visible');
    dock.classList.remove('cwg-expanded', 'cwg-dock--card-reveal');
    syncFabSpin();
    scheduleDockAlignRefresh();
  }

  function expandDockChip() {
    clearDockFlowTimers();
    userSentThisTurn = false;
    var dock = document.getElementById('cwg-dock');
    var fab  = document.getElementById('cwg-fab');
    if (!dock || !fab) return;
    fab.classList.remove('cwg-fab--waiting');
    dock.classList.add('cwg-visible', 'cwg-expanded', 'cwg-dock--card-reveal');
    scheduleDockAlignRefresh();
    console.log(LOG, 'chip expanded');
  }

  function onFabClick(e) {
    e.stopPropagation();
    var dock = document.getElementById('cwg-dock');
    if (!dock || dock.classList.contains('cwg-expanded')) return;
    // Skip the popup card — go straight to the side panel
    openPanel();
  }

  // ── Tab routing ───────────────────────────────────────────────────────────────

  S.switchTab = function switchTab(tab) {
    S.activeTab = tab;
    var tabGame  = document.getElementById('cwg-tab-game');
    var tabNotes = document.getElementById('cwg-tab-notes');
    var tabDraw  = document.getElementById('cwg-tab-draw');
    if (tabGame)  tabGame.classList.toggle('cwg-tab--active',  tab === 'game');
    if (tabNotes) tabNotes.classList.toggle('cwg-tab--active', tab === 'notes');
    if (tabDraw)  tabDraw.classList.toggle('cwg-tab--active',  tab === 'draw');

    var scoreline = document.getElementById('cwg-panel-scoreline');
    var header    = document.getElementById('cwg-panel-header');
    if (scoreline) scoreline.hidden = (tab !== 'game');
    if (header) header.classList.toggle('cwg-panel-header--color', tab === 'game');

    if (tab === 'game')  { S.renderColorGame(); }
    else if (tab === 'draw') { S.renderDrawTab(); }
    else                 { S.renderNotesTab(); }
  };

  function openPanel() {
    panelOpen = true;
    hideDock();
    setPanelOpenLayout(true);
    console.log(LOG, 'panel opened');

    var panel = document.getElementById('cwg-panel');
    panel.classList.remove('cwg-panel--enter');
    document.getElementById('cwg-ready-badge').classList.remove('cwg-show');
    panel.classList.add('cwg-open');
    requestAnimationFrame(function () { panel.classList.add('cwg-panel--enter'); });
    setTimeout(function () { panel.classList.remove('cwg-panel--enter'); }, 440);

    S.switchTab(S.activeTab);
  }

  function minimizePanel() {
    panelOpen = false;
    setPanelOpenLayout(false);
    document.getElementById('cwg-panel').classList.remove('cwg-open', 'cwg-panel--enter');
    console.log(LOG, 'panel minimized');
    showWaitingFab();
    scheduleDockAlignRefresh();
  }

  function hideReadyBadge() {
    var el = document.getElementById('cwg-ready-badge');
    if (el) el.classList.remove('cwg-show');
  }

  function showReadyBadge() {
    if (!panelOpen) return;
    var badge = document.getElementById('cwg-ready-badge');
    if (!badge) return;
    badge.classList.add('cwg-show');
    console.log(LOG, 'answer ready badge shown');
  }

  // ── Dock flow timers ──────────────────────────────────────────────────────────

  function clearDockFlowTimers() {
    dockFlowTimers.forEach(function (id) { clearTimeout(id); });
    dockFlowTimers = [];
  }

  function scheduleDockFlow() {
    clearDockFlowTimers();
    var dock = document.getElementById('cwg-dock');
    var fab  = document.getElementById('cwg-fab');
    if (!dock || !fab) return;
    var id8 = setTimeout(function () {
      if (!userSentThisTurn || panelOpen) return;
      if (!dock.classList.contains('cwg-visible')) return;
      expandDockChip();
    }, DOCK_SHOW_CARD_MS);
    dockFlowTimers.push(id8);
  }

  function clearStreamingDockTimer() {
    if (streamingDockTimer !== null) { clearTimeout(streamingDockTimer); streamingDockTimer = null; }
  }

  function scheduleStreamingDockIfSlow() {
    clearStreamingDockTimer();
    streamingDockTimer = setTimeout(function () {
      streamingDockTimer = null;
      if (panelOpen) return;
      var dock = document.getElementById('cwg-dock');
      if (!dock || dock.classList.contains('cwg-visible')) return;
      onPromptSent('streaming-slow');
    }, STREAMING_DOCK_MIN_MS);
  }

  function onPromptSent(reason) {
    clearStreamingDockTimer();
    console.log(LOG, 'prompt sent', { reason: reason });
    userSentThisTurn = true;
    answerInFlight   = true;
    hideReadyBadge();
    clearDockFlowTimers();
    updateDockAlign();
    showWaitingFab();
    scheduleDockFlow();
  }

  function onClickCapture(e) {
    if (!isLikelySendClick(e.target)) return;
    capturePromptText();
    onPromptSent('send-click');
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (!isLikelyChatInput(e.target)) return;
    capturePromptText();
    onPromptSent('enter-key');
  }

  // ── Scroll helper ─────────────────────────────────────────────────────────────

  function scrollChatToBottom() {
    var roots = [document.getElementById('__next'), document.getElementById('root')].filter(Boolean);
    if (roots.length === 0) roots.push(document.body);
    var pick = null, pickScore = 0;
    roots.forEach(function (root) {
      root.querySelectorAll('div').forEach(function (el) {
        if (!el || el.id === 'cwg-root' || el.closest('#cwg-root')) return;
        var st = window.getComputedStyle(el);
        if (st.overflowY !== 'auto' && st.overflowY !== 'scroll') return;
        var ex = el.scrollHeight - el.clientHeight;
        if (ex > pickScore && el.clientHeight > Math.min(280, window.innerHeight * 0.32)) { pickScore = ex; pick = el; }
      });
    });
    if (pick && pickScore > 24) {
      try { pick.scrollTo({ top: pick.scrollHeight, behavior: 'smooth' }); }
      catch (e) { pick.scrollTop = pick.scrollHeight; }
      return;
    }
    try { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); }
    catch (e2) { document.documentElement.scrollTop = document.documentElement.scrollHeight; }
  }

  // ── DOM: build the extension panel once ──────────────────────────────────────

  function ensureDom() {
    if (document.getElementById('cwg-root')) return;

    var root = document.createElement('div');
    root.id = 'cwg-root';
    root.className = 'cwg-pointer';
    root.innerHTML =
      '<div id="cwg-dock" class="cwg-dock cwg-pointer">' +
      '<div id="cwg-chip-popup" class="cwg-chip-popup">' +
      '<div class="cwg-chip-top-row">' +
      '<p id="cwg-chip-text" class="cwg-chip-text">Want to do something while your answer loads?</p>' +
      '<button type="button" class="cwg-chip-close" id="cwg-chip-close" aria-label="Close">' +
      '<svg class="cwg-chip-close-svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>' +
      '</svg></button></div>' +
      '<button type="button" id="cwg-surprise-btn">Buddy</button>' +
      '</div>' +
      '<button type="button" id="cwg-fab" aria-label="Open Stay panel" title="Open Stay">' +
      '<span class="cwg-fab-flower-wrap" aria-hidden="true">' +
      '<svg class="cwg-fab-flower" width="22" height="22" viewBox="0 0 24 24">' +
      '<g fill="#ffffff">' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(0 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(72 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(144 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(216 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(288 12 12)"/>' +
      '<circle cx="12" cy="12" r="2.4" fill="rgba(255,255,255,0.9)"/>' +
      '</g></svg></span></button>' +
      '</div>' +
      '<div id="cwg-panel" class="cwg-pointer">' +
      '<div id="cwg-panel-header">' +
      // Brand bar (purple)
      '<div class="cwg-brand-bar">' +
      '<span class="cwg-brand-logo" aria-hidden="true">' +
      '<svg width="18" height="18" viewBox="0 0 24 24"><g fill="#ffffff">' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(0 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(72 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(144 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(216 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(288 12 12)"/>' +
      '<circle cx="12" cy="12" r="2.4" fill="rgba(255,255,255,0.85)"/>' +
      '</g></svg></span>' +
      '<span class="cwg-brand-name">Stay</span>' +
      '<div class="cwg-brand-actions">' +
      '<button type="button" class="cwg-header-icon-btn cwg-header-icon-btn--white" id="cwg-minimize-btn" aria-label="Minimise panel">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M9 6l6 6-6 6"/>' +
      '</svg></button>' +
      '</div></div>' +
      // Tab row — Notes / Draw / Game
      '<div class="cwg-tab-row"><div class="cwg-tab-bar">' +
      '<button type="button" class="cwg-tab cwg-tab--active" id="cwg-tab-notes">Notes</button>' +
      '<button type="button" class="cwg-tab" id="cwg-tab-draw">Draw</button>' +
      '<button type="button" class="cwg-tab" id="cwg-tab-game">Game</button>' +
      '</div></div>' +
      '<p id="cwg-panel-title" hidden>The Art of Waiting</p>' +
      '<p id="cwg-panel-scoreline" class="cwg-panel-scoreline" hidden></p>' +
      '</div>' +
      '<div id="cwg-ready-badge" class="cwg-ready-badge-wrap">' +
      '<div class="cwg-ready-badge-row">' +
      '<span class="cwg-ready-badge-text">Your answer is ready</span>' +
      '<button type="button" class="cwg-ready-badge-close" id="cwg-ready-close" aria-label="Dismiss notification">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>' +
      '</svg></button></div>' +
      '<button type="button" class="cwg-ready-take-me-btn" id="cwg-ready-take-me">Take me to my answer</button>' +
      '</div>' +
      '<div id="cwg-panel-body"></div>' +
      '</div>';

    document.documentElement.appendChild(root);

    // Core button wiring
    document.getElementById('cwg-fab').addEventListener('click', onFabClick);
    document.getElementById('cwg-chip-close').addEventListener('click', hideDock);
    document.getElementById('cwg-surprise-btn').addEventListener('click', openPanel);
    document.getElementById('cwg-minimize-btn').addEventListener('click', minimizePanel);
    document.getElementById('cwg-tab-notes').addEventListener('click', function () { S.switchTab('notes'); });
    document.getElementById('cwg-tab-draw').addEventListener('click',  function () { S.switchTab('draw');  });
    document.getElementById('cwg-tab-game').addEventListener('click',  function () { S.switchTab('game');  });
    document.getElementById('cwg-ready-close').addEventListener('click', function (e) {
      e.stopPropagation(); hideReadyBadge();
    });
    document.getElementById('cwg-ready-take-me').addEventListener('click', function (e) {
      e.stopPropagation(); scrollChatToBottom();
    });

    // Drop zone + paste — set up ONCE so listeners never accumulate (implemented in notes.js)
    S.setupNotesDropZone(document.getElementById('cwg-panel-body'));

    // Window resize / scroll
    var resizeT = null;
    window.addEventListener('resize', function () {
      if (resizeT) clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        resizeT = null;
        updateDockAlign();
        if (document.body.classList.contains('llm-game-open')) refreshTopChromeShift();
      }, 80);
    }, true);
    window.addEventListener('scroll', function () {
      scheduleDockAlignRefresh();
      if (!document.body.classList.contains('llm-game-open')) return;
      if (panelGeomT) clearTimeout(panelGeomT);
      panelGeomT = setTimeout(function () { panelGeomT = null; refreshTopChromeShift(); }, 120);
    }, true);

    updateDockAlign();
  }

  // ── Navigation hook ───────────────────────────────────────────────────────────

  var cwgLastLocationKey = S.getCurrentChatId() + location.search;

  function onAiSiteNavigation() {
    var locKey = S.getCurrentChatId() + location.search;
    if (locKey === cwgLastLocationKey) return;
    cwgLastLocationKey = locKey;
    hideReadyBadge();
    answerInFlight   = false;
    userSentThisTurn = false;
    S.activeTab      = 'notes';
    clearDockFlowTimers();
    clearStreamingDockTimer();
    if (panelOpen) {
      panelOpen = false;
      var p = document.getElementById('cwg-panel');
      if (p) { setPanelOpenLayout(false); p.classList.remove('cwg-open', 'cwg-panel--enter'); }
    }
    hideDock();
    syncFabSpin();
    updateDockAlign();
  }

  function installHistoryNavigationHook() {
    function onNav() { window.setTimeout(onAiSiteNavigation, 0); }
    var ps = history.pushState;
    history.pushState = function () { var ret = ps.apply(history, arguments); onNav(); return ret; };
    var rs = history.replaceState;
    history.replaceState = function () { var ret = rs.apply(history, arguments); onNav(); return ret; };
    window.addEventListener('popstate', onNav);
  }

  // ── Answer-ready observer ─────────────────────────────────────────────────────

  function watchForAnswerReady() {
    var hadStop = !!findStopButton();
    var obs = new MutationObserver(function () {
      var now = hadStop;
      try {
        now = !!findStopButton();
        if (hadStop && !now)  { clearStreamingDockTimer(); showReadyBadge(); answerInFlight = false; syncFabSpin(); }
        if (!hadStop && now)  { scheduleStreamingDockIfSlow(); }
      } catch (err) { console.warn(LOG, 'mutation observer', err); }
      hadStop = now;
    });
    obs.observe(document.body, { childList: true, subtree: true });
    if (hadStop) scheduleStreamingDockIfSlow();
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  ensureDom();
  installHistoryNavigationHook();
  watchForAnswerReady();

  document.addEventListener('keydown', onKeyDown,      true);
  document.addEventListener('click',   onClickCapture, true);

  console.log(LOG, 'loaded', { href: location.href, platform: S.PLATFORM });

})(window._Stay = window._Stay || {});
