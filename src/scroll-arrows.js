// Floating scroll-to-start / scroll-to-end arrows for the editor textarea.
//
// #text-editor is the scroller. The up-arrow (top-right, just under the menu
// icon) shows when the user isn't at the top; the down-arrow (bottom-right)
// shows when they aren't at the bottom; both hide when the whole document
// fits the viewport. Appear / disappear / click reuse the find bar's glitch
// vocabulary (steps() RGB-split keyframes in styles.css); reduced motion
// degrades to an instant show/hide and an instant jump.

import { prefersReducedMotion } from './welcome.js';

// Decide which arrows should be visible for a given scroll position. Both hide
// when the whole document fits (nothing to scroll); otherwise the up-arrow
// shows unless we're at the top and the down-arrow unless we're at the bottom.
// The 1px tolerance absorbs sub-pixel rounding in the scroll metrics. Pure +
// exported for unit testing.
export function arrowVisibility({ scrollTop, clientHeight, scrollHeight }) {
  const canScroll = scrollHeight > clientHeight + 1;
  const atTop = scrollTop <= 1;
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
  return { top: canScroll && !atTop, bottom: canScroll && !atBottom };
}

export function initScrollArrows({ editor }) {
  const topBtn = document.getElementById('scroll-top');
  const bottomBtn = document.getElementById('scroll-bottom');
  if (!editor || !topBtn || !bottomBtn) return { update() {} };

  // One persistent animationend handler per button: cleans up whichever
  // one-shot class fired (matched by animation name) and commits the hide once
  // a glitch-out finishes — unless a show interrupted it (data-hiding cleared).
  function onAnimEnd(e) {
    const btn = e.currentTarget;
    if (e.animationName === 'arrow-glitch-in') {
      btn.classList.remove('arrow-glitch-in');
    } else if (e.animationName === 'arrow-pulse') {
      btn.classList.remove('arrow-activating');
    } else if (e.animationName === 'arrow-glitch-out') {
      btn.classList.remove('arrow-glitch-out');
      if (btn.dataset.hiding === '1') {
        btn.dataset.hiding = '';
        btn.hidden = true;
      }
    }
  }

  function showArrow(btn) {
    btn.dataset.hiding = '';            // cancel any in-flight hide
    btn.classList.remove('arrow-glitch-out');
    if (!btn.hidden) return;
    btn.hidden = false;
    if (prefersReducedMotion()) return;
    btn.classList.remove('arrow-glitch-in');
    void btn.offsetWidth;               // reflow so a rapid re-show restarts cleanly
    btn.classList.add('arrow-glitch-in');
  }

  function hideArrow(btn) {
    if (btn.hidden || btn.dataset.hiding === '1') return;
    if (prefersReducedMotion()) {
      btn.hidden = true;
      return;
    }
    btn.dataset.hiding = '1';
    btn.classList.remove('arrow-glitch-in');
    void btn.offsetWidth;
    btn.classList.add('arrow-glitch-out');
  }

  function update() {
    const { top, bottom } = arrowVisibility(editor);
    if (top) showArrow(topBtn); else hideArrow(topBtn);
    if (bottom) showArrow(bottomBtn); else hideArrow(bottomBtn);
  }

  function go(top, btn) {
    if (!prefersReducedMotion()) {
      btn.classList.remove('arrow-activating');
      void btn.offsetWidth;
      btn.classList.add('arrow-activating');
    }
    editor.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  topBtn.addEventListener('animationend', onAnimEnd);
  bottomBtn.addEventListener('animationend', onAnimEnd);
  topBtn.addEventListener('click', () => go(0, topBtn));
  bottomBtn.addEventListener('click', () => go(editor.scrollHeight, bottomBtn));

  // Re-evaluate on scroll, on content change, and on any size change (the
  // find bar's padding shrinks the editor on mobile, the soft keyboard
  // resizes it, the window resizes). update() also runs for programmatic
  // scrollTop changes since the native 'scroll' event fires for those too.
  editor.addEventListener('scroll', update, { passive: true });
  editor.addEventListener('input', update);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(update).observe(editor);
  } else {
    window.addEventListener('resize', update);
  }

  update();
  return { update };
}
