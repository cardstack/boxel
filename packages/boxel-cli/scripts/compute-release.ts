#!/usr/bin/env node
/**
 * Computes the next unstable npm version and plugin version for boxel-cli
 * based on the merged PR's title (conventional-commit prefix) and which
 * surfaces were touched (npm vs plugin). Emits JSON on stdout for the
 * GitHub Actions workflow to consume.
 *
 * Pure logic lives in `computeRelease()`. The I/O wrapper at the bottom
 * reads from env/git/disk so tests can exercise the pure function directly.
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

import bumpByPrefixJson from './release-prefixes.json';
import { lastStableTag } from './lib/tags';

export type BumpLevel = 'major' | 'minor' | 'patch' | 'none';

export interface ComputeReleaseInput {
  prTitle: string;
  prBody: string;
  changedFiles: string[];
  currentNpm: string;
  currentPlugin: string;
  prereleaseN: number;
  lastStableNpmBase: string;
}

export interface ComputeReleaseOutput {
  npmBump: BumpLevel;
  pluginBump: BumpLevel;
  nextNpm: string | null;
  nextPlugin: string | null;
  prereleaseN: number;
}

const CONVENTIONAL_PREFIX_RE = /^([a-z]+)(?:\([^)]+\))?(!?):\s*/;

const BUMP_BY_PREFIX = bumpByPrefixJson as Record<string, BumpLevel>;

const NPM_SURFACE_PATTERNS: RegExp[] = [
  /^packages\/boxel-cli\/src\//,
  /^packages\/boxel-cli\/api\.ts$/,
  /^packages\/boxel-cli\/scripts\/build\.ts$/,
];

const PLUGIN_SURFACE_PATTERNS: RegExp[] = [
  /^packages\/boxel-cli\/plugin\//,
  /^packages\/boxel-cli\/scripts\/build-plugin\.ts$/,
  /^packages\/boxel-cli\/scripts\/build-skills\.ts$/,
];

const PACKAGE_JSON_PATH = 'packages/boxel-cli/package.json';

export function classifyBumpFromTitle(
  prTitle: string,
  prBody: string,
): BumpLevel {
  const match = prTitle.match(CONVENTIONAL_PREFIX_RE);
  if (!match) {
    return 'none';
  }
  const prefix = match[1];
  const bang = match[2];
  const breakingFooter = /^BREAKING CHANGE:/m.test(prBody);
  if (bang === '!' || breakingFooter) {
    return 'major';
  }
  return BUMP_BY_PREFIX[prefix] ?? 'none';
}

function matchesAny(file: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(file));
}

export function detectSurfaces(changedFiles: string[]): {
  npmTouched: boolean;
  pluginTouched: boolean;
} {
  let npmTouched = false;
  let pluginTouched = false;
  for (const file of changedFiles) {
    if (matchesAny(file, NPM_SURFACE_PATTERNS)) {
      npmTouched = true;
    } else if (file === PACKAGE_JSON_PATH) {
      // package.json bumps the npm surface, but only if dependencies (or
      // anything other than "version") changed. Surface detection here is
      // approximate — without a diff we can't know which key moved. The
      // workflow guards the feedback loop separately via `[skip ci]` +
      // `if: github.actor != 'github-actions[bot]'`, so a false positive
      // here only matters if a human edits package.json with bumpable
      // changes (e.g. new dependency). That's the right behavior.
      npmTouched = true;
    }
    if (matchesAny(file, PLUGIN_SURFACE_PATTERNS)) {
      pluginTouched = true;
    }
  }
  return { npmTouched, pluginTouched };
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseSemver(version: string): ParsedVersion {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!m) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ?? null,
  };
}

function applyBump(baseVersion: string, bump: BumpLevel): string {
  const { major, minor, patch } = parseSemver(baseVersion);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'none':
      return `${major}.${minor}.${patch}`;
  }
}

const BUMP_RANK: Record<BumpLevel, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

function maxBump(a: BumpLevel, b: BumpLevel): BumpLevel {
  return BUMP_RANK[a] >= BUMP_RANK[b] ? a : b;
}

function impliedBumpBetween(stable: string, prereleaseBase: string): BumpLevel {
  const s = parseSemver(stable);
  const p = parseSemver(prereleaseBase);
  if (p.major > s.major) return 'major';
  if (p.minor > s.minor) return 'minor';
  if (p.patch > s.patch) return 'patch';
  return 'none';
}

function nextUnstableVersion(
  currentNpm: string,
  lastStableNpmBase: string,
  bump: BumpLevel,
  prereleaseN: number,
): string {
  const current = parseSemver(currentNpm);
  if (current.prerelease) {
    // Already on a prerelease base. Decide whether this commit's bump
    // escalates the base or stays.
    const currentBase = `${current.major}.${current.minor}.${current.patch}`;
    const implied = impliedBumpBetween(lastStableNpmBase, currentBase);
    const effective = maxBump(implied, bump);
    const newBase = applyBump(lastStableNpmBase, effective);
    return `${newBase}-unstable.${prereleaseN}`;
  }
  // Not on a prerelease — first unstable on top of stable.
  const newBase = applyBump(currentNpm, bump);
  return `${newBase}-unstable.${prereleaseN}`;
}

