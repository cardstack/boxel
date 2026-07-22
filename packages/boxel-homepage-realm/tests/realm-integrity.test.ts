// Structural integrity tests for the homepage realm (contents/).
//
// These walk the realm's files and assert link-graph invariants that the
// realm server itself only surfaces at index time (as error documents) or
// not at all. Each guards a class of defect found in review: dangling
// adoptsFrom/relationship links, unreachable instances, orphaned assets,
// stray extensionless files, and instance data keys that match no card field.
//
// Run with: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../contents',
);

const EXECUTABLE_EXTENSIONS = ['.gts', '.ts', '.js', '.gjs'];
const SKIP_DIRS = new Set(['.git', '.boxel-history', 'node_modules']);

// Fields every card inherits from CardDef (base realm card-api).
const CARD_DEF_FIELDS = new Set([
  'cardInfo',
  'cardTitle',
  'cardDescription',
  'title',
  'description',
  'thumbnailURL',
]);

// Instances that are deliberately not linked from any routed page.
// Prune entries when the instance gets wired in or deleted; a NEW unlisted
// orphan fails the reachability test.
const ALLOWED_ORPHANS = new Set<string>([
  // populated below from the current, reviewed state of the realm
  ...loadAllowedOrphans(),
]);

function loadAllowedOrphans(): string[] {
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    'allowed-orphans.txt',
  );
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

interface WalkResult {
  jsonFiles: string[]; // card instance documents
  sourceFiles: string[]; // .gts/.ts/.js/.gjs modules
  otherFiles: string[]; // everything else (assets, markdown, ...)
}

function walk(dir: string, out: WalkResult): WalkResult {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(full, out);
      continue;
    }
    if (name.startsWith('.')) continue;
    if (name.endsWith('.json')) out.jsonFiles.push(full);
    else if (EXECUTABLE_EXTENSIONS.includes(extname(name)))
      out.sourceFiles.push(full);
    else out.otherFiles.push(full);
  }
  return out;
}

const files = walk(CONTENTS, {
  jsonFiles: [],
  sourceFiles: [],
  otherFiles: [],
});

const instances = files.jsonFiles.filter((f) => {
  try {
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    return doc?.data?.type === 'card';
  } catch {
    return false;
  }
});

function rel(f: string): string {
  return relative(CONTENTS, f);
}

function readJson(f: string): any {
  return JSON.parse(readFileSync(f, 'utf8'));
}

// Recursively collect every {links: {self}} target and every adoptsFrom in a doc.
function collectRefs(node: any, links: string[], modules: string[]) {
  if (node == null || typeof node !== 'object') return;
  if (typeof node.adoptsFrom?.module === 'string') {
    modules.push(node.adoptsFrom.module);
  }
  if (typeof node.links?.self === 'string') {
    links.push(node.links.self);
  }
  for (const value of Object.values(node)) collectRefs(value, links, modules);
}

function resolvesAsModule(fromFile: string, specifier: string): boolean {
  const base = resolve(dirname(fromFile), specifier);
  if (existsSync(base) && statSync(base).isFile()) return true;
  return EXECUTABLE_EXTENSIONS.some((ext) => existsSync(base + ext));
}

function resolvesAsLink(fromFile: string, target: string): boolean {
  const base = resolve(dirname(fromFile), target);
  if (extname(target)) {
    // file link (image, markdown, ...) — the literal file must exist
    return existsSync(base);
  }
  // card link — extensionless instance URL backed by a .json document
  return existsSync(base + '.json');
}

