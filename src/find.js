// Find + Replace for the DedTxt textarea editor.
//
// The bar is a thin overlay anchored top-right of #editor-wrap. It does not
// resize the editor — keeping the textarea geometry stable means line numbers
// stay in sync. Matches are surfaced by setting the textarea's native
// selection (no overlay highlighting — that would require a parallel mirror
// element and conflict with the textarea's own renderer).
//
// Pure-logic helpers (`compilePattern`, `buildMatches`, `applyReplaceAll`)
// are exported for unit testing; the DOM wiring lives in `installFind`.

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Compile a search query into a global RegExp, honouring the case/word/regex
// toggles. Returns null for an empty query or an invalid regex source (the
// caller treats both as "no matches" rather than throwing).
export function compilePattern(query, opts) {
  if (!query) return null;
  let src;
  if (opts && opts.regex) {
    src = query;
  } else {
    src = escapeRegex(query);
    if (opts && opts.word) src = `\\b${src}\\b`;
  }
  try {
    return new RegExp(src, opts && opts.case ? 'g' : 'gi');
  } catch (_) {
    return null;
  }
}

// Walk the text and collect every match as [start, end] tuples. Zero-length
// matches (e.g. `\b` alone) advance lastIndex by one to avoid an infinite
// loop while still surfacing the empty match's position.
export function buildMatches(text, query, opts) {
  const pattern = compilePattern(query, opts);
  if (!pattern) return [];
  const out = [];
  let m;
  while ((m = pattern.exec(text)) !== null) {
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) pattern.lastIndex++;
  }
  return out;
}

// Replace every match in `text` and report how many. In regex mode the
// replacement string respects $1/$&/etc. via native String.prototype.replace;
// in plain mode we escape `$` so the user's literal "$1" stays "$1".
export function applyReplaceAll(text, query, replaceWith, opts) {
  const pattern = compilePattern(query, opts);
  if (!pattern) return { text, count: 0 };
  const rep = opts && opts.regex
    ? replaceWith
    : replaceWith.replace(/\$/g, '$$$$');
  const matches = text.match(pattern) || [];
  return { text: text.replace(pattern, rep), count: matches.length };
}

