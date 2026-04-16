/**
 * notes.js — Research Scratchpad / Notes tab feature
 *
 * Storage key  : 'stay_scratchpad'  →  chrome.storage.local
 * Stored shape : { chats: { [chatId]: Block[] } }
 *
 * Depends on the shared _Stay namespace defined in content.js.
 */
(function (S) {
  'use strict';

  // ── Storage key ─────────────────────────────────────────────────────────────

  var SCRATCHPAD_KEY = 'stay_scratchpad';

  // ── Storage helpers ──────────────────────────────────────────────────────────

  function loadScratchpad(cb) {
    if (!S.storageContextOk()) { cb({ chats: {} }); return; }
    try {
      chrome.storage.local.get([SCRATCHPAD_KEY], function (res) {
        if (!S.storageContextOk()) { cb({ chats: {} }); return; }
        if (chrome.runtime.lastError) { cb({ chats: {} }); return; }
        var raw = res[SCRATCHPAD_KEY];
        var data = raw && typeof raw === 'object' && raw.chats ? raw : { chats: {} };
        cb(data);
      });
    } catch (err) { cb({ chats: {} }); }
  }

  function saveScratchpad(data, cb) {
    if (!S.storageContextOk()) { if (cb) cb(); return; }
    try {
      chrome.storage.local.set({ [SCRATCHPAD_KEY]: data }, function () { if (cb) cb(); });
    } catch (err) { if (cb) cb(); }
  }

  function makeBlockId() {
    return Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }

  function spAddBlock(chatId, block, cb) {
    loadScratchpad(function (data) {
      if (!data.chats[chatId]) data.chats[chatId] = [];
      data.chats[chatId].push(block);
      saveScratchpad(data, cb);
    });
  }

  function spUpdateBlock(chatId, blockId, changes, cb) {
    loadScratchpad(function (data) {
      var arr = data.chats[chatId] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === blockId) { Object.assign(arr[i], changes); break; }
      }
      saveScratchpad(data, cb);
    });
  }

  function spDeleteBlock(chatId, blockId, cb) {
    loadScratchpad(function (data) {
      if (data.chats[chatId]) {
        data.chats[chatId] = data.chats[chatId].filter(function (b) { return b.id !== blockId; });
      }
      saveScratchpad(data, cb);
    });
  }

  function spInsertBlockAfter(chatId, afterId, block, cb) {
    loadScratchpad(function (data) {
      if (!data.chats[chatId]) data.chats[chatId] = [];
      var arr = data.chats[chatId];
      var idx = arr.findIndex(function (b) { return b.id === afterId; });
      if (idx === -1) { arr.push(block); } else { arr.splice(idx + 1, 0, block); }
      saveScratchpad(data, cb);
    });
  }

  function spReorderBlocks(chatId, orderedIds, cb) {
    loadScratchpad(function (data) {
      var arr = data.chats[chatId] || [];
      var map = {};
      arr.forEach(function (b) { map[b.id] = b; });
      data.chats[chatId] = orderedIds.map(function (id) { return map[id]; }).filter(Boolean);
      saveScratchpad(data, cb);
    });
  }

  // ── Utility helpers ──────────────────────────────────────────────────────────

  function sanitizeHtml(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('script, style, iframe, object, embed, form').forEach(function (n) { n.remove(); });
    return div.innerHTML;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function truncateUrl(url) {
    try {
      var u = new URL(url);
      var s = u.hostname + u.pathname;
      return s.length > 40 ? s.slice(0, 38) + '…' : s;
    } catch (e) {
      return url.length > 40 ? url.slice(0, 38) + '…' : url;
    }
  }

  function getPlaceholder(type) {
    if (type === 'heading') return 'Heading…';
    if (type === 'reference') return 'Reference…';
    if (type === 'quote') return 'Quote…';
    return 'Type a note…';
  }

  function formatTimestamp(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function promptSnippet(prompt) {
    if (!prompt) return '';
    return prompt.length > 48 ? prompt.slice(0, 46) + '…' : prompt;
  }

  function extractYoutubeId(url) {
    var m = url.match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  var BLOCK_TYPE_BADGE = {
    text: '¶', quote: '"', heading: 'H', reference: '[ ]',
    image: '⊞', link: '↗', video: '▶',
  };

  // ── Drag type detection ──────────────────────────────────────────────────────

  function detectDragType(dataTransfer) {
    var html = dataTransfer.getData('text/html');
    var uriList = dataTransfer.getData('text/uri-list') || '';
    var uri = uriList.trim().split('\n').filter(function (u) { return u && u[0] !== '#'; })[0] || '';
    var text = dataTransfer.getData('text/plain');

    if (html && /<img/i.test(html)) {
      var srcMatch = html.match(/src=["']([^"']+)["']/i);
      var altMatch = html.match(/alt=["']([^"']*)["']/i);
      var src = srcMatch ? srcMatch[1] : '';
      var alt = altMatch ? altMatch[1] : '';
      if (src) return { type: 'image', src: src, content: alt || 'Image' };
    }
    if (uri && /^https?:\/\//.test(uri)) {
      if (/(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/)/.test(uri)) {
        return { type: 'video', src: uri, content: text || uri };
      }
      return { type: 'link', src: uri, content: text || uri };
    }
    if (text && text.trim()) return { type: 'text', content: text.trim() };
    return null;
  }

  // ── Block renderer ───────────────────────────────────────────────────────────

  /** Build a DOM node for a single block. */
  function renderBlock(block, chatId) {
    var el = document.createElement('div');
    el.className = 'cwg-block cwg-block--' + block.type;
    el.setAttribute('data-block-id', block.id);
    if (block._placeholder) el.setAttribute('data-cwg-new', 'true');

    var badgeHTML  = '<span class="cwg-block-badge">' + (BLOCK_TYPE_BADGE[block.type] || '¶') + '</span>';
    var metaHTML   = '<div class="cwg-block-meta">' + formatTimestamp(block.timestamp) + (block.prompt ? ' · ' + promptSnippet(block.prompt) : '') + '</div>';
    var deleteHTML = '<button type="button" class="cwg-block-delete" aria-label="Delete block" tabindex="-1">×</button>';
    var bodyHTML   = '';

    if (block.type === 'image') {
      var safeAlt = (block.content || 'Image').replace(/"/g, '&quot;');
      bodyHTML =
        '<div class="cwg-block-img-wrap">' +
        '<img class="cwg-block-img" src="' + block.src + '" alt="' + safeAlt + '" loading="lazy"/>' +
        '<div class="cwg-block-caption" contenteditable="true" data-placeholder="Add caption…">' + escapeHtml(block.caption || '') + '</div>' +
        '<span class="cwg-block-src-label">' + truncateUrl(block.src) + '</span>' +
        '</div>';
    } else if (block.type === 'link') {
      var domain = '';
      try { domain = new URL(block.src).hostname; } catch (e) { domain = block.src; }
      bodyHTML =
        '<a class="cwg-block-link-card" href="' + block.src + '" target="_blank" rel="noopener">' +
        '<img class="cwg-block-favicon" src="https://www.google.com/s2/favicons?domain=' + domain + '&sz=16" alt="" loading="lazy"/>' +
        '<div class="cwg-block-link-info">' +
        '<div class="cwg-block-content" contenteditable="true" data-placeholder="Link title…">' + escapeHtml(block.content || block.src) + '</div>' +
        '<span class="cwg-block-url-label">' + truncateUrl(block.src) + '</span>' +
        '</div></a>';
    } else if (block.type === 'video') {
      var ytId  = extractYoutubeId(block.src);
      var thumb = ytId ? '<img class="cwg-block-video-thumb" src="https://img.youtube.com/vi/' + ytId + '/hqdefault.jpg" alt="Video thumbnail" loading="lazy"/>' : '';
      bodyHTML =
        '<a class="cwg-block-video-card" href="' + block.src + '" target="_blank" rel="noopener">' +
        '<div class="cwg-block-video-thumb-wrap">' + thumb + '<span class="cwg-block-play-icon" aria-hidden="true">▶</span></div>' +
        '<div class="cwg-block-content" contenteditable="true" data-placeholder="Video title…">' + escapeHtml(block.content || block.src) + '</div>' +
        '</a>';
    } else {
      bodyHTML =
        '<div class="cwg-block-content" contenteditable="true" data-placeholder="' + getPlaceholder(block.type) + '">CWGCONTENT</div>';
    }

    var checkboxHTML = '<input type="checkbox" class="cwg-block-select" aria-label="Select block" tabindex="-1">';
    el.innerHTML = checkboxHTML + badgeHTML + '<div class="cwg-block-main">' + bodyHTML + metaHTML + '</div>' + deleteHTML;

    // Inject sanitized rich content for text-type blocks
    if (block.type !== 'image' && block.type !== 'link' && block.type !== 'video') {
      var ce = el.querySelector('.cwg-block-content');
      if (ce) ce.innerHTML = sanitizeHtml(block.content || '');
    }

    // Delete
    el.querySelector('.cwg-block-delete').addEventListener('click', function (e) {
      e.stopPropagation();
      spDeleteBlock(chatId, block.id, function () { el.remove(); updateNoteCountLabel(chatId); });
    });

    // Drag handle (internal reorder — triggered by dragging the block itself)
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', function (ev) {
      // Only treat it as reorder if they actually started on the block row (not on a button or input)
      if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'BUTTON') return;
      S.cwgInternalDrag = true;
      ev.dataTransfer.setData('text/plain', block.id);
      ev.dataTransfer.effectAllowed = 'move';
      el.classList.add('cwg-block--dragging');
    });
    el.addEventListener('dragend', function () {
      S.cwgInternalDrag = false;
      el.classList.remove('cwg-block--dragging');
      document.querySelectorAll('.cwg-block--drag-over').forEach(function (n) { n.classList.remove('cwg-block--drag-over'); });
    });

    // Allow external drags INTO an existing text block
    if (block.type === 'text' || block.type === 'quote' || block.type === 'heading' || block.type === 'reference') {
      el.addEventListener('dragenter', function (ev) {
        if (S.cwgInternalDrag) return;
        ev.preventDefault(); ev.stopPropagation();
        el.classList.add('cwg-block--drop-target');
      });
      el.addEventListener('dragover', function (ev) {
        if (S.cwgInternalDrag) return;
        ev.preventDefault(); ev.stopPropagation();
        ev.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('dragleave', function (ev) {
        if (!el.contains(ev.relatedTarget)) el.classList.remove('cwg-block--drop-target');
      });
      el.addEventListener('drop', function (ev) {
        if (S.cwgInternalDrag) return;
        ev.preventDefault(); ev.stopPropagation();
        el.classList.remove('cwg-block--drop-target');
        var detected = detectDragType(ev.dataTransfer);
        if (!detected || detected.type !== 'text') return;
        var ce = el.querySelector('.cwg-block-content');
        if (!ce) return;
        var existing = ce.innerText || '';
        var joined   = existing ? existing + '\n' + (detected.content || '') : (detected.content || '');
        ce.innerText = joined;
        spUpdateBlock(chatId, block.id, { content: joined }, function () {});
      });
    }

    // Inline editing — text / quote / heading / reference
    var contentEl = el.querySelector('.cwg-block-content');
    if (contentEl && (block.type === 'text' || block.type === 'quote' || block.type === 'heading' || block.type === 'reference')) {
      wireContentEditable(contentEl, chatId, block.id, 'content', block._placeholder ? block : null);
    }

    // Caption editing — image
    var captionEl = el.querySelector('.cwg-block-caption');
    if (captionEl) wireContentEditable(captionEl, chatId, block.id, 'caption', null);

    // Link / video title editing
    var linkTitle = el.querySelector('.cwg-block-link-card .cwg-block-content, .cwg-block-video-card .cwg-block-content');
    if (linkTitle) {
      linkTitle.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
      wireContentEditable(linkTitle, chatId, block.id, 'content', null);
    }

    return el;
  }

  // ── Contenteditable wiring ───────────────────────────────────────────────────

  var _editDebounceMap = {};

  /**
   * Wire a contenteditable element.
   * newBlockTemplate — if set, block is not yet persisted; save on first non-empty keystroke.
   */
  function wireContentEditable(el, chatId, blockId, field, newBlockTemplate) {
    var persisted = !newBlockTemplate;

    function ensurePersisted(cb) {
      if (persisted) { cb(); return; }
      persisted = true;
      var blockToSave = {};
      for (var k in newBlockTemplate) {
        if (k !== '_placeholder') blockToSave[k] = newBlockTemplate[k];
      }
      blockToSave.content = el.innerHTML;
      spAddBlock(chatId, blockToSave, cb);
    }

    el.addEventListener('keydown', function (e) {
      // Rich-text formatting shortcuts
      var mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); e.stopPropagation(); document.execCommand('bold'); return; }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); e.stopPropagation(); document.execCommand('italic'); return; }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'u') { e.preventDefault(); e.stopPropagation(); document.execCommand('underline'); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 's')  { e.preventDefault(); e.stopPropagation(); document.execCommand('strikeThrough'); return; }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation();
        var nextBlock = { id: makeBlockId(), type: 'text', content: '', src: null, caption: '', prompt: S.lastSentPromptText, timestamp: Date.now() };
        ensurePersisted(function () {
          spInsertBlockAfter(chatId, blockId, nextBlock, function () {
            S.renderNotesTab(function () {
              var newEl = document.querySelector('[data-block-id="' + nextBlock.id + '"] .cwg-block-content');
              if (newEl) newEl.focus();
            });
          });
        });
        return;
      }

      if (e.key === 'Backspace' && el.innerText.trim() === '') {
        e.preventDefault(); e.stopPropagation();
        var blockEl = el.closest('.cwg-block');
        var prev = blockEl ? blockEl.previousElementSibling : null;
        if (!persisted) { if (blockEl) blockEl.remove(); return; }
        spDeleteBlock(chatId, blockId, function () {
          S.renderNotesTab(function () {
            if (prev) { var pc = prev.querySelector('.cwg-block-content'); if (pc) pc.focus(); }
          });
        });
        return;
      }
    });

    el.addEventListener('input', function () {
      var val = el.innerHTML;
      var plainVal = el.innerText;
      if (!persisted) {
        if (!plainVal.trim()) return;
        persisted = true;
        var blockToSave = {};
        for (var k in newBlockTemplate) {
          if (k !== '_placeholder') blockToSave[k] = newBlockTemplate[k];
        }
        blockToSave.content = val;
        spAddBlock(chatId, blockToSave, null);
        return;
      }
      var key = blockId + '_' + field;
      if (_editDebounceMap[key]) clearTimeout(_editDebounceMap[key]);
      _editDebounceMap[key] = setTimeout(function () {
        delete _editDebounceMap[key];
        var changes = {};
        changes[field] = val;
        spUpdateBlock(chatId, blockId, changes, null);
      }, 500);
    });
  }

  // ── Block reorder ────────────────────────────────────────────────────────────

  function setupBlockReorder(listEl, chatId) {
    var dragOverBlockId = null;

    listEl.addEventListener('dragover', function (e) {
      if (!S.cwgInternalDrag) return;
      e.preventDefault();
      var target = e.target.closest('.cwg-block');
      if (target) {
        listEl.querySelectorAll('.cwg-block--drag-over').forEach(function (n) { n.classList.remove('cwg-block--drag-over'); });
        target.classList.add('cwg-block--drag-over');
        dragOverBlockId = target.getAttribute('data-block-id');
      }
    });

    listEl.addEventListener('drop', function (e) {
      if (!S.cwgInternalDrag) return;
      e.preventDefault();
      listEl.querySelectorAll('.cwg-block--drag-over').forEach(function (n) { n.classList.remove('cwg-block--drag-over'); });
      var draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || !dragOverBlockId || draggedId === dragOverBlockId) return;

      var allBlocks  = Array.from(listEl.querySelectorAll('.cwg-block'));
      var orderedIds = allBlocks.map(function (b) { return b.getAttribute('data-block-id'); });
      var fromIdx    = orderedIds.indexOf(draggedId);
      var toIdx      = orderedIds.indexOf(dragOverBlockId);
      if (fromIdx === -1 || toIdx === -1) return;
      orderedIds.splice(fromIdx, 1);
      orderedIds.splice(toIdx, 0, draggedId);
      spReorderBlocks(chatId, orderedIds, function () { S.renderNotesTab(); });
    });
  }

  // ── Note count label ─────────────────────────────────────────────────────────

  function updateNoteCountLabel(chatId) {
    loadScratchpad(function (data) {
      var count = (data.chats[chatId] || []).length;
      var ctx = document.getElementById('cwg-notes-ctx');
      if (ctx) {
        var platformLabel = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }[S.PLATFORM] || S.PLATFORM;
        ctx.textContent = platformLabel + ' · ' + chatId + ' · ' + count + ' block' + (count === 1 ? '' : 's');
      }
    });
  }

  // ── Notes tab renderer ───────────────────────────────────────────────────────

  S.renderNotesTab = function renderNotesTab(afterCb) {
    var body = document.getElementById('cwg-panel-body');
    var chatId = S.getCurrentChatId();

    // Clear game header chrome
    var header = document.getElementById('cwg-panel-header');
    var panel  = document.getElementById('cwg-panel');
    if (header) header.classList.remove('cwg-panel-header--color');
    if (panel)  panel.classList.remove('cwg-panel--art-waiting');
    var scoreline = document.getElementById('cwg-panel-scoreline');
    if (scoreline) scoreline.hidden = true;

    body.className = 'cwg-panel-body cwg-panel-body--notes';

    loadScratchpad(function (data) {
      var blocks = data.chats[chatId] || [];
      var platformLabel = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }[S.PLATFORM] || S.PLATFORM;

      body.innerHTML =
        '<div class="cwg-notes-wrap">' +
        '<div class="cwg-notes-ctx-row"><span class="cwg-notes-ctx" id="cwg-notes-ctx">' +
        platformLabel + ' · ' + chatId + ' · ' + blocks.length + ' block' + (blocks.length === 1 ? '' : 's') +
        '</span></div>' +
        '<div class="cwg-block-list" id="cwg-block-list"></div>' +
        // Persistent drop target at the bottom
        '<div class="cwg-drop-zone" id="cwg-drop-zone">' +
        '<span class="cwg-drop-zone-label" id="cwg-drop-hint">Drag here to add a note</span>' +
        '</div>' +
        '<div class="cwg-notes-footer">' +
        '<button type="button" class="cwg-add-block-btn" id="cwg-add-block-btn">+ Add note</button>' +
        // Selection actions — all hidden until a checkbox is ticked
        '<div class="cwg-sel-actions" id="cwg-sel-actions">' +
        '<button type="button" class="cwg-sel-action-btn" id="cwg-copy-selected">Copy</button>' +
        '<button type="button" class="cwg-sel-action-btn cwg-sel-action-btn--danger" id="cwg-delete-selected">Delete</button>' +
        '<button type="button" class="cwg-sel-action-btn" id="cwg-clear-selected">Clear text</button>' +
        '</div>' +
        '<div class="cwg-action-bar">' +
        '<div class="cwg-share-wrap">' +
        '<button type="button" class="cwg-action-btn" id="cwg-share-btn">Share <span class="cwg-chevron">▾</span></button>' +
        '<div class="cwg-share-dropdown" id="cwg-share-dropdown">' +
        '<button type="button" class="cwg-share-item" id="cwg-share-doc">↓ Download as Doc</button>' +
        '<button type="button" class="cwg-share-item" id="cwg-share-pdf">↓ Download as PDF</button>' +
        '<button type="button" class="cwg-share-item" id="cwg-share-notion">↗ Open in Notion</button>' +
        '</div></div></div></div></div>';

      var listEl = document.getElementById('cwg-block-list');

      if (blocks.length === 0) {
        var placeholderBlock = {
          id: makeBlockId(), type: 'text', content: '', src: null, caption: '',
          prompt: S.lastSentPromptText, timestamp: Date.now(), _placeholder: true,
        };
        var placeholderEl = renderBlock(placeholderBlock, chatId);
        var placeholderCE = placeholderEl.querySelector('.cwg-block-content');
        if (placeholderCE) placeholderCE.setAttribute('data-placeholder', 'Start typing, paste, or drag content here…');
        listEl.appendChild(placeholderEl);
        if (placeholderCE) setTimeout(function () { placeholderCE.focus(); }, 0);
      } else {
        blocks.forEach(function (block) { listEl.appendChild(renderBlock(block, chatId)); });
      }

      // Selection checkboxes → show/hide selection action bar
      var selActions  = document.getElementById('cwg-sel-actions');
      var copySelBtn  = document.getElementById('cwg-copy-selected');
      var deleteSelBtn = document.getElementById('cwg-delete-selected');
      var clearSelBtn  = document.getElementById('cwg-clear-selected');

      function getCheckedBlocks() {
        return blocks.filter(function (b) {
          var chk = listEl.querySelector('[data-block-id="' + b.id + '"] .cwg-block-select');
          return chk && chk.checked;
        });
      }

      function refreshSelActions() {
        var any = !!listEl.querySelector('.cwg-block-select:checked');
        selActions.classList.toggle('cwg-sel-actions--visible', any);
      }

      listEl.addEventListener('change', function (e) {
        if (e.target && e.target.classList.contains('cwg-block-select')) refreshSelActions();
      });

      // Copy selected
      copySelBtn.addEventListener('click', function () {
        var md = exportAsMarkdown(getCheckedBlocks());
        try {
          navigator.clipboard.writeText(md).then(function () {
            copySelBtn.textContent = '✓ Copied';
            setTimeout(function () { copySelBtn.textContent = 'Copy'; }, 1500);
          }).catch(function () { fallbackCopyText(md); });
        } catch (e) { fallbackCopyText(md); }
      });

      // Delete selected
      deleteSelBtn.addEventListener('click', function () {
        var toDelete = getCheckedBlocks();
        var ids = toDelete.map(function (b) { return b.id; });
        var pending = ids.length;
        if (!pending) return;
        ids.forEach(function (id) {
          spDeleteBlock(chatId, id, function () {
            var row = listEl.querySelector('[data-block-id="' + id + '"]');
            if (row) row.remove();
            pending--;
            if (pending <= 0) {
              blocks = blocks.filter(function (b) { return ids.indexOf(b.id) === -1; });
              updateNoteCountLabel(chatId);
              refreshSelActions();
            }
          });
        });
      });

      // Clear text of selected blocks
      clearSelBtn.addEventListener('click', function () {
        getCheckedBlocks().forEach(function (b) {
          if (b.type !== 'text' && b.type !== 'quote' && b.type !== 'heading' && b.type !== 'reference') return;
          var ce = listEl.querySelector('[data-block-id="' + b.id + '"] .cwg-block-content');
          if (ce) { ce.innerHTML = ''; ce.innerText = ''; }
          spUpdateBlock(chatId, b.id, { content: '' }, function () {});
          b.content = '';
        });
      });

      // Add note button
      document.getElementById('cwg-add-block-btn').addEventListener('click', function () {
        var newBlock = { id: makeBlockId(), type: 'text', content: '', src: null, caption: '', prompt: S.lastSentPromptText, timestamp: Date.now() };
        spAddBlock(chatId, newBlock, function () {
          S.renderNotesTab(function () {
            var newEl = document.querySelector('[data-block-id="' + newBlock.id + '"] .cwg-block-content');
            if (newEl) newEl.focus();
          });
        });
      });

      // Share dropdown toggle
      var shareBtn = document.getElementById('cwg-share-btn');
      var shareDd  = document.getElementById('cwg-share-dropdown');
      shareBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = shareDd.classList.toggle('cwg-share-dropdown--open');
        if (open) {
          setTimeout(function () {
            document.addEventListener('click', function closeDd() {
              shareDd.classList.remove('cwg-share-dropdown--open');
              document.removeEventListener('click', closeDd);
            });
          }, 0);
        }
      });

      // Download as Doc
      document.getElementById('cwg-share-doc').addEventListener('click', function () {
        shareDd.classList.remove('cwg-share-dropdown--open');
        var md = exportAsMarkdown(blocks);
        var html = '<html><head><meta charset="utf-8"><title>Stay Notes</title></head><body><pre style="font-family:system-ui;max-width:720px;margin:40px auto;white-space:pre-wrap">' +
          md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre></body></html>';
        var blob = new Blob([html], { type: 'application/msword' });
        var url  = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'stay-notes.doc'; a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      });

      // Download as PDF
      document.getElementById('cwg-share-pdf').addEventListener('click', function () {
        shareDd.classList.remove('cwg-share-dropdown--open');
        var md  = exportAsMarkdown(blocks);
        var win = window.open('', '_blank');
        if (win) {
          win.document.write('<html><head><meta charset="utf-8"><title>Stay Notes</title><style>body{font-family:system-ui;max-width:720px;margin:40px auto;font-size:14px;line-height:1.6;white-space:pre-wrap}</style></head><body>' +
            md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</body></html>');
          win.document.close(); win.focus();
          setTimeout(function () { win.print(); }, 300);
        }
      });

      // Open in Notion
      document.getElementById('cwg-share-notion').addEventListener('click', function () {
        shareDd.classList.remove('cwg-share-dropdown--open');
        var md = exportAsMarkdown(blocks);
        try {
          navigator.clipboard.writeText(md).then(function () {
            window.open('https://www.notion.so/new', '_blank');
          }).catch(function () { fallbackCopyText(md); window.open('https://www.notion.so/new', '_blank'); });
        } catch (e) { fallbackCopyText(md); window.open('https://www.notion.so/new', '_blank'); }
      });

      // Block list drag-to-reorder
      setupBlockReorder(listEl, chatId);

      if (afterCb) afterCb();
    });
  };

  // ── Export ───────────────────────────────────────────────────────────────────

  function exportAsMarkdown(blocks) {
    if (!blocks || blocks.length === 0) return '# Stay Notes\n\n(empty)\n';
    var lines = ['# Stay Notes', ''];
    var lastPrompt = null;
    blocks.forEach(function (block) {
      if (block.prompt && block.prompt !== lastPrompt) {
        if (lastPrompt !== null) lines.push('---', '');
        lines.push('**Prompt:** ' + block.prompt, '');
        lastPrompt = block.prompt;
      }
      switch (block.type) {
        case 'heading':   lines.push('## ' + (block.content || '')); break;
        case 'quote':     lines.push('> ' + (block.content || '').replace(/\n/g, '\n> ')); break;
        case 'reference': lines.push('`' + (block.content || '') + '`'); break;
        case 'image':     lines.push('![' + (block.caption || block.content || 'image') + '](' + block.src + ')'); break;
        case 'link':      lines.push('[' + (block.content || block.src) + '](' + block.src + ')'); break;
        case 'video':     lines.push('[Video: ' + (block.content || block.src) + '](' + block.src + ')'); break;
        default:          lines.push(block.content || '');
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  function fallbackCopyText(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  // ── Drop zone + paste — called once from content.js ensureDom ───────────────

  S.setupNotesDropZone = function setupNotesDropZone(panelBody) {
    // Highlight the drop zone when dragging over the whole panel
    var dragCount = 0;
    panelBody.addEventListener('dragenter', function (e) {
      if (S.cwgInternalDrag || S.activeTab !== 'notes') return;
      e.preventDefault(); dragCount++;
      panelBody.classList.add('cwg-drop-active');
      var dz = document.getElementById('cwg-drop-zone');
      if (dz) dz.classList.add('cwg-drop-zone--active');
    });
    panelBody.addEventListener('dragover', function (e) {
      if (S.cwgInternalDrag || S.activeTab !== 'notes') return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    });
    panelBody.addEventListener('dragleave', function (e) {
      if (S.cwgInternalDrag || S.activeTab !== 'notes') return;
      dragCount--;
      if (dragCount <= 0) {
        dragCount = 0;
        panelBody.classList.remove('cwg-drop-active');
        var dz = document.getElementById('cwg-drop-zone');
        if (dz) dz.classList.remove('cwg-drop-zone--active');
      }
    });

    // Drop ON the bottom drop zone → always creates a new block
    panelBody.addEventListener('drop', function (e) {
      if (S.cwgInternalDrag || S.activeTab !== 'notes') return;
      // If the drop landed on a block's own drop handler (text block),
      // that handler already called stopPropagation — we won't see it here.
      e.preventDefault(); dragCount = 0;
      panelBody.classList.remove('cwg-drop-active');
      var dz = document.getElementById('cwg-drop-zone');
      if (dz) dz.classList.remove('cwg-drop-zone--active');

      var detected = detectDragType(e.dataTransfer);
      if (!detected) return;
      var chatId   = S.getCurrentChatId();
      var newBlock = { id: makeBlockId(), type: detected.type, content: detected.content || '', src: detected.src || null, caption: '', prompt: S.lastSentPromptText, timestamp: Date.now() };
      spAddBlock(chatId, newBlock, function () { S.renderNotesTab(); });
    });

    // Global paste into notes tab (outside any editable)
    panelBody.addEventListener('paste', function (e) {
      if (S.activeTab !== 'notes') return;
      var focused = document.activeElement;
      if (focused && focused.closest && focused.closest('.cwg-block-content')) return;
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      if (!text || !text.trim()) return;
      var chatId   = S.getCurrentChatId();
      var newBlock = { id: makeBlockId(), type: 'text', content: text.trim(), src: null, caption: '', prompt: S.lastSentPromptText, timestamp: Date.now() };
      spAddBlock(chatId, newBlock, function () { S.renderNotesTab(); });
    });
  };

})(window._Stay = window._Stay || {});
