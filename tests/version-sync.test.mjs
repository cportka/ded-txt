// version-sync.test.mjs — assert package.json's version is valid SemVer and documented in
// CHANGELOG.md. Scaffolded by repo-bootstrap (Portka standard); run with `node --test` (or vitest).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;

test("version is valid SemVer", () => {
  assert.match(version, /^\d+\.\d+\.\d+([-+][0-9A-Za-z.]+)?$/);
});

test("CHANGELOG.md documents the current version", () => {
  const log = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.ok(log.includes(version), `CHANGELOG.md has no entry for ${version}`);
});
