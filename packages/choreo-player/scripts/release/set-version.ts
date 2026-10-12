#!/usr/bin/env node
/**
 * Set the package version.
 *
 *   node scripts/release/set-version.ts 0.2.0-unstable.3
 *
 * `package.json` is the only place the version lives: the library reports no
 * version of its own at runtime.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(import.meta.dirname, '../..');

// The versions this package publishes: `major.minor.patch`, optionally an
// `-unstable.<n>` prerelease.
const PUBLISHABLE_VERSION = /^\d+\.\d+\.\d+(?:-unstable\.\d+)?$/;

export function assertPublishableVersion(version: string): void {
  if (!PUBLISHABLE_VERSION.test(version)) {
    throw new Error(
      `"${version}" is not a version this package publishes ` +
        `(major.minor.patch[-unstable.n])`,
    );
  }
}

export function setVersion(version: string): void {
  assertPublishableVersion(version);
  const manifestPath = join(PACKAGE_ROOT, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) {
    throw new Error('usage: node scripts/release/set-version.ts <version>');
  }
  setVersion(version);
  console.log(`version → ${version} (package.json)`);
}
