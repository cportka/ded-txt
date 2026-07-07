// Subtle line-number gutter for the editor.
//
// Important: the textarea's `.value` is what we save — line numbers, the
// gutter, and the mirror element used for layout measurement are all
// purely visual. NOTHING is ever inserted into the file. Word-wrap is
// browser-native (textarea wrap="soft" + CSS white-space: pre-wrap), so
// wrapped continuation lines are virtual — no \n in the saved bytes.
//
// Strategy: an off-screen mirror element mirrors the textarea's font,
// padding, width, and wrap behaviour. We render one <div> per logical
// line into the mirror and read its height — that height divided by the
// line-height tells us how many visual rows that logical line wraps to.
// We then build the gutter content as N lines, where each logical line N
// gets its number followed by (rows-1) blank entries so wrapped
// continuations are visually unnumbered.

// Zero-width space (U+200B). Declared via String.fromCharCode so the
// source file stays ASCII and eslint's no-irregular-whitespace stays happy.
const ZWSP = String.fromCharCode(0x200B);

let gutter, gutterInner, mirror, editor;
let lineHeightPx = 0;
let rafPending = false;

function syncMirrorStyle() {
  if (!editor || !mirror) return;
  // Match the editor's effective content width so wrapping is identical.
  mirror.style.width = editor.clientWidth + 'px';
}

// Build the gutter's per-visual-row tokens from each logical line's measured
// pixel height. A line that wraps to N visual rows contributes its 1-based
// number followed by N-1 empty tokens, so the gutter's total row count always
// equals the textarea's wrapped row count and every number stays locked to the
// row its line starts on. Exported for unit testing.
export function buildGutterTokens(lineHeights, lineHeightPx) {
  const lh = lineHeightPx > 0 ? lineHeightPx : 20;
  const tokens = [];
  for (let i = 0; i < lineHeights.length; i++) {
    const rows = Math.max(1, Math.round(lineHeights[i] / lh));
    tokens.push(String(i + 1));
    for (let j = 1; j < rows; j++) tokens.push('');
  }
  return tokens;
}

function render() {
  if (!editor || !gutter || !mirror || !gutterInner) return;

  syncMirrorStyle();

  const lines = editor.value.split('\n');

  // Populate mirror with one <div> per logical line. Empty lines get a
  // zero-width space (U+200B) so .offsetHeight still reports a real row.
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const d = document.createElement('div');
    d.textContent = line === '' ? ZWSP : line;
    frag.appendChild(d);
  }
  mirror.replaceChildren(frag);

  // The editor's *rendered* line-height in px. Read fresh every paint (not
  // cached) so a zoom — or the touch-viewport media query that lifts the
  // textarea to 16px while the gutter font stays 14px — is always picked up.
  lineHeightPx = parseFloat(getComputedStyle(editor).lineHeight) || lineHeightPx || 20;

  const heights = [];
  for (let i = 0; i < lines.length; i++) heights.push(mirror.children[i].offsetHeight);

  // Pin the gutter's row pitch to the editor's so the numbers can't drift
  // away from their lines. The gutter glyphs stay 14px (multi-digit numbers
  // keep fitting the 40px rail), but each number's row must be exactly as
  // tall as an editor row — otherwise on touch viewports (editor 16px,
  // gutter 14px) the two columns slide apart one line at a time. Written
  // alongside the text so the style change rides the same layout pass.
  gutterInner.style.lineHeight = lineHeightPx + 'px';
  gutterInner.textContent = buildGutterTokens(heights, lineHeightPx).join('\n');
}

function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    render();
  });
}

function syncScroll() {
  if (!editor || !gutterInner) return;
  gutterInner.style.transform = `translateY(${-editor.scrollTop}px)`;
}

export function initLineNumbers() {
  editor = document.getElementById('text-editor');
  gutter = document.getElementById('line-gutter');
  gutterInner = document.getElementById('line-gutter-inner');
  mirror = document.getElementById('editor-mirror');
  if (!editor || !gutter || !gutterInner || !mirror) return;

  lineHeightPx = parseFloat(getComputedStyle(editor).lineHeight) || 20;

  editor.addEventListener('input', scheduleRender);
  editor.addEventListener('scroll', syncScroll, { passive: true });
  // Re-measure on any change to the editor's box, not just window resizes.
  // The find bar's padding narrows/widens the editor (desktop), and the soft
  // keyboard or a newly-appearing scrollbar changes its width too — none of
  // which fire a window 'resize'. Without observing the element directly the
  // gutter keeps stale wrap counts and the numbers drift off their lines.
  // Mirrors scroll-arrows.js.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(scheduleRender).observe(editor);
  } else {
    window.addEventListener('resize', scheduleRender);
  }

  // Initial paint.
  scheduleRender();
}

// Called by renderer.js after platform.onLoad sets editor.value (setting
// .value programmatically does NOT fire 'input', so we need an explicit
// nudge).
export function refreshLineNumbers() {
  scheduleRender();
}
