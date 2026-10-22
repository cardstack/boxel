#!/usr/bin/env node
/**
 * Decide what version, if any, a merge to main publishes as `glimmer-motion`
 * and `@cardstack/choreo`.
 *
 * The two packages release in lockstep: one version, one bump, one tag. choreo
 * peer-depends on the exact glimmer-motion version, so a release of either is
 * a release of both — a `fix:` that touches only glimmer-motion still publishes
 * a choreo naming the new glimmer-motion.
 *
 * Two inputs drive it. The merged PR's title carries a conventional-commit
 * prefix, which maps to a bump level through `release-prefixes.json` — the same
 * file the pre-merge title check reads, so the gate and the classifier can't
 * disagree about what a valid prefix is. The push's changed files say whether
 * either *published* artifact moved at all: a package holds more than it
 * ships, and a `fix:` that only touched a test suite has nothing to release.
 * One of those files sits outside both packages — the workspace catalog, which
 * resolves their dependency specifiers into the published manifests.
 *
 * Publishes are prereleases — `<base>-unstable.<n>` under the `unstable`
 * dist-tag. Cutting a stable release from one is a deliberate, separate act
 * (the publish workflow's `promote` path).
 *
 * Emits JSON on stdout for the workflow to read. `computeRelease()` is pure; the
 * wrapper at the bottom is what touches git, npm, and disk, so the suite in
 * `release.test.ts` can exercise the decisions directly.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import semver from 'semver';

import bumpByPrefix from './release-prefixes.json' with { type: 'json' };

export type BumpLevel = 'major' | 'minor' | 'patch' | 'none';

export interface ReleasedPackage {
  // Repository-relative directory.
  dir: string;
  name: string;
  // Repository-relative paths, under `dir`, whose contents reach the tarball or
  // shape what the build puts there.
  publishedSurface: RegExp[];
}

export interface ComputeReleaseInput {
  // Whether the push moved a catalog entry either package depends on. The
  // catalog lives outside both packages but resolves into the published
  // manifests, so it counts as published surface on its own terms.
  catalogAffectsDependencies: boolean;
  changedFiles: string[];
  currentVersion: string;
  lastStableBase: string;
  prBody: string;
  prTitle: string;
  prereleaseCounter: number;
}

export interface ComputeReleaseOutput {
  // A stable release tag the workflow must create alongside this prerelease,
  // when nothing yet records the base the series builds on. Null once one does.
  bootstrapStableTag: string | null;
  bump: BumpLevel;
  nextVersion: string | null;
  // The packages this version publishes, in publish order. Always all of them
  // when `nextVersion` is set; the lockstep never publishes one alone.
  packages: string[];
  prereleaseCounter: number;
}

export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
export const TAG_PREFIX = 'glimmer-motion-choreo-v';
const PRERELEASE_TAG = 'unstable';
// The workspace catalog, which resolves both packages' `catalog:` dependency
// specifiers at pack time — so it shapes the published manifests from outside
// the package directories.
const CATALOG_FILE = 'pnpm-workspace.yaml';

const CONVENTIONAL_PREFIX = /^([a-z]+)(?:\([^)]+\))?(!?):\s*/;

const BUMP_BY_PREFIX = bumpByPrefix as Record<string, BumpLevel>;

function surface(dir: string, paths: string[]): RegExp[] {
  return paths.map(
    (path) =>
      new RegExp(
        `^${escapeForRegExp(`${dir}/${path}`)}${path.endsWith('/') ? '' : '$'}`,
      ),
  );
}

/**
 * The released packages, in publish order. glimmer-motion goes first: choreo's
 * declarations build resolves it through its built output, and the choreo a
 * consumer installs names a glimmer-motion that has to exist already.
 *
 * Each published surface is the package's `files`, the files npm always packs
 * (`package.json`, `README.md`, `LICENSE`), and the inputs to its rollup and
 * declarations builds. Everything else — the test suites and harness config,
 * the lint config, the development-only type shims, the release scripts
 * themselves — is real work that changes nothing a consumer installs.
 */
export const PACKAGES: ReleasedPackage[] = [
  {
    name: 'glimmer-motion',
    dir: 'packages/glimmer-motion',
    publishedSurface: surface('packages/glimmer-motion', [
      'src/',
      'package.json',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
      'VENDORED.md',
      'addon-main.cjs',
      'rollup.config.mjs',
      'babel.publish.config.json',
      'tsconfig.json',
      'tsconfig.declarations.json',
      'scripts/fix-declarations.mjs',
      // rollup.config.mjs reads it to inline framer-motion's internals.
      'scripts/source-resolution.mjs',
    ]),
  },
  {
    name: '@cardstack/choreo',
    dir: 'packages/choreo',
    publishedSurface: surface('packages/choreo', [
      'src/',
      'package.json',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
      'addon-main.cjs',
      'rollup.config.mjs',
      // rollup's babel plugin loads the package's default config file.
      'babel.config.json',
      'tsconfig.json',
      'tsconfig.declarations.json',
      'scripts/fix-declarations.mjs',
    ]),
  },
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
    PACKAGES.some((pkg) =>
      pkg.publishedSurface.some((pattern) => pattern.test(file)),
    ),
  );
}

