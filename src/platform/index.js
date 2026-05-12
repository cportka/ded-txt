// Detects the runtime and returns the right platform implementation.
// Each platform module exports the same shape so renderer.js can
// stay environment-agnostic.

import electron from './electron.js';
import web from './web.js';

let platform;

if (typeof window !== 'undefined' && window.dt) {
  platform = electron;
} else {
  platform = web;
}

export default platform;