export function computeRelease(
  input: ComputeReleaseInput,
): ComputeReleaseOutput {
  const bumpFromCommit = classifyBumpFromTitle(input.prTitle, input.prBody);
  const { npmTouched, pluginTouched } = detectSurfaces(input.changedFiles);

  const npmBump: BumpLevel = npmTouched ? bumpFromCommit : 'none';
  const pluginBump: BumpLevel = pluginTouched ? bumpFromCommit : 'none';

  const nextNpm =
    npmBump === 'none'
      ? null
      : nextUnstableVersion(
          input.currentNpm,
          input.lastStableNpmBase,
          npmBump,
          input.prereleaseN,
        );

  const nextPlugin =
    pluginBump === 'none' ? null : applyBump(input.currentPlugin, pluginBump);

  return {
    npmBump,
    pluginBump,
    nextNpm,
    nextPlugin,
    prereleaseN: input.prereleaseN,
  };
}

// --- I/O wrapper ---

function repoRoot(): string {
  return execSync('git rev-parse --show-toplevel').toString().trim();
}

function changedFilesAgainstHead1(root: string): string[] {
  // Union PR-committed files (HEAD^..HEAD) with working-tree changes. The
  // on-main workflow regenerates plugin/skills/ before invoking this script,
  // and that regen lives in the working tree — invisible to HEAD^..HEAD.
  // Without the union, a `feat:` PR adding a new command in src/ would bump
  // npm but not plugin.json, leaving the marketplace cache key stale.
  //
  // We force cwd to the repo root because Git resolves pathspec relatively
  // and the workflow invokes this script from `packages/boxel-cli/`, where
  // the literal `packages/boxel-cli/` pathspec resolves to a non-existent
  // nested directory and matches nothing.
  const opts = { cwd: root };
  const committed = execSync(
    'git diff --name-only HEAD^ -- packages/boxel-cli/',
    opts,
  ).toString();
  const workingTree = execSync(
    'git diff --name-only -- packages/boxel-cli/',
    opts,
  ).toString();
  const set = new Set(
    [...committed.split('\n'), ...workingTree.split('\n')].filter(Boolean),
  );
  return [...set];
}

function readJsonVersion(path: string): string {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return json.version;
}

function npmUnstableCounters(base: string): number[] {
  // `npm view ... versions --json` yields an array, or a bare string when
  // exactly one version is published; `[].concat` normalizes both. Empty when
  // the package was never published (E404 → non-zero exit).
  let raw: string;
  try {
    raw = execSync('npm view @cardstack/boxel-cli versions --json', {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    return [];
  }
  if (!raw) return [];
  const versions: string[] = [].concat(JSON.parse(raw));
  const re = new RegExp(
    '^' + base.replace(/\./g, '\\.') + '-unstable\\.(\\d+)$',
  );
  return versions
    .map((v) => (v.match(re) || [])[1])
    .filter((x): x is string => x != null)
    .map(Number);
}

function main(): void {
  const prTitle = process.env.PR_TITLE ?? '';
  const prBody = process.env.PR_BODY ?? '';
  if (!prTitle) {
    // Direct push to main (no associated PR), or workflow misuse.
    // Emit a no-op result so the workflow can short-circuit cleanly.
    const noop: ComputeReleaseOutput = {
      npmBump: 'none',
      pluginBump: 'none',
      nextNpm: null,
      nextPlugin: null,
      prereleaseN: 0,
    };
    process.stdout.write(JSON.stringify(noop) + '\n');
    return;
  }

  const root = repoRoot();
  const currentNpm = readJsonVersion(resolve(root, PACKAGE_JSON_PATH));
  const currentPlugin = readJsonVersion(
    resolve(root, 'packages/boxel-cli/plugin/.claude-plugin/plugin.json'),
  );
  const stableBase = lastStableTag();
  const changedFiles = changedFilesAgainstHead1(root);

  // Resolve the bumped base with a placeholder counter, then pick the next
  // counter free for that base on npm. npm is the source of truth: the manual
  // publish path publishes counters this run's git history never sees, so a
  // git-commit count could collide with one of them.
  const result = computeRelease({
    prTitle,
    prBody,
    changedFiles,
    currentNpm,
    currentPlugin,
    prereleaseN: 0,
    lastStableNpmBase: stableBase,
  });
  if (result.nextNpm) {
    const base = result.nextNpm.replace(/-unstable\.\d+$/, '');
    const counters = npmUnstableCounters(base);
    const n = counters.length ? Math.max(...counters) + 1 : 0;
    result.nextNpm = `${base}-unstable.${n}`;
    result.prereleaseN = n;
  }

  process.stdout.write(JSON.stringify(result) + '\n');
}

// CJS guard: only run main() when invoked as a script, not when imported
// by the vitest test file. `require.main === module` is the standard idiom.
if (require.main === module) {
  main();
}
