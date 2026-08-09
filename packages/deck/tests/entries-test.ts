import QUnit from 'qunit';
const { module, test } = QUnit;
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from '../src/index.ts';
import * as node from '../src/node.ts';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Follow every relative import from a starting module and report which
// files the entry actually pulls in. A promise about an entry is a promise
// about its whole closure, not its first line.
async function closureOf(entry: string): Promise<string[]> {
  let seen = new Set<string>();
  let queue = [resolvePath(src, entry)];
  while (queue.length > 0) {
    let file = queue.pop()!;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    let text = await readFile(file, 'utf8');
    // `import type` is erased at runtime and by every bundler, so it is
    // not an edge. A VALUE import of the same module would be, which is
    // exactly the regression this test exists to catch.
    for (let match of text.matchAll(/(^|\n)\s*(import|export)\s+(?!type\s)[^;]*?from '(\.[^']+)'/g)) {
      queue.push(resolvePath(dirname(file), match[3]));
    }
  }
  return [...seen];
}

module('package entries', function () {
  // The claim the root entry makes about itself, checked rather than
  // asserted in a comment. eslint guards the named files; this guards the
  // closure, which is the thing that actually breaks a consumer's bundle.
  test('the root entry reaches no node: builtin', async function (assert) {
    let files = await closureOf('index.ts');
    let offenders: string[] = [];
    for (let file of files) {
      if (/from 'node:/.test(await readFile(file, 'utf8'))) {
        offenders.push(file.slice(src.length + 1));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'a module in the root closure imports a Node builtin',
    );
  });

  test('the root entry carries the resolution surface', function (assert) {
    for (let name of [
      'resolveSpecifier',
      'parseExtends',
      'flattenInheritance',
      'resolveInheritance',
      'classifyReference',
      'planPack',
      'parsePackages',
    ]) {
      assert.strictEqual(
        typeof (root as Record<string, unknown>)[name],
        'function',
        name,
      );
    }
  });

  // One import for an embedder, rather than a deep path per module. Deep
  // paths still resolve; they are how this repo imports, and they are not
  // what an embedder should have to learn.
  test('the node entry adds the filesystem surface, and re-exports the root', function (assert) {
    for (let name of [
      'treeHashFromDir',
      'pack',
      'unpack',
      'createPacklist',
      'intakeReadiness',
      'publishToStore',
      'verifyLinks',
    ]) {
      assert.strictEqual(
        typeof (node as Record<string, unknown>)[name],
        'function',
        name,
      );
    }
    assert.strictEqual(
      node.resolveSpecifier,
      root.resolveSpecifier,
      'one implementation, reachable from either entry',
    );
  });

  // The entries exist so an embedder gets a contract. That is only true if
  // the contract covers what the embedder actually reaches for, and the
  // list below is not hypothetical: it is every algorithm the Boxel backport
  // plan says to import rather than fork.
  //
  // This test was written because three of them were not on either entry.
  // `mergeTrees` in particular — the one thing most likely to be
  // reimplemented badly, and the reason K4 exists — was reachable only from
  // a deep subpath, so the first PR that tried
  // `import { mergeTrees } from '@cardstack/deck/node'` would have failed and
  // the likely repair would have been a hand-rolled diff3 in the consumer.
  // A missing export is not a small thing when the alternative to finding it
  // is writing it again.
  test('every algorithm the backport imports is reachable from an entry', function (assert) {
    // name → the entry it must be on. `root` implies `/node` too, since the
    // node entry re-exports the root.
    let contract: [string, 'root' | 'node'][] = [
      // resolution: the resolver seam
      ['resolveSpecifier', 'root'],
      ['parsePackages', 'root'],
      ['parseDependencies', 'root'],
      // remix: extends and its flattening
      ['parseExtends', 'root'],
      ['flattenInheritance', 'root'],
      ['resolveInheritance', 'root'],
      // publish and intake: what a URL is
      ['classifyReference', 'root'],
      // sync and pack intake: three-way merge, base = a Version
      ['mergeTrees', 'root'],
      ['mergeText', 'root'],
      ['mergeJsonValues', 'root'],
      // packs
      ['planPack', 'root'],
      ['pack', 'node'],
      ['unpack', 'node'],
      ['intakeReadiness', 'node'],
      ['carryHermetic', 'node'],
      // identity and the store
      ['treeHashFromDir', 'node'],
      ['publishToStore', 'node'],
      ['resolveVersionSpec', 'node'],
      // The naming rules a publish gate has to enforce. An embedder that
      // cannot ask "is this a legal package name" writes its own regex, and
      // two spellings of the rule is one more than the protocol allows.
      ['isValidPackageName', 'node'],
      ['isValidDistTag', 'node'],
      // catalog verbs: ranges in, pins and scopes out
      ['lockDeck', 'node'],
      ['resolveDependencies', 'node'],
      ['resolveScopes', 'node'],
      ['parseDependencyValue', 'node'],
      // moving trees around
      ['readTreeFromDir', 'node'],
      ['writeTreeToDir', 'node'],
      ['forkDeck', 'node'],
      // offers: a proposal is a Version
      ['discoverOffers', 'node'],
      ['planRebase', 'node'],
      ['applyRebase', 'node'],
      // endorsement
      ['signTreeHash', 'node'],
      ['verifyEnvelope', 'node'],
      ['verifyLinks', 'node'],
    ];
    let missing: string[] = [];
    for (let [name, entry] of contract) {
      let table = (entry === 'root' ? root : node) as Record<string, unknown>;
      if (typeof table[name] !== 'function') {
        missing.push(`${name} (expected on ${entry})`);
      }
    }
    assert.deepEqual(missing, [], 'reachable from a documented entry');
  });
});