// Wire the find bar to the editor. Returns { open, close } so the welcome
// dialog's shortcut button can call open() without going through the keydown
// path. Pre-fills the input with whatever the editor has selected so the
// "search for the highlighted word" workflow is a single keystroke.
export function installFind({ editor }) {
  const bar = document.getElementById('find-bar');
  const findInput = document.getElementById('find-input');
  const replaceInput = document.getElementById('find-replace-input');
  const replaceRow = document.getElementById('find-replace-row');
  const caseBtn = document.getElementById('find-case');
  const wordBtn = document.getElementById('find-word');
  const regexBtn = document.getElementById('find-regex');
  const replaceToggle = document.getElementById('find-replace-toggle');
  const prevBtn = document.getElementById('find-prev');
  const nextBtn = document.getElementById('find-next');
  const replaceBtn = document.getElementById('find-replace');
  const replaceAllBtn = document.getElementById('find-replace-all');
  const counter = document.getElementById('find-counter');
  const closeBtn = document.getElementById('find-close');

  if (!bar || !findInput) return { open() {}, close() {} };

  const state = {
    matches: [],
    idx: -1,
    opts: { case: false, word: false, regex: false },
  };

  function readOpt(btn) { return btn && btn.getAttribute('aria-pressed') === 'true'; }
  function syncOpts() {
    state.opts.case = readOpt(caseBtn);
    state.opts.word = readOpt(wordBtn);
    state.opts.regex = readOpt(regexBtn);
  }
  function toggleOpt(btn) {
    if (!btn) return;
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(next));
    syncOpts();
    refresh();
  }

  function refresh() {
    state.matches = buildMatches(editor.value, findInput.value, state.opts);
    if (state.matches.length === 0) {
      state.idx = -1;
      counter.textContent = '0 / 0';
      counter.classList.add('find-counter-empty');
      return;
    }
    counter.classList.remove('find-counter-empty');
    // Try to preserve the current index across edits; otherwise reset to 0.
    if (state.idx < 0 || state.idx >= state.matches.length) state.idx = 0;
    counter.textContent = `${state.idx + 1} / ${state.matches.length}`;
    select(state.matches[state.idx]);
  }

  function select([start, end]) {
    editor.focus();
    editor.setSelectionRange(start, end);
    // Re-focus the input so the user can keep typing the query.
    findInput.focus();
  }

  function step(delta) {
    if (state.matches.length === 0) return;
    state.idx = (state.idx + delta + state.matches.length) % state.matches.length;
    counter.textContent = `${state.idx + 1} / ${state.matches.length}`;
    select(state.matches[state.idx]);
  }

  function open(prefill) {
    bar.hidden = false;
    if (typeof prefill === 'string' && prefill.length > 0) {
      findInput.value = prefill;
    }
    syncOpts();
    refresh();
    findInput.focus();
    findInput.select();
  }

  function close() {
    bar.hidden = true;
    // Hide replace row too so the next open() shows a calm single-row bar.
    if (replaceRow) replaceRow.hidden = true;
    if (replaceToggle) replaceToggle.setAttribute('aria-pressed', 'false');
    editor.focus();
  }

  function replaceOne() {
    if (state.matches.length === 0 || state.idx < 0) return;
    const [start, end] = state.matches[state.idx];
    let replacement;
    if (state.opts.regex) {
      // Re-run the replace on the SINGLE matched slice so $1/$2 backrefs
      // against the current match work as expected.
      const slice = editor.value.slice(start, end);
      replacement = slice.replace(compilePattern(findInput.value, state.opts), replaceInput.value);
    } else {
      replacement = replaceInput.value;
    }
    // Splice via setRangeText so the textarea's native undo stack captures
    // the edit (vs. assigning .value, which clears undo history).
    editor.setRangeText(replacement, start, end, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    refresh();
  }

  function replaceAll() {
    const before = editor.value;
    const { text, count } = applyReplaceAll(
      before,
      findInput.value,
      replaceInput.value,
      state.opts
    );
    if (count === 0) return;
    // .value assignment to keep the change as a single operation; the native
    // undo stack loses history but the explicit one-shot is closer to what a
    // user expects from "Replace All".
    editor.value = text;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    refresh();
  }

  // --- Event wiring ---
  findInput.addEventListener('input', refresh);

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  if (replaceInput) {
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        replaceOne();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
  }

  if (caseBtn) caseBtn.addEventListener('click', () => toggleOpt(caseBtn));
  if (wordBtn) wordBtn.addEventListener('click', () => toggleOpt(wordBtn));
  if (regexBtn) regexBtn.addEventListener('click', () => toggleOpt(regexBtn));
  if (prevBtn) prevBtn.addEventListener('click', () => step(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => step(1));
  if (replaceBtn) replaceBtn.addEventListener('click', replaceOne);
  if (replaceAllBtn) replaceAllBtn.addEventListener('click', replaceAll);
  if (closeBtn) closeBtn.addEventListener('click', close);

  if (replaceToggle) {
    replaceToggle.addEventListener('click', () => {
      const next = replaceToggle.getAttribute('aria-pressed') !== 'true';
      replaceToggle.setAttribute('aria-pressed', String(next));
      if (replaceRow) replaceRow.hidden = !next;
      if (next && replaceInput) replaceInput.focus();
    });
  }

  // Global Cmd/Ctrl+F. Cmd/Ctrl+G steps to the next match (a common
  // convention from BBEdit / Xcode / VS Code's "Find Next" binding).
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
      open(sel || findInput.value);
    } else if ((e.key === 'g' || e.key === 'G') && !bar.hidden) {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  });

  return { open, close };
}