/**
 * The one version every released package carries.
 *
 * The lockstep is what makes choreo's exact peer dependency on glimmer-motion
 * satisfiable, so manifests that disagree are a broken state to repair by hand,
 * not something a release should pick a side in.
 */
export function lockstepVersion(versions: Record<string, string>): string {
  const distinct = [...new Set(Object.values(versions))];
  if (distinct.length !== 1) {
    throw new Error(
      `The lockstep packages carry different versions (${Object.entries(
        versions,
      )
        .map(([name, version]) => `${name}@${version}`)
        .join(', ')}); set them to one version before releasing.`,
    );
  }
  return distinct[0];
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

export interface StableBase {
  base: string;
  // Whether a release tag records this base. When nothing does, the workflow
  // creates one — see `bootstrapStableTag` on the output.
  tagged: boolean;
}

/**
 * The stable release the current prerelease series builds on, given every
 * `glimmer-motion-choreo-v*` tag that exists.
 *
 * Release tags are the record: a stable cut tags
 * `glimmer-motion-choreo-v<major.minor.patch>`. Before the first one there is
 * nothing to read, so fall back to the manifests, which still hold a stable
 * version until the first prerelease publishes — and report that no tag records
 * it, because from the next merge onward the manifests hold a prerelease and
 * this information would be gone. A prerelease manifest with no stable tag is
 * that lost state, and nothing can recover the base from it, so it stops the
 * release rather than guessing.
 */
export function resolveStableBase(
  tags: string[],
  currentVersion: string,
): StableBase {
  const stable = tags
    .filter((tag) => tag.startsWith(TAG_PREFIX))
    .map((tag) => tag.slice(TAG_PREFIX.length))
    .filter((version) => semver.valid(version) && !semver.prerelease(version))
    .sort(semver.compare);
  if (stable.length > 0) {
    return { base: stable[stable.length - 1], tagged: true };
  }
  if (semver.prerelease(currentVersion)) {
    throw new Error(
      `No ${TAG_PREFIX}* stable tag exists and the manifests are already at ` +
        `prerelease ${currentVersion}, so the stable base it builds on is ` +
        `unknowable. Tag the stable release this series started from.`,
    );
  }
  return { base: currentVersion, tagged: false };
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
  const shipped =
    touchesPublishedSurface(input.changedFiles) ||
    input.catalogAffectsDependencies;
  const bump = shipped
    ? classifyBumpFromTitle(input.prTitle, input.prBody)
    : 'none';
  return {
    bootstrapStableTag: null,
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
    packages: bump === 'none' ? [] : PACKAGES.map((pkg) => pkg.name),
    prereleaseCounter: input.prereleaseCounter,
  };
}

/**
 * The version a manual "republish main as it stands" should take.
 *
 * The base is the manifests' version with any prerelease suffix dropped —
 * except when that version is itself already released, which is main's state
 * directly after a promotion. Reusing it would publish `0.6.0-unstable.4`
 * *after* `0.6.0`, and a prerelease sorts below the release it names, so the
 * `unstable` dist-tag would point at something semver considers older than
 * `latest`. Move to the next patch instead.
 *
 * `published` holds every version either package has on npm: a version is
 * taken once one of them holds it, since the lockstep publishes both under it.
 */
export function nextManualUnstableVersion(
  manifestVersion: string,
  published: unknown[],
): string {
  const stripped = manifestVersion.replace(
    new RegExp(`-${PRERELEASE_TAG}\\.\\d+$`),
    '',
  );
  const released = published.some(
    (version) => version === stripped && !semver.prerelease(stripped),
  );
  const base = released ? applyBump(stripped, 'patch') : stripped;
  return `${base}-${PRERELEASE_TAG}.${nextCounter(base, published)}`;
}

/** The first `-unstable.<n>` counter for `base` that no published version holds. */
export function nextCounter(base: string, versions: unknown[]): number {
  const counters = unstableCounters(base, versions);
  return counters.length ? Math.max(...counters) + 1 : 0;
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

/**
 * Does a unified diff of the catalog add or remove an entry for one of `names`?
 *
 * Catalog entries are one `name: range` mapping per line, so an added or removed
 * line whose key is one of the packages' dependencies is the signal. A name
 * that also appears elsewhere in the file can only cause an extra release, never
 * a missed one.
 */
export function diffTouchesCatalogEntries(
  diff: string,
  names: string[],
): boolean {
  if (names.length === 0) {
    return false;
  }
  const entry = new RegExp(
    `^[+-]\\s*['"]?(${names.map(escapeForRegExp).join('|')})['"]?\\s*:`,
  );
  return diff
    .split('\n')
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
    .some((line) => entry.test(line));
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- the parts that touch the world ---

export function readManifest(pkg: ReleasedPackage): {
  dependencies?: Record<string, string>;
  version: string;
} {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, pkg.dir, 'package.json'), 'utf8'),
  );
}

/** The shared version, read from every released package's manifest. */
export function currentLockstepVersion(): string {
  return lockstepVersion(
    Object.fromEntries(
      PACKAGES.map((pkg) => [pkg.name, readManifest(pkg).version]),
    ),
  );
}

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
}

