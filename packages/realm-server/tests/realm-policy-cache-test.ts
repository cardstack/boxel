import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  FilterRefersToNonexistentTypeError,
  noteRealmIndexMoved,
  rri,
} from '@cardstack/runtime-common';
import { stubPolicyCache } from './helpers/policy-cache-stub.ts';

// The compiled-policy cache's own logic, over an environment held in memory:
// no realm, no database, no prerender.
const ORG = 'http://policy-cache.test/org/';
const EDUCATION = 'http://policy-cache.test/education/';
const ELSEWHERE = 'http://policy-cache.test/elsewhere/';

async function until(done: () => boolean, what: string) {
  let started = Date.now();
  while (!done()) {
    if (Date.now() - started > 3_000) {
      throw new Error(`timed out waiting until ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

module(basename(import.meta.filename), function (hooks) {
  hooks.afterEach(function () {
    delete (globalThis as { __boxelNow?: number }).__boxelNow;
  });

  // Pins the clock the cache reads, `now()` in runtime-common's clock.
  function setNow(value: number) {
    (globalThis as { __boxelNow?: number }).__boxelNow = value;
  }

  function setup() {
    return stubPolicyCache({ orgURL: ORG, educationURL: EDUCATION });
  }

  test('a move in a realm the policy reads from revalidates it in the background, and a move anywhere else does not', async function (assert) {
    let { cache, state } = setup();
    await cache.get();
    assert.strictEqual(state.reads, 1);

    noteRealmIndexMoved(ELSEWHERE);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(state.reads, 1, 'a move elsewhere reads nothing');

    noteRealmIndexMoved(ORG);
    await until(() => cache.stats.revalidations === 1, 'the Org move lands');
    noteRealmIndexMoved(EDUCATION);
    await until(
      () => cache.stats.revalidations === 2,
      "the move in the rule's type's realm lands",
    );
    assert.strictEqual(
      cache.stats.compiles,
      1,
      'nothing changed, so no compile',
    );
  });

  test('an entry that has gone too long without a revalidation is revalidated on read, with no move at all', async function (assert) {
    let { cache, state } = setup();
    setNow(1_000_000);
    let first = await cache.get();
    setNow(1_004_000);
    assert.strictEqual(await cache.get(), first);
    assert.strictEqual(state.reads, 1, 'answered from memory within the bound');

    state.version = 'v2';
    setNow(1_006_000);
    let later = await cache.get();
    assert.strictEqual(state.reads, 2, 'past the bound, the read revalidates');
    assert.strictEqual(
      later?.version,
      'v2',
      'and finds the edit that no move announced',
    );
  });

  test('a definition lookup that fails is thrown and not kept, so the next read tries again', async function (assert) {
    let { cache, state } = setup();
    state.lookupFailure = new Error('connection reset');
    await assert.rejects(
      cache.get(),
      /connection reset/,
      'the read fails rather than answering a policy without the rule',
    );

    state.lookupFailure = undefined;
    let policy = await cache.get();
    assert.deepEqual(
      policy?.rules.map((rule) => rule.targetType.name),
      ['Classroom'],
      'the next read compiles the rule',
    );
    assert.deepEqual(policy?.issues, []);
  });

  test('a type with no definition is recorded and kept', async function (assert) {
    let { cache, state } = setup();
    state.lookupFailure = new FilterRefersToNonexistentTypeError(
      { module: rri(`${EDUCATION}classroom`), name: 'Classroom' },
      { cause: 'not exported' },
    );
    let policy = await cache.get();
    assert.deepEqual(policy?.rules, [], 'the rule is left out');
    assert.deepEqual(
      policy?.issues.map(({ code, path }) => ({ code, path })),
      [{ code: 'unresolved-type', path: 'rules[0].targetType' }],
    );
    await cache.get();
    assert.strictEqual(
      state.reads,
      1,
      'and the result is answered from memory',
    );
  });

  test('reads of a cold cache share one compile', async function (assert) {
    let { cache, state } = setup();
    let [a, b, c] = await Promise.all([cache.get(), cache.get(), cache.get()]);
    assert.strictEqual(state.reads, 1, 'one read of the card');
    assert.strictEqual(cache.stats.compiles, 1, 'one compile');
    assert.strictEqual(b, a, 'one compiled policy answers every read');
    assert.strictEqual(c, a, 'one compiled policy answers every read');
  });

  test('a refresh that a move lands under while it reads answers its read, and is not kept', async function (assert) {
    let { cache, state } = setup();
    let release!: () => void;
    state.readGate = new Promise((resolve) => (release = resolve));
    let pending = cache.get();
    await until(() => state.reads === 1, 'the read is under way');

    noteRealmIndexMoved(ORG);
    state.readGate = undefined;
    release();
    assert.strictEqual((await pending)?.version, 'v1', 'the read is answered');

    state.version = 'v2';
    let next = await cache.get();
    assert.strictEqual(
      next?.version,
      'v2',
      'the next read does not take the superseded refresh from memory',
    );
  });
});
