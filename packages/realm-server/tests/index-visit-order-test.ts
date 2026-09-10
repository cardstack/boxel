import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';
import type { DependencyIndexRow } from '@cardstack/runtime-common';
import { prioritizeWrittenURLs } from '@cardstack/runtime-common/index-runner';
import { IndexRunnerDependencyManager } from '@cardstack/runtime-common/index-runner/dependency-resolver';

const realmURL = 'http://example.com/realm/';

let urls = (...paths: string[]) =>
  paths.map((path) => new URL(`${realmURL}${path}`));
let paths = (result: URL[]) =>
  result.map((url) => url.href.slice(realmURL.length));

// A VirtualNetwork stand-in that resolves references with the platform URL
// parser. Invalidation ordering only reaches it to canonicalize a `deps`
// entry, and the fixtures below write absolute hrefs, so resolution is the
// identity here.
function stubNetwork(): VirtualNetwork {
  return {
    isRegisteredPrefix() {
      return false;
    },
    resolveURL(reference: string, relativeTo: URL | string | undefined) {
      return new URL(reference, relativeTo ?? undefined);
    },
    unresolveURL(url: string) {
      return url;
    },
  } as unknown as VirtualNetwork;
}

// A dependency manager whose only live input is the `deps` graph under test.
// Everything else on the ordering path — the definition cache, the
// index-backed error fan-out — is unreachable from
// `orderInvalidationsByDependencies`.
function orderingOver(
  deps: Record<string, string[]>,
): (invalidations: URL[]) => Promise<URL[]> {
  let manager = new IndexRunnerDependencyManager({
    realmURL: new URL(realmURL),
    virtualNetwork: stubNetwork(),
    async readDefinitionCacheEntries() {
      return {};
    },
    async getDependencyRows() {
      return [];
    },
    async getOrderingDependencyRows(requested: string[]) {
      return requested
        .filter((url) => deps[url])
        .map(
          (url) =>
            ({
              url,
              type: 'instance',
              deps: deps[url]!.map((dep) => `${realmURL}${dep}`),
            }) as Pick<DependencyIndexRow, 'url' | 'type' | 'deps'>,
        );
    },
    getInvalidations() {
      return [];
    },
  });
  return (invalidations: URL[]) =>
    manager.orderInvalidationsByDependencies(invalidations);
}

