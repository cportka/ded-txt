#!/usr/bin/env node
// Generate a 1280x640 social preview PNG (GitHub recommends min 640x320,
// max 1MB; this size matches what GitHub renders for "Open Graph image"
// in Settings -> Social preview). The icon is centered at 480px on a
// solid noir background that matches the icon's gradient base.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'build', 'icon.svg');
const outPath = path.join(root, 'build', 'social-preview.png');

const W = 1280;
const H = 640;
const ICON = 480;
const BG = '#000000';

async function main() {
  const svg = fs.readFileSync(svgPath);
  const icon = await sharp(svg).resize(ICON, ICON).png().toBuffer();

  await sharp({
    create: { width: W, height: H, channels: 4, background: BG }
  })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toFile(outPath);

  const { size } = fs.statSync(outPath);
  console.log(`Wrote ${path.relative(root, outPath)} (${(size / 1024).toFixed(1)} KB, ${W}x${H})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
