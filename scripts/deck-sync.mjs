#!/usr/bin/env node
/* eslint-env node */

// packages/deck is VENDORED. Fixes go to the Deck repo first, then sync.
//
// The whole value of keeping Deck's algorithms in one place evaporates the
// first time someone patches packages/deck/src here at 2am and the two
// copies drift. This script makes that mechanical rather than a matter of
// discipline: `check` recomputes a content digest of the vendored tree and
// compares it to the one recorded in packages/deck/DECK_SOURCE.
//
//   check   recompute and compare (CI; no Deck checkout needed)
//   pull    re-copy from a Deck checkout, then stamp
//   stamp   rewrite DECK_SOURCE from the current tree + an explicit --sha
//
// The digest is tree-hash-v1, Deck's own identity algorithm: sha256 of a
// `shasum -a 256`-compatible manifest (`<hex><space><space><path>`, one
// line per file, sorted by path in UTF-8 byte order). It is reimplemented
// here in a dozen lines rather than imported from the vendored tree on
// purpose — a checker that imports the code it is checking cannot report
// that the code changed, and this way `check` still works when the vendored
// tree is broken enough not to import.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECK = join(REPO, 'packages', 'deck');
const STAMP = join(DECK, 'DECK_SOURCE');
// Only the directories copied verbatim. package.json, tsconfig.json and
// DECK_SOURCE itself are Boxel-side files and are expected to differ.
const VENDORED = ['src', 'tests'];

function fail(message) {
  console.error(`deck-sync: ${message}`);
  process.exit(1);
}

async function walk(dir, base = dir, out = []) {
  for (let entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.DS_Store') continue;
    let full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else out.push(relative(base, full));
  }
  return out;
}

// tree-hash-v1 over the vendored directories, rooted at packages/deck so
// paths read `src/resolve.ts`.
async function computeTreeHash(root) {
  let entries = [];
  for (let sub of VENDORED) {
    for (let path of await walk(join(root, sub))) {
      entries.push({
        // Paths are hashed as UTF-8 bytes, so encoding is part of the
        // algorithm: NFC, forward slashes on every platform.
        path: `${sub}/${path}`.split('\\').join('/').normalize('NFC'),
        sha256: createHash('sha256')
          .update(await readFile(join(root, sub, path)))
          .digest('hex'),
      });
    }
  }
  entries.sort((a, b) =>
    Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')),
  );
  let manifest = entries.map((e) => `${e.sha256}  ${e.path}\n`).join('');
  return {
    treeHash: createHash('sha256').update(manifest, 'utf8').digest('hex'),
    fileCount: entries.length,
  };
}

async function readStamp() {
  let text;
  try {
    text = await readFile(STAMP, 'utf8');
  } catch {
    fail(
      `no ${relative(REPO, STAMP)} — run: node scripts/deck-sync.mjs pull ~/Projects/deck`,
    );
  }
  let field = (name) =>
    (text.match(new RegExp(`^${name}:\\s*(\\S+)`, 'm')) ?? [])[1];
  return { sha: field('deck-commit'), treeHash: field('tree-hash') };
}

async function writeStamp(sha, subject, date) {
  if (!sha) fail('a stamp needs the Deck commit it came from');
  let { treeHash, fileCount } = await computeTreeHash(DECK);
  await writeFile(
    STAMP,
    [
      '# Provenance for packages/deck — DO NOT EDIT packages/deck/src or tests here.',
      '#',
      '# This directory is vendored verbatim from the Deck repo. Fixes land in',
      '# Deck first (with a test there), then come back via:',
      '#',
      '#     node scripts/deck-sync.mjs pull ~/Projects/deck',
      '#',
      '# CI runs `node scripts/deck-sync.mjs check`, which recomputes the',
      '# tree-hash below and fails if this tree was edited in place.',
      '',
      'source: https://github.com/cardstack/deck',
      `deck-commit: ${sha}`,
      ...(subject ? [`deck-subject: ${subject}`] : []),
      ...(date ? [`deck-date: ${date}`] : []),
      `vendored: ${VENDORED.join(' ')}`,
      `file-count: ${fileCount}`,
      'tree-hash-spec: tree-hash-v1',
      `tree-hash: ${treeHash}`,
      '',
    ].join('\n'),
  );
  console.log(
    `deck-sync: stamped Deck ${sha.slice(0, 7)} ` +
      `(${fileCount} files, tree-hash ${treeHash.slice(0, 12)})`,
  );
}

async function check() {
  let stamp = await readStamp();
  if (!stamp.treeHash) fail('DECK_SOURCE has no tree-hash field');
  let actual = await computeTreeHash(DECK);
  if (actual.treeHash === stamp.treeHash) {
    console.log(
      `deck-sync: packages/deck matches Deck ${(stamp.sha ?? 'unknown').slice(0, 7)} ` +
        `(${actual.fileCount} files, tree-hash ${actual.treeHash.slice(0, 12)})`,
    );
    return;
  }
  fail(
    `packages/deck/{${VENDORED.join(',')}} has been modified in this repo.\n` +
      `  recorded tree-hash: ${stamp.treeHash}\n` +
      `  actual tree-hash:   ${actual.treeHash}\n\n` +
      '  packages/deck is vendored from the Deck repo and is read-only here.\n' +
      '  Move the change upstream, add a test for it there, then re-sync:\n\n' +
      '      node scripts/deck-sync.mjs pull ~/Projects/deck\n',
  );
}

function git(cwd, args) {
  let r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    fail(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr?.trim()}`);
  }
  return r.stdout.trim();
}

async function pull(deckRepo) {
  if (!deckRepo)
    fail('pull needs a path to a Deck checkout, e.g. ~/Projects/deck');
  let repo = resolve(deckRepo.replace(/^~/, process.env.HOME ?? '~'));
  // Only the copied Core paths affect the provenance claim. Unrelated files
  // elsewhere in a developer's Deck checkout must not prevent a truthful
  // sync, but any tracked or untracked change under these paths must.
  if (
    git(repo, [
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      'packages/core/src',
      'packages/core/tests',
    ])
  ) {
    fail(
      `${repo}/packages/core/{src,tests} has uncommitted changes; commit them so the recorded sha matches the bytes`,
    );
  }
  for (let sub of VENDORED) {
    let r = spawnSync(
      'rsync',
      [
        '-a',
        '--delete',
        '--exclude=.DS_Store',
        '--exclude=node_modules',
        `${join(repo, 'packages', 'core', sub)}/`,
        `${join(DECK, sub)}/`,
      ],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) fail(`rsync of ${sub} failed`);
  }
  await writeStamp(
    git(repo, ['rev-parse', 'HEAD']),
    git(repo, ['log', '-1', '--format=%s']),
    git(repo, ['log', '-1', '--format=%cI']),
  );
}

let [command, ...rest] = process.argv.slice(2);
let flag = (name) => {
  let i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1];
};

if (command === 'check') {
  await check();
} else if (command === 'pull') {
  await pull(rest.find((a) => !a.startsWith('--')));
} else if (command === 'stamp') {
  await writeStamp(flag('--sha'), flag('--subject'), flag('--date'));
} else {
  console.error(
    'usage: deck-sync.mjs check | pull <deck-repo> | stamp --sha <commit>',
  );
  process.exit(1);
}
