// Crash / draft recovery: while the buffer is dirty, stash it to
// localStorage (debounced) so an accidental tab close, crash, or reload can
// offer to restore the unsaved text on the next boot.
//
// Semantics — the draft mirrors "the unsaved buffer at the last edit":
//   - written  (debounced) on every input while dirty; flushed immediately
//     when the page hides (visibilitychange/pagehide);
//   - cleared  on a CONFIRMED save (FSA write), on New (the user explicitly
//     confirmed discarding), and on the restore offer's Discard button;
//   - kept     on the Firefox/Safari download-fallback save (the download
//     API can't confirm the file landed) and on Open (a dirty buffer
//     replaced without a save keeps its draft as a safety net).
// Two tabs share the key — last writer wins; a single-key stash is a
// deliberate simplicity trade-off for a single-document editor.
//
// Pure helpers (serializeDraft / parseDraft / relativeTime / describeDraft)
// and the storage-injected factory are exported for unit testing.

export const DRAFT_KEY = 'dedtxt-draft';
// localStorage quota is ~5 MB of UTF-16 in most browsers; cap the stash well
// under it so a huge (up to 25 MB) document never aborts mid-write and other
// keys (welcome flag) survive. Oversized buffers simply aren't stashed.
export const MAX_DRAFT_CHARS = 2 * 1000 * 1000;
export const STASH_DEBOUNCE_MS = 1500;

export function serializeDraft({ content, name, isBinary, savedAt }) {
  if (typeof content !== 'string' || content.length === 0) return null;
  if (content.length > MAX_DRAFT_CHARS) return null;
  return JSON.stringify({
    content,
    name: name || null,
    isBinary: !!isBinary,
    savedAt: typeof savedAt === 'number' ? savedAt : Date.now()
  });
}

export function parseDraft(raw) {
  if (!raw) return null;
  let d;
  try { d = JSON.parse(raw); } catch (_e) { return null; }
  if (!d || typeof d !== 'object') return null;
  if (typeof d.content !== 'string' || d.content.length === 0) return null;
  return {
    content: d.content,
    name: typeof d.name === 'string' && d.name ? d.name : null,
    isBinary: !!d.isBinary,
    savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0
  };
}

// Coarse "5 minutes ago" label for the restore offer. Anything under a
// minute reads as "just now"; anything over a week falls back to "a while
// ago" (precision past that adds no decision value).
export function relativeTime(ts, now) {
  const delta = Math.max(0, now - ts);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (!ts || delta >= 7 * day) return 'a while ago';
  if (delta < min) return 'just now';
  if (delta < hour) {
    const m = Math.round(delta / min);
    return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  }
  if (delta < day) {
    const h = Math.round(delta / hour);
    return h === 1 ? 'an hour ago' : `${h} hours ago`;
  }
  const d = Math.round(delta / day);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function describeDraft(draft, now) {
  const what = draft.name ? `“${draft.name}”` : 'unsaved text';
  return `Recovered ${what} from ${relativeTime(draft.savedAt, now)}.`;
}

// Storage-injected stash controller. `getSnapshot` returns the live
// { content, name, isBinary, dirty } — read at write time, not schedule
// time, so the stash always captures the latest buffer.
export function createDraftStash({ storage, getSnapshot, debounceMs = STASH_DEBOUNCE_MS }) {
  let timer = 0;
  // While the boot-time restore offer is pending, new edits must not
  // overwrite the recoverable draft — suspended until the user decides.
  let suspended = false;
  // True once THIS session has written the draft. A clean buffer then means
  // the stored draft is stale (the user undid back to the saved text) and
  // gets removed — but a draft from a PREVIOUS session is never auto-removed
  // on a clean write, only by an explicit clear()/overwrite.
  let wroteDraft = false;

  function writeNow() {
    if (suspended) return;
    const snap = getSnapshot();
    if (!snap) return;
    if (!snap.dirty) {
      if (wroteDraft) {
        wroteDraft = false;
        try { storage.removeItem(DRAFT_KEY); } catch (_e) { /* ignore */ }
      }
      return;
    }
    const s = serializeDraft(snap);
    if (!s) return;
    try {
      storage.setItem(DRAFT_KEY, s);
      wroteDraft = true;
    } catch (_e) { /* quota / private mode */ }
  }

  return {
    schedule() {
      if (suspended) return;
      clearTimeout(timer);
      timer = setTimeout(writeNow, debounceMs);
    },
    // Immediate write for pagehide/visibilitychange — the tab may be gone
    // before a pending debounce fires.
    flush() {
      clearTimeout(timer);
      timer = 0;
      writeNow();
    },
    clear() {
      clearTimeout(timer);
      timer = 0;
      wroteDraft = false;
      try { storage.removeItem(DRAFT_KEY); } catch (_e) { /* ignore */ }
    },
    peek() {
      try { return parseDraft(storage.getItem(DRAFT_KEY)); } catch (_e) { return null; }
    },
    suspend() { suspended = true; },
    resume() { suspended = false; }
  };
}