module(basename(import.meta.filename), function () {
  module('prioritizeWrittenURLs', function () {
    test('hoists the written URLs, keeping the order they were written in', function (assert) {
      assert.deepEqual(
        paths(
          prioritizeWrittenURLs(
            urls('aaa.json', 'bbb.json', 'yyy.json', 'zzz.json'),
            urls('zzz.json', 'yyy.json'),
            new URL(realmURL),
          ),
        ),
        ['zzz.json', 'yyy.json', 'aaa.json', 'bbb.json'],
        'the targets lead in write order and the dependents keep theirs',
      );
    });

    test('ignores a written URL the invalidation set does not contain', function (assert) {
      assert.deepEqual(
        paths(
          prioritizeWrittenURLs(
            urls('aaa.json', 'bbb.json'),
            urls('elsewhere.json'),
            new URL(realmURL),
          ),
        ),
        ['aaa.json', 'bbb.json'],
        'a written URL the fan-out recorded under another name changes nothing',
      );
    });

    test('emits each URL once when a write names the same URL twice', function (assert) {
      assert.deepEqual(
        paths(
          prioritizeWrittenURLs(
            urls('aaa.json', 'zzz.json'),
            urls('zzz.json', 'zzz.json'),
            new URL(realmURL),
          ),
        ),
        ['zzz.json', 'aaa.json'],
        'a repeated target is hoisted once, not duplicated',
      );
    });

    test('never hoists a target instance ahead of a target module', function (assert) {
      // One job naming a brand-new instance and the module it adopts from —
      // a coalesced pair, or a write the module-then-instance gate did not
      // split. The instance was written first, but no persisted `deps` row
      // joins them yet, so nothing downstream can restore module-first: the
      // hoist has to preserve it.
      assert.deepEqual(
        paths(
          prioritizeWrittenURLs(
            urls('card.json', 'person.gts'),
            urls('card.json', 'person.gts'),
            new URL(realmURL),
          ),
        ),
        ['person.gts', 'card.json'],
        'the module keeps its class priority over the instance that adopts from it',
      );
    });

    test('keeps a target realm config at the head of the target group', function (assert) {
      assert.deepEqual(
        paths(
          prioritizeWrittenURLs(
            urls('aaa.json', 'realm.json', 'zzz.json'),
            urls('zzz.json', 'realm.json'),
            new URL(realmURL),
          ),
        ),
        ['realm.json', 'zzz.json', 'aaa.json'],
        'the realm config leads the targets, which lead the dependents',
      );
    });

    test('passes a single-URL invalidation set through untouched', function (assert) {
      let single = urls('zzz.json');
      assert.strictEqual(
        prioritizeWrittenURLs(single, urls('zzz.json'), new URL(realmURL)),
        single,
        'a set of one has no order to decide',
      );
    });
  });

  // The visit order an incremental pass ends up with is the composition of
  // three steps: `sortInvalidations` (which, for a set of sibling `.json`
  // instances, is a lexical sort — the starting order in each case below),
  // then `prioritizeWrittenURLs`, then the topological ordering. These pin
  // the composition's outcome, so a change to any one of the three that
  // breaks target-first ordering fails here.
  module('a written URL is visited before its dependents', function () {
    test('a dependency edge still overrules the hoist', async function (assert) {
      // The written instance adopts from the written module, so the module's
      // file entry has to exist before the instance renders. Write order says
      // instance-then-module; the dependency graph says otherwise and wins.
      let order = orderingOver({
        [`${realmURL}zzz.json`]: ['person.gts'],
      });
      assert.deepEqual(
        paths(
          await order(
            prioritizeWrittenURLs(
              urls('person.gts', 'zzz.json'),
              urls('zzz.json', 'person.gts'),
              new URL(realmURL),
            ),
          ),
        ),
        ['person.gts', 'zzz.json'],
        'the dependency is visited first even though it was written second',
      );
    });

    test('a dependent no persisted deps row connects to its target loses the lexical race', async function (assert) {
      // `aaa.json` is in the fan-out but the index holds no `deps` row for it
      // — the state between a link being written and that row being
      // reindexed. With no edge to order them, lexical order alone would put
      // the dependent first.
      let order = orderingOver({});
      assert.deepEqual(
        paths(
          await order(
            prioritizeWrittenURLs(
              urls('aaa.json', 'bbb.json', 'zzz.json'),
              urls('zzz.json'),
              new URL(realmURL),
            ),
          ),
        ),
        ['zzz.json', 'aaa.json', 'bbb.json'],
        'the target leads and the dependents follow in their own order',
      );
    });

    test('a target inside a dependency cycle is visited before its dependents', async function (assert) {
      // `zzz` and `aaa` link to each other, so those two are the cycle; `bbb`
      // links to `zzz` and merely sits behind it, keeping its edge and so
      // still waiting for `zzz`. Between the two cycle members no order is
      // satisfiable, so priority decides — and without the hoist that hands
      // it to lexically-first `aaa`, putting the target second.
      let order = orderingOver({
        [`${realmURL}aaa.json`]: ['zzz.json'],
        [`${realmURL}bbb.json`]: ['zzz.json'],
        [`${realmURL}zzz.json`]: ['aaa.json'],
      });
      assert.deepEqual(
        paths(await order(urls('aaa.json', 'bbb.json', 'zzz.json'))),
        ['aaa.json', 'zzz.json', 'bbb.json'],
        'the cycle member that arrived first wins, and the target lands second',
      );
      assert.deepEqual(
        paths(
          await order(
            prioritizeWrittenURLs(
              urls('aaa.json', 'bbb.json', 'zzz.json'),
              urls('zzz.json'),
              new URL(realmURL),
            ),
          ),
        ),
        ['zzz.json', 'aaa.json', 'bbb.json'],
        'leading with the target puts it first',
      );
    });

    test('a target stranded in a cycle still outranks a dependent with no edge', async function (assert) {
      // The mixed graph: `zzz` (the target) and `aaa` link to each other, so
      // both are stranded in a cycle, while `ddd` is in the fan-out with no
      // usable persisted edge — a `deps` entry whose canonical form does not
      // match any URL in the set — so it is immediately schedulable. Ranking
      // the cycle's members only after every schedulable URL would put the
      // target behind `ddd`; dropping the cycle's own edges lets priority
      // decide, which is all a cycle's order can be decided by anyway.
      let order = orderingOver({
        [`${realmURL}aaa.json`]: ['zzz.json'],
        [`${realmURL}zzz.json`]: ['aaa.json'],
      });
      assert.deepEqual(
        paths(
          await order(
            prioritizeWrittenURLs(
              urls('aaa.json', 'ddd.json', 'zzz.json'),
              urls('zzz.json'),
              new URL(realmURL),
            ),
          ),
        ),
        ['zzz.json', 'aaa.json', 'ddd.json'],
        'the target leads even though a cycle strands it and another dependent is ready',
      );
    });

    test('a URL behind a cycle still waits for the cycle member it depends on', async function (assert) {
      // `one.js` and `two.js` import each other, and `card.json` adopts from
      // `one.js`. Only the two modules are in the cycle; `card.json` merely
      // sits behind it. Dropping every edge out of a cycle member would free
      // `card.json` to render before `one.js` had a file entry — the edge
      // that leaves the cycle is the one that must survive.
      let order = orderingOver({
        [`${realmURL}one.js`]: ['two.js'],
        [`${realmURL}two.js`]: ['one.js'],
        [`${realmURL}card.json`]: ['one.js'],
      });
      let visited = paths(
        await order(
          prioritizeWrittenURLs(
            urls('card.json', 'one.js', 'two.js'),
            urls('card.json'),
            new URL(realmURL),
          ),
        ),
      );
      assert.ok(
        visited.indexOf('one.js') < visited.indexOf('card.json'),
        `the module it adopts from is visited first (order: ${visited.join(', ')})`,
      );
      assert.deepEqual(
        [...visited].sort(),
        ['card.json', 'one.js', 'two.js'],
        'every URL is still visited exactly once',
      );
    });

    test('an acyclic set is unaffected by the cycle handling', async function (assert) {
      // The second scheduling pass only runs when the first strands
      // something, so an acyclic graph keeps exactly the order it always
      // had: dependencies first, priority breaking every tie.
      let order = orderingOver({
        [`${realmURL}aaa.json`]: ['person.gts'],
        [`${realmURL}bbb.json`]: ['person.gts'],
        [`${realmURL}zzz.json`]: ['person.gts'],
      });
      assert.deepEqual(
        paths(
          await order(urls('aaa.json', 'bbb.json', 'person.gts', 'zzz.json')),
        ),
        ['person.gts', 'aaa.json', 'bbb.json', 'zzz.json'],
        'the dependency is visited first, then the dependents in priority order',
      );
    });

    test('a batch is visited targets-first, then dependents', async function (assert) {
      // Two targets, each in a cycle with one of the dependents, and each
      // sorting after its own dependent lexically.
      let order = orderingOver({
        [`${realmURL}aaa.json`]: ['zzz.json'],
        [`${realmURL}bbb.json`]: ['yyy.json'],
        [`${realmURL}yyy.json`]: ['bbb.json'],
        [`${realmURL}zzz.json`]: ['aaa.json'],
      });
      assert.deepEqual(
        paths(
          await order(
            prioritizeWrittenURLs(
              urls('aaa.json', 'bbb.json', 'yyy.json', 'zzz.json'),
              urls('yyy.json', 'zzz.json'),
              new URL(realmURL),
            ),
          ),
        ),
        ['yyy.json', 'zzz.json', 'aaa.json', 'bbb.json'],
        'every target is visited before any dependent',
      );
    });
  });
});
