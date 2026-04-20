/**
 * draw.js — Stay extension: Draw tab
 *
 * Toolbar
 *   Row 1 : [Pen] [Eraser] [Text] [Shape]   [• • • • •  (colours)]
 *   Row 2 : [Undo] [Redo] [Cursor]   [Select artwork]   [Clear]
 *
 * Bottom bar (only after a selection is made)
 *   [ Send to chat ]   →   [ Copied — paste in chat ]
 *
 *   The bottom CTA replaces the previous floating overlay near the cursor.
 *   It runs the cross-tab paste path defined in background.js / content.js
 *   (`STAY_PASTE_IMAGE_TO_CHAT`) and falls back to the clipboard when the
 *   active tab cannot be reached.
 *
 * Cursor tool (the arrow icon)
 *   Vector picker. Click on any single stroke / shape / text and drag it
 *   to a new place on the canvas. Hit testing uses each object's bounding
 *   box (topmost wins). All edits go through the same objects-array history
 *   that powers undo / redo.
 *
 * Keyboard: ⌘Z undo · ⌘⇧Z / ⌘Y redo  |  V cursor · P pen · E eraser · T text
 */
(function (S) {
  'use strict';

  // Palette per reference: blue, red, green, white, black.
  var BASIC_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#ffffff', '#1a1a1a'];

  S.loadDrawings = function (cb) { if (cb) cb({}); };
  S.saveDrawing  = function () {};

  var _kbCleanup = null;

  // ── renderDrawTab ──────────────────────────────────────────────────────────

  S.renderDrawTab = function renderDrawTab() {
    if (_kbCleanup) { _kbCleanup(); _kbCleanup = null; }

    var body = S.el('cwg-panel-body');
    var header   = S.el('cwg-panel-header');
    if (header)    header.classList.remove('cwg-panel-header--color');
    var scoreline = S.el('cwg-panel-scoreline');
    if (scoreline) scoreline.hidden = true;
    body.className = 'cwg-panel-body cwg-panel-body--draw';

    // ── Hugeicons-style stroked icons (24x24, stroke 1.6, currentColor) ──
    var IC_PEN =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 20l4-1 10-10-3-3L5 16l-1 4z"/>' +
      '<path d="M14 6l3 3"/></svg>';

    var IC_ERASER =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M16 3l5 5-10 10H6l-3-3L13 6l3-3z"/>' +
      '<path d="M9 10l5 5"/></svg>';

    var IC_TEXT =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 6V5h14v1"/>' +
      '<path d="M12 5v14"/>' +
      '<path d="M9 19h6"/></svg>';

    var IC_RECT =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="5" y="5" width="14" height="14" rx="2"/></svg>';

    var IC_CIRCLE =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="7"/></svg>';

    var IC_TRIANGLE =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 5l7 13H5l7-13z"/></svg>';

    var IC_LINE =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 19L19 5"/></svg>';

    // The shape button shows the currently-selected shape. Default = rect.
    var IC_SHAPE = IC_RECT;

    var IC_DOWNLOAD =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 4v11"/>' +
      '<path d="M7 11l5 5 5-5"/>' +
      '<path d="M5 19h14"/></svg>';

    var IC_UNDO =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M9 14l-4-4 4-4"/>' +
      '<path d="M5 10h9a5 5 0 010 10h-2"/></svg>';

    var IC_REDO =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M15 14l4-4-4-4"/>' +
      '<path d="M19 10h-9a5 5 0 000 10h2"/></svg>';

    var IC_CURSOR =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 3l6 16 2-7 7-2L5 3z"/></svg>';

    function swatch(c) {
      var cls = (c === '#ffffff') ? ' cwg-draw-swatch--white' : '';
      return '<button type="button" class="cwg-draw-swatch' + cls +
             '" style="background:' + c + '" data-color="' + c + '" aria-label="' + c + '"></button>';
    }

    body.innerHTML =
      '<div class="cwg-draw-wrap">' +

      '<div class="cwg-draw-toolbar">' +

      // ── Row 1 ──────────────────────────────────────────────────────────
      '<div class="cwg-draw-toolbar-row">' +
      '<button type="button" class="cwg-draw-tool-btn cwg-draw-tool-btn--active" id="cwg-draw-pencil"    title="Pen (P)"    aria-label="Pen">'    + IC_PEN    + '</button>' +
      '<button type="button" class="cwg-draw-tool-btn"                              id="cwg-draw-eraser"    title="Eraser (E)" aria-label="Eraser">' + IC_ERASER + '</button>' +
      '<button type="button" class="cwg-draw-tool-btn"                              id="cwg-draw-text-tool" title="Text (T)"   aria-label="Text">'   + IC_TEXT   + '</button>' +
      // Shape button + dropdown popup (square / circle / triangle / line).
      '<div class="cwg-shape-wrap">' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-shape"' +
      ' title="Shape" aria-label="Shape" aria-haspopup="true" aria-expanded="false">' + IC_SHAPE + '</button>' +
      '<div class="cwg-shape-popup" id="cwg-shape-popup" role="menu">' +
        '<button type="button" class="cwg-draw-tool-btn" data-shape="rect"     title="Square"   aria-label="Square">'   + IC_RECT     + '</button>' +
        '<button type="button" class="cwg-draw-tool-btn" data-shape="circle"   title="Circle"   aria-label="Circle">'   + IC_CIRCLE   + '</button>' +
        '<button type="button" class="cwg-draw-tool-btn" data-shape="triangle" title="Triangle" aria-label="Triangle">' + IC_TRIANGLE + '</button>' +
        '<button type="button" class="cwg-draw-tool-btn" data-shape="line"     title="Line"     aria-label="Line">'     + IC_LINE     + '</button>' +
      '</div>' +
      '</div>' +
      BASIC_COLORS.map(swatch).join('') +
      '</div>' +

      // ── Row 2 ──────────────────────────────────────────────────────────
      // Select artwork + Download have moved to the persistent panel footer
      // (rendered below). This row keeps history controls + the move tool.
      '<div class="cwg-draw-toolbar-row">' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-undo"  title="Undo (\u2318Z)"  aria-label="Undo">'   + IC_UNDO   + '</button>' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-redo"  title="Redo (\u2318\u21e7Z)" aria-label="Redo">'  + IC_REDO   + '</button>' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-move"  title="Move (V)"          aria-label="Move">'   + IC_CURSOR + '</button>' +
      '<button type="button" class="cwg-draw-clear-btn" id="cwg-draw-clear" title="Clear">Clear</button>' +
      '</div>' +

      '</div>' + // end toolbar

      '<div class="cwg-draw-canvas-wrap" id="cwg-canvas-wrap"><canvas id="cwg-draw-canvas"></canvas></div>' +

      '</div>';

    // ── Persistent footer (Select artwork + Download) ───────────────────────
    // 80:20 split — primary "Select artwork" pill on the left, icon-only
    // download button on the right. The left button is a small state
    // machine: idle → selecting → armed → sending → success.
    var footerEl = document.getElementById('cwg-panel-footer');
    footerEl.className = 'cwg-panel-footer';
    footerEl.innerHTML =
      '<button type="button" class="cwg-footer-btn" id="cwg-draw-select-artwork">Select artwork</button>' +
      '<button type="button" class="cwg-footer-btn cwg-footer-btn--icon" id="cwg-draw-download" title="Download artboard" aria-label="Download artboard">' +
        IC_DOWNLOAD +
      '</button>';

    var canvas   = S.el('cwg-draw-canvas');
    // willReadFrequently: true silences Chrome's "Multiple readback operations
    // using getImageData are faster with willReadFrequently" warning. We hit
    // this every time we call toDataURL() during Select-artwork / Download.
    var ctx      = canvas.getContext('2d', { willReadFrequently: true });
    var canvWrap = S.el('cwg-canvas-wrap');

    // ── State ────────────────────────────────────────────────────────────────
    var tool          = 'pencil';
    var color         = BASIC_COLORS[0];
    var currentShape  = 'rect';
    var toolSizes     = { pencil: 2, eraser: 8, text: 14 };
    var drawing       = false;
    var startX = 0, startY = 0, lastX = 0, lastY = 0;

    // Vector model: every mark is an object. The canvas pixels are derived
    // from `objects` via renderAll(), so a single stroke can be picked up
    // by the cursor tool without disturbing any other marks.
    //   stroke : { type:'stroke', tool, points:[{x,y}], color, lineWidth }
    //   shape  : { type:'shape',  shape, x1, y1, x2, y2,    color, lineWidth }
    //   text   : { type:'text',   x, y, text, color, fontSize }
    var objects   = [];
    var history   = [[]];           // snapshots of the objects array
    var histIdx   = 0;
    var MAX_HIST  = 60;

    // The pencil/eraser stroke currently being authored.
    var inProgressStroke = null;

    // Cursor (move) tool
    var pickedObj         = null;
    var pickedOriginalIdx = -1;
    var pickedClickPos    = null;   // canvas coords of the mousedown

    // Export-select (Select artwork) state
    var exportMode        = false;
    var exportSelStart    = null;
    var exportSel         = null;
    var pendingSel        = null;   // the selection that armed the bottom CTA

    // Popups (none currently used; kept for outside-click safety)
    var outsideClickFn = null;

    // ── Object rendering ─────────────────────────────────────────────────────
    function deepCloneObjects(arr) {
      return arr.map(function (o) {
        var c = {};
        for (var k in o) {
          if (k === 'points') c.points = o.points.map(function (p) { return { x: p.x, y: p.y }; });
          else c[k] = o[k];
        }
        return c;
      });
    }

    function drawStrokeObject(o) {
      ctx.beginPath();
      ctx.strokeStyle = o.tool === 'eraser' ? '#ffffff' : o.color;
      ctx.lineWidth   = o.lineWidth;
      ctx.lineCap = ctx.lineJoin = 'round';
      var pts = o.points;
      if (pts.length === 1) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.arc(pts[0].x, pts[0].y, Math.max(0.5, o.lineWidth / 2), 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    function drawShapeObject(o) {
      ctx.beginPath();
      ctx.strokeStyle = o.color;
      ctx.lineWidth   = o.lineWidth;
      ctx.lineCap = ctx.lineJoin = 'round';
      if (o.shape === 'circle') {
        ctx.arc(o.x1, o.y1, Math.hypot(o.x2 - o.x1, o.y2 - o.y1), 0, Math.PI * 2);
      } else if (o.shape === 'triangle') {
        var mx = (o.x1 + o.x2) / 2;
        ctx.moveTo(mx, o.y1); ctx.lineTo(o.x2, o.y2); ctx.lineTo(o.x1, o.y2); ctx.closePath();
      } else if (o.shape === 'rect') {
        ctx.rect(o.x1, o.y1, o.x2 - o.x1, o.y2 - o.y1);
      } else if (o.shape === 'line') {
        ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2);
      }
      ctx.stroke();
    }

    function drawTextObject(o) {
      ctx.font = 'bold ' + o.fontSize + 'px system-ui,sans-serif';
      ctx.fillStyle = o.color;
      ctx.fillText(o.text, o.x, o.y + o.fontSize * 0.15);
    }

    function drawObject(o) {
      if (!o) return;
      if (o.type === 'stroke') drawStrokeObject(o);
      else if (o.type === 'shape') drawShapeObject(o);
      else if (o.type === 'text')  drawTextObject(o);
    }

    function renderAll() {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      objects.forEach(drawObject);
      // "Select artwork" appears as soon as there is anything to capture.
      setSelectBtnVisible(objects.length > 0 || inProgressStroke || pickedObj);
    }

    function getObjectBbox(o) {
      if (o.type === 'stroke') {
        var pts = o.points;
        if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < pts.length; i++) {
          if (pts[i].x < minX) minX = pts[i].x;
          if (pts[i].y < minY) minY = pts[i].y;
          if (pts[i].x > maxX) maxX = pts[i].x;
          if (pts[i].y > maxY) maxY = pts[i].y;
        }
        var pad = (o.lineWidth || 2) / 2 + 6;
        return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
      }
      if (o.type === 'shape') {
        var pad2 = (o.lineWidth || 2) / 2 + 4;
        if (o.shape === 'circle') {
          var r = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
          return { x: o.x1 - r - pad2, y: o.y1 - r - pad2, w: 2 * r + pad2 * 2, h: 2 * r + pad2 * 2 };
        }
        var x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2);
        var w = Math.abs(o.x2 - o.x1), h = Math.abs(o.y2 - o.y1);
        return { x: x - pad2, y: y - pad2, w: w + pad2 * 2, h: h + pad2 * 2 };
      }
      if (o.type === 'text') {
        var savedFont = ctx.font;
        ctx.font = 'bold ' + o.fontSize + 'px system-ui,sans-serif';
        var tw = ctx.measureText(o.text).width;
        ctx.font = savedFont;
        return { x: o.x - 4, y: o.y - o.fontSize, w: tw + 8, h: o.fontSize * 1.3 };
      }
      return { x: 0, y: 0, w: 0, h: 0 };
    }

    function hitObjectAt(px, py) {
      for (var i = objects.length - 1; i >= 0; i--) {
        var bb = getObjectBbox(objects[i]);
        if (px >= bb.x && px <= bb.x + bb.w &&
            py >= bb.y && py <= bb.y + bb.h) return i;
      }
      return -1;
    }

    function translatedClone(o, dx, dy) {
      var c = deepCloneObjects([o])[0];
      if (c.type === 'stroke') {
        c.points = c.points.map(function (p) { return { x: p.x + dx, y: p.y + dy }; });
      } else if (c.type === 'shape') {
        c.x1 += dx; c.y1 += dy; c.x2 += dx; c.y2 += dy;
      } else if (c.type === 'text') {
        c.x += dx; c.y += dy;
      }
      return c;
    }

    // ── History ──────────────────────────────────────────────────────────────
    function saveSnap() {
      if (histIdx < history.length - 1) history.splice(histIdx + 1);
      history.push(deepCloneObjects(objects));
      if (history.length > MAX_HIST) history.shift();
      histIdx = history.length - 1;
    }

    function applySnap(idx) {
      if (idx < 0 || idx >= history.length) return;
      // Cancel any in-flight selection / picked object before time-travel.
      if (exportMode) exitExportMode();
      pickedObj = null; pickedOriginalIdx = -1;
      pendingSel = null;
      setBtnState('idle');
      histIdx = idx;
      objects = deepCloneObjects(history[idx]);
      renderAll();
    }

    requestAnimationFrame(function () {
      canvas.width  = canvWrap.clientWidth  || 320;
      canvas.height = canvWrap.clientHeight || 300;
      objects = [];
      history = [[]];
      histIdx = 0;
      renderAll();
    });

    // ── Footer button state machine ──────────────────────────────────────────
    // Single left-slot button cycles through:
    //   idle      → "Select artwork"           (secondary)
    //   selecting → "Cancel"                   (secondary)
    //   armed     → "Send to chat"             (primary coral)
    //   success   → "Copied — paste in chat"   (success state, transient)
    var selectBtn   = S.el('cwg-draw-select-artwork');
    var downloadBtn = S.el('cwg-draw-download');
    var btnState    = 'idle';

    function setBtnState(next) {
      btnState = next;
      if (!selectBtn) return;
      selectBtn.classList.remove(
        'cwg-footer-btn--primary',
        'cwg-footer-btn--success'
      );
      selectBtn.disabled = false;
      if (next === 'idle') {
        selectBtn.textContent = 'Select artwork';
        // Primary coral only after the user has drawn something — otherwise
        // the pill stays in its neutral secondary look (and is disabled).
        var hasContent = objects.length > 0 || !!inProgressStroke || !!pickedObj;
        if (hasContent) selectBtn.classList.add('cwg-footer-btn--primary');
        else            selectBtn.disabled = true;
      } else if (next === 'selecting') {
        selectBtn.textContent = 'Cancel';
      } else if (next === 'armed') {
        selectBtn.textContent = 'Copy art';
        selectBtn.classList.add('cwg-footer-btn--primary');
      } else if (next === 'sending') {
        selectBtn.textContent = 'Copying…';
        selectBtn.classList.add('cwg-footer-btn--primary');
        selectBtn.disabled = true;
      } else if (next === 'success') {
        selectBtn.textContent = 'Copied — paste in chat';
        selectBtn.classList.add('cwg-footer-btn--success');
      }
    }

    // Toggle download availability + re-evaluate the idle styling so the
    // Select artwork button flips secondary↔primary as soon as the canvas
    // gains/loses content.
    function refreshFooterAvailability() {
      var hasContent = objects.length > 0 || !!inProgressStroke || !!pickedObj;
      if (downloadBtn) downloadBtn.disabled = !hasContent;
      if (selectBtn && btnState === 'idle') {
        // Re-run the idle branch to update primary class + disabled flag.
        setBtnState('idle');
      }
    }

    // Kept as a no-op wrapper so existing callsites in renderAll() still
    // work. With the footer always visible there's no separate "show/hide".
    function setSelectBtnVisible(_visible) { refreshFooterAvailability(); }

    function enterExportMode() {
      removeAnyPicked();
      exportMode = true;
      exportSelStart = null;
      exportSel = null;
      pendingSel = null;
      renderAll();
      canvas.style.cursor = 'crosshair';
      setBtnState('selecting');
    }

    function exitExportMode() {
      exportMode = false;
      exportSelStart = null;
      exportSel = null;
      canvas.style.cursor = toolCursors[tool] || 'crosshair';
      // Caller decides which button state to restore (idle vs armed).
    }

    function clearArmedSelection() {
      pendingSel = null;
      setBtnState('idle');
      renderAll(); // strips any lingering selection rectangle
    }

    function removeAnyPicked() {
      if (pickedObj && pickedOriginalIdx >= 0) {
        objects.splice(pickedOriginalIdx, 0, pickedObj);
      }
      pickedObj = null; pickedOriginalIdx = -1; pickedClickPos = null;
    }

    // ── PNG helpers (unchanged behaviour, work directly on the canvas) ──────
    function makePngFile(sx, sy, sw, sh) {
      var dataURL;
      if (sw && sh && Math.abs(sw) > 4 && Math.abs(sh) > 4) {
        var nx = Math.min(sx, sx + sw), ny = Math.min(sy, sy + sh);
        var nw = Math.abs(sw), nh = Math.abs(sh);
        var off = document.createElement('canvas');
        off.width = Math.round(nw); off.height = Math.round(nh);
        off.getContext('2d', { willReadFrequently: true }).drawImage(canvas, nx, ny, nw, nh, 0, 0, nw, nh);
        dataURL = off.toDataURL('image/png');
      } else {
        dataURL = canvas.toDataURL('image/png');
      }
      var parts = dataURL.split(','), bin = atob(parts[1]);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], 'stay-drawing.png', { type: 'image/png' });
    }

    function makeOffCanvasFor(sel) {
      var nx = Math.min(sel.x, sel.x + sel.w), ny = Math.min(sel.y, sel.y + sel.h);
      var nw = Math.abs(sel.w), nh = Math.abs(sel.h);
      var off = document.createElement('canvas');
      off.width  = Math.max(1, Math.round(nw));
      off.height = Math.max(1, Math.round(nh));
      // Render with the selection rect NOT painted on (renderAll first).
      renderAll();
      off.getContext('2d', { willReadFrequently: true }).drawImage(canvas, nx, ny, nw, nh, 0, 0, nw, nh);
      return off;
    }

    function copyPngToClipboard(off, cb) {
      off.toBlob(function (blob) {
        if (!blob) { if (cb) cb(false); return; }
        try {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            .then(function () { if (cb) cb(true); })
            .catch(function () { if (cb) cb(false); });
        } catch (_) { if (cb) cb(false); }
      }, 'image/png');
    }

    // ── Send-to-chat invocation (run from Select-artwork button click) ──────
    function sendArmedSelectionToChat() {
      if (!pendingSel) return;
      setBtnState('sending');
      var off = makeOffCanvasFor(pendingSel);
      var dataUrl = off.toDataURL('image/png');

      // 1. Always copy to the clipboard so ⌘V works even if injection fails.
      copyPngToClipboard(off, null);

      // 2. Ask the active tab's content script to drop the PNG into the
      //    composer. Whether or not injection succeeds, we surface the same
      //    "paste in chat" hint because the clipboard write is reliable.
      var done = false;
      function onDone(_injected) {
        if (done) return; done = true;
        setBtnState('success');
        setTimeout(function () {
          pendingSel = null;
          setBtnState('idle');
          renderAll(); // remove the dashed selection marker
          refreshFooterAvailability();
        }, 2400);
      }
      try {
        chrome.runtime.sendMessage(
          { type: 'STAY_PASTE_IMAGE_TO_CHAT', dataUrl: dataUrl },
          function (res) {
            if (chrome.runtime.lastError) { onDone(false); return; }
            onDone(!!(res && res.ok));
          }
        );
      } catch (_) { onDone(false); }
    }

    // ── Download button: saves the entire artboard as a PNG ─────────────────
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function () {
        if (downloadBtn.disabled) return;
        // Make sure we capture the committed scene only — no in-flight
        // selection rectangle or hover ghost.
        renderAll();
        try {
          var url = canvas.toDataURL('image/png');
          var a = document.createElement('a');
          a.href = url;
          a.download = 'stay-drawing-' + Date.now() + '.png';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
        } catch (_) { /* canvas tainted — ignore silently */ }
      });
    }

    // ── Selection rectangle (during export mode) ────────────────────────────
    function drawSelectionRect(sx, sy, sw, sh) {
      renderAll();
      var rx = Math.min(sx, sx + sw), ry = Math.min(sy, sy + sh);
      var rw = Math.abs(sw), rh = Math.abs(sh);
      ctx.save();
      ctx.fillStyle = 'rgba(255, 107, 91, 0.10)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#ff6b5b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
      ctx.restore();
    }

    // ── Picked-object overlay (during cursor drag) ──────────────────────────
    function drawPickedFloating(dx, dy) {
      if (!pickedObj) return;
      var ghost = translatedClone(pickedObj, dx, dy);
      drawObject(ghost);
      var bb = getObjectBbox(ghost);
      ctx.save();
      ctx.strokeStyle = '#ff6b5b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(bb.x + 0.5, bb.y + 0.5, bb.w, bb.h);
      ctx.restore();
    }

    function drawHoverHighlight(idx) {
      if (idx < 0) return;
      var bb = getObjectBbox(objects[idx]);
      ctx.save();
      ctx.strokeStyle = '#ff6b5b';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(bb.x + 0.5, bb.y + 0.5, bb.w, bb.h);
      ctx.restore();
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    function getPos(e) {
      var rect = canvas.getBoundingClientRect();
      var src  = e.touches ? e.touches[0] : e;
      return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    function isShapeTool() {
      return tool === 'circle' || tool === 'triangle' || tool === 'rect' || tool === 'line';
    }

    // ── Canvas events ────────────────────────────────────────────────────────
    function onStart(e) {
      e.preventDefault();
      if (tool === 'text') return;

      var p = getPos(e);

      // ── Cursor (move) tool: hit-test for a single object ────────────────
      if (tool === 'move') {
        var idx = hitObjectAt(p.x, p.y);
        if (idx < 0) return; // click on empty space — nothing to grab
        drawing = true;
        pickedOriginalIdx = idx;
        pickedObj = objects.splice(idx, 1)[0];
        pickedClickPos = p;
        renderAll();              // redraw without the picked object
        drawPickedFloating(0, 0); // overlay it at original position
        return;
      }

      drawing = true;
      startX = lastX = p.x; startY = lastY = p.y;

      // ── Export selection drag ──────────────────────────────────────────
      if (exportMode) {
        exportSelStart = p;
        exportSel = null;
        return;
      }

      // ── Shape tool: defer to onMove for live preview ───────────────────
      if (isShapeTool()) return;

      // ── Pencil / eraser: open a new stroke ─────────────────────────────
      inProgressStroke = {
        type: 'stroke',
        tool: tool,
        points: [{ x: p.x, y: p.y }],
        color: color,
        lineWidth: tool === 'eraser' ? toolSizes.eraser : toolSizes.pencil,
      };
      ctx.beginPath();
      ctx.fillStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.arc(p.x, p.y, Math.max(0.5, inProgressStroke.lineWidth / 2), 0, Math.PI * 2);
      ctx.fill();
    }

    function onMove(e) {
      if (!drawing) return;
      e.preventDefault();
      var p = getPos(e);

      if (tool === 'move' && pickedObj) {
        var dx = p.x - pickedClickPos.x;
        var dy = p.y - pickedClickPos.y;
        renderAll();
        drawPickedFloating(dx, dy);
        return;
      }

      if (exportMode && exportSelStart) {
        exportSel = { x: exportSelStart.x, y: exportSelStart.y, w: p.x - exportSelStart.x, h: p.y - exportSelStart.y };
        drawSelectionRect(exportSel.x, exportSel.y, exportSel.w, exportSel.h);
        return;
      }

      if (isShapeTool()) {
        renderAll();
        var preview = {
          type: 'shape',
          shape: currentShape,
          x1: startX, y1: startY,
          x2: p.x,    y2: p.y,
          color: color,
          lineWidth: toolSizes.pencil,
        };
        drawShapeObject(preview);
        return;
      }

      if (inProgressStroke) {
        inProgressStroke.points.push({ x: p.x, y: p.y });
        ctx.beginPath();
        ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
        ctx.lineWidth   = inProgressStroke.lineWidth;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.stroke();
        lastX = p.x; lastY = p.y;
      }
    }

    function onEnd(e) {
      if (!drawing) return;
      if (e) e.preventDefault();
      drawing = false;
      var p = getPos(e || {});

      // ── Cursor (move) tool: drop the picked object ─────────────────────
      if (tool === 'move' && pickedObj) {
        var dx = p.x - pickedClickPos.x;
        var dy = p.y - pickedClickPos.y;
        var moved = translatedClone(pickedObj, dx, dy);
        objects.splice(pickedOriginalIdx, 0, moved);
        pickedObj = null; pickedOriginalIdx = -1; pickedClickPos = null;
        renderAll();
        saveSnap();
        return;
      }

      // ── Export (Select artwork) drag complete → arm footer CTA ─────────
      if (exportMode && exportSel && Math.abs(exportSel.w) > 8 && Math.abs(exportSel.h) > 8) {
        // Keep a thin marker on the canvas so the user can see what they
        // captured while the footer button switches to "Send to chat".
        renderAll();
        drawSelectionRect(exportSel.x, exportSel.y, exportSel.w, exportSel.h);
        pendingSel = exportSel;
        exitExportMode();
        setBtnState('armed');
        return;
      }
      if (exportMode) {
        renderAll(); // discard a too-small selection scribble
        exportSel = exportSelStart = null;
        return;
      }

      // ── Shape tool finalisation ────────────────────────────────────────
      if (isShapeTool()) {
        var w = p.x - startX, h = p.y - startY;
        if (Math.abs(w) > 2 && Math.abs(h) > 2) {
          objects.push({
            type: 'shape',
            shape: currentShape,
            x1: startX, y1: startY,
            x2: p.x,    y2: p.y,
            color: color,
            lineWidth: toolSizes.pencil,
          });
          renderAll();
          saveSnap();
        } else {
          renderAll();
        }
        return;
      }

      // ── Pencil / eraser stroke commit ──────────────────────────────────
      if (inProgressStroke) {
        objects.push(inProgressStroke);
        inProgressStroke = null;
        // Canvas pixels already reflect the stroke; just snapshot for undo.
        saveSnap();
        renderAll();
      }
    }

    canvas.addEventListener('mousedown',  onStart);
    canvas.addEventListener('mousemove',  onMove);
    canvas.addEventListener('mouseup',    onEnd);
    canvas.addEventListener('mouseleave', function (e) {
      if (!isShapeTool() && !exportMode && tool !== 'move') onEnd(e);
    });
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove',  onMove,  { passive: false });
    canvas.addEventListener('touchend',   onEnd,   { passive: false });

    var docMouseUp = function (e) { if (drawing) onEnd(e); };
    document.addEventListener('mouseup', docMouseUp);

    // ── Text tool click ──────────────────────────────────────────────────────
    canvas.addEventListener('click', function (e) {
      if (tool !== 'text' || drawing) return;
      var p = getPos(e);
      var fontSize = toolSizes.text;

      var inp = document.createElement('div');
      inp.contentEditable = 'true';
      inp.setAttribute('spellcheck', 'false');
      inp.style.cssText =
        'position:absolute;left:' + Math.round(p.x) + 'px;' +
        'top:' + Math.round(p.y - fontSize * 0.85) + 'px;' +
        'min-width:80px;min-height:' + (fontSize + 4) + 'px;border:none;' +
        'outline:1.5px dashed #aaa;background:transparent;color:' + color + ';' +
        'font-size:' + fontSize + 'px;font-family:system-ui,sans-serif;' +
        'line-height:1.2;padding:2px 4px;cursor:text;white-space:nowrap;z-index:10;';
      canvWrap.appendChild(inp);
      inp.focus();
      var range = document.createRange(), sel = window.getSelection();
      range.selectNodeContents(inp); range.collapse(false);
      sel.removeAllRanges(); sel.addRange(range);

      var done = false;
      function commit() {
        if (done) return; done = true;
        var text = (inp.innerText || inp.textContent || '').replace(/\n/g, ' ').trim();
        if (text) {
          objects.push({
            type: 'text',
            x: p.x, y: p.y,
            text: text,
            color: color,
            fontSize: fontSize,
          });
          renderAll();
          saveSnap();
        }
        if (inp.parentNode) inp.parentNode.removeChild(inp);
      }
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { done = true; if (inp.parentNode) inp.parentNode.removeChild(inp); }
        ev.stopPropagation();
      });
    });

    // ── Tool button wiring ───────────────────────────────────────────────────
    var toolCursors = {
      pencil: 'crosshair', eraser: 'cell', text: 'text',
      rect:   'crosshair', move:   'default',
    };

    function activateTool(name) {
      if (exportMode) { exitExportMode(); setBtnState('idle'); }
      // Picking a different tool also drops any armed selection.
      if (pendingSel) clearArmedSelection();
      removeAnyPicked();
      renderAll();

      tool = name;
      var toolBtnMap = {
        'cwg-draw-move':       'move',
        'cwg-draw-pencil':     'pencil',
        'cwg-draw-eraser':     'eraser',
        'cwg-draw-text-tool':  'text',
        'cwg-draw-shape':      'shape',
      };
      Object.keys(toolBtnMap).forEach(function (id) {
        var btn = S.el(id);
        if (btn) btn.classList.toggle('cwg-draw-tool-btn--active',
          toolBtnMap[id] === name || (toolBtnMap[id] === 'shape' && isShapeTool()));
      });
      canvas.style.cursor = toolCursors[name] || 'crosshair';
    }

    if (selectBtn) {
      selectBtn.addEventListener('click', function () {
        if (selectBtn.disabled) return;
        // Single-button state machine — see setBtnState() above.
        if (btnState === 'idle') {
          enterExportMode();
        } else if (btnState === 'selecting') {
          exitExportMode();
          setBtnState('idle');
          renderAll();
        } else if (btnState === 'armed') {
          sendArmedSelectionToChat();
        }
        // 'sending' / 'success' are non-interactive (button is disabled
        // or about to revert), so no action is needed.
      });
    }

    [
      ['cwg-draw-move',       'move'   ],
      ['cwg-draw-pencil',     'pencil' ],
      ['cwg-draw-eraser',     'eraser' ],
      ['cwg-draw-text-tool',  'text'   ],
    ].forEach(function (entry) {
      var btn = S.el(entry[0]);
      if (!btn) return;
      btn.addEventListener('click', function () { activateTool(entry[1]); });
    });

    // ── Shape dropdown ──────────────────────────────────────────────────────
    // The shape toolbar button toggles a popup with rect / circle / triangle
    // / line. Picking a shape sets `currentShape`, swaps the toolbar icon
    // to match, and activates the shape tool.
    var shapeBtn      = S.el('cwg-draw-shape');
    var shapePopup    = S.el('cwg-shape-popup');
    var shapeIconMap  = { rect: IC_RECT, circle: IC_CIRCLE, triangle: IC_TRIANGLE, line: IC_LINE };
    var closeShapePopup = function () {
      if (!shapePopup) return;
      shapePopup.classList.remove('cwg-shape-popup--open');
      if (shapeBtn) shapeBtn.setAttribute('aria-expanded', 'false');
      if (outsideClickFn) {
        document.removeEventListener('mousedown', outsideClickFn, true);
        outsideClickFn = null;
      }
    };
    var openShapePopup = function () {
      if (!shapePopup) return;
      shapePopup.classList.add('cwg-shape-popup--open');
      if (shapeBtn) shapeBtn.setAttribute('aria-expanded', 'true');
      // Defer attaching the outside-click handler so the click that opened
      // the popup doesn't immediately dismiss it.
      setTimeout(function () {
        outsideClickFn = function (ev) {
          if (shapePopup.contains(ev.target) || (shapeBtn && shapeBtn.contains(ev.target))) return;
          closeShapePopup();
        };
        document.addEventListener('mousedown', outsideClickFn, true);
      }, 0);
    };

    if (shapeBtn) {
      shapeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var willOpen = !shapePopup.classList.contains('cwg-shape-popup--open');
        // First click on the shape button also activates the shape tool with
        // whatever currentShape is already set to — matches the other tools.
        activateTool(currentShape);
        if (willOpen) openShapePopup();
        else          closeShapePopup();
      });
    }
    if (shapePopup) {
      shapePopup.querySelectorAll('[data-shape]').forEach(function (opt) {
        opt.addEventListener('click', function (e) {
          e.stopPropagation();
          var s = opt.getAttribute('data-shape');
          currentShape = s;
          if (shapeBtn) shapeBtn.innerHTML = shapeIconMap[s] || IC_RECT;
          activateTool(s);
          closeShapePopup();
        });
      });
    }

    // Colour swatches.
    body.querySelectorAll('.cwg-draw-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        color = sw.getAttribute('data-color');
        if (tool === 'eraser') activateTool('pencil');
        body.querySelectorAll('.cwg-draw-swatch').forEach(function (s) {
          s.classList.toggle('cwg-draw-swatch--active', s === sw);
        });
      });
    });
    var initSwatch = body.querySelector('.cwg-draw-swatch[data-color="#1a1a1a"]');
    if (initSwatch) initSwatch.classList.add('cwg-draw-swatch--active');

    // Undo / Redo / Clear.
    var undoBtn  = S.el('cwg-draw-undo');
    var redoBtn  = S.el('cwg-draw-redo');
    var clearBtn = S.el('cwg-draw-clear');
    if (undoBtn)  undoBtn.addEventListener('click',  function () { applySnap(histIdx - 1); });
    if (redoBtn)  redoBtn.addEventListener('click',  function () { applySnap(histIdx + 1); });
    if (clearBtn) clearBtn.addEventListener('click', function () {
      if (exportMode) exitExportMode();
      removeAnyPicked();
      objects = [];
      pendingSel = null;
      setBtnState('idle');
      renderAll();
      saveSnap();
      refreshFooterAvailability();
    });

    // Initial footer state.
    setBtnState('idle');
    refreshFooterAvailability();

    // ── Keyboard shortcuts ───────────────────────────────────────────────────
    function onKey(e) {
      if (S.activeTab !== 'draw') return;
      if (e.target && (e.target.contentEditable === 'true' ||
                       e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          e.shiftKey ? applySnap(histIdx + 1) : applySnap(histIdx - 1);
          return;
        }
        if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); applySnap(histIdx + 1); return; }
        return;
      }
      var map = { v: 'move', p: 'pencil', e: 'eraser', t: 'text' };
      if (map[e.key.toLowerCase()]) activateTool(map[e.key.toLowerCase()]);
    }

    document.addEventListener('keydown', onKey, true);
    _kbCleanup = function () {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mouseup', docMouseUp);
      if (outsideClickFn) document.removeEventListener('mousedown', outsideClickFn, true);
    };

    // Suppress unused-var lints (kept for future hover preview work).
    void drawHoverHighlight;
  };

})(window._Stay = window._Stay || {});