/**
 * The two commits bounding what the push introduced.
 *
 * Deliberately not the checked-out `HEAD`. The workflow checks out `main`, whose
 * tip may have moved past the merge that triggered this run — a release
 * workflow's own commit lands there, and a run that waited its turn in the
 * concurrency group sees it. Diffing from `HEAD` would then describe someone
 * else's commit and conclude these packages were untouched, silently skipping a
 * release. `PUSH_BEFORE` (the branch tip before the push) and `PUSH_SHA` (after)
 * pin the range to this run's own event, whatever main has done since.
 *
 * `PUSH_BEFORE` is absent when a branch is created and can name a commit that a
 * force-push has since orphaned, so it is used only once resolved; the pushed
 * commit's first parent stands in otherwise. With neither — a local run — the
 * checkout's own last commit is the best available guess.
 */
function pushedRange(): [string, string] {
  const before = process.env.PUSH_BEFORE ?? '';
  const sha = process.env.PUSH_SHA ?? '';
  if (!sha) {
    return ['HEAD^', 'HEAD'];
  }
  if (before && !/^0+$/.test(before) && resolvesToCommit(before)) {
    return [before, sha];
  }
  return [`${sha}^`, sha];
}

function resolvesToCommit(ref: string): boolean {
  try {
    // Silenced: an absent object is this function's answer, not a failure worth
    // printing into the workflow log as though something went wrong.
    execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function changedFilesInPush([from, to]: [string, string]): string[] {
  return git(
    'diff',
    '--name-only',
    from,
    to,
    '--',
    ...PACKAGES.map((pkg) => `${pkg.dir}/`),
    CATALOG_FILE,
  )
    .split('\n')
    .filter(Boolean);
}

/**
 * Whether the push moved a catalog entry either package depends on.
 *
 * Dependencies are declared as `catalog:` and resolved to the catalog's real
 * ranges when a tarball is packed, so a catalog edit changes a published
 * manifest without touching a file under the package. Only these packages' own
 * entries count — the catalog holds a few hundred, and someone else's bump
 * changes nothing about what they ship.
 */
function catalogAffectsDependencies(range: [string, string]): boolean {
  const [from, to] = range;
  const diff = git('diff', from, to, '--', CATALOG_FILE);
  if (!diff) {
    return false;
  }
  const names = new Set(
    PACKAGES.flatMap((pkg) =>
      Object.keys(readManifest(pkg).dependencies ?? {}),
    ),
  );
  return diffTouchesCatalogEntries(diff, [...names]);
}

function stableBase(currentVersion: string): StableBase {
  return resolveStableBase(
    git('tag', '--list', `${TAG_PREFIX}*`).split('\n').filter(Boolean),
    currentVersion,
  );
}

/**
 * Every version any released package has on npm, which is the authority on
 * which prerelease counters are taken: the workflow's manual publish path
 * deliberately doesn't commit its bump, so git history alone would miss
 * counters that exist. A version one package holds is taken for both, since
 * the lockstep publishes both under it. A registry error is left to fail the
 * run — treating it as "nothing published" would restart the counter at 0 and
 * collide with a real version. An unpublished package is the one exception,
 * and it 404s distinguishably.
 */
export function publishedVersions(): unknown[] {
  return PACKAGES.flatMap((pkg) => publishedVersionsOf(pkg.name));
}

function publishedVersionsOf(name: string): unknown[] {
  let raw: string;
  try {
    raw = execFileSync('npm', ['view', name, 'versions', '--json'], {
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
    bootstrapStableTag: null,
    bump: 'none',
    nextVersion: null,
    packages: [],
    prereleaseCounter: 0,
  };
  if (!prTitle) {
    // A direct push to main, with no PR to read a prefix from.
    process.stdout.write(JSON.stringify(noop) + '\n');
    return;
  }

  const currentVersion = currentLockstepVersion();
  const range = pushedRange();
  const base = stableBase(currentVersion);

  // Resolve the version with a placeholder counter, then take the first counter
  // free for that base on npm.
  const result = computeRelease({
    catalogAffectsDependencies: catalogAffectsDependencies(range),
    changedFiles: changedFilesInPush(range),
    currentVersion,
    lastStableBase: base.base,
    prBody,
    prereleaseCounter: 0,
    prTitle,
  });
  if (result.nextVersion) {
    const bumped = result.nextVersion.replace(
      new RegExp(`-${PRERELEASE_TAG}\\.\\d+$`),
      '',
    );
    result.prereleaseCounter = nextCounter(bumped, publishedVersions());
    result.nextVersion = `${bumped}-${PRERELEASE_TAG}.${result.prereleaseCounter}`;
    // Nothing records the base this prerelease series builds on, and after this
    // commit the manifests no longer hold it either. Ask the workflow to tag it
    // so the next merge can still resolve it.
    if (!base.tagged) {
      result.bootstrapStableTag = `${TAG_PREFIX}${base.base}`;
    }
  }

  process.stdout.write(JSON.stringify(result) + '\n');
}

if (import.meta.main) {
  main();
}
