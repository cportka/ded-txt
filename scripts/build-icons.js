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

  // Favicon — modern browsers honor PNG favicons fine.
  await sharp(svg).resize(64, 64).png().toFile(path.join(webIconsDir, 'favicon.png'));

  console.log('Wrote icons to build/, src/icons/, and src-tauri/icons/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
