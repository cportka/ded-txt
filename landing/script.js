// Fetches the latest GitHub release and wires up download buttons.
// Falls back gracefully if the API is unreachable or rate-limited.

(function () {
  // Theme toggle: dark by default, persisted in localStorage so the choice
  // sticks across sessions and is shared with the PWA at /app/.
  const THEME_KEY = 'dedtxt-theme';

  // MIGRATION: copy old key to new key once, then remove old.
  // Added during DeadText → DedTxt rename. Safe to remove after a few months.
  try {
    var oldThemeKey = localStorage.getItem('deadtext-theme');
    if (oldThemeKey && !localStorage.getItem(THEME_KEY)) {
      localStorage.setItem(THEME_KEY, oldThemeKey);
    }
    if (oldThemeKey) localStorage.removeItem('deadtext-theme');
  } catch (e) { /* private mode */ }

  const themeMeta = document.getElementById('theme-color-meta');
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    if (themeMeta) themeMeta.setAttribute('content', t === 'light' ? '#ffffff' : '#0e0e0e');
  }
  document.querySelectorAll('[data-theme-toggle]').forEach((el) => {
    el.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
    });
  });

  const REPO = 'cportka/dedtxt';
  const API = `https://api.github.com/repos/${REPO}/releases/latest`;
  const RELEASES_URL = `https://github.com/${REPO}/releases`;

  const statusEl = document.getElementById('status');
  const primaryBtn = document.getElementById('primary-btn');
  const otherList = document.getElementById('other-list');
  const otherDetails = document.getElementById('other');

  function detectOS() {
    const ua = navigator.userAgent || '';
    const platform = (navigator.userAgentData && navigator.userAgentData.platform)
      || navigator.platform
      || '';
    const isTouch = navigator.maxTouchPoints > 1;

    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPod/.test(ua) || (/iPad/.test(ua)) || (platform === 'MacIntel' && isTouch)) return 'ios';
    if (/Mac/i.test(platform)) return 'macos';
    if (/Win/i.test(platform)) return 'windows';
    if (/Linux/i.test(platform)) return 'linux';
    return 'unknown';
  }

  function detectArch() {
    const ua = navigator.userAgent || '';
    if (/aarch64|arm64/i.test(ua)) return 'arm64';
    if (/x86_64|x64|Win64|WOW64/i.test(ua)) return 'x64';
    return 'x64'; // sensible default
  }

  function classify(asset) {
    const n = asset.name;
    const lower = n.toLowerCase();
    const arm = /arm64|aarch64/.test(lower);
    if (lower.endsWith('.dmg')) return { os: 'macos', arch: arm ? 'arm64' : 'x64', label: 'macOS', kind: 'DMG' };
    if (lower.endsWith('-mac.zip') || lower.endsWith('mac.zip')) return { os: 'macos', arch: arm ? 'arm64' : 'x64', label: 'macOS', kind: 'ZIP' };
    if (lower.endsWith('.appimage')) return { os: 'linux', arch: arm ? 'arm64' : 'x64', label: 'Linux', kind: 'AppImage' };
    if (lower.endsWith('.deb')) return { os: 'linux', arch: arm ? 'arm64' : 'x64', label: 'Linux', kind: 'deb' };
    if (lower.endsWith('.rpm')) return { os: 'linux', arch: arm ? 'arm64' : 'x64', label: 'Linux', kind: 'rpm' };
    if (/setup.*\.exe$/i.test(n)) return { os: 'windows', arch: arm ? 'arm64' : 'x64', label: 'Windows', kind: 'Installer' };
    if (lower.endsWith('.exe')) return { os: 'windows', arch: arm ? 'arm64' : 'x64', label: 'Windows', kind: 'Portable' };
    if (lower.endsWith('.apk')) return { os: 'android', arch: 'universal', label: 'Android', kind: 'APK' };
    if (lower.endsWith('.aab')) return { os: 'android', arch: 'universal', label: 'Android', kind: 'AAB' };
    return null;
  }

  function pickPrimary(catalog, os, arch) {
    const matches = catalog.filter((c) => c.os === os);
    if (matches.length === 0) return null;
    // Prefer the user's arch; on macOS prefer DMG over ZIP; on Linux prefer AppImage.
    const archMatches = matches.filter((c) => c.arch === arch);
    const pool = archMatches.length ? archMatches : matches;
    const order = { 'DMG': 0, 'Installer': 0, 'AppImage': 0, 'APK': 0, 'AAB': 1, 'Portable': 1, 'deb': 2, 'rpm': 3, 'ZIP': 4 };
    pool.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
    return pool[0];
  }

  function setPrimary(item) {
    if (!item) return;
    const archLabel = item.arch === 'universal' ? '' : ` (${item.arch})`;
    primaryBtn.innerHTML = `<span>Download for ${item.label}</span><span class="arch">${item.kind}${archLabel}</span>`;
    primaryBtn.href = item.url;
  }

  function renderOthers(catalog, primary) {
    const sorted = [...catalog].sort((a, b) => {
      if (a.label !== b.label) return a.label.localeCompare(b.label);
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.arch.localeCompare(b.arch);
    });
    otherList.innerHTML = '';
    for (const c of sorted) {
      if (primary && c.url === primary.url) continue;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = c.url;
      const archLabel = c.arch === 'universal' ? '' : c.arch;
      a.innerHTML = `<span class="label">${c.label} · ${c.kind}</span><span class="arch">${archLabel}</span>`;
      li.appendChild(a);
      otherList.appendChild(li);
    }
    otherDetails.style.display = sorted.length > 1 ? '' : 'none';
  }

  function fail(message) {
    statusEl.innerHTML = `<span class="err">${message}</span> <a href="${RELEASES_URL}">View releases on GitHub</a>`;
  }

  async function load() {
    let release;
    try {
      const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      release = await res.json();
    } catch (err) {
      fail("Couldn't reach GitHub right now.");
      return;
    }

    if (!release || !Array.isArray(release.assets) || release.assets.length === 0) {
      fail('No published release yet.');
      return;
    }

    const catalog = release.assets
      .map((a) => {
        const c = classify(a);
        if (!c) return null;
        return { ...c, url: a.browser_download_url, size: a.size };
      })
      .filter(Boolean);

    if (catalog.length === 0) {
      fail("Latest release doesn't have downloadable installers yet.");
      return;
    }

    const os = detectOS();
    const arch = detectArch();
    const primary = pickPrimary(catalog, os === 'unknown' ? 'macos' : os, arch);

    if (primary) {
      setPrimary(primary);
    } else {
      primaryBtn.href = release.html_url;
      primaryBtn.innerHTML = `<span>Get ${release.tag_name}</span>`;
    }

    statusEl.textContent = `Latest: ${release.tag_name}`;
    renderOthers(catalog, primary);
  }

  load();
})();
