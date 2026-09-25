// Materializes the catalog test subset: the system-level catalog definitions
// that boxel's own test suites load through `@cardstack/catalog/`, declared in
// `../test-subset.json` and pinned to one boxel-catalog revision.
//
//   node scripts/sync-test-subset.ts                 fetch into test-subset/
//   node scripts/sync-test-subset.ts --into-clone    also merge into contents/
//   node scripts/sync-test-subset.ts --remove-from-clone
//   node scripts/sync-test-subset.ts --bump          re-pin to catalog main
//   node scripts/sync-test-subset.ts --check-pin     fail unless main contains the pin
//   node scripts/sync-test-subset.ts --touch=<test-subset|clone>
//
// `test-subset/` is served as the catalog realm by stacks that start with
// CATALOG_SOURCE=test-subset. A stack that serves the full clone instead runs
// with --into-clone, which adds each subset file the clone lacks and records,
// without touching it, every tracked file whose content differs from the pin.
//
// CATALOG_TEST_SUBSET_SOURCE=<dir> (relative to the repo root) reads the files
// from a local catalog checkout instead of the pinned revision, for developing
// a catalog change against boxel's tests before it is pinned.
//
// Each run writes a marker, served next to the definitions, that test helpers
// compare with the manifest so a stale subset fails loudly instead of running
// assertions against old definitions. The marker also records a hash of each
// file as written, so a copy edited in place — which neither CI nor a
// deployment would ever see — fails just as loudly.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  utimesSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const catalogDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(catalogDir, '..', '..');
const manifestPath = join(catalogDir, 'test-subset.json');
const subsetDir = join(catalogDir, 'test-subset');
const cloneDir = join(catalogDir, 'contents');
const externalsPath = join(repoRoot, 'packages/host/app/lib/externals.ts');

// Served by the catalog realm, so its name must not look like a card or a
// definition to the indexer.
const MARKER_FILE = 'catalog-test-subset.txt';
const ADDED_LIST = 'boxel-test-subset-added';

const CATALOG_PREFIX = '@cardstack/catalog/';
const ALLOWED_PREFIXES = [
  'https://cardstack.com/base/',
  '@cardstack/base/',
  '@cardstack/boxel-icons/',
  '@cardstack/boxel-ui/',
];

interface Manifest {
  repository: string;
  revision: string;
  files: { path: string; reason: string }[];
  tests?: { host?: string[]; realmServer?: string[] };
}

interface Marker {
  source: 'pin' | 'local';
  revision: string;
  files: string[];
  divergent: string[];
  // sha256 of each file's content as the sync wrote it: the pinned revision's
  // content, or the local checkout's under CATALOG_TEST_SUBSET_SOURCE.
  hashes: Record<string, string>;
}

function readManifest(): Manifest {
  let manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  if (!/^[0-9a-f]{40}$/.test(manifest.revision)) {
    fail(
      `revision must be a full 40-character sha, got "${manifest.revision}"`,
    );
  }
  for (let entry of manifest.files) {
    if (!entry.reason?.trim()) {
      fail(
        `${entry.path} has no reason; every subset entry must say why it is here`,
      );
    }
    if (/\.test\.gts$/.test(entry.path)) {
      fail(`${entry.path} is a test file; the subset holds definitions only`);
    }
  }
  return manifest;
}

function fail(message: string): never {
  console.error(`catalog test subset: ${message}`);
  process.exit(1);
}

function log(message: string) {
  console.log(`catalog test subset: ${message}`);
}

function listHash(manifest: Manifest) {
  return createHash('sha256')
    .update(manifest.files.map((f) => f.path).join('\n'))
    .digest('hex');
}

