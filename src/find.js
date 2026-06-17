// Find + Replace for the DedTxt textarea editor.
//
// The bar is a thin overlay anchored top-right of #editor-wrap. It does not
// resize the editor — keeping the textarea geometry stable means line numbers
// stay in sync.
//
// Match highlighting uses a parallel #editor-highlights div behind the
// transparent textarea (z-index dance in styles.css). Each match is wrapped
// in a <mark> there; the textarea draws the user's text on top so the marks
// appear as coloured bands behind the glyphs. We can't rely on the textarea's
// native selection rendering because the find input steals focus back as the
// user types — and browsers wash out the inactive textarea selection to a
// near-invisible system gray. The textarea selection IS still set (so
// Replace's setRangeText sees the active match), it's just no longer what
// the user sees.
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

// innerHTML escape for the overlay text — only & < > matter because we never
// write user content into an attribute. Everything else (control chars from
// Latin-1 binary mode, multibyte UTF-8, quotes) is safe in text-content
// position. Exported for unit testing.
export function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

// Build the match-highlight overlay's innerHTML: the *entire* editor text,
// reproduced verbatim with a <mark> around each match (the active one tagged
// so CSS can colour it differently). Reproducing the full text — not only the
// matched spans — is what makes the overlay wrap line-for-line with the
// textarea, so every mark lands exactly behind its word instead of drifting.
// Exported for unit testing.
export function buildHighlightHtml(text, matches, activeIdx, escapeFn = escapeHtml) {
  let html = '';
  let pos = 0;
  for (let i = 0; i < matches.length; i++) {
    const [start, end] = matches[i];
    if (start > pos) html += escapeFn(text.slice(pos, start));
    const cls = i === activeIdx ? 'find-match find-match-active' : 'find-match';
    html += `<mark class="${cls}">${escapeFn(text.slice(start, end))}</mark>`;
    pos = end;
  }
  if (pos < text.length) html += escapeFn(text.slice(pos));
  return html;
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
  const highlights = document.getElementById('editor-highlights');
  const highlightsInner = document.getElementById('editor-highlights-inner');
  const wrap = document.getElementById('editor-wrap');

  if (!bar || !findInput) return { open() {}, close() {}, reset() {} };

  // Honour the OS "reduce motion" setting — when set, the find bar's glitch
  // in/out is skipped and it shows/hides instantly (mirrors the
  // welcome-icon-boot reduced-motion guard).
  function prefersReducedMotion() {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Tracks the in-flight close animation's animationend handler so a rapid
  // re-open() can cancel the pending hide before it fires.
  let onGlitchOutEnd = null;

  // Reserve space for the find bar (mobile only) so text never paints
  // under it, and toggle .find-open. Called whenever the bar opens, closes,
  // grows (replace row toggled), or the viewport size changes the way its
  // controls wrap. --find-bar-h drives padding-top on mobile; --find-bar-w
  // is still written but no longer consumed — on desktop the bar overlays
  // the full-width textarea instead of reserving padding-right. Both vars
  // are always written so swapping breakpoints (resize across 600px) Just
  // Works.
  function syncBarMetrics() {
    if (!wrap) return;
    if (bar.hidden) {
      wrap.classList.remove('find-open');
      wrap.style.setProperty('--find-bar-h', '0px');
      wrap.style.setProperty('--find-bar-w', '0px');
      return;
    }
    // Measure the bar's footprint *relative to #editor-wrap* so the
    // reservation includes the bar's own right-inset (the 56px gap
    // that keeps the corner menu clickable). Using bar.getBoundingClientRect()
    // height/width alone leaves a ~56px paintable strip under the
    // bar's left edge on desktop, which the user sees as text bleeding
    // into the bar's territory.
    const wrapRect = wrap.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const h = Math.max(0, barRect.bottom - wrapRect.top);
    const w = Math.max(0, wrapRect.right - barRect.left);
    wrap.style.setProperty('--find-bar-h', h + 'px');
    wrap.style.setProperty('--find-bar-w', w + 'px');
    wrap.classList.add('find-open');
  }

  // Repaint the match-highlight overlay. Called whenever matches, the
  // active index, the bar's visibility, or the editor's geometry change.
  // No-ops when the bar is closed (overlay cleared). Width is re-synced
  // every paint because the textarea's scrollbar appearing/disappearing
  // changes editor.clientWidth — and the marks must wrap at the same
  // column as the textarea's text.
  function paintHighlights() {
    if (!highlights || !highlightsInner) return;
    if (bar.hidden || state.matches.length === 0) {
      highlightsInner.replaceChildren();
      return;
    }
    // Lock the overlay's box to the textarea's *actual* offset within
    // their shared offsetParent (#editor-wrap). On desktop the editor
    // sits at offsetTop:0 / offsetLeft:40 (gutter only); on mobile the
    // editor moves down by the find banner's padding-top. Reading the
    // values directly from `editor` means the overlay tracks whichever
    // axis the active media query padded — no per-axis CSS-var coupling.
    // Geometry goes on the OUTER clip window; the marks + the scroll-sync
    // transform go on the INNER full-height layer (see #editor-highlights
    // CSS for why a single element would clip every off-screen match).
    highlights.style.top = editor.offsetTop + 'px';
    highlights.style.left = editor.offsetLeft + 'px';
    highlights.style.width = editor.clientWidth + 'px';
    highlightsInner.style.transform = `translateY(${-editor.scrollTop}px)`;
    highlightsInner.innerHTML = buildHighlightHtml(editor.value, state.matches, state.idx);
  }

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
      paintHighlights();
      return;
    }
    counter.classList.remove('find-counter-empty');
    // Try to preserve the current index across edits; otherwise reset to 0.
    if (state.idx < 0 || state.idx >= state.matches.length) state.idx = 0;
    counter.textContent = `${state.idx + 1} / ${state.matches.length}`;
    select(state.matches[state.idx]);
    paintHighlights();
    scrollToActiveMatch();
  }

  function select([start, end]) {
    editor.focus();
    editor.setSelectionRange(start, end);
    // Re-focus the input so the user can keep typing the query.
    findInput.focus();
  }

  // Pull the active match into a comfortably-visible part of the textarea.
  // Uses the overlay's <mark class="find-match-active"> as the position
  // oracle — the overlay's geometry mirrors the textarea exactly, so the
  // mark's bounding rect is also where the textarea would paint the match.
  // setSelectionRange's auto-scroll is unreliable cross-browser and
  // outright doesn't fire on mobile after the find input steals focus
  // back; this makes match visibility explicit.
  function scrollToActiveMatch() {
    if (state.idx < 0 || bar.hidden || !highlights) return;
    const active = highlights.querySelector('mark.find-match-active');
    if (!active) return;
    const editorRect = editor.getBoundingClientRect();
    const markRect = active.getBoundingClientRect();
    const relTop = markRect.top - editorRect.top;
    const relBottom = relTop + markRect.height;
    const margin = 24;
    // Already comfortably in view? Don't move — avoids fighting the user's
    // manual scroll on every Enter.
    if (relTop >= margin && relBottom <= editorRect.height - margin) return;
    // Aim ~1/3 from the top so the match sits in a natural reading zone
    // and there's room below to see following context.
    editor.scrollTop += relTop - editorRect.height / 3;
    // Inline overlay re-sync — the textarea's scroll event would re-sync
    // too, but doing it here means the paint frame after this fn returns
    // already shows the marks in the right place.
    highlightsInner.style.transform = `translateY(${-editor.scrollTop}px)`;
  }

  function step(delta) {
    if (state.matches.length === 0) return;
    state.idx = (state.idx + delta + state.matches.length) % state.matches.length;
    counter.textContent = `${state.idx + 1} / ${state.matches.length}`;
    select(state.matches[state.idx]);
    paintHighlights();
    scrollToActiveMatch();
  }

  function open(prefill) {
    // Cancel any in-flight close so a rapid re-open isn't hidden out from
    // under us when the out-animation's animationend lands.
    if (onGlitchOutEnd) {
      bar.removeEventListener('animationend', onGlitchOutEnd);
      onGlitchOutEnd = null;
    }
    bar.classList.remove('find-glitch-out');
    bar.hidden = false;
    if (typeof prefill === 'string' && prefill.length > 0) {
      findInput.value = prefill;
    }
    syncOpts();
    // Reserve space BEFORE refresh() — scrollToActiveMatch (called from
    // refresh) measures editor geometry, which the .find-open padding
    // changes. Doing it first means the first scroll lands in the right
    // place; otherwise the match starts in the bar's reserved band and
    // a second paint frame is needed to correct it.
    syncBarMetrics();
    refresh();
    findInput.focus();
    findInput.select();
    // One-shot glitch-in. Remove + reflow + re-add so a re-open mid-
    // animation restarts cleanly (same trick as the welcome icon boot).
    if (!prefersReducedMotion()) {
      bar.classList.remove('find-glitch-in');
      void bar.offsetWidth;
      bar.classList.add('find-glitch-in');
    }
  }

  function close() {
    // Already closed, or a close animation is already mid-flight (e.g. Esc
    // pressed twice) — nothing to do.
    if (bar.hidden || onGlitchOutEnd) return;

    // Finalise the hide: reset the bar to a calm single-row state, drop the
    // overlay, release the reserved padding. Shared by the animated and
    // reduced-motion paths. Deferred so the replace row glitches out with
    // the rest of the bar rather than vanishing first.
    const finish = () => {
      bar.hidden = true;
      bar.classList.remove('find-glitch-out');
      if (replaceRow) replaceRow.hidden = true;
      if (replaceToggle) replaceToggle.setAttribute('aria-pressed', 'false');
      // Clear the overlay — bar.hidden is now true so paintHighlights wipes it.
      paintHighlights();
      // Release the reserved padding on editor-wrap so the textarea reclaims
      // the full content area.
      syncBarMetrics();
    };

    // Hand focus back to the editor immediately so typing resumes even while
    // the bar is still glitching out.
    editor.focus();

    if (prefersReducedMotion()) {
      finish();
      return;
    }

    // Play the glitch-out while the bar is still visible, then hide on
    // animationend. The name filter guards against the in-animation's end
    // finalising the close early.
    bar.classList.remove('find-glitch-in');
    void bar.offsetWidth;
    bar.classList.add('find-glitch-out');
    onGlitchOutEnd = (e) => {
      if (e.animationName !== 'find-bar-glitch-out') return;
      bar.removeEventListener('animationend', onGlitchOutEnd);
      onGlitchOutEnd = null;
      finish();
    };
    bar.addEventListener('animationend', onGlitchOutEnd);
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

  // Keep the overlay scroll-locked to the textarea. Same translateY-on-
  // scrollTop pattern that line-numbers.js uses for the gutter. Passive
  // so we never block textarea scrolling.
  editor.addEventListener('scroll', () => {
    if (highlightsInner && !bar.hidden) {
      highlightsInner.style.transform = `translateY(${-editor.scrollTop}px)`;
    }
  }, { passive: true });

  // Repaint the overlay whenever the editor's box changes size — the find
  // bar's own padding, the soft keyboard, or a scrollbar appearing all shift
  // where the text wraps without firing a window 'resize'. Without this the
  // marks drift off their words until the next scroll or keystroke.
  if (highlights && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { if (!bar.hidden) paintHighlights(); }).observe(editor);
  }

  // Window resize changes editor.clientWidth (and may add/remove the
  // textarea's scrollbar), which shifts where lines wrap. Re-paint so
  // marks stay aligned with the textarea's text. Also re-measures the
  // bar: at mobile widths the controls can flex-wrap to additional rows,
  // growing the reserved padding-top. (Desktop reserves nothing — the bar
  // overlays — so crossing the 600px breakpoint simply drops the padding.)
  window.addEventListener('resize', () => {
    if (!bar.hidden) {
      syncBarMetrics();
      paintHighlights();
    }
  });

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
      // Bar height (and on mobile, often width too) changed — re-reserve
      // editor space so the new replace row isn't painted over the text,
      // and re-paint the overlay so its top/left follows the textarea's
      // new offset position.
      syncBarMetrics();
      paintHighlights();
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

  // Instant teardown for when the document is replaced (New / Open): hide the
  // bar with NO glitch-out, drop the overlay, and wipe the query + match state
  // so stale highlights/counter from the previous file never linger. close()
  // animates and keeps the query; reset() is the hard reset.
  function reset() {
    if (onGlitchOutEnd) {
      bar.removeEventListener('animationend', onGlitchOutEnd);
      onGlitchOutEnd = null;
    }
    bar.classList.remove('find-glitch-in', 'find-glitch-out');
    bar.hidden = true;
    if (replaceRow) replaceRow.hidden = true;
    if (replaceToggle) replaceToggle.setAttribute('aria-pressed', 'false');
    findInput.value = '';
    if (replaceInput) replaceInput.value = '';
    state.matches = [];
    state.idx = -1;
    if (counter) {
      counter.textContent = '0 / 0';
      counter.classList.add('find-counter-empty');
    }
    paintHighlights();   // bar.hidden → clears the overlay
    syncBarMetrics();    // bar.hidden → releases the reserved padding
  }

  return { open, close, reset };
}
