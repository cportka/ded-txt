// Detects the runtime and returns the right platform implementation.
// Each platform module exports the same shape so renderer.js can
// stay environment-agnostic.
//
// Tauri's bridge is loaded via dynamic import so the web/PWA build never
// pays for code it can't use.

import web from './web.js';

let platform;

if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
  const mod = await import('./tauri.js');
  platform = mod.default;
} else {
  platform = web;
}

export default platform;