function readMarker(dir: string): (Marker & { listHash?: string }) | undefined {
  let path = join(dir, MARKER_FILE);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

async function fetchPinned(manifest: Manifest, path: string) {
  let url = `https://raw.githubusercontent.com/${manifest.repository}/${manifest.revision}/${path}`;
  let response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} answered ${response.status}`);
  }
  return await response.text();
}

async function loadContents(manifest: Manifest) {
  let localSource = process.env.CATALOG_TEST_SUBSET_SOURCE;
  let contents = new Map<string, string>();
  if (localSource) {
    let sourceDir = resolve(repoRoot, localSource);
    for (let { path } of manifest.files) {
      let file = join(sourceDir, path);
      if (!existsSync(file)) {
        fail(`${path} is not in ${sourceDir}`);
      }
      contents.set(path, readFileSync(file, 'utf8'));
    }
    return { contents, source: 'local' as const };
  }

  let marker = readMarker(subsetDir);
  let current =
    marker?.source === 'pin' &&
    marker.revision === manifest.revision &&
    marker.listHash === listHash(manifest) &&
    marker.hashes !== undefined &&
    manifest.files.every(({ path }) => existsSync(join(subsetDir, path)));
  if (current) {
    let edited: string[] = [];
    for (let { path } of manifest.files) {
      let text = readFileSync(join(subsetDir, path), 'utf8');
      if (sha256(text) !== marker!.hashes[path]) {
        edited.push(path);
      }
      contents.set(path, text);
    }
    if (edited.length) {
      fail(
        `${edited.join(', ')} in ${relative(repoRoot, subsetDir)} was edited after the sync wrote it. ` +
          `That directory is generated from ${manifest.repository}@${manifest.revision}, so an edit there reaches neither CI nor a deployment. ` +
          `Make the change in a ${manifest.repository} checkout and serve it with CATALOG_TEST_SUBSET_SOURCE=<dir> (see .claude/skills/catalog-test-subset), ` +
          `or delete ${relative(repoRoot, subsetDir)} and re-run the sync to discard the edit.`,
      );
    }
    return { contents, source: 'pin' as const, unchanged: true };
  }
  for (let { path } of manifest.files) {
    contents.set(path, await fetchPinned(manifest, path));
  }
  return { contents, source: 'pin' as const };
}

function shimmedModules() {
  let source = readFileSync(externalsPath, 'utf8');
  return new Set(
    [...source.matchAll(/shimModule\(\s*'([^']+)'/g)].map((m) => m[1]),
  );
}

// Every import a subset definition makes has to resolve in a test stack that
// serves only the subset: a sibling subset file, the base realm, or a module
// the host shims. Anything else would load in a full catalog and fail here.
function checkClosure(contents: Map<string, string>) {
  let shims = shimmedModules();
  let problems: string[] = [];
  let importRE =
    /(?:^|[^\w$.])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w$.])import\s*\(?\s*['"]([^'"]+)['"]/gm;
  for (let [path, source] of contents) {
    for (let match of source.matchAll(importRE)) {
      let specifier = match[1] ?? match[2];
      let target: string | undefined;
      if (specifier.startsWith('.')) {
        target = join(dirname(path), specifier);
      } else if (specifier.startsWith(CATALOG_PREFIX)) {
        target = specifier.slice(CATALOG_PREFIX.length);
      } else if (
        ALLOWED_PREFIXES.some((prefix) => specifier.startsWith(prefix)) ||
        shims.has(specifier)
      ) {
        continue;
      } else {
        problems.push(
          `${path} imports ${specifier}, which a test stack cannot resolve`,
        );
        continue;
      }
      let inSubset = [target, `${target}.gts`, `${target}.ts`].some((t) =>
        contents.has(t),
      );
      if (!inSubset) {
        problems.push(
          `${path} imports ${specifier}, which is not in the subset`,
        );
      }
    }
  }
  if (problems.length) {
    fail(`the subset is not closed:\n  ${problems.join('\n  ')}`);
  }
}

function hashes(contents: Map<string, string>) {
  return Object.fromEntries(
    [...contents].map(([path, text]) => [path, sha256(text)]),
  );
}

function writeMarker(dir: string, marker: Marker, manifest: Manifest) {
  writeFileSync(
    join(dir, MARKER_FILE),
    JSON.stringify({ ...marker, listHash: listHash(manifest) }, null, 2) + '\n',
  );
}

function writeSubsetDir(
  manifest: Manifest,
  contents: Map<string, string>,
  source: Marker['source'],
) {
  rmSync(subsetDir, { recursive: true, force: true });
  for (let [path, text] of contents) {
    let file = join(subsetDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  writeFileSync(
    join(subsetDir, 'realm.json'),
    JSON.stringify(
      {
        data: {
          type: 'card',
          attributes: { cardInfo: { name: 'Cardstack Catalog (test subset)' } },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/realm-config',
              name: 'RealmConfig',
            },
          },
        },
      },
      null,
      2,
    ) + '\n',
  );
  writeMarker(
    subsetDir,
    {
      source,
      revision: manifest.revision,
      files: [...contents.keys()],
      divergent: [],
      hashes: hashes(contents),
    },
    manifest,
  );
}

function gitPath(name: string) {
  return resolve(
    cloneDir,
    execFileSync('git', ['-C', cloneDir, 'rev-parse', '--git-path', name], {
      encoding: 'utf8',
    }).trim(),
  );
}

function sha256(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

// One line per file --into-clone added: its path and the hash of what was
// written, so a later removal can tell an untouched copy from an edited one.
function readAdded(): { path: string; hash: string }[] {
  let file = gitPath(ADDED_LIST);
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      let [path, hash] = line.split('\t');
      return { path, hash };
    });
}

function readExclude() {
  let path = gitPath('info/exclude');
  return { path, text: existsSync(path) ? readFileSync(path, 'utf8') : '' };
}

// Takes back out of the clone every file an earlier --into-clone added, so a
// pull that brings the same path in from upstream is never blocked by it.
// A copy someone has edited since it was added is kept, and stops being
// excluded from git, so it shows up as an ordinary untracked file that
// catalog-update.sh's autostash preserves instead of losing.
function removeFromClone() {
  if (!existsSync(join(cloneDir, '.git'))) {
    return;
  }
  let kept: string[] = [];
  for (let { path, hash } of readAdded()) {
    let file = join(cloneDir, path);
    if (!existsSync(file)) {
      continue;
    }
    if (sha256(readFileSync(file, 'utf8')) !== hash) {
      kept.push(path);
      continue;
    }
    rmSync(file);
    let dir = dirname(file);
    while (
      dir !== cloneDir &&
      existsSync(dir) &&
      readdirSync(dir).length === 0
    ) {
      rmSync(dir, { recursive: true });
      dir = dirname(dir);
    }
  }
  rmSync(gitPath(ADDED_LIST), { force: true });
  // The marker describes files that are no longer merged in; a guard reading
  // it would otherwise report a subset the clone no longer serves.
  rmSync(join(cloneDir, MARKER_FILE), { force: true });

  let exclude = readExclude();
  let keptLines = new Set(kept.map((p) => `/${p}`));
  let remaining = exclude.text
    .split('\n')
    .filter((line) => !keptLines.has(line));
  if (keptLines.size) {
    writeFileSync(exclude.path, remaining.join('\n'));
    console.warn(
      `catalog test subset: kept ${kept.join(', ')} in the catalog clone because it was edited after being merged in; it is now an ordinary untracked file.`,
    );
  }
}

function mergeIntoClone(
  manifest: Manifest,
  contents: Map<string, string>,
  source: Marker['source'],
) {
  if (!existsSync(join(cloneDir, '.git'))) {
    fail(`${cloneDir} is not a catalog clone; run pnpm catalog:setup first`);
  }
  removeFromClone();
  let added: string[] = [];
  let divergent: string[] = [];
  for (let [path, text] of contents) {
    let file = join(cloneDir, path);
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      added.push(path);
    } else if (readFileSync(file, 'utf8') !== text) {
      divergent.push(path);
    }
  }
  writeFileSync(
    gitPath(ADDED_LIST),
    added.map((p) => `${p}\t${sha256(contents.get(p)!)}\n`).join(''),
  );

  // Neither the added files nor the marker belong to the clone's history.
  let excludePath = gitPath('info/exclude');
  mkdirSync(dirname(excludePath), { recursive: true });
  let exclude = existsSync(excludePath)
    ? readFileSync(excludePath, 'utf8')
    : '';
  let lines = new Set(exclude.split('\n'));
  let missing = [`/${MARKER_FILE}`, ...added.map((p) => `/${p}`)].filter(
    (line) => !lines.has(line),
  );
  if (missing.length) {
    let separator = exclude === '' || exclude.endsWith('\n') ? '' : '\n';
    writeFileSync(excludePath, exclude + separator + missing.join('\n') + '\n');
  }

  writeMarker(
    cloneDir,
    {
      source,
      revision: manifest.revision,
      files: [...contents.keys()],
      divergent,
      hashes: hashes(contents),
    },
    manifest,
  );
  if (added.length) {
    log(`added to the catalog clone: ${added.join(', ')}`);
  }
  if (divergent.length) {
    console.warn(
      `catalog test subset: the catalog clone's copy differs from the pinned revision for ${divergent.join(', ')}. ` +
        `Tests that use these definitions will fail until the clone matches the pin: ` +
        `bump the pin in packages/catalog/test-subset.json, reset those files in packages/catalog/contents, ` +
        `or set CATALOG_TEST_SUBSET_SOURCE=packages/catalog/contents to test against the clone.`,
    );
  }
}

