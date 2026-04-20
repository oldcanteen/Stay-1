/**
 * content.js — Stay edge trigger + AI activity detector (slim)
 *
 * In v2 the actual panel UI (Notes / Draw / Game) lives in the Chrome Side
 * Panel (sidepanel.html). This script is now intentionally tiny:
 *
 *   1. Inject a permanent edge bookmark on the right side of every supported
 *      AI page (Shadow DOM, isolated from host CSS).
 *   2. Clicking the bookmark sends STAY_OPEN_SIDE_PANEL to the service
 *      worker, which opens the Chrome Side Panel for the active tab — the
 *      browser viewport itself shrinks, so the host page (ChatGPT etc.)
 *      reflows responsively. No in-page squeeze, no overlay, no rail CSS.
 *   3. Detect when the user sends a prompt and when the answer streams to
 *      completion. Pulse the edge trigger while waiting; notify the side
 *      panel (STAY_ANSWER_READY) when the answer arrives.
 *   4. Respond to STAY_SCROLL_CHAT_BOTTOM from the side panel by smoothly
 *      scrolling the chat's own scroll container.
 *
 * The host element is attached to <html> and watched by a MutationObserver,
 * so React hydration (Next.js on chatgpt.com) can never wipe the bookmark.
 */
(function () {
  'use strict';

  var LOG = '[Stay]';
  var STAY_HOST_ID = 'stay-extension-host';

  /** Re-fire prompt detection after this many ms of streaming (catches missed-send edge cases). */
  var STREAMING_CATCH_MIN_MS = 1000;

  // ── Platform detection ────────────────────────────────────────────────────

  var PLATFORM = (function () {
    var h = location.hostname;
    if (h === 'gemini.google.com') return 'gemini';
    if (h === 'claude.ai')         return 'claude';
    return 'chatgpt';
  })();

  var PLATFORM_COMPOSER_SELECTORS = {
    chatgpt: '[data-testid="prompt-textarea"], #prompt-textarea, [data-testid="composer-textarea"]',
    gemini:  'rich-textarea, .ql-editor',
    claude:  '.ProseMirror',
  };

  // ── Shared mutable state ──────────────────────────────────────────────────

  var shadowRoot = null;
  var streamingCatchTimer = null;
  var answerInFlight = false;
  var pointerHandlersInstalled = false;

  // Persisted vertical offset for the edge bookmark (px from viewport top).
  // Users can drag the bookmark up/down; the last position is saved per device.
  var EDGE_Y_STORAGE_KEY = 'stayEdgeY';
  var EDGE_FAB_HEIGHT    = 40;   // Keep in sync with #cwg-edge-main in styles.css.
  var EDGE_FAB_MARGIN    = 12;   // Minimum gap from top/bottom of viewport.
  var savedEdgeY         = null; // Number (px) once we've loaded or dragged.
  var suppressNextEdgeClick = false;

  function shadowEl(id) {
    if (!shadowRoot) return null;
    try { return shadowRoot.getElementById(id); } catch (e) { return null; }
  }

  function isStayUiNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === STAY_HOST_ID) return true;
    try {
      var root = node.getRootNode();
      if (root && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot &&
          root.host && root.host.id === STAY_HOST_ID) return true;
    } catch (e) {}
    return false;
  }

  // ── Send / Stop detection ─────────────────────────────────────────────────

  function findStopButton() {
    var candidates = document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var b = candidates[i];
      if (isStayUiNode(b)) continue;
      var r = b.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      var text = (b.textContent || '').trim().toLowerCase();
      var aria = (b.getAttribute('aria-label') || '').toLowerCase();
      var tid  = (b.getAttribute('data-testid') || '').toLowerCase();
      if (tid.indexOf('stop') !== -1 && (
          tid.indexOf('generat') !== -1 || tid.indexOf('stream') !== -1 ||
          tid === 'stop-button' || tid.indexOf('stop-button') !== -1)) return b;
      if (aria.indexOf('stop generating') !== -1 || aria === 'stop' || aria.indexOf(' stop') === aria.length - 5) return b;
      if (text === 'stop' || (text.length < 48 && (text.indexOf('stop generating') !== -1 || text === 'stop streaming'))) return b;
    }
    return null;
  }

  function isLikelyChatInput(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isStayUiNode(el)) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    if (el.closest && el.closest('[contenteditable="true"]')) return true;
    if (el.closest && el.closest('#prompt-textarea')) return true;
    if (el.closest && el.closest('[data-testid="prompt-textarea"]')) return true;
    if (el.closest && el.closest('[data-testid="composer-textarea"]')) return true;
    return false;
  }

  function isLikelySendClick(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isStayUiNode(el)) return false;
    var btn = el.closest ? el.closest('button, [role="button"]') : null;
    if (!btn || isStayUiNode(btn)) return false;
    var aria  = (btn.getAttribute('aria-label') || '').toLowerCase();
    var tid   = (btn.getAttribute('data-testid') || '').toLowerCase();
    var title = (btn.getAttribute('title') || '').toLowerCase();
    if (tid.indexOf('send') !== -1) return true;
    if (tid.indexOf('submit') !== -1 && tid.indexOf('feedback') === -1) return true;
    if (tid === 'composer-send-button' || tid === 'send-button') return true;
    if (aria.indexOf('send') !== -1 && aria.indexOf('feedback') === -1) return true;
    if (aria.indexOf('submit') !== -1 && aria.indexOf('feedback') === -1) return true;
    if (title.indexOf('send') !== -1) return true;
    var tx = (btn.textContent || '').trim().toLowerCase();
    return tx === 'send';
  }

  function syncEdgeSpin() {
    var trig = shadowEl('cwg-edge-trigger');
    if (!trig) return;
    var waiting = answerInFlight || !!findStopButton();
    trig.classList.toggle('cwg-edge--waiting', waiting);
  }

  function clearStreamingCatchTimer() {
    if (streamingCatchTimer !== null) { clearTimeout(streamingCatchTimer); streamingCatchTimer = null; }
  }

  function scheduleStreamingCatchIfSlow() {
    clearStreamingCatchTimer();
    streamingCatchTimer = setTimeout(function () {
      streamingCatchTimer = null;
      onPromptSent('streaming-slow');
    }, STREAMING_CATCH_MIN_MS);
  }

  function onPromptSent(reason) {
    clearStreamingCatchTimer();
    answerInFlight = true;
    syncEdgeSpin();
    console.log(LOG, 'prompt sent', { reason: reason });
  }

  function onAnswerReady() {
    clearStreamingCatchTimer();
    answerInFlight = false;
    syncEdgeSpin();
    try {
      chrome.runtime.sendMessage({ type: 'STAY_ANSWER_READY' }).catch(function () {});
    } catch (e) {}
    console.log(LOG, 'answer ready');
  }

  function onClickCapture(e) {
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    for (var pi = 0; pi < path.length; pi++) {
      var node = path[pi];
      if (!node || node === document || node === window) continue;
      if (node.nodeType !== 1) continue;
      if (isStayUiNode(node)) break;
      if (isLikelySendClick(node)) { onPromptSent('send-click'); return; }
    }
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    for (var ki = 0; ki < path.length; ki++) {
      if (isStayUiNode(path[ki])) return;
      if (isLikelyChatInput(path[ki])) { onPromptSent('enter-key'); return; }
    }
  }

  function watchForAnswerReady() {
    var hadStop = !!findStopButton();
    var obs = new MutationObserver(function () {
      var now = hadStop;
      try {
        now = !!findStopButton();
        if (hadStop && !now)  { onAnswerReady(); }
        if (!hadStop && now)  { scheduleStreamingCatchIfSlow(); }
      } catch (err) { console.warn(LOG, 'mutation observer', err); }
      hadStop = now;
    });
    obs.observe(document.body, { childList: true, subtree: true });
    if (hadStop) scheduleStreamingCatchIfSlow();
  }

  // ── Chat-container scroll-to-bottom (responds to side panel button) ──────

  function scrollChatToBottom() {
    var roots = [document.getElementById('__next'), document.getElementById('root')].filter(Boolean);
    if (roots.length === 0) roots.push(document.body);
    var pick = null, pickScore = 0;
    roots.forEach(function (root) {
      root.querySelectorAll('div').forEach(function (el) {
        if (!el || el.id === STAY_HOST_ID || isStayUiNode(el)) return;
        var st = window.getComputedStyle(el);
        if (st.overflowY !== 'auto' && st.overflowY !== 'scroll') return;
        var ex = el.scrollHeight - el.clientHeight;
        if (ex > pickScore && el.clientHeight > Math.min(280, window.innerHeight * 0.32)) {
          pickScore = ex; pick = el;
        }
      });
    });
    if (pick && pickScore > 24) {
      try { pick.scrollTo({ top: pick.scrollHeight, behavior: 'smooth' }); }
      catch (e) { pick.scrollTop = pick.scrollHeight; }
      return true;
    }
    try { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); }
    catch (e2) { document.documentElement.scrollTop = document.documentElement.scrollHeight; }
    return true;
  }

  // ── Edge trigger DOM (shadow DOM, isolated from host CSS) ────────────────

  function ensureEdgeTrigger() {
    if (document.getElementById(STAY_HOST_ID)) return;

    var host = document.createElement('div');
    host.id = STAY_HOST_ID;
    host.setAttribute('data-stay-extension', '');
    host.style.cssText =
      'position:fixed!important;left:0!important;top:0!important;right:0!important;bottom:0!important;' +
      'width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;' +
      'pointer-events:none!important;z-index:2147483647!important;background:transparent!important;' +
      'overflow:visible!important;display:block!important;visibility:visible!important;opacity:1!important;' +
      'transform:none!important;clip:auto!important;clip-path:none!important;';

    var shadow = host.attachShadow({ mode: 'open' });
    shadowRoot = shadow;

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles.css');
    shadow.appendChild(link);

    var root = document.createElement('div');
    root.id = 'cwg-root';
    root.className = 'cwg-pointer';
    root.innerHTML =
      '<div id="cwg-edge-trigger" class="cwg-edge-trigger cwg-pointer" role="region" aria-label="Stay">' +
        '<button type="button" id="cwg-edge-main" class="cwg-edge-main" aria-label="Open Stay" title="Stay" tabindex="0">' +
          '<span class="cwg-edge-flower-wrap" aria-hidden="true">' +
            // Filled flower: 5 white petals radiating from a center — reads clearly
            // against the coral button in both half-circle and full-circle states.
            '<svg class="cwg-edge-flower" viewBox="0 0 24 24" fill="#ffffff" stroke="none">' +
              '<ellipse cx="12" cy="7" rx="2.6" ry="4.2" transform="rotate(0 12 12)"/>' +
              '<ellipse cx="12" cy="7" rx="2.6" ry="4.2" transform="rotate(72 12 12)"/>' +
              '<ellipse cx="12" cy="7" rx="2.6" ry="4.2" transform="rotate(144 12 12)"/>' +
              '<ellipse cx="12" cy="7" rx="2.6" ry="4.2" transform="rotate(216 12 12)"/>' +
              '<ellipse cx="12" cy="7" rx="2.6" ry="4.2" transform="rotate(288 12 12)"/>' +
              '<circle cx="12" cy="12" r="1.6" fill="#ff6b5b"/>' +
            '</svg>' +
          '</span>' +
        '</button>' +
      '</div>';

    shadow.appendChild(root);
    document.documentElement.appendChild(host);

    installHostPersistenceGuard(host);
    installEdgePointerHandlers();
    syncEdgeSpin();
  }

  // ── Edge trigger interactivity ───────────────────────────────────────────

  function openSidePanel(e) {
    /* Must run synchronously to preserve the user gesture across the message;
     * the background's onMessage handler then calls chrome.sidePanel.open(). */
    if (e) { e.preventDefault(); e.stopPropagation(); }
    // After the extension is reloaded in chrome://extensions, content scripts
    // injected into existing tabs lose their connection to the background.
    // chrome.runtime.id becomes undefined and any sendMessage call throws
    // "Extension context invalidated." That is expected and harmless — the
    // user just needs to refresh the tab — so we swallow it silently.
    if (!chrome.runtime || !chrome.runtime.id) return;
    try {
      var p = chrome.runtime.sendMessage({ type: 'STAY_OPEN_SIDE_PANEL' });
      if (p && typeof p.catch === 'function') {
        p.catch(function (err) {
          var msg = err && err.message ? err.message : String(err);
          if (/Extension context invalidated/i.test(msg)) return;
          console.warn(LOG, 'open side panel failed', err);
        });
      }
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      if (/Extension context invalidated/i.test(msg)) return;
      console.warn(LOG, 'open side panel threw', err);
    }
  }

  // ── Draggable edge bookmark (vertical axis only) ─────────────────────────
  // Behaviour:
  //   • Quick click → opens the side panel (unchanged).
  //   • Drag (pointer moves > 4px while pressed) → repositions vertically.
  //   • Final position persists in chrome.storage.local and is re-applied on
  //     subsequent page loads, clamped to the current viewport height.

  function applyEdgeY(y) {
    var wrap = shadowEl('cwg-edge-trigger');
    if (!wrap) return;
    var max = Math.max(EDGE_FAB_MARGIN, window.innerHeight - EDGE_FAB_HEIGHT - EDGE_FAB_MARGIN);
    var clamped = Math.max(EDGE_FAB_MARGIN, Math.min(max, y));
    wrap.style.top = clamped + 'px';
    wrap.style.transform = 'none';
    savedEdgeY = clamped;
  }

  function loadSavedEdgeY() {
    if (!chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.get([EDGE_Y_STORAGE_KEY], function (data) {
        var y = data && data[EDGE_Y_STORAGE_KEY];
        if (typeof y === 'number' && isFinite(y)) applyEdgeY(y);
      });
    } catch (e) {}
  }

  function persistEdgeY(y) {
    if (!chrome.storage || !chrome.storage.local) return;
    try {
      var payload = {};
      payload[EDGE_Y_STORAGE_KEY] = y;
      chrome.storage.local.set(payload);
    } catch (e) {}
  }

  function installEdgePointerHandlers() {
    if (pointerHandlersInstalled) return;
    var wrap = shadowEl('cwg-edge-trigger');
    var main = shadowEl('cwg-edge-main');
    var gear = shadowEl('cwg-edge-gear');
    if (!wrap || !main) return;
    pointerHandlersInstalled = true;

    wrap.addEventListener('pointerenter', function () { wrap.classList.add('cwg-edge--hover'); });
    wrap.addEventListener('pointerleave', function () { wrap.classList.remove('cwg-edge--hover'); });

    // ── Drag to reposition vertically ──────────────────────────────────────
    var DRAG_THRESHOLD = 4;
    var dragStartY  = 0;
    var dragStartTop = 0;
    var dragging    = false;
    var pressed     = false;
    var activePointerId = null;

    main.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      pressed     = true;
      dragging    = false;
      dragStartY  = ev.clientY;
      var rect    = wrap.getBoundingClientRect();
      dragStartTop = rect.top;
      activePointerId = ev.pointerId;
      try { main.setPointerCapture(ev.pointerId); } catch (e) {}
    });

    main.addEventListener('pointermove', function (ev) {
      if (!pressed) return;
      var dy = ev.clientY - dragStartY;
      if (!dragging && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragging = true;
      wrap.classList.add('cwg-edge--dragging');
      applyEdgeY(dragStartTop + dy);
      ev.preventDefault();
    });

    function endDrag(ev) {
      if (!pressed) return;
      var wasDragging = dragging;
      pressed  = false;
      dragging = false;
      wrap.classList.remove('cwg-edge--dragging');
      try { if (activePointerId !== null) main.releasePointerCapture(activePointerId); } catch (e) {}
      activePointerId = null;
      if (wasDragging) {
        // Suppress the synthetic click that follows the pointerup so the panel
        // doesn't open after a reposition gesture.
        suppressNextEdgeClick = true;
        if (savedEdgeY !== null) persistEdgeY(savedEdgeY);
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      }
    }

    main.addEventListener('pointerup',     endDrag);
    main.addEventListener('pointercancel', endDrag);

    // Click opens the panel — unless the gesture was a drag.
    main.addEventListener('click', function (ev) {
      if (suppressNextEdgeClick) {
        suppressNextEdgeClick = false;
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      openSidePanel(ev);
    });
    if (gear) gear.addEventListener('click', openSidePanel);

    main.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') openSidePanel(ev);
    });
    if (gear) gear.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') openSidePanel(ev);
    });

    // Reclamp to the viewport on resize so the bookmark never drifts off-screen.
    window.addEventListener('resize', function () {
      if (savedEdgeY !== null) applyEdgeY(savedEdgeY);
    });

    loadSavedEdgeY();
  }

  // ── Host persistence: survive React hydration / SPA re-renders ───────────
  // ChatGPT (Next.js) can replace top-level children during hydration / route
  // changes. This guard re-attaches the same host node (shadow root + listeners
  // intact) whenever it gets detached from <html>.

  var hostGuardInstalled = false;

  function installHostPersistenceGuard(host) {
    if (hostGuardInstalled || !host) return;
    hostGuardInstalled = true;

    function ensureAttached() {
      var html = document.documentElement;
      if (!html) return;
      if (host.isConnected && host.parentNode === html) return;
      try { html.appendChild(host); } catch (e) {}
      if (host.style.position !== 'fixed') {
        host.style.setProperty('position', 'fixed', 'important');
      }
      host.style.setProperty('display',    'block',   'important');
      host.style.setProperty('visibility', 'visible', 'important');
      host.style.setProperty('opacity',    '1',       'important');
      host.style.setProperty('transform',  'none',    'important');
    }

    function startObserver() {
      var html = document.documentElement;
      if (!html) { setTimeout(startObserver, 0); return; }
      try {
        var htmlObs = new MutationObserver(function (mutations) {
          for (var i = 0; i < mutations.length; i++) {
            var rm = mutations[i].removedNodes;
            for (var j = 0; j < rm.length; j++) {
              if (rm[j] === host || (rm[j].nodeType === 1 && rm[j].id === STAY_HOST_ID)) {
                ensureAttached();
                return;
              }
            }
          }
          if (!host.isConnected) ensureAttached();
        });
        htmlObs.observe(html, { childList: true });

        var attrObs = new MutationObserver(function () { ensureAttached(); });
        attrObs.observe(host, { attributes: true, attributeFilter: ['style', 'hidden'] });
      } catch (e) {}
    }
    startObserver();

    window.addEventListener('pageshow',           ensureAttached, true);
    document.addEventListener('visibilitychange', ensureAttached, true);
    window.addEventListener('popstate',           ensureAttached, true);

    var t0 = Date.now();
    var pollId = setInterval(function () {
      ensureAttached();
      if (Date.now() - t0 > 5000) clearInterval(pollId);
    }, 250);
  }

  // ── Navigation hook (reset answer-in-flight on chat switch) ──────────────

  function getCurrentChatId() {
    var p = location.pathname;
    if (PLATFORM === 'chatgpt') { var m = p.match(/\/c\/([^/?#]+)/);   return m ? '/c/'   + m[1] : p; }
    if (PLATFORM === 'gemini')  { var m2 = p.match(/\/app\/([^/?#]+)/); return m2 ? '/app/' + m2[1] : '/app'; }
    if (PLATFORM === 'claude')  { var m3 = p.match(/\/chat\/([^/?#]+)/); return m3 ? '/chat/' + m3[1] : p; }
    return p;
  }

  var lastLocationKey = getCurrentChatId() + location.search;

  function onSiteNavigation() {
    var key = getCurrentChatId() + location.search;
    if (key === lastLocationKey) return;
    lastLocationKey = key;
    answerInFlight = false;
    clearStreamingCatchTimer();
    syncEdgeSpin();
  }

  function installHistoryNavigationHook() {
    function onNav() { setTimeout(onSiteNavigation, 0); }
    var ps = history.pushState;
    history.pushState = function () { var ret = ps.apply(history, arguments); onNav(); return ret; };
    var rs = history.replaceState;
    history.replaceState = function () { var ret = rs.apply(history, arguments); onNav(); return ret; };
    window.addEventListener('popstate', onNav);
  }

  // ── Messages from background / side panel ────────────────────────────────

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.type === 'STAY_SCROLL_CHAT_BOTTOM') {
      var ok = scrollChatToBottom();
      sendResponse({ ok: ok });
      return false;
    }
    if (msg.type === 'STAY_PASTE_IMAGE_TO_CHAT') {
      var pasted = pasteImageToChat(msg.dataUrl);
      sendResponse({ ok: pasted });
      return false;
    }
    return false;
  });

  /**
   * Convert a PNG dataUrl into a File and drop it into the current page's chat
   * composer. Tries the most reliable path first (file-input injection, which
   * ChatGPT/Claude/Gemini all use under the hood for attachments), then falls
   * back to a synthetic paste ClipboardEvent on the contenteditable composer.
   */
  function pasteImageToChat(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return false;
    try {
      var commaIdx = dataUrl.indexOf(',');
      if (commaIdx < 0) return false;
      var meta = dataUrl.slice(0, commaIdx);
      var b64  = dataUrl.slice(commaIdx + 1);
      var type = (meta.match(/data:([^;]+)/) || [])[1] || 'image/png';
      var bin  = atob(b64);
      var u8   = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var file = new File([u8], 'stay-drawing.png', { type: type });

      var composer =
        document.querySelector('#prompt-textarea') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('textarea');
      if (composer) { try { composer.focus(); } catch (_) {} }

      // 1. File-input injection (preferred; matches what the file picker does).
      var inputs = document.querySelectorAll('input[type="file"]');
      for (var j = 0; j < inputs.length; j++) {
        var input = inputs[j];
        try {
          var dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input',  { bubbles: true }));
          console.log(LOG, 'paste: injected via file input');
          return true;
        } catch (_) { /* try next */ }
      }

      // 2. Synthetic paste on the composer (works on some React surfaces).
      if (composer) {
        try {
          var dt2 = new DataTransfer();
          dt2.items.add(file);
          var pe = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt2,
          });
          composer.dispatchEvent(pe);
          console.log(LOG, 'paste: dispatched ClipboardEvent');
          return true;
        } catch (_) { /* fall through */ }
      }

      return false;
    } catch (err) {
      console.warn(LOG, 'pasteImageToChat failed', err);
      return false;
    }
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────

  ensureEdgeTrigger();
  installHistoryNavigationHook();
  watchForAnswerReady();

  document.addEventListener('keydown', onKeyDown,      true);
  document.addEventListener('click',   onClickCapture, true);

  console.log(LOG, 'content loaded', { href: location.href, platform: PLATFORM });

})();
