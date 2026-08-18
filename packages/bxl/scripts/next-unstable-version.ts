#!/usr/bin/env node
/**
 * Print the next free `<base>-unstable.<n>` for the version in package.json,
 * where `<base>` is that version with any prerelease suffix dropped.
 *
 * This backs the publish workflow's manual path, which republishes main as it
 * stands. That path deliberately doesn't commit its bump, so the repo can't
 * track the counter — npm is the authority on which ones are taken, and reading
 * them back is what keeps a manual publish from colliding with a version that
 * already exists.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { publishedVersions, unstableCounters } from './compute-release.ts';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');

const version = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
).version as string;

const base = version.replace(/-unstable\.\d+$/, '');
const counters = unstableCounters(base, publishedVersions());
process.stdout.write(
  `${base}-unstable.${counters.length ? Math.max(...counters) + 1 : 0}\n`,
);