function bump(manifest: Manifest) {
  let output = execFileSync(
    'git',
    [
      'ls-remote',
      `https://github.com/${manifest.repository}.git`,
      'refs/heads/main',
    ],
    { encoding: 'utf8' },
  );
  let sha = output.split(/\s/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    fail(`could not resolve main of ${manifest.repository}`);
  }
  let raw = readFileSync(manifestPath, 'utf8');
  writeFileSync(manifestPath, raw.replace(manifest.revision, sha));
  log(`pinned ${manifest.repository} at ${sha}`);
  return { ...manifest, revision: sha };
}

// The deployed catalog realm serves boxel-catalog's main, so a pin that main
// does not contain describes definitions no deployment has. A pin that main
// contains can still be behind it: once main changes a subset file, boxel's
// tests run against a definition deployments no longer serve, so that fails
// too.
async function checkPin(manifest: Manifest) {
  let headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  let url = `https://api.github.com/repos/${manifest.repository}/compare/main...${manifest.revision}`;
  let response = await fetch(url, { headers });
  if (!response.ok) {
    fail(`GET ${url} answered ${response.status}`);
  }
  let { status } = (await response.json()) as { status: string };
  if (status !== 'behind' && status !== 'identical') {
    fail(
      `${manifest.revision} is not on ${manifest.repository} main (compare status "${status}"). ` +
        `Merge the catalog change first, then re-pin to a commit on main (pnpm catalog:test-subset --bump).`,
    );
  }
  log(`${manifest.revision} is on ${manifest.repository} main`);

  // The contents API answers with each file's blob sha, so comparing a file
  // at two refs needs no download. A file main no longer has answers 404.
  let blobSha = async (path: string, ref: string) => {
    let url = `https://api.github.com/repos/${manifest.repository}/contents/${path}?ref=${ref}`;
    let response = await fetch(url, { headers });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      fail(`GET ${url} answered ${response.status}`);
    }
    return ((await response.json()) as { sha: string }).sha;
  };
  let changed: string[] = [];
  for (let { path } of manifest.files) {
    if (
      (await blobSha(path, 'main')) !== (await blobSha(path, manifest.revision))
    ) {
      changed.push(path);
    }
  }
  if (changed.length) {
    fail(
      `${manifest.repository} main has changed ${changed.join(', ')} since ${manifest.revision}, so boxel's tests would run against definitions deployments no longer serve. ` +
        `Re-pin to main (pnpm catalog:test-subset --bump), run the manifest's tests against it, and commit the new pin.`,
    );
  }
  log(
    `the subset files at ${manifest.revision} match ${manifest.repository} main`,
  );
}

