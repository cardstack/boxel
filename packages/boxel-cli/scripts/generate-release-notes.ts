#!/usr/bin/env node
/**
 * Build the GitHub Release body (and a matching CHANGELOG.md fragment) for a
 * boxel-cli publish. Sources its bullet list from
 * `POST /repos/{owner}/{repo}/releases/generate-notes` so the content is the
 * same auto-generated grouping GitHub uses elsewhere — but we compose the
 * outer body ourselves to:
 *
 *   • call out npm and plugin versions in separate sub-sections (omitted when
 *     that surface didn't bump),
 *   • truncate to a safe size with a "Full diff" footer (GitHub's hard cap is
 *     125 KB; we target ~60 KB),
 *   • emit a dated CHANGELOG entry that mirrors the release body.
 *
 * Both the on-main (unstable) and manual-promotion (stable) workflows call
 * this script with the same shape; only PREV_TAG / NPM_DIST_TAG differ.
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

function fetchAutoNotes(inputs: Inputs): string {
  // gh CLI passes through to the REST endpoint that backs --generate-notes.
  // Using `gh api` (rather than `gh release create --generate-notes`) lets us
  // get the body without creating the release, so we can compose + truncate
  // before handing the final body to `gh release create --notes-file`.
  const args = [
    'api',
    `repos/${inputs.repo}/releases/generate-notes`,
    '-f',
    `tag_name=${inputs.newTag}`,
    '-f',
    `previous_tag_name=${inputs.prevTag}`,
    '-f',
    'target_commitish=main',
    '--jq',
    '.body',
  ];
  const out = execSync(`gh ${args.map(quoteShell).join(' ')}`, {
    stdio: ['ignore', 'pipe', 'inherit'],
  }).toString();
  return out.trim();
}

function quoteShell(arg: string): string {
  // Conservative single-quote escaping for the gh argv. The values we pass are
  // tag names + a fixed `target_commitish` literal, none of which legitimately
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
  const autoNotes = fetchAutoNotes(inputs);
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

if (require.main === module) {
  main();
}
