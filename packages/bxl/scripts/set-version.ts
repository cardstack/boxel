#!/usr/bin/env node
/**
 * Set the package version.
 *
 *   node scripts/set-version.ts 0.6.0-unstable.3
 *
 * Two files carry it. `package.json` is what npm publishes under; `VERSION` in
 * `src/index.ts` is what the library reports about itself at runtime, through
 * `BXL_BUILD_INFO` — a consumer holding a BXL result reads that, not the
 * manifest. They have to agree, so nothing sets one without the other, and
 * `tests/unit/bxl-build-info.ts` fails the suite if they ever disagree.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');

const VERSION_DECLARATION = /^export const VERSION = '[^']*';$/gm;

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

/**
 * Rewrite the `VERSION` declaration in the entry module's source.
 *
 * Insisting on exactly one match is the point: this is a text edit standing in
 * for a language-level guarantee, so a source tree where the declaration moved,
 * changed shape, or acquired a second copy has to stop the release rather than
 * quietly leave the runtime version behind.
 */
export function withVersionDeclaration(
  source: string,
  version: string,
): string {
  assertPublishableVersion(version);
  const matches = source.match(VERSION_DECLARATION) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one VERSION declaration, found ${matches.length}`,
    );
  }
  return source.replace(
    VERSION_DECLARATION,
    `export const VERSION = '${version}';`,
  );
}

export function setVersion(version: string): void {
  assertPublishableVersion(version);

  const manifestPath = join(PACKAGE_ROOT, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const entryPath = join(PACKAGE_ROOT, 'src', 'index.ts');
  writeFileSync(
    entryPath,
    withVersionDeclaration(readFileSync(entryPath, 'utf8'), version),
    'utf8',
  );
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) {
    throw new Error('usage: node scripts/set-version.ts <version>');
  }
  setVersion(version);
  console.log(`version → ${version} (package.json, src/index.ts)`);
}