// A realm's compiled-module cache is keyed by path and cleared by the running
// realm's file watcher, so files the sync rewrote before the realm booted can
// still be served from a compile of their old content. Touching them once the
// realm is up makes the watcher clear those entries.
function touch(where: string) {
  let dir = where === 'clone' ? cloneDir : subsetDir;
  let now = new Date();
  for (let { path } of readManifest().files) {
    let file = join(dir, path);
    if (existsSync(file)) {
      utimesSync(file, now, now);
    }
  }
  log(`touched the subset files in ${relative(repoRoot, dir)}`);
}

async function main() {
  let args = new Set(process.argv.slice(2));
  let touchArg = [...args].find((a) => a.startsWith('--touch='));
  if (touchArg) {
    touch(touchArg.slice('--touch='.length));
    return;
  }
  if (args.has('--check-pin')) {
    await checkPin(readManifest());
    return;
  }
  if (args.has('--remove-from-clone')) {
    removeFromClone();
    return;
  }
  let manifest = readManifest();
  if (args.has('--bump')) {
    manifest = bump(manifest);
  }

  let loaded: Awaited<ReturnType<typeof loadContents>>;
  try {
    loaded = await loadContents(manifest);
  } catch (e) {
    let message = `could not fetch ${manifest.repository}@${manifest.revision}: ${(e as Error).message}`;
    if (args.has('--best-effort')) {
      console.warn(`catalog test subset: ${message}; continuing without it`);
      return;
    }
    fail(message);
  }
  let { contents, source } = loaded;
  checkClosure(contents);

  if ('unchanged' in loaded && loaded.unchanged) {
    log(`${relative(repoRoot, subsetDir)} is current at ${manifest.revision}`);
  } else {
    writeSubsetDir(manifest, contents, source);
    log(
      source === 'local'
        ? `copied ${contents.size} file(s) from ${process.env.CATALOG_TEST_SUBSET_SOURCE}`
        : `fetched ${contents.size} file(s) at ${manifest.revision}`,
    );
  }
  if (args.has('--into-clone')) {
    mergeIntoClone(manifest, contents, source);
  }
}

await main();
