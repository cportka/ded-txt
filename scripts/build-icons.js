#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build');
const webIconsDir = path.join(root, 'src', 'icons');
const tauriIconsDir = path.join(root, 'src-tauri', 'icons');
const svgPath = path.join(buildDir, 'icon.svg');

async function main() {
  fs.mkdirSync(webIconsDir, { recursive: true });
  fs.mkdirSync(tauriIconsDir, { recursive: true });
  const svg = fs.readFileSync(svgPath);

  // Master 1024 PNG used by Linux + as the source for ICNS / ICO.
  const png1024 = await sharp(svg).resize(1024, 1024).png().toBuffer();
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png1024);

  const icns = png2icons.createICNS(png1024, png2icons.BILINEAR, 0);
  if (!icns) throw new Error('ICNS generation failed');

  const ico = png2icons.createICO(png1024, png2icons.BILINEAR, 0, false, true);
  if (!ico) throw new Error('ICO generation failed');

  // Tauri 2 icon set — the filenames here are dictated by tauri.conf.json.
  await sharp(svg).resize(32, 32).png().toFile(path.join(tauriIconsDir, '32x32.png'));
  await sharp(svg).resize(128, 128).png().toFile(path.join(tauriIconsDir, '128x128.png'));
  await sharp(svg).resize(256, 256).png().toFile(path.join(tauriIconsDir, '128x128@2x.png'));
  fs.writeFileSync(path.join(tauriIconsDir, 'icon.png'), png1024);
  fs.writeFileSync(path.join(tauriIconsDir, 'icon.icns'), icns);
  fs.writeFileSync(path.join(tauriIconsDir, 'icon.ico'), ico);

  // PWA / web icons.
  await sharp(svg).resize(192, 192).png().toFile(path.join(webIconsDir, 'icon-192.png'));
  await sharp(svg).resize(512, 512).png().toFile(path.join(webIconsDir, 'icon-512.png'));

  // Maskable icon: pad the artwork to 80% of the canvas so it survives
  // platform mask shapes (round, squircle, etc.).
  const inner = await sharp(svg).resize(410, 410).png().toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#000000ff' }
  })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toFile(path.join(webIconsDir, 'icon-maskable-512.png'));

  // Favicon — a scalable SVG for modern engines (crisp on hi-DPI tabs), plus
  // a 64px PNG fallback. The SVG is the same master art, copied verbatim so it
  // ships in the web bundle and precaches with the rest of the shell.
  fs.copyFileSync(svgPath, path.join(webIconsDir, 'icon.svg'));
  await sharp(svg).resize(64, 64).png().toFile(path.join(webIconsDir, 'favicon.png'));

  // Open Graph / social card (1200x630): the app icon on the left, tagline +
  // URL on the right, on the brand's dark background. Social crawlers can't use
  // the animated UI, so this still-frame carries the glitch look (chromatic
  // RGB-split text echoing the wordmark).
  const OG_W = 1200;
  const OG_H = 630;
  const ogIcon = await sharp(svg).resize(468, 468).png().toBuffer();
  const line = (y, size, text) =>
    `<text x="643" y="${y + 3}" font-size="${size}" fill="#ff3d8a" opacity="0.85">${text}</text>` +
    `<text x="637" y="${y - 2}" font-size="${size}" fill="#cfe9ff" opacity="0.45">${text}</text>` +
    `<text x="640" y="${y}" font-size="${size}" fill="#f0ede4">${text}</text>`;
  const ogBg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">
      <defs>
        <linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#161616"/><stop offset="1" stop-color="#000000"/>
        </linearGradient>
      </defs>
      <rect width="${OG_W}" height="${OG_H}" fill="url(#og)"/>
      <g fill="#ff3d8a" opacity="0.12">
        <rect x="640" y="150" width="470" height="8"/>
        <rect x="640" y="372" width="360" height="8"/>
        <rect x="640" y="470" width="250" height="8"/>
      </g>
      <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="700">
        ${line(250, 52, 'a dead simple')}
        ${line(322, 52, 'plain-text editor')}
        <text x="640" y="426" font-size="40" font-weight="700" fill="#ff3d8a">dedtxt.app</text>
      </g>
    </svg>`
  );
  await sharp(ogBg)
    .composite([{ input: ogIcon, top: Math.round((OG_H - 468) / 2), left: 96 }])
    .png()
    .toFile(path.join(webIconsDir, 'og-image.png'));

  // GitHub repository social preview (1280x640 — GitHub's own spec, distinct
  // from the 1200x630 Open Graph card above). Same glitch language, refreshed
  // for the wider 2:1 canvas: icon left, tagline + URL right, plus a third
  // muted feature line ("install · offline · no accounts") the OG card omits.
  // Lives in .github/ (a repo-settings asset, never deployed) — upload it via
  // the repo's Settings → Social preview. Regenerated here so it can't drift.
  const githubDir = path.join(root, '.github');
  fs.mkdirSync(githubDir, { recursive: true });
  const SP_W = 1280;
  const SP_H = 640;
  const SP_ICON = 468;
  const spIcon = await sharp(svg).resize(SP_ICON, SP_ICON).png().toBuffer();
  // textX + the 50px tagline keep the longest line ("plain-text editor",
  // ~17 mono chars ≈ 510px) inside the 1280 canvas with a comfortable margin.
  const textX = 660;
  const splitLine = (y, size, text) =>
    `<text x="${textX + 3}" y="${y + 3}" font-size="${size}" fill="#ff3d8a" opacity="0.85">${text}</text>` +
    `<text x="${textX - 3}" y="${y - 2}" font-size="${size}" fill="#cfe9ff" opacity="0.45">${text}</text>` +
    `<text x="${textX}" y="${y}" font-size="${size}" fill="#f0ede4">${text}</text>`;
  const spBg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SP_W}" height="${SP_H}" viewBox="0 0 ${SP_W} ${SP_H}">
      <defs>
        <linearGradient id="sp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#161616"/><stop offset="1" stop-color="#000000"/>
        </linearGradient>
      </defs>
      <rect width="${SP_W}" height="${SP_H}" fill="url(#sp)"/>
      <g fill="#ff3d8a" opacity="0.12">
        <rect x="${textX}" y="182" width="470" height="8"/>
        <rect x="${textX}" y="392" width="330" height="8"/>
        <rect x="${textX}" y="470" width="230" height="8"/>
      </g>
      <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="700">
        ${splitLine(272, 50, 'a dead simple')}
        ${splitLine(338, 50, 'plain-text editor')}
        <text x="${textX}" y="440" font-size="40" font-weight="700" fill="#ff3d8a">dedtxt.app</text>
        <text x="${textX}" y="502" font-size="25" font-weight="600" fill="#8a8a8a" letter-spacing="1">install · offline · no accounts</text>
      </g>
    </svg>`
  );
  await sharp(spBg)
    .composite([{ input: spIcon, top: Math.round((SP_H - SP_ICON) / 2), left: 110 }])
    .png()
    .toFile(path.join(githubDir, 'social-preview.png'));

  console.log('Wrote icons to build/, src/icons/, src-tauri/icons/, and .github/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
