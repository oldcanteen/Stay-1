/**
 * game.js — Color Game tab feature
 *
 * Storage key  : 'llm_game_scores'  →  chrome.storage.local
 * Stored shape : { highColor: number, highWord: number }
 *
 * Depends on the shared _Stay namespace defined in content.js.
 */
(function (S) {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────

  var STORAGE_KEY   = 'llm_game_scores';
  var CORRECT_ADVANCE_MS = 225;

  var COLOR_NAMES = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'PURPLE'];
  var COLOR_MAP   = {
    RED: '#b91c1c', BLUE: '#1d4ed8', GREEN: '#15803d',
    YELLOW: '#ca8a04', PURPLE: '#7c3aed',
  };

  // ── Score storage ────────────────────────────────────────────────────────────

  function loadStorage(cb) {
    if (!S.storageContextOk()) { cb({ highColor: 0, highWord: 0 }); return; }
    try {
      chrome.storage.local.get([STORAGE_KEY], function (res) {
        if (!S.storageContextOk()) { cb({ highColor: 0, highWord: 0 }); return; }
        if (chrome.runtime.lastError) { cb({ highColor: 0, highWord: 0 }); return; }
        var raw  = res[STORAGE_KEY];
        var data = (raw && typeof raw === 'object') ? raw : { highColor: 0, highWord: 0 };
        if (typeof data.highColor !== 'number') data.highColor = 0;
        if (typeof data.highWord  !== 'number') data.highWord  = 0;
        cb(data);
      });
    } catch (err) { cb({ highColor: 0, highWord: 0 }); }
  }

  function saveStorage(data) {
    if (!S.storageContextOk()) return;
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: data }, function () {
        if (!S.storageContextOk()) return;
        if (chrome.runtime.lastError) return;
      });
    } catch (err) { /* ignore */ }
  }

  function updateHighScore(score) {
    loadStorage(function (data) {
      if (score > data.highColor) data.highColor = score;
      saveStorage(data);
    });
  }

  // ── Game logic helpers ───────────────────────────────────────────────────────

  function buildColorRound() {
    var word     = COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
    var colorKey = COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
    return { word: word, displayColor: COLOR_MAP[colorKey], correctMatch: word === colorKey };
  }

  function applyColorGameChrome() {
    var panel     = document.getElementById('cwg-panel');
    var header    = document.getElementById('cwg-panel-header');
    var scoreline = document.getElementById('cwg-panel-scoreline');
    if (scoreline) scoreline.hidden = false;
    if (header) header.classList.add('cwg-panel-header--color');
    if (panel)  panel.classList.add('cwg-panel--art-waiting');
  }

  function updateColorScoreline(score, high) {
    var el = document.getElementById('cwg-panel-scoreline');
    if (el) el.textContent = 'Score: ' + score + ' • High score: ' + high;
  }

  function promptGlowStyle(hex) {
    var h = (hex || '#000').replace('#', '');
    if (h.length !== 6) return 'color:' + hex + ';';
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'color:' + hex + ';text-shadow:0 0 22px rgba(' + r + ',' + g + ',' + b + ',0.42),0 0 42px rgba(' + r + ',' + g + ',' + b + ',0.22);';
  }

  // ── Color game renderer ──────────────────────────────────────────────────────

  S.renderColorGame = function renderColorGame() {
    var body = document.getElementById('cwg-panel-body');
    body.className = 'cwg-panel-body cwg-panel-body--color';

    var score          = 0;
    var round          = buildColorRound();
    var gameOver       = false;
    var showingCorrect = false;
    var correctTimer   = null;

    applyColorGameChrome();

    function paint() {
      loadStorage(function (data) {
        updateColorScoreline(score, data.highColor);

        if (gameOver) {
          body.innerHTML =
            '<div class="cwg-cw-stage cwg-cw-stage--over">' +
            '<p class="cwg-cw-question">Does the color match the text?</p>' +
            '<div class="cwg-cw-color-card" style="background:' + round.displayColor + '">' +
            '<span class="cwg-cw-color-card-label">' + round.word + '</span>' +
            '</div>' +
            '<div class="cwg-cw-gameover" role="status">' +
            '<div class="cwg-cw-go-icon-bad" aria-hidden="true">' +
            '<svg width="44" height="44" viewBox="0 0 44 44" fill="none">' +
            '<circle cx="22" cy="22" r="20" fill="#DC2626"/>' +
            '<path d="M16 16l12 12M28 16L16 28" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' +
            '</svg></div>' +
            '<h3 class="cwg-cw-gameover-title">Incorrect</h3>' +
            '<p class="cwg-cw-gameover-text">The card color didn\'t match the word.</p>' +
            '<div class="cwg-cw-go-stats-box">' +
            '<div class="cwg-cw-go-stat"><span class="cwg-cw-go-stat-label">Final Score</span><strong class="cwg-cw-go-stat-num">' + score + '</strong></div>' +
            '<div class="cwg-cw-go-stat-divider" aria-hidden="true"></div>' +
            '<div class="cwg-cw-go-stat"><span class="cwg-cw-go-stat-label">High Score</span><strong class="cwg-cw-go-stat-num">' + data.highColor + '</strong></div>' +
            '</div>' +
            '<button type="button" class="cwg-cw-replay" id="cwg-cw-replay">' +
            '<svg class="cwg-cw-replay-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0012 4V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>' +
            '</svg>Replay</button>' +
            '</div></div>';

          document.getElementById('cwg-cw-replay').addEventListener('click', function () {
            gameOver = false; score = 0; round = buildColorRound(); paint();
          });
          return;
        }

        var dis = showingCorrect ? ' disabled' : '';
        body.innerHTML =
          '<div class="cwg-cw-stage cwg-cw-stage--playing">' +
          '<p class="cwg-cw-question">Does the color match the text?</p>' +
          '<div class="cwg-cw-color-card" style="background:' + round.displayColor + '">' +
          '<span class="cwg-cw-color-card-label">' + round.word + '</span>' +
          '</div>' +
          '<div class="cwg-cw-btns">' +
          '<button type="button" data-choice="true"' + dis + '>True</button>' +
          '<button type="button" data-choice="false"' + dis + '>False</button>' +
          '</div>' +
          (showingCorrect
            ? '<div class="cwg-cw-correct-block"><span class="cwg-cw-correct-pill">' +
              '<svg class="cwg-cw-check" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
              '<path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>' +
              '</svg>Correct!</span></div>'
            : '') +
          '</div>';

        if (showingCorrect) return;

        body.querySelectorAll('[data-choice]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (gameOver || showingCorrect) return;
            // "True" means the card color matches the word
            var userSaysMatch = btn.getAttribute('data-choice') === 'true';
            if (userSaysMatch === round.correctMatch) {
              score += 1;
              updateHighScore(score);
              showingCorrect = true;
              paint();
              if (correctTimer) clearTimeout(correctTimer);
              correctTimer = setTimeout(function () {
                correctTimer = null; showingCorrect = false; round = buildColorRound(); paint();
              }, CORRECT_ADVANCE_MS);
            } else {
              gameOver = true; paint();
            }
          });
        });
      });
    }

    paint();
  };

})(window._Stay = window._Stay || {});
