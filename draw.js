/**
 * draw.js — Stay extension: Draw tab
 *
 * Row 1 : [↖ Move]  [✏️ Pencil▾]  [⌫ Eraser▾]  [T Text▾]  [▭ Shape▾]
 * Row 2 : [● ○ ● ● ●  🎨]  [sep]  [↩]  [↪]  [Clear]  [Drag to chat]
 *
 * Pencil / Eraser / Text  → clicking the button toggles a size popup (3 dots)
 * Shape                   → clicking opens a shape picker (circle/triangle/rect/line)
 * Move                    → drag to select a region, then drag the floating region
 * Drag to chat            → select region → floating drag handle → drop into chat
 *
 * Keyboard: ⌘Z undo · ⌘⇧Z / ⌘Y redo  |  V move · P pencil · E eraser · T text
 */
(function (S) {
  'use strict';

  var BASIC_COLORS = ['#1a1a1a', '#ffffff', '#ef4444', '#22c55e', '#3b82f6'];
  var MORE_COLORS  = ['#f59e0b', '#f97316', '#a855f7', '#ec4899', '#92400e', '#06b6d4'];

  var SHAPE_DATA = [
    { id: 'circle',   icon: '○', label: 'Circle'    },
    { id: 'triangle', icon: '△', label: 'Triangle'  },
    { id: 'rect',     icon: '▭', label: 'Rectangle' },
    { id: 'line',     icon: '╱', label: 'Line'      },
  ];

  // Size presets per tool: [canvas-value, dot-px-diameter]
  var SIZE_SETS = {
    pencil: [{v:2,p:7},{v:5,p:12},{v:12,p:18}],
    eraser: [{v:8,p:7},{v:18,p:12},{v:36,p:18}],
    text:   [{v:14,p:7},{v:24,p:12},{v:36,p:18}],
  };

  S.loadDrawings = function (cb) { if (cb) cb({}); };
  S.saveDrawing  = function () {};

  var _kbCleanup = null;

  // ── renderDrawTab ──────────────────────────────────────────────────────────

  S.renderDrawTab = function renderDrawTab() {
    if (_kbCleanup) { _kbCleanup(); _kbCleanup = null; }

    var body = document.getElementById('cwg-panel-body');
    var header   = document.getElementById('cwg-panel-header');
    if (header)    header.classList.remove('cwg-panel-header--color');
    var scoreline = document.getElementById('cwg-panel-scoreline');
    if (scoreline) scoreline.hidden = true;
    body.className = 'cwg-panel-body cwg-panel-body--draw';

    // ── SVG icons ────────────────────────────────────────────────────────────
    var moveSvg =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/>' +
      '<polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/>' +
      '<line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>';

    var eraserSvg =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 20H7L3 16 14 5l7 7-4 4"/><path d="M6 17l4-4"/></svg>';

    // ── HTML builders ────────────────────────────────────────────────────────
    function sizeDots(toolName) {
      return SIZE_SETS[toolName].map(function (s, i) {
        return '<button class="cwg-draw-size-dot' + (i === 0 ? ' cwg-draw-size-dot--active' : '') +
               '" data-size="' + s.v + '" data-tool="' + toolName +
               '" style="width:' + s.p + 'px;height:' + s.p + 'px"></button>';
      }).join('');
    }

    function swatch(c) {
      var cls = (c === '#ffffff') ? ' cwg-draw-swatch--white' : '';
      return '<button type="button" class="cwg-draw-swatch' + cls +
             '" style="background:' + c + '" data-color="' + c + '"></button>';
    }

    // ── Toolbar HTML ─────────────────────────────────────────────────────────
    body.innerHTML =
      '<div class="cwg-draw-wrap">' +
      '<div class="cwg-draw-toolbar">' +

      // Row 1: Move | Pencil | Eraser | Text | Shape
      '<div class="cwg-draw-toolbar-row">' +

      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-move" title="Move (V)">' + moveSvg + '</button>' +

      // Pencil
      '<div class="cwg-draw-tool-wrap" id="cwg-pencil-wrap">' +
      '<button type="button" class="cwg-draw-tool-btn cwg-draw-tool-btn--active" id="cwg-draw-pencil" title="Pencil (P)">✏️</button>' +
      '<div class="cwg-draw-popup cwg-draw-size-popup" id="cwg-pencil-size">' + sizeDots('pencil') + '</div>' +
      '</div>' +

      // Eraser
      '<div class="cwg-draw-tool-wrap" id="cwg-eraser-wrap">' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-eraser" title="Eraser (E)">' + eraserSvg + '</button>' +
      '<div class="cwg-draw-popup cwg-draw-size-popup" id="cwg-eraser-size">' + sizeDots('eraser') + '</div>' +
      '</div>' +

      // Text
      '<div class="cwg-draw-tool-wrap" id="cwg-text-wrap">' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-text-tool" title="Text (T)" style="font-weight:900;font-size:13px">T</button>' +
      '<div class="cwg-draw-popup cwg-draw-size-popup" id="cwg-text-size">' + sizeDots('text') + '</div>' +
      '</div>' +

      // Shape picker
      '<div class="cwg-draw-tool-wrap" id="cwg-shape-wrap">' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-shape" title="Shapes">' +
      '<span id="cwg-shape-icon">▭</span><span style="font-size:8px;opacity:.55;margin-left:2px">▾</span>' +
      '</button>' +
      '<div class="cwg-draw-popup cwg-draw-shape-popup" id="cwg-shape-popup">' +
      SHAPE_DATA.map(function (s) {
        return '<button type="button" class="cwg-draw-shape-opt' +
               (s.id === 'rect' ? ' cwg-draw-shape-opt--active' : '') +
               '" data-shape="' + s.id + '">' + s.icon + ' ' + s.label + '</button>';
      }).join('') +
      '</div>' +
      '</div>' +

      '</div>' + // end row 1

      // Row 2: Colours | ↩ | ↪ | Clear | Drag to chat
      '<div class="cwg-draw-toolbar-row">' +

      BASIC_COLORS.map(swatch).join('') +

      // More colours
      '<div class="cwg-draw-tool-wrap" id="cwg-more-wrap">' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-more-colors" title="More colours" style="font-size:14px;padding:0 3px">🎨</button>' +
      '<div class="cwg-draw-popup cwg-draw-more-popup" id="cwg-more-popup">' +
      MORE_COLORS.map(swatch).join('') +
      '</div>' +
      '</div>' +

      '<div class="cwg-draw-sep"></div>' +

      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-undo" title="Undo ⌘Z">↩</button>' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-redo" title="Redo ⌘⇧Z">↪</button>' +
      '<button type="button" class="cwg-draw-tool-btn" id="cwg-draw-clear" title="Clear canvas">Clear</button>' +
      '<button type="button" class="cwg-draw-export-btn" id="cwg-draw-export">Drag to chat</button>' +

      '</div>' + // end row 2
      '</div>' + // end toolbar

      '<div class="cwg-draw-canvas-wrap" id="cwg-canvas-wrap"><canvas id="cwg-draw-canvas"></canvas></div>' +
      '</div>';

    var canvas   = document.getElementById('cwg-draw-canvas');
    var ctx      = canvas.getContext('2d');
    var canvWrap = document.getElementById('cwg-canvas-wrap');

    // ── Canvas sizing ────────────────────────────────────────────────────────
    requestAnimationFrame(function () {
      canvas.width  = canvWrap.clientWidth  || 320;
      canvas.height = canvWrap.clientHeight || 300;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      saveSnap();
    });

    // ── State ────────────────────────────────────────────────────────────────
    var tool          = 'pencil';
    var color         = BASIC_COLORS[0];
    var currentShape  = 'rect';
    var toolSizes     = { pencil: 2, eraser: 8, text: 14 };
    var drawing       = false;
    var startX = 0, startY = 0, lastX = 0, lastY = 0;

    // Undo/redo
    var history = [], histIdx = -1, MAX_HIST = 40;

    // Move-tool state
    var moveState    = null; // null | 'selecting' | 'floating' | 'dragging'
    var moveSelRect  = null; // { x, y, w, h } normalised
    var moveSelData  = null; // ImageData of captured region
    var moveSelPos   = { x: 0, y: 0 }; // where the floating region is painted
    var moveDragOff  = { x: 0, y: 0 }; // mousedown offset inside the selection

    // Export-select state
    var exportMode      = false;
    var exportSelStart  = null;
    var exportSel       = null;
    var selOverlayEl    = null;

    // Popup management
    var openPopupEl = null;
    var outsideClickFn = null;

    // ── History ──────────────────────────────────────────────────────────────
    function saveSnap() {
      if (histIdx < history.length - 1) history.splice(histIdx + 1);
      if (history.length >= MAX_HIST) history.shift();
      history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      histIdx = history.length - 1;
    }

    function applySnap(idx) {
      if (idx < 0 || idx >= history.length) return;
      commitMoveIfNeeded(false); // commit without saving (we're about to overwrite)
      histIdx = idx;
      ctx.putImageData(history[idx], 0, 0);
      moveState = null; moveSelData = null;
      exportSel = null;
      removeSelOverlay();
    }

    // ── Synchronous PNG helper ────────────────────────────────────────────────
    function makePngFile(sx, sy, sw, sh) {
      var dataURL;
      if (sw && sh && Math.abs(sw) > 4 && Math.abs(sh) > 4) {
        var nx = Math.min(sx, sx + sw), ny = Math.min(sy, sy + sh);
        var nw = Math.abs(sw), nh = Math.abs(sh);
        var off = document.createElement('canvas');
        off.width = Math.round(nw); off.height = Math.round(nh);
        off.getContext('2d').drawImage(canvas, nx, ny, nw, nh, 0, 0, nw, nh);
        dataURL = off.toDataURL('image/png');
      } else {
        dataURL = canvas.toDataURL('image/png');
      }
      var parts = dataURL.split(','), bin = atob(parts[1]);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], 'stay-drawing.png', { type: 'image/png' });
    }

    // ── Move-tool helpers ────────────────────────────────────────────────────
    function redrawMoveFloat() {
      if (!moveSelData || !history[histIdx]) return;
      ctx.putImageData(history[histIdx], 0, 0);
      var tmp = document.createElement('canvas');
      tmp.width = moveSelData.width; tmp.height = moveSelData.height;
      tmp.getContext('2d').putImageData(moveSelData, 0, 0);
      ctx.drawImage(tmp, moveSelPos.x, moveSelPos.y);
      ctx.save();
      ctx.strokeStyle = '#2f2f2f'; ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(moveSelPos.x + 0.5, moveSelPos.y + 0.5, moveSelRect.w, moveSelRect.h);
      ctx.restore();
    }

    function commitMoveIfNeeded(doSave) {
      if (moveState !== 'floating' || !moveSelData) return;
      var tmp = document.createElement('canvas');
      tmp.width = moveSelData.width; tmp.height = moveSelData.height;
      tmp.getContext('2d').putImageData(moveSelData, 0, 0);
      // Draw on the current history base
      if (history[histIdx]) ctx.putImageData(history[histIdx], 0, 0);
      ctx.drawImage(tmp, moveSelPos.x, moveSelPos.y);
      if (doSave !== false) saveSnap();
      moveState = null; moveSelData = null; moveSelRect = null;
    }

    // ── Export overlay ───────────────────────────────────────────────────────
    function removeSelOverlay() {
      if (selOverlayEl && selOverlayEl.parentNode) selOverlayEl.parentNode.removeChild(selOverlayEl);
      selOverlayEl = null;
    }

    // ── Inject PNG file into the page's chat composer input ─────────────────
    function injectFileIntoComposer(file) {
      // Platforms store file inputs near the composer; try common selectors
      var fileInputSelectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"]',
      ];
      var fileInput = null;
      for (var i = 0; i < fileInputSelectors.length; i++) {
        fileInput = document.querySelector(fileInputSelectors[i]);
        if (fileInput) break;
      }
      if (!fileInput) return false;
      try {
        var dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input',  { bubbles: true }));
        return true;
      } catch (_) { return false; }
    }

    function copyPngToClipboard(off, nw, nh, cb) {
      off.toBlob(function (blob) {
        if (!blob) { if (cb) cb(false); return; }
        try {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            .then(function () { if (cb) cb(true); })
            .catch(function () { if (cb) cb(false); });
        } catch (_) { if (cb) cb(false); }
      }, 'image/png');
    }

    function showSelOverlay(sel) {
      removeSelOverlay();
      var nx = Math.min(sel.x, sel.x + sel.w), ny = Math.min(sel.y, sel.y + sel.h);
      var nw = Math.abs(sel.w), nh = Math.abs(sel.h);

      // Build the cropped off-screen canvas once for this selection
      var offCanvas = document.createElement('canvas');
      offCanvas.width  = Math.round(nw);
      offCanvas.height = Math.round(nh);
      offCanvas.getContext('2d').drawImage(canvas, nx, ny, nw, nh, 0, 0, nw, nh);

      var el = document.createElement('div');
      el.className = 'cwg-draw-sel-overlay';
      var elLeft = Math.min(nx + nw + 6, canvas.width - 160);
      var elTop  = Math.min(ny + nh + 8, canvas.height - 80);
      el.style.left = Math.max(4, Math.round(elLeft)) + 'px';
      el.style.top  = Math.max(4, Math.round(elTop))  + 'px';

      // ── "Send to chat" button: copies to clipboard + tries file-input injection
      var sendBtn = document.createElement('button');
      sendBtn.className = 'cwg-draw-sel-drag';
      sendBtn.textContent = 'Send to chat ↗';

      function doSend() {
        sendBtn.textContent = 'Sending…';
        var file = makePngFile(nx, ny, nw, nh);
        // 1. Try direct file-input injection first (cleanest UX)
        var injected = injectFileIntoComposer(file);
        // 2. Always copy to clipboard as a reliable fallback
        copyPngToClipboard(offCanvas, nw, nh, function (ok) {
          if (injected) {
            sendBtn.textContent = '✓ Added to chat!';
          } else if (ok) {
            sendBtn.textContent = '✓ Copied — paste in chat (⌘V)';
          } else {
            sendBtn.textContent = '⚠ Use Copy PNG below';
          }
          setTimeout(function () {
            sendBtn.textContent = 'Send to chat ↗';
          }, 3000);
        });
      }

      sendBtn.addEventListener('click', doSend);

      // ── Drag handle — sets text/html with embedded <img> so some apps accept it
      // Also triggers a clipboard copy on dragstart so dropping in chat + pasting both work
      var dragBtn = document.createElement('button');
      dragBtn.className = 'cwg-draw-sel-copy';
      dragBtn.setAttribute('draggable', 'true');
      dragBtn.textContent = '⠿ Drag';
      dragBtn.addEventListener('dragstart', function (e) {
        var file = makePngFile(nx, ny, nw, nh);
        var dataUrl = offCanvas.toDataURL('image/png');
        // Provide as many types as possible so the drop target has the best chance
        try { e.dataTransfer.items.add(file); } catch (_) {}
        try { e.dataTransfer.setData('text/html', '<img src="' + dataUrl + '" alt="Stay drawing"/>'); } catch (_) {}
        try { e.dataTransfer.setData('text/plain', ''); } catch (_) {}
        e.dataTransfer.effectAllowed = 'copy';
        // Ghost image
        var img = new Image(); img.src = dataUrl;
        img.style.cssText = 'position:fixed;top:-9999px;left:-9999px;max-width:80px;max-height:60px';
        document.body.appendChild(img);
        e.dataTransfer.setDragImage(img, 40, 30);
        setTimeout(function () { if (img.parentNode) img.parentNode.removeChild(img); }, 100);
        // Also copy to clipboard so paste works immediately after drag
        copyPngToClipboard(offCanvas, nw, nh, null);
      });

      el.appendChild(sendBtn);
      el.appendChild(dragBtn);
      canvWrap.appendChild(el);
      selOverlayEl = el;

      // Auto-copy to clipboard as soon as the overlay appears
      copyPngToClipboard(offCanvas, nw, nh, null);
    }

    // ── Draw helpers ─────────────────────────────────────────────────────────
    function getPos(e) {
      var rect = canvas.getBoundingClientRect();
      var src  = e.touches ? e.touches[0] : e;
      return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    function isShapeTool() {
      return tool === 'circle' || tool === 'triangle' || tool === 'rect' || tool === 'line';
    }

    function drawShapePreview(ex, ey) {
      if (history[histIdx]) ctx.putImageData(history[histIdx], 0, 0);
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = toolSizes.pencil;
      ctx.lineCap = ctx.lineJoin = 'round';
      var s = currentShape;
      if (s === 'circle') {
        ctx.arc(startX, startY, Math.hypot(ex - startX, ey - startY), 0, Math.PI * 2);
      } else if (s === 'triangle') {
        var mx = (startX + ex) / 2;
        ctx.moveTo(mx, startY); ctx.lineTo(ex, ey); ctx.lineTo(startX, ey); ctx.closePath();
      } else if (s === 'rect') {
        ctx.rect(startX, startY, ex - startX, ey - startY);
      } else if (s === 'line') {
        ctx.moveTo(startX, startY); ctx.lineTo(ex, ey);
      }
      ctx.stroke();
    }

    function drawSelRect(sx, sy, sw, sh) {
      if (history[histIdx]) ctx.putImageData(history[histIdx], 0, 0);
      var rx = Math.min(sx, sx + sw), ry = Math.min(sy, sy + sh);
      var rw = Math.abs(sw), rh = Math.abs(sh);
      ctx.save();
      ctx.fillStyle = 'rgba(47,47,47,0.06)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#2f2f2f'; ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
      ctx.restore();
    }

    // ── Canvas events ────────────────────────────────────────────────────────
    function onStart(e) {
      e.preventDefault();
      if (tool === 'text') return;
      drawing = true;
      var p = getPos(e);
      startX = lastX = p.x; startY = lastY = p.y;
      removeSelOverlay();

      // Move tool
      if (tool === 'move') {
        if (moveState === 'floating') {
          var sel = moveSelRect;
          if (p.x >= moveSelPos.x && p.x <= moveSelPos.x + sel.w &&
              p.y >= moveSelPos.y && p.y <= moveSelPos.y + sel.h) {
            moveState = 'dragging';
            moveDragOff = { x: p.x - moveSelPos.x, y: p.y - moveSelPos.y };
          } else {
            commitMoveIfNeeded(true);
            moveState = 'selecting';
          }
        } else {
          moveState = 'selecting';
        }
        return;
      }

      // Export select
      if (exportMode) { exportSelStart = p; exportSel = null; return; }

      // Shapes: wait for move to preview
      if (isShapeTool()) return;

      // Pencil / eraser dot on touchdown
      ctx.beginPath();
      var sz = tool === 'eraser' ? toolSizes.eraser : toolSizes.pencil;
      ctx.arc(lastX, lastY, Math.max(0.5, sz / 2), 0, Math.PI * 2);
      ctx.fillStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.fill();
    }

    function onMove(e) {
      if (!drawing) return;
      e.preventDefault();
      var p = getPos(e);

      // Move tool
      if (tool === 'move') {
        if (moveState === 'selecting') {
          drawSelRect(startX, startY, p.x - startX, p.y - startY);
        } else if (moveState === 'dragging') {
          moveSelPos = { x: p.x - moveDragOff.x, y: p.y - moveDragOff.y };
          redrawMoveFloat();
        }
        return;
      }

      if (exportMode && exportSelStart) {
        exportSel = { x: exportSelStart.x, y: exportSelStart.y, w: p.x - exportSelStart.x, h: p.y - exportSelStart.y };
        drawSelRect(exportSel.x, exportSel.y, exportSel.w, exportSel.h);
        return;
      }

      if (isShapeTool()) { drawShapePreview(p.x, p.y); return; }

      ctx.beginPath();
      ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.lineWidth   = tool === 'eraser' ? toolSizes.eraser : toolSizes.pencil;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.stroke();
      lastX = p.x; lastY = p.y;
    }

    function onEnd(e) {
      if (!drawing) return;
      if (e) e.preventDefault();
      drawing = false;
      var p = getPos(e || {});

      // Move tool
      if (tool === 'move') {
        if (moveState === 'selecting') {
          var nx = Math.min(startX, p.x), ny = Math.min(startY, p.y);
          var nw = Math.abs(p.x - startX), nh = Math.abs(p.y - startY);
          if (nw > 4 && nh > 4) {
            // Restore clean base and capture the region
            if (history[histIdx]) ctx.putImageData(history[histIdx], 0, 0);
            moveSelData = ctx.getImageData(nx, ny, nw, nh);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(nx, ny, nw, nh);
            saveSnap(); // save "erased" state as base for floating
            moveSelRect = { x: nx, y: ny, w: nw, h: nh };
            moveSelPos  = { x: nx, y: ny };
            moveState   = 'floating';
            redrawMoveFloat();
          } else {
            moveState = null;
          }
        } else if (moveState === 'dragging') {
          moveState = 'floating';
          redrawMoveFloat();
        }
        return;
      }

      // Export select
      if (exportMode && exportSel && Math.abs(exportSel.w) > 8 && Math.abs(exportSel.h) > 8) {
        if (history[histIdx]) ctx.putImageData(history[histIdx], 0, 0);
        drawSelRect(exportSel.x, exportSel.y, exportSel.w, exportSel.h);
        showSelOverlay(exportSel);
        exportMode = false; exportSelStart = null;
        var eb = document.getElementById('cwg-draw-export');
        if (eb) { eb.textContent = 'Drag to chat'; eb.classList.remove('cwg-draw-export-btn--active'); }
        canvas.style.cursor = 'crosshair';
        return;
      }
      exportSel = exportSelStart = null;
      if (!exportMode) saveSnap();
    }

    canvas.addEventListener('mousedown',  onStart);
    canvas.addEventListener('mousemove',  onMove);
    canvas.addEventListener('mouseup',    onEnd);
    // Don't cancel on mouseleave for shapes/move/export (user may re-enter)
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
      commitMoveIfNeeded(true);

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
          ctx.font = 'bold ' + fontSize + 'px system-ui,sans-serif';
          ctx.fillStyle = color;
          ctx.fillText(text, p.x, p.y + fontSize * 0.15);
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

    // ── Popup management ─────────────────────────────────────────────────────
    function closeAllPopups() {
      body.querySelectorAll('.cwg-draw-popup.cwg-draw-popup--open').forEach(function (p) {
        p.classList.remove('cwg-draw-popup--open');
      });
      if (outsideClickFn) { document.removeEventListener('click', outsideClickFn); outsideClickFn = null; }
      openPopupEl = null;
    }

    function togglePopup(popupEl, wrapEl) {
      var wasOpen = popupEl.classList.contains('cwg-draw-popup--open');
      closeAllPopups();
      if (wasOpen) return;
      popupEl.classList.add('cwg-draw-popup--open');
      openPopupEl = popupEl;
      setTimeout(function () {
        outsideClickFn = function (ev) {
          if (!wrapEl.contains(ev.target)) closeAllPopups();
        };
        document.addEventListener('click', outsideClickFn);
      }, 0);
    }

    // Size dot shared handler
    body.querySelectorAll('.cwg-draw-size-dot').forEach(function (dot) {
      dot.addEventListener('click', function (e) {
        e.stopPropagation();
        var toolName = dot.getAttribute('data-tool');
        toolSizes[toolName] = parseInt(dot.getAttribute('data-size'), 10);
        var popup = dot.closest('.cwg-draw-size-popup');
        if (popup) popup.querySelectorAll('.cwg-draw-size-dot').forEach(function (d) {
          d.classList.toggle('cwg-draw-size-dot--active', d === dot);
        });
        closeAllPopups();
      });
    });

    // ── Tool button wiring ───────────────────────────────────────────────────
    var toolCursors = { pencil:'crosshair', eraser:'cell', text:'text',
                        circle:'crosshair', triangle:'crosshair', rect:'crosshair',
                        line:'crosshair', move:'default' };

    function activateTool(name) {
      commitMoveIfNeeded(true);
      // Cancel export mode
      if (exportMode) {
        exportMode = false;
        var eb = document.getElementById('cwg-draw-export');
        if (eb) { eb.textContent = 'Drag to chat'; eb.classList.remove('cwg-draw-export-btn--active'); }
      }
      tool = name;
      // Update active highlight — only on main tool buttons (not undo/redo/clear)
      var toolBtnMap = {
        'cwg-draw-move':'move','cwg-draw-pencil':'pencil','cwg-draw-eraser':'eraser',
        'cwg-draw-text-tool':'text','cwg-draw-shape':'shape'
      };
      Object.keys(toolBtnMap).forEach(function (id) {
        var btn = document.getElementById(id);
        if (btn) btn.classList.toggle('cwg-draw-tool-btn--active',
          toolBtnMap[id] === name || (toolBtnMap[id] === 'shape' && isShapeTool()));
      });
      canvas.style.cursor = toolCursors[name] || 'crosshair';
      // Close popups unless we just opened one for this tool
    }

    // Move
    document.getElementById('cwg-draw-move').addEventListener('click', function () {
      activateTool('move');
      closeAllPopups();
    });

    // Pencil / eraser / text → toggle size popup
    ['pencil', 'eraser', 'text-tool'].forEach(function (suffix) {
      var toolName = suffix === 'text-tool' ? 'text' : suffix;
      var btn  = document.getElementById('cwg-draw-' + suffix);
      var wrap = document.getElementById('cwg-' + (suffix === 'text-tool' ? 'text' : suffix) + '-wrap');
      var popup = document.getElementById('cwg-' + (suffix === 'text-tool' ? 'text' : suffix) + '-size');
      if (!btn || !wrap || !popup) return;
      btn.addEventListener('click', function () {
        activateTool(toolName);
        togglePopup(popup, wrap);
      });
    });

    // Shape button → toggle shape picker
    var shapeBtn  = document.getElementById('cwg-draw-shape');
    var shapeWrap = document.getElementById('cwg-shape-wrap');
    var shapePopup = document.getElementById('cwg-shape-popup');
    shapeBtn.addEventListener('click', function () {
      togglePopup(shapePopup, shapeWrap);
    });

    body.querySelectorAll('.cwg-draw-shape-opt').forEach(function (opt) {
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        currentShape = opt.getAttribute('data-shape');
        var shapeEntry = SHAPE_DATA.find ? SHAPE_DATA.find(function (s) { return s.id === currentShape; })
                         : (function () { for (var i = 0; i < SHAPE_DATA.length; i++) { if (SHAPE_DATA[i].id === currentShape) return SHAPE_DATA[i]; } })();
        var iconEl = document.getElementById('cwg-shape-icon');
        if (iconEl && shapeEntry) iconEl.textContent = shapeEntry.icon;
        body.querySelectorAll('.cwg-draw-shape-opt').forEach(function (o) {
          o.classList.toggle('cwg-draw-shape-opt--active', o === opt);
        });
        activateTool(currentShape);
        closeAllPopups();
      });
    });

    // Colour swatches (basic + more)
    body.querySelectorAll('.cwg-draw-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        color = sw.getAttribute('data-color');
        if (tool === 'eraser') activateTool('pencil');
        body.querySelectorAll('.cwg-draw-swatch').forEach(function (s) {
          s.classList.toggle('cwg-draw-swatch--active', s === sw);
        });
        closeAllPopups();
      });
    });
    // Set initial active swatch
    body.querySelector('.cwg-draw-swatch[data-color="#1a1a1a"]').classList.add('cwg-draw-swatch--active');

    // More colours button
    var moreBtn  = document.getElementById('cwg-draw-more-colors');
    var moreWrap = document.getElementById('cwg-more-wrap');
    var morePopup = document.getElementById('cwg-more-popup');
    moreBtn.addEventListener('click', function () { togglePopup(morePopup, moreWrap); });

    // Undo / Redo / Clear
    document.getElementById('cwg-draw-undo').addEventListener('click', function () { applySnap(histIdx - 1); });
    document.getElementById('cwg-draw-redo').addEventListener('click', function () { applySnap(histIdx + 1); });
    document.getElementById('cwg-draw-clear').addEventListener('click', function () {
      commitMoveIfNeeded(false);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      moveState = null; moveSelData = null;
      exportSel = null; removeSelOverlay();
      saveSnap();
    });

    // Drag to chat → export select mode
    document.getElementById('cwg-draw-export').addEventListener('click', function () {
      var btn = document.getElementById('cwg-draw-export');
      if (exportMode) {
        exportMode = false; exportSel = exportSelStart = null;
        btn.textContent = 'Drag to chat';
        btn.classList.remove('cwg-draw-export-btn--active');
        canvas.style.cursor = toolCursors[tool] || 'crosshair';
        removeSelOverlay();
      } else {
        commitMoveIfNeeded(true);
        exportMode = true;
        btn.textContent = '✕ Cancel';
        btn.classList.add('cwg-draw-export-btn--active');
        canvas.style.cursor = 'crosshair';
        removeSelOverlay();
      }
    });

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
      var map = { v:'move', p:'pencil', e:'eraser', t:'text' };
      if (map[e.key.toLowerCase()]) activateTool(map[e.key.toLowerCase()]);
    }

    document.addEventListener('keydown', onKey, true);
    _kbCleanup = function () {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mouseup', docMouseUp);
      if (outsideClickFn) document.removeEventListener('click', outsideClickFn);
    };
  };

})(window._Stay = window._Stay || {});
