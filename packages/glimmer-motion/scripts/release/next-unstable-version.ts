#!/usr/bin/env node
/**
 * Print the version a manual "republish main as it stands" should publish, based
 * on the shared version in the manifests and what npm already holds for either
 * package.
 *
 * This backs the publish workflow's manual path. That path deliberately doesn't
 * commit its bump, so the repo can't track the prerelease counter — npm is the
 * authority on which ones are taken, and reading them back is what keeps a
 * manual publish from colliding with a version that already exists.
 */

import {
  currentLockstepVersion,
  nextManualUnstableVersion,
  publishedVersions,
} from './compute-release.ts';

process.stdout.write(
  `${nextManualUnstableVersion(currentLockstepVersion(), publishedVersions())}\n`,
);
