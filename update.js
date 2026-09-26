// Pure version-comparison + update-classification helpers for the desktop
// update path (currently paused) and its unit tests. On desktop the Rust side
// performs the actual network fetch — the webview CSP blocks cross-origin
// requests — then hands the raw versions here, so the "which kind of update is
// this?" decision lives in exactly one place. The web/PWA build does NOT use
// this; it detects updates via the service-worker lifecycle (see renderer.js).

// Parse a "MAJOR.MINOR.PATCH(-rc.N)" string into comparable parts. Returns
// null for anything unparseable so callers can treat it as "no information".
function parse(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    // A final release outranks any -rc of the same X.Y.Z, so model "no rc"
    // as +Infinity (1.0.0 > 1.0.0-rc.99).
    rc: m[4] === undefined ? Infinity : Number(m[4])
  };
}

// Compare two versions: -1 (a<b), 0 (a==b), 1 (a>b). Unparseable versions
// compare equal to everything (0) so a malformed manifest never claims an
// update is available.
export function compareVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (const k of ['major', 'minor', 'patch', 'rc']) {
    if (pa[k] < pb[k]) return -1;
    if (pa[k] > pb[k]) return 1;
  }
  return 0;
}

// Classify an update from the running web-layer version, the latest available
// web version, the minimum native shell that `latest` requires, and the
// installed native shell version:
//   'none'   — latest is not newer than what's running.
//   'native' — latest is newer BUT needs a newer native shell than installed,
//              so the web layer can't be hot-swapped → point at a full build.
//   'web'    — latest is newer AND the installed shell can run it → safe to
//              fetch the web layer and reload in place.
// On the web there is no native shell: pass currentNative === null to skip the
// native gate (web updates are always 'web').
export function updateKind(currentWeb, latest, nativeMin, currentNative) {
  if (compareVersions(latest, currentWeb) <= 0) return 'none';
  if (currentNative != null && compareVersions(nativeMin, currentNative) > 0) {
    return 'native';
  }
  return 'web';
}
