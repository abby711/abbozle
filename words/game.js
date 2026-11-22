/* Abbozle Words: unlimited five-letter word puzzles. */
(function () {
  'use strict';

  var WORD_LEN = 5;
  var MAX_GUESSES = 6;
  var WIN_WORDS = ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew'];
  var ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];
  var RANK = { absent: 1, present: 2, correct: 3 };

  /* ------------------------------------------------------------------ */
  /* Pure game logic (also exported for tests in Node)                   */
  /* ------------------------------------------------------------------ */

  // Colors a guess the same way the NYT game does, including repeated letters:
  // greens are claimed first, then yellows from whatever letters remain.
  function score(guess, answer) {
    var result = new Array(WORD_LEN).fill('absent');
    var remaining = {};
    var i;
    for (i = 0; i < WORD_LEN; i++) {
      if (guess[i] === answer[i]) result[i] = 'correct';
      else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
    }
    for (i = 0; i < WORD_LEN; i++) {
      if (result[i] !== 'correct' && remaining[guess[i]] > 0) {
        result[i] = 'present';
        remaining[guess[i]]--;
      }
    }
    return result;
  }

  // Hard mode: greens must stay in place, and every revealed letter must be reused.
  // `previous` is a list of { word, result }. Returns an error message or null.
  function hardModeError(guess, previous) {
    var p, i;
    for (p = 0; p < previous.length; p++) {
      for (i = 0; i < WORD_LEN; i++) {
        if (previous[p].result[i] === 'correct' && guess[i] !== previous[p].word[i]) {
          return ORDINALS[i] + ' letter must be ' + previous[p].word[i].toUpperCase();
        }
      }
    }
    for (p = 0; p < previous.length; p++) {
      var need = {};
      for (i = 0; i < WORD_LEN; i++) {
        if (previous[p].result[i] !== 'absent') {
          var ch = previous[p].word[i];
          need[ch] = (need[ch] || 0) + 1;
        }
      }
      for (var letter in need) {
        var have = guess.split(letter).length - 1;
        if (have < need[letter]) return 'Guess must contain ' + letter.toUpperCase();
      }
    }
    return null;
  }

  // Best known state for each letter, for coloring the keyboard.
  function keyStates(guesses, answer) {
    var states = {};
    guesses.forEach(function (word) {
      var res = score(word, answer);
      for (var i = 0; i < WORD_LEN; i++) {
        var ch = word[i];
        if (!states[ch] || RANK[res[i]] > RANK[states[ch]]) states[ch] = res[i];
      }
    });
    return states;
  }

  function shareText(game, contrast, dark) {
    var squares = {
      correct: contrast ? '🟧' : '🟩',
      present: contrast ? '🟦' : '🟨',
      absent: dark ? '⬛' : '⬜'
    };
    var count = game.status === 'won' ? game.guesses.length : 'X';
    var rows = game.guesses.map(function (word) {
      return score(word, game.answer).map(function (s) { return squares[s]; }).join('');
    });
    return 'Abbozle Words ' + count + '/' + MAX_GUESSES + (game.hard ? '*' : '') + '\n\n' + rows.join('\n');
  }

  var Logic = { score: score, hardModeError: hardModeError, keyStates: keyStates, shareText: shareText };
  if (typeof module === 'object' && module.exports) {
    module.exports = Logic;
    return;
  }

  /* ------------------------------------------------------------------ */
  /* Storage (per browser; the game still works if storage is blocked)   */
  /* ------------------------------------------------------------------ */

  var KEYS = {
    game: 'abbozle.words.game',
    stats: 'abbozle.words.stats',
    settings: 'abbozle.words.settings',
    seen: 'abbozle.words.seen',
    helped: 'abbozle.words.helped'
  };

  var store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  var ANSWERS = window.WORDS.answers;
  var VALID = window.WORDS.valid;
  var ANSWER_SET = new Set(ANSWERS);

  var settings = Object.assign({ hard: false, dark: null, contrast: false }, store.get(KEYS.settings, {}));
  var stats = Object.assign({ played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0] }, store.get(KEYS.stats, {}));
  var seen = store.get(KEYS.seen, []);
  if (!Array.isArray(seen)) seen = [];

  var game = store.get(KEYS.game, null);
  var current = '';
  var busy = false;      // true while a row is flipping
  var roundId = 0;       // guards delayed callbacks from a previous round
  var openModalEl = null;

  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FLIP_HALF = reduceMotion ? 60 : 250;
  var FLIP_STAGGER = reduceMotion ? 60 : 300;
  document.documentElement.style.setProperty('--flip-half', FLIP_HALF + 'ms');

  function randomInt(n) {
    if (window.crypto && crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  // Picks a word you haven't had yet; once every answer has been used, starts over.
  function newGame() {
    var seenSet = new Set(seen);
    var pool = ANSWERS.filter(function (w) { return !seenSet.has(w); });
    if (!pool.length) {
      seen = [];
      pool = ANSWERS.slice();
    }
    var answer = pool[randomInt(pool.length)];
    seen.push(answer);
    store.set(KEYS.seen, seen);
    return { answer: answer, guesses: [], status: 'playing', hard: settings.hard, counted: false, gaveUp: false };
  }

  function isValidSavedGame(g) {
    return g && typeof g.answer === 'string' && ANSWER_SET.has(g.answer) &&
      Array.isArray(g.guesses) && g.guesses.length <= MAX_GUESSES &&
      g.guesses.every(function (w) { return typeof w === 'string' && w.length === WORD_LEN; }) &&
      ['playing', 'won', 'lost'].indexOf(g.status) !== -1;
  }

  function saveGame() { store.set(KEYS.game, game); }
  function saveStats() { store.set(KEYS.stats, stats); }
  function saveSettings() { store.set(KEYS.settings, settings); }

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $('board');
  var boardContainer = $('board-container');
  var keyboardEl = $('keyboard');
  var toastsEl = $('toasts');
  var srEl = $('sr-announce');
  var overBar = $('game-over-bar');
  var roundBtn = $('round-btn');
  var rows = [];

  function buildBoard() {
    for (var r = 0; r < MAX_GUESSES; r++) {
      var row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'row');
      row.setAttribute('aria-label', 'Guess ' + (r + 1));
      for (var c = 0; c < WORD_LEN; c++) {
        var tile = document.createElement('div');
        tile.className = 'tile';
        tile.setAttribute('role', 'gridcell');
        tile.dataset.state = 'empty';
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
      rows.push(row);
    }
  }

  function tileAt(r, c) { return rows[r].children[c]; }

  function setTile(tile, letter, state) {
    tile.textContent = letter || '';
    tile.dataset.state = state;
    tile.setAttribute('aria-label', letter ? letter.toUpperCase() + (state === 'tbd' ? '' : ', ' + state) : 'empty');
  }

  function renderBoard() {
    for (var r = 0; r < MAX_GUESSES; r++) {
      var word = game.guesses[r];
      var res = word ? score(word, game.answer) : null;
      for (var c = 0; c < WORD_LEN; c++) {
        var t = tileAt(r, c);
        t.className = 'tile';
        if (word) setTile(t, word[c], res[c]);
        else if (r === game.guesses.length && game.status === 'playing' && current[c]) setTile(t, current[c], 'tbd');
        else setTile(t, '', 'empty');
      }
      rows[r].classList.remove('shake');
    }
  }

  function renderKeyboard() {
    var states = keyStates(game.guesses, game.answer);
    keyboardEl.querySelectorAll('button[data-key]').forEach(function (btn) {
      var k = btn.dataset.key;
      if (k.length === 1 && states[k]) btn.dataset.state = states[k];
      else btn.removeAttribute('data-state');
    });
  }

  function renderRoundState() {
    var over = game.status !== 'playing';
    roundBtn.classList.toggle('is-over', over);
    roundBtn.setAttribute('aria-label', over ? 'Next word' : 'Give up');
    roundBtn.title = over ? 'Next word' : 'Give up';
    overBar.classList.toggle('show', over);
    if (over) {
      var msg = $('over-msg');
      if (game.status === 'won') {
        msg.innerHTML = 'Solved in <strong>' + game.guesses.length + '/' + MAX_GUESSES + '</strong>';
      } else {
        msg.innerHTML = 'The word was <strong>' + game.answer.toUpperCase() + '</strong>';
      }
    }
    sizeBoard();
  }

  function renderAll() {
    renderBoard();
    renderKeyboard();
    renderRoundState();
  }

  // Board fits the space between header and keyboard, max 350×420 like the original.
  function sizeBoard() {
    var availH = boardContainer.clientHeight - 8;
    var availW = Math.min(boardContainer.clientWidth - 8, 350);
    var height = Math.max(150, Math.min(420, availH, availW * 6 / 5));
    var width = Math.floor(height * 5 / 6);
    boardEl.style.width = width + 'px';
    boardEl.style.height = Math.floor(height) + 'px';
    var tileSize = (width - 20 - 4 * 5) / 5;
    boardEl.style.setProperty('--tile-font', Math.max(14, Math.round(tileSize * 0.52)) + 'px');
  }

  function animate(el, cls, onEnd) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
    el.addEventListener('animationend', function handler(e) {
      if (e.target !== el) return;
      el.removeEventListener('animationend', handler);
      el.classList.remove(cls);
      if (onEnd) onEnd();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Toasts                                                              */
  /* ------------------------------------------------------------------ */

  function toast(message, duration, extraClass) {
    var el = document.createElement('div');
    el.className = 'toast' + (extraClass ? ' ' + extraClass : '');
    el.textContent = message;
    toastsEl.prepend(el);
    if (duration !== Infinity) {
      setTimeout(function () {
        el.classList.add('fade');
        setTimeout(function () { el.remove(); }, 320);
      }, duration || 1000);
    }
    return el;
  }

  function clearToasts() { toastsEl.innerHTML = ''; }

  function announce(text) {
    srEl.textContent = '';
    setTimeout(function () { srEl.textContent = text; }, 50);
  }

  /* ------------------------------------------------------------------ */
  /* Playing                                                             */
  /* ------------------------------------------------------------------ */

  function canType() {
    return !busy && !openModalEl && game.status === 'playing';
  }

  function addLetter(ch) {
    if (!canType() || current.length >= WORD_LEN) return;
    current += ch;
    var t = tileAt(game.guesses.length, current.length - 1);
    setTile(t, ch, 'tbd');
    animate(t, 'pop');
  }

  function removeLetter() {
    if (!canType() || !current.length) return;
    var t = tileAt(game.guesses.length, current.length - 1);
    setTile(t, '', 'empty');
    current = current.slice(0, -1);
  }

  function reject(message) {
    animate(rows[game.guesses.length], 'shake');
    toast(message);
  }

  function submitGuess() {
    if (!canType()) return;
    if (current.length < WORD_LEN) return reject('Not enough letters');
    if (!VALID.has(current)) return reject('Not in word list');
    if (game.hard) {
      var previous = game.guesses.map(function (w) { return { word: w, result: score(w, game.answer) }; });
      var err = hardModeError(current, previous);
      if (err) return reject(err);
    }

    var guess = current;
    var rowIndex = game.guesses.length;
    var result = score(guess, game.answer);
    game.guesses.push(guess);
    current = '';

    var won = guess === game.answer;
    var lost = !won && game.guesses.length >= MAX_GUESSES;
    if (won) game.status = 'won';
    else if (lost) game.status = 'lost';
    if (won || lost) recordResult();
    saveGame();

    busy = true;
    var myRound = roundId;
    revealRow(rowIndex, result, function () {
      if (myRound !== roundId) return;
      busy = false;
      renderKeyboard();
      announce(guess.toUpperCase().split('').map(function (ch, i) { return ch + ' ' + result[i]; }).join(', '));

      if (won) {
        toast(WIN_WORDS[rowIndex], 2000);
        bounceRow(rowIndex);
        renderRoundState();
        setTimeout(function () { if (myRound === roundId) openStats(); }, 2200);
      } else if (lost) {
        toast(game.answer.toUpperCase(), Infinity, 'answer');
        renderRoundState();
        setTimeout(function () { if (myRound === roundId) openStats(); }, 1800);
      }
    });
  }

  function revealRow(r, result, done) {
    for (var c = 0; c < WORD_LEN; c++) {
      (function (c) {
        var t = tileAt(r, c);
        setTimeout(function () {
          t.classList.add('flip-in');
          setTimeout(function () {
            t.classList.remove('flip-in');
            setTile(t, t.textContent, result[c]);
            animate(t, 'flip-out');
          }, FLIP_HALF);
        }, c * FLIP_STAGGER);
      })(c);
    }
    setTimeout(done, (WORD_LEN - 1) * FLIP_STAGGER + FLIP_HALF * 2);
  }

  function bounceRow(r) {
    for (var c = 0; c < WORD_LEN; c++) {
      (function (t, delay) {
        setTimeout(function () { animate(t, 'bounce'); }, delay);
      })(tileAt(r, c), c * 100);
    }
  }

  function recordResult() {
    if (game.counted) return;
    stats.played++;
    if (game.status === 'won') {
      stats.wins++;
      stats.streak++;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      stats.dist[game.guesses.length - 1]++;
    } else {
      stats.streak = 0;
    }
    game.counted = true;
    saveStats();
  }

  function giveUp() {
    if (game.status !== 'playing' || busy) return;
    game.status = 'lost';
    game.gaveUp = true;
    current = '';
    recordResult();
    saveGame();
    closeModal();
    renderBoard();
    renderRoundState();
    toast(game.answer.toUpperCase(), Infinity, 'answer');
    var myRound = roundId;
    setTimeout(function () { if (myRound === roundId) openStats(); }, 900);
  }

  function nextWord() {
    if (busy) return;
    roundId++;
    closeModal();
    clearToasts();
    game = newGame();
    current = '';
    saveGame();
    renderAll();
  }

  function onEnter() {
    if (busy) return;
    if (game.status === 'playing') submitGuess();
    else nextWord();
  }

  /* ------------------------------------------------------------------ */
  /* Modals                                                              */
  /* ------------------------------------------------------------------ */

  function openModal(id, focusEl) {
    closeModal();
    openModalEl = $(id);
    openModalEl.classList.add('open');
    var target = focusEl || openModalEl.querySelector('[data-close]') || openModalEl.querySelector('button');
    if (target) target.focus({ preventScroll: true });
  }

  // Focus goes back to the page (not a button) so typing and Enter keep playing the game.
  function closeModal() {
    if (!openModalEl) return;
    var el = openModalEl;
    openModalEl = null;
    el.classList.remove('open');
    if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
  }

  function openStats() {
    $('st-played').textContent = stats.played;
    $('st-win').textContent = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    $('st-streak').textContent = stats.streak;
    $('st-max').textContent = stats.maxStreak;

    var max = Math.max.apply(null, stats.dist.concat([1]));
    var distEl = $('dist');
    distEl.innerHTML = '';
    stats.dist.forEach(function (n, i) {
      var row = document.createElement('div');
      row.className = 'dist-row';
      var isCurrent = game.status === 'won' && game.guesses.length === i + 1;
      row.innerHTML =
        '<div class="dist-label">' + (i + 1) + '</div>' +
        '<div class="dist-track"><div class="dist-bar' + (isCurrent ? ' current' : '') +
        '" style="width:' + Math.max(7, Math.round((n / max) * 100)) + '%">' + n + '</div></div>';
      distEl.appendChild(row);
    });

    var over = game.status !== 'playing';
    $('result').classList.toggle('show', over);
    $('stats-actions').style.display = over ? '' : 'none';
    if (over) {
      $('result-title').textContent = game.status === 'won' ? WIN_WORDS[game.guesses.length - 1] + '!' :
        (game.gaveUp ? 'Better luck next time' : 'So close');
      var wordEl = $('result-word');
      wordEl.innerHTML = '';
      game.answer.split('').forEach(function (ch) {
        var t = document.createElement('div');
        t.className = 'tile';
        t.dataset.state = game.status === 'won' ? 'correct' : 'absent';
        t.textContent = ch;
        wordEl.appendChild(t);
      });
      wordEl.setAttribute('aria-label', 'The word was ' + game.answer);
      $('result-def').href = 'https://www.merriam-webster.com/dictionary/' + game.answer;
      $('result-def').textContent = 'What does ' + game.answer.toUpperCase() + ' mean? ↗';
    }
    openModal('stats-modal', over ? $('stats-next') : null);
  }

  function confirmDialog(title, text, okLabel, onOk) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    var ok = $('confirm-ok');
    ok.textContent = okLabel;
    ok.onclick = function () { closeModal(); onOk(); };
    openModal('confirm-modal', $('confirm-cancel'));
  }

  /* ------------------------------------------------------------------ */
  /* Settings & theme                                                    */
  /* ------------------------------------------------------------------ */

  var systemDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

  function isDark() {
    if (settings.dark === null || settings.dark === undefined) return !!(systemDark && systemDark.matches);
    return settings.dark;
  }

  function applyTheme() {
    var root = document.documentElement;
    root.classList.toggle('dark', isDark());
    root.classList.toggle('contrast', !!settings.contrast);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark() ? '#121213' : '#ffffff');
    $('sw-dark').setAttribute('aria-checked', String(isDark()));
    $('sw-contrast').setAttribute('aria-checked', String(!!settings.contrast));
    $('sw-hard').setAttribute('aria-checked', String(!!settings.hard));
  }

  function toggleHard() {
    var turningOn = !settings.hard;
    if (turningOn && game.status === 'playing' && game.guesses.length > 0) {
      toast('Hard mode can only be enabled at the start of a round', 1600);
      return;
    }
    settings.hard = turningOn;
    if (game.status === 'playing') {
      game.hard = turningOn;
      saveGame();
    }
    saveSettings();
    applyTheme();
  }

  /* ------------------------------------------------------------------ */
  /* Share                                                               */
  /* ------------------------------------------------------------------ */

  function share() {
    var text = shareText(game, settings.contrast, isDark());
    var mobile = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (mobile && navigator.share) {
      navigator.share({ text: text }).catch(function () {});
      return;
    }
    copy(text).then(function () { toast('Copied results to clipboard'); })
      .catch(function () { toast('Couldn’t copy. Try again'); });
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) resolve(); else reject();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (openModalEl) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    // Let keyboard users activate focused buttons and links normally.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button, a')) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      removeLetter();
    } else if (/^[a-z]$/i.test(e.key)) {
      addLetter(e.key.toLowerCase());
    }
  });

  keyboardEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-key]');
    if (!btn) return;
    btn.blur();
    var k = btn.dataset.key;
    if (k === 'enter') onEnter();
    else if (k === 'back') removeLetter();
    else addLetter(k);
  });

  document.querySelectorAll('.overlay').forEach(function (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('[data-close]')) closeModal();
    });
  });

  $('help-btn').addEventListener('click', function () { openModal('help-modal'); });
  $('stats-btn').addEventListener('click', openStats);
  $('settings-btn').addEventListener('click', function () { openModal('settings-modal'); });
  $('stats-next').addEventListener('click', nextWord);
  $('over-next').addEventListener('click', function (e) { e.currentTarget.blur(); nextWord(); });
  $('share-btn').addEventListener('click', share);

  roundBtn.addEventListener('click', function () {
    roundBtn.blur();
    if (busy) return;
    if (game.status !== 'playing') return nextWord();
    confirmDialog('Give up?', 'The answer will be revealed and this round counts as a loss.', 'Reveal answer', giveUp);
  });

  $('sw-hard').addEventListener('click', toggleHard);
  $('sw-dark').addEventListener('click', function () {
    settings.dark = !isDark();
    saveSettings();
    applyTheme();
  });
  $('sw-contrast').addEventListener('click', function () {
    settings.contrast = !settings.contrast;
    saveSettings();
    applyTheme();
  });
  $('reset-stats').addEventListener('click', function () {
    confirmDialog('Reset statistics?', 'Games played, wins and streaks will go back to zero.', 'Reset', function () {
      stats = { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0] };
      saveStats();
      toast('Statistics reset');
    });
  });

  if (systemDark) {
    var onSystemTheme = function () { if (settings.dark === null || settings.dark === undefined) applyTheme(); };
    if (systemDark.addEventListener) systemDark.addEventListener('change', onSystemTheme);
    else if (systemDark.addListener) systemDark.addListener(onSystemTheme);
  }

  if (window.ResizeObserver) new ResizeObserver(sizeBoard).observe(boardContainer);
  else window.addEventListener('resize', sizeBoard);

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  if (!isValidSavedGame(game)) {
    game = newGame();
    saveGame();
  }

  buildBoard();
  applyTheme();
  renderAll();

  if (!store.get(KEYS.helped, false)) {
    store.set(KEYS.helped, true);
    openModal('help-modal');
  }
})();
