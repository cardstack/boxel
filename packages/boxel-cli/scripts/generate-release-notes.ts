#!/usr/bin/env node
/**
 * Build the GitHub Release body (and a matching CHANGELOG.md fragment) for a
 * boxel-cli publish. Sources its bullet list from path-filtered local git
 * history (only commits that touched `packages/boxel-cli/`), then resolves
 * each commit to its PR via `gh api` so the bullets carry the same
 * `<title> by @<user> in <PR URL>` shape GitHub's auto-notes use. We compose
 * the outer body ourselves to:
 *
 *   • call out npm and plugin versions in separate sub-sections (omitted when
 *     that surface didn't bump),
 *   • truncate to a safe size with a "Full diff" footer (GitHub's hard cap is
 *     125 KB; we target ~60 KB),
 *   • emit a dated CHANGELOG entry that mirrors the release body.
 *
 * Both the unstable per-merge and stable promotion jobs call this script with
 * the same shape; only PREV_TAG / NPM_DIST_TAG differ.
 *
 * Inputs (all via env):
 *   PREV_TAG              e.g. boxel-cli-v0.1.5-unstable.6 (required)
 *   NEW_TAG               e.g. boxel-cli-v0.1.5-unstable.7 (required)
 *   NEXT_NPM              "0.1.5-unstable.7" or "" (omit npm section when empty)
 *   NEXT_PLUGIN           "0.1.5"            or "" (omit plugin section when empty)
 *   NPM_DIST_TAG          "unstable" | "latest" (required when NEXT_NPM set)
 *   REPO                  "cardstack/boxel"   (required)
 *   MAX_BYTES             default 60000
 *   RELEASE_BODY_FILE     write target for the GitHub Release body (required)
 *   CHANGELOG_FRAGMENT_FILE  write target for the CHANGELOG entry (required)
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const DEFAULT_MAX_BYTES = 60000;

export interface Inputs {
  prevTag: string;
  newTag: string;
  nextNpm: string;
  nextPlugin: string;
  npmDistTag: string;
  repo: string;
  maxBytes: number;
  releaseBodyFile: string;
  changelogFragmentFile: string;
}

function readInputs(): Inputs {
  const required = (name: string): string => {
    const v = process.env[name];
    if (!v) {
      throw new Error(`Missing required env var: ${name}`);
    }
    return v;
  };
  const maxBytesRaw = process.env.MAX_BYTES;
  const maxBytes = maxBytesRaw ? parseInt(maxBytesRaw, 10) : DEFAULT_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes < 200) {
    throw new Error(`MAX_BYTES must be a number >= 200; got ${maxBytesRaw}`);
  }
  return {
    prevTag: required('PREV_TAG'),
    newTag: required('NEW_TAG'),
    nextNpm: process.env.NEXT_NPM ?? '',
    nextPlugin: process.env.NEXT_PLUGIN ?? '',
    npmDistTag: process.env.NPM_DIST_TAG ?? '',
    repo: required('REPO'),
    maxBytes,
    releaseBodyFile: required('RELEASE_BODY_FILE'),
    changelogFragmentFile: required('CHANGELOG_FRAGMENT_FILE'),
  };
}

/**
 * Dependencies that `buildFilteredNotes` needs to talk to the outside world.
 * Tests substitute these with deterministic stubs so the unit tests don't
 * shell out to git or gh.
 */
export interface Deps {
  /** Run `git log <prev>..HEAD --pretty=…%H%x09%an%x09%s -- packages/boxel-cli/`. */
  gitLogBoxelCli(prevTag: string): string;
  /** Run `gh api repos/<repo>/commits/<sha>/pulls --jq '.[0]'`. Returns "" if no PR. */
  ghPrForCommit(repo: string, sha: string): string;
}

const BOT_AUTHOR = 'github-actions[bot]';
const BOXEL_CLI_PATH = 'packages/boxel-cli/';

function repoRoot(): string {
  return execSync('git rev-parse --show-toplevel').toString().trim();
}

const realDeps: Deps = {
  gitLogBoxelCli(prevTag) {
    // %x09 = TAB. Subject can contain anything, so it goes last.
    // cwd is pinned to the repo root because the path filter is interpreted
    // relative to the process cwd, and the workflow invokes this script from
    // `packages/boxel-cli/` — without the cwd override the filter would
    // resolve to `packages/boxel-cli/packages/boxel-cli/` (nothing).
    return execSync(
      `git log ${quoteShell(prevTag)}..HEAD --pretty=%H%x09%an%x09%s -- ${BOXEL_CLI_PATH}`,
      { stdio: ['ignore', 'pipe', 'inherit'], cwd: repoRoot() },
    ).toString();
  },
  ghPrForCommit(repo, sha) {
    const args = [
      'api',
      `repos/${repo}/commits/${sha}/pulls`,
      '--jq',
      '.[0] // empty',
    ];
    return execSync(`gh ${args.map(quoteShell).join(' ')}`, {
      stdio: ['ignore', 'pipe', 'inherit'],
    }).toString();
  },
};

interface PrInfo {
  number: number;
  title: string;
  htmlUrl: string;
  login: string;
}

