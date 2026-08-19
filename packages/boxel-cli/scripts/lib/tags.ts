/**
 * Shared helpers for resolving boxel-cli git tags. Used by compute-release.ts
 * (for prerelease counting) and generate-release-notes.ts (for scoping the
 * GitHub releases/generate-notes window via previous_tag_name).
 *
 * All boxel-cli release tags follow the pattern `boxel-cli-v<semver>` where
 * unstable tags carry a `-unstable.<n>` suffix in the semver portion.
 */

import { execSync } from 'child_process';

import semver from 'semver';

function listBoxelCliTags(): string[] {
  return execSync("git tag --list 'boxel-cli-v*'")
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);
}

/**
 * Returns the most recent stable `boxel-cli-v*` semver string (suffix `boxel-cli-v` stripped).
 * Throws when no stable tag exists — the unstable counter has no base in that case.
 */
export function lastStableTag(): string {
  const versions = listBoxelCliTags()
    .filter((t) => !t.includes('-unstable.'))
    .map((t) => t.replace(/^boxel-cli-v/, ''))
    .sort(semver.compare);
  if (versions.length === 0) {
    throw new Error(
      'No stable boxel-cli-v* tag found. Cannot compute prerelease counter.',
    );
  }
  return versions[versions.length - 1];
}

/**
 * Returns the most recent `boxel-cli-v*` tag (stable or unstable) reachable
 * from HEAD, e.g. `boxel-cli-v0.1.5-unstable.7`. Returns null when no such
 * tag exists — bootstrap case, callers should fall back to a minimal body.
 */
export function previousReachableTag(): string | null {
  try {
    const tag = execSync(
      "git describe --tags --abbrev=0 --match 'boxel-cli-v*' HEAD",
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim();
    return tag || null;
  } catch {
    return null;
  }
}

/**
 * Returns the most recent stable `boxel-cli-v*` tag (full tag name including
 * the `boxel-cli-v` prefix). Returns null when no stable tag exists.
 */
export function previousStableTag(): string | null {
  const versions = listBoxelCliTags()
    .filter((t) => !t.includes('-unstable.'))
    .map((t) => t.replace(/^boxel-cli-v/, ''))
    .sort(semver.compare);
  if (versions.length === 0) return null;
  return `boxel-cli-v${versions[versions.length - 1]}`;
}
