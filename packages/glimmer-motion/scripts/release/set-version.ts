#!/usr/bin/env node
/**
 * Set the shared version in every lockstep package's manifest.
 *
 *   node scripts/release/set-version.ts 0.6.0-unstable.3
 *
 * glimmer-motion and choreo always carry the same version: choreo's peer
 * dependency on glimmer-motion is `workspace:*`, which pnpm rewrites to the
 * exact version at publish, so nothing sets one manifest without the other.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGES, REPO_ROOT } from './compute-release.ts';

// The versions these packages publish: `major.minor.patch`, optionally an
// `-unstable.<n>` prerelease.
const PUBLISHABLE_VERSION = /^\d+\.\d+\.\d+(?:-unstable\.\d+)?$/;

export function assertPublishableVersion(version: string): void {
  if (!PUBLISHABLE_VERSION.test(version)) {
    throw new Error(
      `"${version}" is not a version these packages publish ` +
        `(major.minor.patch[-unstable.n])`,
    );
  }
}

export function setVersion(version: string): void {
  assertPublishableVersion(version);
  for (const pkg of PACKAGES) {
    const manifestPath = join(REPO_ROOT, pkg.dir, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.version = version;
    writeFileSync(
      manifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8',
    );
  }
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) {
    throw new Error('usage: node scripts/release/set-version.ts <version>');
  }
  setVersion(version);
  console.log(
    `version → ${version} (${PACKAGES.map((pkg) => `${pkg.dir}/package.json`).join(', ')})`,
  );
}