function parsePrJson(raw: string): PrInfo | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const j = JSON.parse(trimmed);
    if (!j || typeof j.number !== 'number') return null;
    return {
      number: j.number,
      title: String(j.title ?? ''),
      htmlUrl: String(j.html_url ?? ''),
      login: String(j.user?.login ?? ''),
    };
  } catch {
    return null;
  }
}

export function buildFilteredNotes(
  inputs: Inputs,
  deps: Deps = realDeps,
): string {
  const log = deps.gitLogBoxelCli(inputs.prevTag).trim();
  const seenPrs = new Set<number>();
  const bullets: string[] = [];

  if (log) {
    for (const line of log.split('\n')) {
      const [sha, author, subject] = line.split('\t');
      if (!sha) continue;
      if (author === BOT_AUTHOR) continue;
      const prRaw = deps.ghPrForCommit(inputs.repo, sha);
      const pr = parsePrJson(prRaw);
      if (pr) {
        if (seenPrs.has(pr.number)) continue;
        seenPrs.add(pr.number);
        const byLine = pr.login ? ` by @${pr.login}` : '';
        bullets.push(`* ${pr.title}${byLine} in ${pr.htmlUrl}`);
      } else {
        // Direct push to main, no associated PR.
        bullets.push(`* ${subject ?? ''} (${sha.slice(0, 7)})`);
      }
    }
  }

  if (bullets.length === 0) {
    return '';
  }

  const compareUrl = `https://github.com/${inputs.repo}/compare/${inputs.prevTag}...${inputs.newTag}`;
  return bullets.join('\n') + `\n\n**Full Changelog**: ${compareUrl}`;
}

function quoteShell(arg: string): string {
  // Conservative single-quote escaping for argv values. The values we pass
  // are tag names, commit SHAs, and repo slugs, none of which legitimately
  // contain single quotes, so this never produces surprising output.
  if (/^[A-Za-z0-9_=./:-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function composeReleaseBody(inputs: Inputs, autoNotes: string): string {
  const sections: string[] = [];

  if (inputs.nextNpm) {
    const distLabel = inputs.npmDistTag
      ? ` (npm \`${inputs.npmDistTag}\`)`
      : '';
    const npmUrl = `https://www.npmjs.com/package/@cardstack/boxel-cli/v/${inputs.nextNpm}`;
    sections.push(
      `## @cardstack/boxel-cli v${inputs.nextNpm}${distLabel}\n${npmUrl}`,
    );
  }

  if (inputs.nextPlugin) {
    sections.push(
      `## boxel-cli plugin v${inputs.nextPlugin}\nMarketplace plugin version bumped in this release.`,
    );
  }

  const changes = autoNotes
    ? `## Changes\n\n${autoNotes}`
    : `## Changes\n\n_No PR-derived notes available between \`${inputs.prevTag}\` and \`${inputs.newTag}\`._`;
  sections.push(changes);

  const body = sections.join('\n\n');
  return truncate(body, inputs);
}

function truncate(body: string, inputs: Inputs): string {
  if (Buffer.byteLength(body, 'utf8') <= inputs.maxBytes) {
    return body;
  }
  const compareUrl = `https://github.com/${inputs.repo}/compare/${inputs.prevTag}...${inputs.newTag}`;
  const footer = `\n\n_…truncated. Full diff: ${compareUrl}_`;
  const footerBytes = Buffer.byteLength(footer, 'utf8');
  const budget = inputs.maxBytes - footerBytes;
  // Slice on character boundary, then re-check bytes (UTF-8 multibyte chars
  // could push us over even after a character-count slice).
  let truncated = body;
  while (Buffer.byteLength(truncated, 'utf8') > budget) {
    truncated = truncated.slice(0, Math.floor(truncated.length * 0.95));
  }
  return truncated + footer;
}

export function composeChangelogFragment(
  inputs: Inputs,
  releaseBody: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const versionParts: string[] = [];
  if (inputs.nextNpm) versionParts.push(`npm v${inputs.nextNpm}`);
  if (inputs.nextPlugin) versionParts.push(`plugin v${inputs.nextPlugin}`);
  const versionLine =
    versionParts.length > 0 ? versionParts.join(' / ') : inputs.newTag;
  const releaseUrl = `https://github.com/${inputs.repo}/releases/tag/${inputs.newTag}`;
  return [
    `## ${today} — ${versionLine}`,
    `Release: ${releaseUrl}`,
    '',
    releaseBody,
  ].join('\n');
}

function main(): void {
  const inputs = readInputs();
  const autoNotes = buildFilteredNotes(inputs);
  const body = composeReleaseBody(inputs, autoNotes);
  const fragment = composeChangelogFragment(inputs, body);
  writeFileSync(inputs.releaseBodyFile, body + '\n', 'utf8');
  writeFileSync(inputs.changelogFragmentFile, fragment + '\n', 'utf8');
  // Echo a short summary so the workflow log shows what we built.
  const bytes = Buffer.byteLength(body, 'utf8');
  process.stdout.write(
    `Release body: ${bytes} bytes -> ${inputs.releaseBodyFile}\n` +
      `Changelog fragment -> ${inputs.changelogFragmentFile}\n`,
  );
}

if (import.meta.main) {
  main();
}
