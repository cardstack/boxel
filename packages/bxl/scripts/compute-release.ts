#!/usr/bin/env node
/**
 * Decide what version, if any, a merge to main publishes as `@cardstack/bxl`.
 *
 * Two inputs drive it. The merged PR's title carries a conventional-commit
 * prefix, which maps to a bump level through `release-prefixes.json` — the same
 * file the pre-merge title check reads, so the gate and the classifier can't
 * disagree about what a valid prefix is. The PR's changed files say whether the
 * *published* artifact moved at all: a package holds more than it ships, and a
 * `fix:` that only touched a test suite has nothing to release.
 *
 * Publishes are prereleases — `<base>-unstable.<n>` under the `unstable`
 * dist-tag. Cutting a stable release from one is a deliberate, separate act
 * (the publish workflow's `promote` path).
 *
 * Emits JSON on stdout for the workflow to read. `computeRelease()` is pure; the
 * wrapper at the bottom is what touches git, npm, and disk, so the suite in
 * `tests/unit/release-cli.ts` can exercise the decisions directly.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import semver from 'semver';

import bumpByPrefix from './release-prefixes.json' with { type: 'json' };

export type BumpLevel = 'major' | 'minor' | 'patch' | 'none';

export interface ComputeReleaseInput {
  changedFiles: string[];
  currentVersion: string;
  lastStableBase: string;
  prBody: string;
  prereleaseCounter: number;
  prTitle: string;
}

export interface ComputeReleaseOutput {
  bump: BumpLevel;
  nextVersion: string | null;
  prereleaseCounter: number;
}

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const PACKAGE_NAME = '@cardstack/bxl';
const PACKAGE_DIR = 'packages/bxl';
const TAG_PREFIX = 'bxl-v';
const PRERELEASE_TAG = 'unstable';

const CONVENTIONAL_PREFIX = /^([a-z]+)(?:\([^)]+\))?(!?):\s*/;

const BUMP_BY_PREFIX = bumpByPrefix as Record<string, BumpLevel>;

/**
 * The paths whose contents reach the tarball, as `files` and the published
 * exports map define it, plus the two files that shape the artifact itself.
 * Everything else in the package — the test suites, the benchmarks, the
 * authoring examples, the lint rules, the development tsconfig — is real work
 * that changes nothing a consumer would install.
 */
const PUBLISHED_SURFACE: RegExp[] = [
  new RegExp(`^${PACKAGE_DIR}/src/`),
  new RegExp(`^${PACKAGE_DIR}/docs/`),
  new RegExp(`^${PACKAGE_DIR}/LICENSES/`),
  new RegExp(`^${PACKAGE_DIR}/(README|CHANGELOG|NOTICE)\\.md$`),
  new RegExp(`^${PACKAGE_DIR}/LICENSE$`),
  new RegExp(`^${PACKAGE_DIR}/package\\.json$`),
  new RegExp(`^${PACKAGE_DIR}/tsconfig(\\.build)?\\.json$`),
  new RegExp(`^${PACKAGE_DIR}/scripts/build\\.ts$`),
];

const BUMP_RANK: Record<BumpLevel, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

export function classifyBumpFromTitle(
  prTitle: string,
  prBody: string,
): BumpLevel {
  const match = prTitle.match(CONVENTIONAL_PREFIX);
  if (!match) {
    return 'none';
  }
  const [, prefix, bang] = match;
  if (bang === '!' || /^BREAKING CHANGE:/m.test(prBody)) {
    return 'major';
  }
  return BUMP_BY_PREFIX[prefix] ?? 'none';
}

export function touchesPublishedSurface(changedFiles: string[]): boolean {
  return changedFiles.some((file) =>
    PUBLISHED_SURFACE.some((pattern) => pattern.test(file)),
  );
}

function parse(version: string): semver.SemVer {
  const parsed = semver.parse(version);
  if (!parsed) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return parsed;
}

/** Apply a bump to the stable `major.minor.patch` of `version`. */
function applyBump(version: string, bump: BumpLevel): string {
  const { major, minor, patch } = parse(version);
  const base = `${major}.${minor}.${patch}`;
  return bump === 'none' ? base : semver.inc(base, bump)!;
}

function maxBump(a: BumpLevel, b: BumpLevel): BumpLevel {
  return BUMP_RANK[a] >= BUMP_RANK[b] ? a : b;
}

/**
 * Where this commit's bump lands, given the prereleases already stacked up
 * since the last stable release.
 *
 * A prerelease base is the accumulation of every bump since that stable one, so
 * it can't be bumped again from itself: three `fix:` merges in a row publish
 * `0.5.2-unstable.0`, `.1`, `.2`, not `0.5.2`, `0.5.3`, `0.5.4`. Bump the
 * *stable* base instead, by whichever is larger — how far the prereleases have
 * already moved, or what this commit asks for. A `feat:` after those three
 * fixes escalates 0.5.2 to 0.6.0; a fourth `fix:` leaves it at 0.5.2.
 */
function nextVersionFor(
  currentVersion: string,
  lastStableBase: string,
  bump: BumpLevel,
  prereleaseCounter: number,
): string {
  const current = parse(currentVersion);
  if (current.prerelease.length === 0) {
    return `${applyBump(currentVersion, bump)}-${PRERELEASE_TAG}.${prereleaseCounter}`;
  }
  const currentBase = `${current.major}.${current.minor}.${current.patch}`;
  const accumulated = semver.diff(lastStableBase, currentBase);
  const implied: BumpLevel =
    accumulated === 'major' ||
    accumulated === 'minor' ||
    accumulated === 'patch'
      ? accumulated
      : 'none';
  const base = applyBump(lastStableBase, maxBump(implied, bump));
  return `${base}-${PRERELEASE_TAG}.${prereleaseCounter}`;
}

