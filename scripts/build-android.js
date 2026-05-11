#!/usr/bin/env node
// Builds an unsigned debug APK (and optionally an unsigned release AAB) of
// the Android app. Requires the `android/` Capacitor project to exist
// (`npm run cap:add:android` once). Needs Java + the Android SDK on the
// machine — CI installs both.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');

if (!fs.existsSync(androidDir)) {
  console.error('No android/ project. Run: npm run cap:add:android');
  process.exit(1);
}

function run(bin, argv, cwd) {
  const res = spawnSync(bin, argv, { stdio: 'inherit', cwd: cwd || root });
  if (res.status !== 0) process.exit(res.status || 1);
}

// Refresh web bundle and copy into the android project.
run(process.execPath, [path.join(__dirname, 'build-web.js')]);
run('npx', ['--yes', 'cap', 'sync', 'android']);

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(gradlew, ['assembleDebug', '--no-daemon'], androidDir);

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (fs.existsSync(apk)) {
  fs.mkdirSync(path.join(root, 'dist-mobile'), { recursive: true });
  const dest = path.join(root, 'dist-mobile', 'DedTxt-debug.apk');
  fs.copyFileSync(apk, dest);
  console.log(`Wrote ${dest}`);
} else {
  console.error('Build finished but APK not found at', apk);
  process.exit(1);
}