test('every adoptsFrom module resolves', () => {
  const failures: string[] = [];
  for (const f of instances) {
    const links: string[] = [];
    const modules: string[] = [];
    collectRefs(readJson(f), links, modules);
    for (const mod of modules) {
      if (!mod.startsWith('.')) continue; // base-realm / absolute URLs
      if (!resolvesAsModule(f, mod)) {
        failures.push(`${rel(f)} -> ${mod}`);
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    `dangling adoptsFrom:\n${failures.join('\n')}`,
  );
});

test('every relationship link resolves', () => {
  const failures: string[] = [];
  for (const f of instances) {
    const links: string[] = [];
    const modules: string[] = [];
    collectRefs(readJson(f), links, modules);
    for (const target of links) {
      if (/^[a-z]+:/i.test(target)) continue; // http(s) etc.
      if (!resolvesAsLink(f, target)) {
        failures.push(`${rel(f)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(failures, [], `dangling links:\n${failures.join('\n')}`);
});

test('every instance is reachable from a routed page (or allowlisted)', () => {
  const realmConfig = join(CONTENTS, 'realm.json');
  const roots: string[] = [];
  {
    const links: string[] = [];
    const modules: string[] = [];
    collectRefs(readJson(realmConfig), links, modules);
    for (const target of links) {
      const resolved = resolve(CONTENTS, target) + '.json';
      if (existsSync(resolved)) roots.push(resolved);
    }
  }
  assert.ok(roots.length >= 4, 'realm.json should route at least 4 pages');

  const reachable = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.pop()!;
    if (reachable.has(f)) continue;
    reachable.add(f);
    const links: string[] = [];
    const modules: string[] = [];
    collectRefs(readJson(f), links, modules);
    for (const target of links) {
      if (/^[a-z]+:/i.test(target) || extname(target)) continue;
      const resolved = resolve(dirname(f), target) + '.json';
      if (existsSync(resolved)) queue.push(resolved);
    }
  }

  const orphans = instances
    .filter((f) => f !== realmConfig && !reachable.has(f))
    .map(rel)
    .filter((r) => !ALLOWED_ORPHANS.has(r));
  assert.deepEqual(
    orphans,
    [],
    `unreachable instances (wire them in, delete them, or add to tests/allowed-orphans.txt):\n${orphans.join('\n')}`,
  );
});

test('instance attribute keys match a declared @field', () => {
  const allSource = files.sourceFiles
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const failures: string[] = [];
  for (const f of instances) {
    if (basename(f) === 'realm.json') continue;
    const doc = readJson(f);
    // Only check cards whose class is defined in this realm; base-realm and
    // external classes declare their fields outside these sources.
    if (!doc?.data?.meta?.adoptsFrom?.module?.startsWith('.')) continue;
    const attributes = doc?.data?.attributes ?? {};
    const keys: string[] = [];
    const collectKeys = (node: any) => {
      if (Array.isArray(node)) return node.forEach(collectKeys);
      if (node == null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'cardInfo') continue; // free-form base field
        keys.push(key);
        collectKeys(value);
      }
    };
    collectKeys(attributes);
    for (const key of new Set(keys)) {
      if (CARD_DEF_FIELDS.has(key)) continue;
      if (!new RegExp(`@field\\s+${key}\\b`).test(allSource)) {
        failures.push(`${rel(f)}: "${key}"`);
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    `attribute keys with no matching @field declaration:\n${failures.join('\n')}`,
  );
});

test('every screenshot asset is referenced', () => {
  const shotsDir = join(CONTENTS, 'boxel-ai-website', 'screenshots');
  if (!existsSync(shotsDir)) return;
  const allText = [...files.sourceFiles, ...files.jsonFiles]
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const orphaned = readdirSync(shotsDir).filter(
    (name) => !name.startsWith('.') && !allText.includes(name),
  );
  assert.deepEqual(
    orphaned,
    [],
    `unreferenced screenshots (delete them):\n${orphaned.join('\n')}`,
  );
});

test('no extensionless files shadow card-instance URLs', () => {
  const strays = files.otherFiles
    .filter((f) => !extname(f) && basename(f) !== 'LICENSE')
    .map(rel);
  assert.deepEqual(
    strays,
    [],
    `extensionless files (these shadow instance URL resolution):\n${strays.join('\n')}`,
  );
});

test('navbar anchors exist in the home layout template', () => {
  const layout = readFileSync(
    join(CONTENTS, 'boxel-ai-website', 'boxel-home-layout.gts'),
    'utf8',
  );
  const failures: string[] = [];
  for (const f of instances) {
    const navLinks = readJson(f)?.data?.attributes?.navLinks;
    if (!Array.isArray(navLinks)) continue;
    for (const link of navLinks) {
      const href: string | undefined = link?.href ?? link?.url;
      if (typeof href !== 'string') continue;
      const match = href.match(/#([\w-]+)/);
      if (!match) continue;
      // anchors render either as a literal id or via a SectionSlot @anchor
      const anchorPattern = new RegExp(`(id|@anchor)=['"]${match[1]}['"]`);
      if (!anchorPattern.test(layout)) {
        failures.push(`${rel(f)}: ${href}`);
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    `nav anchors with no matching id in boxel-home-layout.gts:\n${failures.join('\n')}`,
  );
});
