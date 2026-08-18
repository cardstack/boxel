#!/usr/bin/env node
/**
 * Print the version a manual "republish main as it stands" should publish, based
 * on the version in package.json and what npm already holds.
 *
 * This backs the publish workflow's manual path. That path deliberately doesn't
 * commit its bump, so the repo can't track the prerelease counter — npm is the
 * authority on which ones are taken, and reading them back is what keeps a
 * manual publish from colliding with a version that already exists.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  nextManualUnstableVersion,
  publishedVersions,
} from './compute-release.ts';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');

const manifestVersion = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
).version as string;

process.stdout.write(
  `${nextManualUnstableVersion(manifestVersion, publishedVersions())}\n`,
);