export function computeRelease(
  input: ComputeReleaseInput,
): ComputeReleaseOutput {
  const bump = touchesPublishedSurface(input.changedFiles)
    ? classifyBumpFromTitle(input.prTitle, input.prBody)
    : 'none';
  return {
    bump,
    nextVersion:
      bump === 'none'
        ? null
        : nextVersionFor(
            input.currentVersion,
            input.lastStableBase,
            bump,
            input.prereleaseCounter,
          ),
    prereleaseCounter: input.prereleaseCounter,
  };
}

/**
 * The `-unstable.<n>` counters already published for `base`. Entries that
 * aren't versions are dropped rather than thrown on, and comparing the parsed
 * components keeps `0.3.20` distinct from `0.3.2`, which a prefix match would
 * conflate.
 */
export function unstableCounters(base: string, versions: unknown[]): number[] {
  const wanted = parse(base);
  const counters: number[] = [];
  for (const version of versions) {
    if (typeof version !== 'string') {
      continue;
    }
    const parsed = semver.parse(version);
    if (
      !parsed ||
      parsed.major !== wanted.major ||
      parsed.minor !== wanted.minor ||
      parsed.patch !== wanted.patch
    ) {
      continue;
    }
    // semver reads a numeric prerelease identifier as a number, so
    // `<base>-unstable.<n>` parses to `['unstable', <n>]`.
    const [tag, counter] = parsed.prerelease;
    if (tag === PRERELEASE_TAG && typeof counter === 'number') {
      counters.push(counter);
    }
  }
  return counters;
}

// --- the parts that touch the world ---

/**
 * Run git from the repository root. The workflow invokes this script from the
 * package directory, where git would resolve the `packages/bxl/` pathspec
 * relative to the cwd — a path that doesn't exist there, matching no files and
 * quietly reporting that nothing publishable changed.
 */
function git(...args: string[]): string {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function changedFilesInPush(): string[] {
  return git('diff', '--name-only', 'HEAD^', '--', `${PACKAGE_DIR}/`)
    .split('\n')
    .filter(Boolean);
}

/**
 * The stable release the current prerelease series builds on.
 *
 * Release tags are the record: a stable cut tags `bxl-v<major.minor.patch>`.
 * Before the first one there is nothing to read, so fall back to the manifest —
 * correct as long as it still holds a stable version, which it does until the
 * first prerelease publishes.
 */
function lastStableBase(currentVersion: string): string {
  const stable = git('tag', '--list', `${TAG_PREFIX}*`)
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.slice(TAG_PREFIX.length))
    .filter((version) => semver.valid(version) && !semver.prerelease(version))
    .sort(semver.compare);
  if (stable.length > 0) {
    return stable[stable.length - 1];
  }
  if (semver.prerelease(currentVersion)) {
    throw new Error(
      `No ${TAG_PREFIX}* stable tag exists and package.json is already at ` +
        `prerelease ${currentVersion}, so the stable base it builds on is ` +
        `unknowable. Tag the stable release this series started from.`,
    );
  }
  return currentVersion;
}

/**
 * The versions npm has, which is the authority on which prerelease counters are
 * taken: the workflow's manual publish path deliberately doesn't commit its
 * bump, so git history alone would miss counters that exist. A registry error
 * is left to fail the run — treating it as "nothing published" would restart
 * the counter at 0 and collide with a real version. An unpublished package is
 * the one exception, and it 404s distinguishably.
 */
export function publishedVersions(): unknown[] {
  let raw: string;
  try {
    raw = execFileSync('npm', ['view', PACKAGE_NAME, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer }).stderr ?? '');
    if (stderr.includes('E404')) {
      return [];
    }
    throw error;
  }
  // `npm view … versions --json` yields an array, or a bare string when exactly
  // one version is published.
  return raw ? [].concat(JSON.parse(raw)) : [];
}

function main(): void {
  const prTitle = process.env.PR_TITLE ?? '';
  const prBody = process.env.PR_BODY ?? '';
  const noop: ComputeReleaseOutput = {
    bump: 'none',
    nextVersion: null,
    prereleaseCounter: 0,
  };
  if (!prTitle) {
    // A direct push to main, with no PR to read a prefix from.
    process.stdout.write(JSON.stringify(noop) + '\n');
    return;
  }

  const currentVersion = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ).version;

  // Resolve the base with a placeholder counter, then take the first counter
  // free for that base on npm.
  const result = computeRelease({
    changedFiles: changedFilesInPush(),
    currentVersion,
    lastStableBase: lastStableBase(currentVersion),
    prBody,
    prereleaseCounter: 0,
    prTitle,
  });
  if (result.nextVersion) {
    const base = result.nextVersion.replace(
      new RegExp(`-${PRERELEASE_TAG}\\.\\d+$`),
      '',
    );
    const counters = unstableCounters(base, publishedVersions());
    result.prereleaseCounter = counters.length ? Math.max(...counters) + 1 : 0;
    result.nextVersion = `${base}-${PRERELEASE_TAG}.${result.prereleaseCounter}`;
  }

  process.stdout.write(JSON.stringify(result) + '\n');
}

if (import.meta.main) {
  main();
}
