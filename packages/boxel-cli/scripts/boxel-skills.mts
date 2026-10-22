/**
 * Local copy of the boxel-skills release this repo pins.
 *
 * End users never see this copy: the repo-root marketplace lists
 * cardstack/boxel-skills as its own `boxel-skills` plugin at a pinned tag, and
 * the `boxel-cli` plugin declares it as a dependency, so Claude Code installs
 * the skills straight from that repository. The monorepo's own readers of the
 * skills — the Software Factory's skill loader and the suites that check
 * claims the skills make — read the same tag from a gitignored clone that
 * this module maintains.
 *
 * The pin is the `ref` of the `boxel-skills` entry in
 * `.claude-plugin/marketplace.json`. Reading it from there keeps one pin for
 * end users and for the monorepo; `.agents/plugins/marketplace.json` (Codex)
 * repeats it, and boxel-skills.test.ts keeps the two equal.
 *
 * Set BOXEL_SKILLS_REPO=/path/to/boxel-skills to read an unreleased checkout
 * instead of the pinned tag.
 *
 * Run `pnpm fetch:skills` from `packages/boxel-cli/` to populate the clone.
 * Node builtins only: the Software Factory's preflight imports this module on
 * a checkout where nothing has been built yet.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'fs';
import { join, resolve } from 'path';

const BOXEL_SKILLS_REPO_URL = 'https://github.com/cardstack/boxel-skills.git';
const BOXEL_SKILLS_PLUGIN_NAME = 'boxel-skills';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const CACHE_DIR = resolve(PACKAGE_ROOT, '.boxel-skills-cache');

export const CLAUDE_MARKETPLACE_PATH = join(
  REPO_ROOT,
  '.claude-plugin',
  'marketplace.json',
);
export const CODEX_MARKETPLACE_PATH = join(
  REPO_ROOT,
  '.agents',
  'plugins',
  'marketplace.json',
);

interface MarketplaceEntry {
  name?: unknown;
  source?: unknown;
}

/**
 * The `ref` of the `boxel-skills` entry in a marketplace file. Both the
 * Claude Code and the Codex marketplace give that entry an object source
 * carrying a `ref`.
 */
export function readBoxelSkillsRef(marketplacePath: string): string {
  let marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8')) as {
    plugins?: MarketplaceEntry[];
  };
  let entry = marketplace.plugins?.find(
    (plugin) => plugin.name === BOXEL_SKILLS_PLUGIN_NAME,
  );
  let source = entry?.source as { ref?: unknown } | undefined;
  if (typeof source?.ref !== 'string' || source.ref === '') {
    throw new Error(
      `${marketplacePath} has no "${BOXEL_SKILLS_PLUGIN_NAME}" plugin entry with a source "ref".`,
    );
  }
  return source.ref;
}

/** The boxel-skills release tag this repo pins. */
export function boxelSkillsPin(): string {
  return readBoxelSkillsRef(CLAUDE_MARKETPLACE_PATH);
}

/**
 * Root of the boxel-skills checkout the monorepo reads: the
 * BOXEL_SKILLS_REPO override when set, otherwise the clone of the pinned tag.
 * The directory may not exist yet; `ensureBoxelSkills()` creates it.
 */
export function boxelSkillsRoot(): string {
  return process.env.BOXEL_SKILLS_REPO || join(CACHE_DIR, boxelSkillsPin());
}

/** The `skills/` directory of that checkout. */
export function boxelSkillsDir(): string {
  return join(boxelSkillsRoot(), 'skills');
}

/** Whether the checkout `boxelSkillsDir()` names is on disk. */
export function boxelSkillsPresent(): boolean {
  return existsSync(boxelSkillsDir());
}

/**
 * Make `boxelSkillsDir()` exist, cloning the pinned tag when it is missing,
 * and return it. Clones into a temporary directory first, so an interrupted
 * clone never leaves a directory that looks complete.
 */
export function ensureBoxelSkills(): string {
  let dir = boxelSkillsDir();
  if (existsSync(dir)) {
    return dir;
  }
  let override = process.env.BOXEL_SKILLS_REPO;
  if (override) {
    throw new Error(
      `BOXEL_SKILLS_REPO is set to "${override}", but ${dir} does not exist.`,
    );
  }

  let pin = boxelSkillsPin();
  let target = boxelSkillsRoot();
  let partial = `${target}.partial`;
  mkdirSync(CACHE_DIR, { recursive: true });
  rmSync(partial, { recursive: true, force: true });
  console.log(`Cloning boxel-skills@${pin} into ${target} ...`);
  execFileSync(
    'git',
    [
      '-c',
      'advice.detachedHead=false',
      'clone',
      '--quiet',
      '--depth',
      '1',
      '--branch',
      pin,
      BOXEL_SKILLS_REPO_URL,
      partial,
    ],
    { stdio: 'inherit' },
  );
  renameSync(partial, target);
  return dir;
}

// Run only when invoked directly, not when imported.
if (import.meta.main) {
  try {
    console.log(ensureBoxelSkills());
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
