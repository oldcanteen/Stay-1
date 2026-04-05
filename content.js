(function () {
  'use strict';

  const LOG = '[CWG]';
  const STORAGE_KEY = 'llm_game_scores';
  const PANEL_WIDTH_PX = 360;

  const COLOR_NAMES = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'PURPLE'];
  const COLOR_MAP = {
    RED: '#b91c1c',
    BLUE: '#1d4ed8',
    GREEN: '#15803d',
    YELLOW: '#ca8a04',
    PURPLE: '#7c3aed',
  };

  let dockFlowTimers = [];
  let streamingDockTimer = null;
  let dockAlignRaf = null;
  let panelGeomT = null;
  let panelOpen = false;
  let userSentThisTurn = false;
  let answerInFlight = false;

  const DOCK_SHOW_CARD_MS = 8000;
  /** If generation is still running after this long, show dock (covers missed send / regenerate). */
  const STREAMING_DOCK_MIN_MS = 3000;
  const CORRECT_ADVANCE_MS = 225;
  function gameWidthPx() {
    return Math.min(PANEL_WIDTH_PX, window.innerWidth);
  }

  /** Widest bottom-anchored composer shell around the prompt (rect in viewport px). */
  function findComposerBarRect() {
    var probes = document.querySelectorAll(
      '[data-testid="prompt-textarea"], #prompt-textarea, textarea[placeholder]'
    );
    var el = null;
    var i;
    for (i = 0; i < probes.length; i++) {
      if (probes[i] && !probes[i].closest('#cwg-root')) {
        el = probes[i];
        break;
      }
    }
    if (!el) return null;
    var best = null;
    var walk = el;
    var d;
    var ih = window.innerHeight;
    for (d = 0; d < 18 && walk; d++) {
      var r = walk.getBoundingClientRect();
      if (r.width > 240 && r.bottom > ih * 0.3) {
        best = r;
      }
      walk = walk.parentElement;
    }
    if (best) return best;
    return el.getBoundingClientRect();
  }

  /**
   * CSS `bottom` on #cwg-dock so the dock's bottom edge (FAB bottom) matches composer bottom.
   */
  function computeComposerBottomInset() {
    var r = findComposerBarRect();
    if (!r) return 24;
    var inset = Math.round(window.innerHeight - r.bottom);
    if (inset < 0) inset = 0;
    return inset;
  }

  function updateDockAlign() {
    var inset = computeComposerBottomInset();
    document.documentElement.style.setProperty('--cwg-dock-bottom', inset + 'px');
  }

  function scheduleDockAlignRefresh() {
    if (dockAlignRaf) cancelAnimationFrame(dockAlignRaf);
    dockAlignRaf = requestAnimationFrame(function () {
      dockAlignRaf = null;
      updateDockAlign();
    });
  }

  function clearDockFlowTimers() {
    dockFlowTimers.forEach(function (id) {
      clearTimeout(id);
    });
    dockFlowTimers = [];
  }

  const TOP_CHROME_SHIFT_CLASS = 'cwg-topchrome-shift';

  function collectTopChromeRoots() {
    var shells = [document.getElementById('__next'), document.getElementById('root')].filter(Boolean);
    if (shells.length === 0) return [];

    var candidates = [];
    var s;
    var q;
    var i;
    var el;
    for (s = 0; s < shells.length; s++) {
      q = shells[s].querySelectorAll('*');
      for (i = 0; i < q.length; i++) {
        el = q[i];
        if (!el || el.id === 'cwg-root' || el.closest('#cwg-root')) continue;
        var cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        var r = el.getBoundingClientRect();
        if (r.top > 100) continue;
        if (r.width < window.innerWidth * 0.45) continue;
        if (r.height > 200 || r.height < 16) continue;
        candidates.push(el);
      }
    }

    return candidates.filter(function (a) {
      return !candidates.some(function (b) {
        return b !== a && b.contains(a);
      });
    });
  }

  const PANEL_TOP_GAP_PX = 8;
  const PANEL_COMPOSER_GAP_PX = 10;

  function applyPanelSafeGeometry(roots) {
    var vh = window.innerHeight;
    var i;
    var headerBottom = 0;
    for (i = 0; i < roots.length; i++) {
      var bb = roots[i].getBoundingClientRect().bottom;
      if (bb > headerBottom) headerBottom = bb;
    }
    var topPx =
      roots.length === 0 && headerBottom < 12
        ? PANEL_TOP_GAP_PX
        : Math.ceil(headerBottom) + PANEL_TOP_GAP_PX;
    topPx = Math.max(0, Math.min(topPx, vh - 80));

    var comp = findComposerBarRect();
    var composerTop = comp && typeof comp.top === 'number' ? comp.top : null;
    var safeBottomEdge;
    if (composerTop !== null && composerTop > topPx + 20) {
      safeBottomEdge = Math.floor(composerTop) - PANEL_COMPOSER_GAP_PX;
    } else {
      safeBottomEdge = vh - 96;
    }

    var available = safeBottomEdge - topPx;
    if (available < 48) {
      topPx = Math.max(4, safeBottomEdge - Math.min(320, vh * 0.55));
      available = safeBottomEdge - topPx;
    }

    var heightPx = Math.min(Math.max(0, available), vh - topPx - 4);
    if (heightPx + topPx > safeBottomEdge) {
      heightPx = Math.max(0, safeBottomEdge - topPx);
    }

    document.documentElement.style.setProperty('--cwg-panel-top', topPx + 'px');
    document.documentElement.style.setProperty('--cwg-panel-height', heightPx + 'px');
  }

  function refreshTopChromeShift() {
    document.querySelectorAll('.' + TOP_CHROME_SHIFT_CLASS).forEach(function (el) {
      el.classList.remove(TOP_CHROME_SHIFT_CLASS);
    });
    if (!document.body.classList.contains('llm-game-open')) {
      document.documentElement.style.removeProperty('--cwg-panel-top');
      document.documentElement.style.removeProperty('--cwg-panel-height');
      return;
    }

    var roots = collectTopChromeRoots();
    roots.forEach(function (node) {
      node.classList.add(TOP_CHROME_SHIFT_CLASS);
    });
    applyPanelSafeGeometry(roots);
  }

  function setPanelOpenLayout(on) {
    const html = document.documentElement;
    const body = document.body;
    if (!body) return;

    if (!on) {
      body.classList.remove('llm-game-open');
      html.classList.remove('llm-game-squeeze');
      html.style.removeProperty('--llm-panel-w');
      html.style.removeProperty('--cwg-panel-top');
      html.style.removeProperty('--cwg-panel-height');
      refreshTopChromeShift();
      return;
    }

    const w = gameWidthPx() + 'px';
    html.style.setProperty('--llm-panel-w', w);
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

  function findStopButton() {
    const candidates = document.querySelectorAll('button, [role="button"]');
    for (let i = 0; i < candidates.length; i++) {
      const b = candidates[i];
      if (b.closest('#cwg-root')) continue;
      const r = b.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const text = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const tid = (b.getAttribute('data-testid') || '').toLowerCase();
      if (
        tid.includes('stop') &&
        (tid.includes('generat') || tid.includes('stream') || tid === 'stop-button' || tid.endsWith('stop-button'))
      ) {
        return b;
      }
      if (aria.includes('stop generating')) return b;
      if (aria === 'stop' || aria.endsWith(' stop')) return b;
      if (text === 'stop') return b;
      if (text.length < 48 && (text.includes('stop generating') || text === 'stop streaming')) return b;
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

  function storageContextOk() {
    try {
      return (
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local &&
        chrome.runtime &&
        typeof chrome.runtime.id === 'string' &&
        chrome.runtime.id.length > 0
      );
    } catch (err) {
      return false;
    }
  }

  function loadStorage(cb) {
    if (!storageContextOk()) {
      cb({ highColor: 0, highWord: 0 });
      return;
    }
    try {
      chrome.storage.local.get([STORAGE_KEY], function (res) {
        if (!storageContextOk()) {
          cb({ highColor: 0, highWord: 0 });
          return;
        }
        const err = chrome.runtime.lastError;
        if (err) {
          cb({ highColor: 0, highWord: 0 });
          return;
        }
        const raw = res[STORAGE_KEY];
        const data =
          raw && typeof raw === 'object'
            ? raw
            : { highColor: 0, highWord: 0 };
        if (typeof data.highColor !== 'number') data.highColor = 0;
        if (typeof data.highWord !== 'number') data.highWord = 0;
        cb(data);
      });
    } catch (err) {
      cb({ highColor: 0, highWord: 0 });
    }
  }

  function saveStorage(data) {
    if (!storageContextOk()) return;
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: data }, function () {
        if (!storageContextOk()) return;
        if (chrome.runtime.lastError) return;
      });
    } catch (err) {
      /* ignore */
    }
  }

  function updateHighScore(score) {
    loadStorage(function (data) {
      if (score > data.highColor) data.highColor = score;
      saveStorage(data);
    });
  }

  function ensureDom() {
    if (document.getElementById('cwg-root')) return;

    const root = document.createElement('div');
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
      '</svg>' +
      '</button>' +
      '</div>' +
      '<button type="button" id="cwg-surprise-btn">Surprise me</button>' +
      '</div>' +
      '<button type="button" id="cwg-fab" aria-label="Open companion panel" title="Open companion">' +
      '<span class="cwg-fab-flower-wrap" aria-hidden="true">' +
      '<svg class="cwg-fab-flower" width="22" height="22" viewBox="0 0 24 24">' +
      '<g fill="#ffffff">' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(0 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(72 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(144 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(216 12 12)"/>' +
      '<ellipse cx="12" cy="7" rx="3.2" ry="5" transform="rotate(288 12 12)"/>' +
      '<circle cx="12" cy="12" r="2.4" fill="rgba(255,255,255,0.9)"/>' +
      '</g>' +
      '</svg>' +
      '</span>' +
      '</button>' +
      '</div>' +
      '<div id="cwg-panel" class="cwg-pointer">' +
      '<div id="cwg-panel-header">' +
      '<div class="cwg-panel-header-row">' +
      '<p id="cwg-panel-title">The Art of Waiting</p>' +
      '<button type="button" id="cwg-minimize-btn" aria-label="Close panel">' +
      '<svg class="cwg-icon-close-x" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>' +
      '</svg>' +
      '</button>' +
      '</div>' +
      '<p id="cwg-panel-scoreline" class="cwg-panel-scoreline" hidden></p>' +
      '</div>' +
      '<div id="cwg-ready-badge" class="cwg-ready-badge-wrap">' +
      '<span class="cwg-ready-badge-text">Your answer is ready</span>' +
      '<button type="button" class="cwg-ready-badge-close" id="cwg-ready-close" aria-label="Dismiss notification">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>' +
      '</svg>' +
      '</button>' +
      '</div>' +
      '<div id="cwg-panel-body"></div>' +
      '</div>';

    document.documentElement.appendChild(root);

    document.getElementById('cwg-fab').addEventListener('click', onFabClick);
    document.getElementById('cwg-chip-close').addEventListener('click', hideDock);
    document.getElementById('cwg-surprise-btn').addEventListener('click', openPanel);
    document.getElementById('cwg-minimize-btn').addEventListener('click', minimizePanel);
    document.getElementById('cwg-ready-close').addEventListener('click', function (e) {
      e.stopPropagation();
      hideReadyBadge();
    });

    var resizeT = null;
    window.addEventListener(
      'resize',
      function () {
        if (resizeT) clearTimeout(resizeT);
        resizeT = setTimeout(function () {
          resizeT = null;
          updateDockAlign();
          if (document.body.classList.contains('llm-game-open')) {
            refreshTopChromeShift();
          }
        }, 80);
      },
      true
    );
    window.addEventListener(
      'scroll',
      function () {
        scheduleDockAlignRefresh();
        if (!document.body.classList.contains('llm-game-open')) return;
        if (panelGeomT) clearTimeout(panelGeomT);
        panelGeomT = setTimeout(function () {
          panelGeomT = null;
          refreshTopChromeShift();
        }, 120);
      },
      true
    );
    updateDockAlign();
  }

  function syncFabSpin() {
    const fab = document.getElementById('cwg-fab');
    const dock = document.getElementById('cwg-dock');
    if (!fab || !dock) return;
    if (!dock.classList.contains('cwg-visible') || dock.classList.contains('cwg-expanded')) return;
    fab.classList.toggle('cwg-fab--waiting', answerInFlight || !!findStopButton());
  }

  function hideDock() {
    clearDockFlowTimers();
    const dock = document.getElementById('cwg-dock');
    const fab = document.getElementById('cwg-fab');
    if (!dock || !fab) return;
    dock.classList.remove('cwg-visible', 'cwg-expanded', 'cwg-dock--card-reveal');
    fab.classList.remove('cwg-fab--waiting');
  }

  function showWaitingFab() {
    const dock = document.getElementById('cwg-dock');
    const fab = document.getElementById('cwg-fab');
    if (!dock || !fab) return;
    dock.classList.add('cwg-visible');
    dock.classList.remove('cwg-expanded', 'cwg-dock--card-reveal');
    syncFabSpin();
    scheduleDockAlignRefresh();
  }

  function expandDockChip() {
    const dock = document.getElementById('cwg-dock');
    const fab = document.getElementById('cwg-fab');
    if (!dock || !fab) return;
    fab.classList.remove('cwg-fab--waiting');
    dock.classList.add('cwg-visible', 'cwg-expanded', 'cwg-dock--card-reveal');
    scheduleDockAlignRefresh();
    console.log(LOG, 'chip expanded');
  }

  function onFabClick(e) {
    e.stopPropagation();
    const dock = document.getElementById('cwg-dock');
    if (dock.classList.contains('cwg-expanded')) return;
    openPanel();
  }

  function pickAndRenderGame() {
    renderColorGame();
  }

  function openPanel() {
    panelOpen = true;
    hideDock();
    setPanelOpenLayout(true);
    console.log(LOG, 'panel opened');

    const panel = document.getElementById('cwg-panel');
    panel.classList.remove('cwg-panel--enter');
    document.getElementById('cwg-ready-badge').classList.remove('cwg-show');

    panel.classList.add('cwg-open');
    requestAnimationFrame(function () {
      panel.classList.add('cwg-panel--enter');
    });
    window.setTimeout(function () {
      panel.classList.remove('cwg-panel--enter');
    }, 440);

    pickAndRenderGame();
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
    document.getElementById('cwg-ready-badge').classList.remove('cwg-show');
  }

  function showReadyBadge() {
    if (!panelOpen) return;
    const badge = document.getElementById('cwg-ready-badge');
    if (!badge) return;
    badge.classList.add('cwg-show');
    console.log(LOG, 'answer ready badge shown');
  }

  function scheduleDockFlow() {
    clearDockFlowTimers();
    const dock = document.getElementById('cwg-dock');
    const fab = document.getElementById('cwg-fab');
    if (!dock || !fab) return;

    var id8 = setTimeout(function () {
      if (!userSentThisTurn || panelOpen) return;
      if (!dock.classList.contains('cwg-visible')) return;
      expandDockChip();
      userSentThisTurn = false;
    }, DOCK_SHOW_CARD_MS);
    dockFlowTimers.push(id8);
  }

  function clearStreamingDockTimer() {
    if (streamingDockTimer !== null) {
      clearTimeout(streamingDockTimer);
      streamingDockTimer = null;
    }
  }

  /**
   * Timer is only scheduled when Stop appeared (generation started). Do not re-check findStopButton
   * here — ChatGPT sometimes omits or renames it while still streaming, which blocked the dock.
   */
  function scheduleStreamingDockIfSlow() {
    clearStreamingDockTimer();
    streamingDockTimer = setTimeout(function () {
      streamingDockTimer = null;
      if (panelOpen) return;
      const dock = document.getElementById('cwg-dock');
      if (!dock) return;
      if (dock.classList.contains('cwg-visible')) return;
      onPromptSent('streaming-slow');
    }, STREAMING_DOCK_MIN_MS);
  }

  function onPromptSent(reason) {
    clearStreamingDockTimer();
    console.log(LOG, 'timer started', { reason: reason });
    userSentThisTurn = true;
    answerInFlight = true;
    hideReadyBadge();
    clearDockFlowTimers();
    updateDockAlign();
    showWaitingFab();
    scheduleDockFlow();
  }

  function isLikelySendClick(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('#cwg-root')) return false;
    const btn = el.closest('button, [role="button"]');
    if (!btn) return false;
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    const tid = (btn.getAttribute('data-testid') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    if (tid.indexOf('send') !== -1) return true;
    if (tid === 'composer-send-button' || tid === 'send-button') return true;
    if (aria.indexOf('send') !== -1 && aria.indexOf('feedback') === -1) return true;
    if (title.indexOf('send') !== -1) return true;
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'send') return true;
    return false;
  }

  function onClickCapture(e) {
    if (!isLikelySendClick(e.target)) return;
    onPromptSent('send-click');
  }

  function buildColorRound() {
    const word = COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
    const colorKey = COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
    return {
      word: word,
      displayColor: COLOR_MAP[colorKey],
      correctMatch: word === colorKey,
    };
  }

  function applyColorGameChrome() {
    const panel = document.getElementById('cwg-panel');
    const header = document.getElementById('cwg-panel-header');
    const scoreline = document.getElementById('cwg-panel-scoreline');
    document.getElementById('cwg-panel-title').textContent = 'The Art of Waiting';
    scoreline.hidden = false;
    header.classList.add('cwg-panel-header--color');
    panel.classList.add('cwg-panel--art-waiting');
  }

  function updateColorScoreline(score, high) {
    document.getElementById('cwg-panel-scoreline').textContent =
      'Score: ' + score + ' • High score: ' + high;
  }

  function renderColorGame() {
    const body = document.getElementById('cwg-panel-body');
    body.className = 'cwg-panel-body cwg-panel-body--color';

    let score = 0;
    let round = buildColorRound();
    let gameOver = false;
    let showingCorrect = false;
    let correctTimer = null;

    applyColorGameChrome();

    function promptGlowStyle(hex) {
      var h = (hex || '#000').replace('#', '');
      if (h.length !== 6) {
        return 'color:' + hex + ';';
      }
      var r = parseInt(h.slice(0, 2), 16);
      var g = parseInt(h.slice(2, 4), 16);
      var b = parseInt(h.slice(4, 6), 16);
      return (
        'color:' +
        hex +
        ';text-shadow:0 0 22px rgba(' +
        r +
        ',' +
        g +
        ',' +
        b +
        ',0.42),0 0 42px rgba(' +
        r +
        ',' +
        g +
        ',' +
        b +
        ',0.22);'
      );
    }

    function paint() {
      loadStorage(function (data) {
        updateColorScoreline(score, data.highColor);

        if (gameOver) {
          body.innerHTML =
            '<div class="cwg-cw-stage cwg-cw-stage--over">' +
            '<p class="cwg-cw-question">Does the text color match the word?</p>' +
            '<div class="cwg-cw-prompt cwg-cw-prompt--fail" aria-live="polite">' +
            round.word +
            '</div>' +
            '<div class="cwg-cw-gameover" role="status">' +
            '<div class="cwg-cw-go-icon-bad" aria-hidden="true">' +
            '<svg width="44" height="44" viewBox="0 0 44 44" fill="none">' +
            '<circle cx="22" cy="22" r="20" fill="#DC2626"/>' +
            '<path d="M16 16l12 12M28 16L16 28" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' +
            '</svg>' +
            '</div>' +
            '<h3 class="cwg-cw-gameover-title">Incorrect</h3>' +
            '<p class="cwg-cw-gameover-text">The text color did not match the word.</p>' +
            '<div class="cwg-cw-go-stats-box">' +
            '<div class="cwg-cw-go-stat">' +
            '<span class="cwg-cw-go-stat-label">Final Score</span>' +
            '<strong class="cwg-cw-go-stat-num">' +
            score +
            '</strong>' +
            '</div>' +
            '<div class="cwg-cw-go-stat-divider" aria-hidden="true"></div>' +
            '<div class="cwg-cw-go-stat">' +
            '<span class="cwg-cw-go-stat-label">High Score</span>' +
            '<strong class="cwg-cw-go-stat-num">' +
            data.highColor +
            '</strong>' +
            '</div>' +
            '</div>' +
            '<button type="button" class="cwg-cw-replay" id="cwg-cw-replay">' +
            '<svg class="cwg-cw-replay-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0012 4V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>' +
            '</svg>' +
            'Replay' +
            '</button>' +
            '</div>' +
            '</div>';
          document.getElementById('cwg-cw-replay').addEventListener('click', function () {
            gameOver = false;
            score = 0;
            round = buildColorRound();
            paint();
          });
          return;
        }

        const btnsDisabled = showingCorrect ? ' disabled' : '';
        body.innerHTML =
          '<div class="cwg-cw-stage cwg-cw-stage--playing">' +
          '<p class="cwg-cw-question">Does the text color match the word?</p>' +
          '<div class="cwg-cw-prompt cwg-cw-prompt--play" style="' +
          promptGlowStyle(round.displayColor) +
          '">' +
          round.word +
          '</div>' +
          '<div class="cwg-cw-btns">' +
          '<button type="button" data-choice="match"' +
          btnsDisabled +
          '>Match</button>' +
          '<button type="button" data-choice="mismatch"' +
          btnsDisabled +
          '>Mismatch</button>' +
          '</div>' +
          (showingCorrect
            ? '<div class="cwg-cw-correct-block">' +
              '<span class="cwg-cw-correct-pill">' +
              '<svg class="cwg-cw-check" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
              '<path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>' +
              '</svg>' +
              'Correct!' +
              '</span>' +
              '</div>'
            : '') +
          '</div>';

        if (showingCorrect) {
          return;
        }

        body.querySelectorAll('[data-choice]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (gameOver || showingCorrect) return;
            const pickedMatch = btn.getAttribute('data-choice') === 'match';
            if (pickedMatch === round.correctMatch) {
              score += 1;
              updateHighScore(score);
              showingCorrect = true;
              paint();
              if (correctTimer) clearTimeout(correctTimer);
              correctTimer = setTimeout(function () {
                correctTimer = null;
                showingCorrect = false;
                round = buildColorRound();
                paint();
              }, CORRECT_ADVANCE_MS);
            } else {
              gameOver = true;
              paint();
            }
          });
        });
      });
    }

    paint();
  }

  function watchForAnswerReady() {
    let hadStop = !!findStopButton();
    const obs = new MutationObserver(function () {
      let now = hadStop;
      try {
        now = !!findStopButton();
        if (hadStop && !now) {
          clearStreamingDockTimer();
          showReadyBadge();
          answerInFlight = false;
          syncFabSpin();
        }
        if (!hadStop && now) {
          scheduleStreamingDockIfSlow();
        }
      } catch (err) {
        console.warn(LOG, 'mutation observer', err);
      }
      hadStop = now;
    });
    obs.observe(document.body, { childList: true, subtree: true });
    if (hadStop) {
      scheduleStreamingDockIfSlow();
    }
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (!isLikelyChatInput(e.target)) return;
    onPromptSent('enter-key');
  }

  ensureDom();
  watchForAnswerReady();

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onClickCapture, true);

  console.log(LOG, 'extension loaded', { href: location.href });
})();
