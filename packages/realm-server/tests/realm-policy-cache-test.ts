import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  FilterRefersToNonexistentTypeError,
  noteRealmIndexMoved,
  realmPolicyRef,
  rri,
  type Definition,
  type FieldDefinition,
  type IndexedInstanceSource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { RealmPolicyCache } from '@cardstack/runtime-common/card-operations';
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

  test('a card whose rules are not a list does not compile as a whole', async function (assert) {
    let { cache, state } = setup();
    state.rules = { targetType: 'everything' };
    let policy = await cache.get();
    assert.true(policy?.uncompilable, 'the policy does not compile');
    assert.deepEqual(policy?.rules, [], 'and has no rules');
    assert.deepEqual(
      policy?.issues.map(({ code, path }) => ({ code, path })),
      [{ code: 'invalid-rule', path: 'rules' }],
    );
  });

  // The row of a visit whose failure was withheld is the earlier visit's row,
  // byte for byte, so nothing but the withholding says it is out of date.
  test('a card whose latest visit failed with the failure withheld does not compile, until a visit succeeds', async function (assert) {
    let { cache, state } = setup();
    let before = await cache.get();
    assert.strictEqual(before?.rules[0]?.grants.length, 1, 'the grant applies');

    state.failureWithheld = true;
    noteRealmIndexMoved(ORG);
    let withheld = await cache.get();
    assert.true(withheld?.uncompilable, 'the policy does not compile');
    assert.deepEqual(withheld?.rules, [], 'and grants nothing');
    assert.strictEqual(
      withheld?.version,
      undefined,
      'nor names the version the earlier visit recorded',
    );
    assert.deepEqual(
      withheld?.issues.map(({ code, path }) => ({ code, path })),
      [{ code: 'policy-card-unloadable', path: '' }],
    );

    state.failureWithheld = false;
    state.version = 'v2';
    noteRealmIndexMoved(ORG);
    let after = await cache.get();
    assert.notOk(after?.uncompilable, 'a visit that succeeds compiles it');
    assert.strictEqual(
      after?.rules[0]?.grants.length,
      1,
      'and it grants again',
    );
  });

  // Nothing else visits a card whose visit was withheld: its row reads as
  // healthy, so no error on it asks for a reindex.
  test('a card whose latest visit was withheld is visited again, once per cooldown, and compiles once a visit succeeds', async function (assert) {
    let { cache, state, card } = setup();
    setNow(1_000_000);
    state.failureWithheld = true;
    let withheld = await cache.get();
    assert.true(withheld?.uncompilable, 'the policy does not compile');
    assert.deepEqual(
      state.revisits,
      [{ file: `${card}.json`, realmURL: ORG }],
      'one visit is asked for, of the file the card is stored in, in the realm that holds it',
    );

    // The visit is withheld too. Once it settles its commit moves the Org
    // index, and the refresh that starts reads the row still withheld.
    await new Promise((resolve) => setTimeout(resolve, 5));
    noteRealmIndexMoved(ORG);
    await until(
      () => cache.stats.revalidations === 1,
      'the refresh after the move lands',
    );
    setNow(1_006_000);
    assert.true(
      (await cache.get())?.uncompilable,
      'a read past the revalidation bound still refuses',
    );
    assert.strictEqual(cache.stats.revalidations, 2);
    assert.strictEqual(
      state.revisits.length,
      1,
      'and neither read inside the cooldown asks for another visit',
    );

    // Past the cooldown the next read asks again, and this visit succeeds.
    // Its commit leaves the card as it was, less the withholding.
    state.onRevisit = () => {
      state.failureWithheld = false;
      noteRealmIndexMoved(ORG);
    };
    setNow(1_070_000);
    assert.true(
      (await cache.get())?.uncompilable,
      'the read that asks is answered with the refusal it read',
    );
    assert.strictEqual(state.revisits.length, 2, 'a second visit is asked for');
    await until(() => cache.stats.compiles === 2, 'the successful visit lands');
    let healed = await cache.get();
    assert.notOk(healed?.uncompilable, 'the policy compiles');
    assert.strictEqual(healed?.version, 'v1', 'from the card as it stood');
    assert.strictEqual(
      healed?.rules[0]?.grants.length,
      1,
      'and it grants again',
    );
    assert.strictEqual(state.revisits.length, 2, 'and nothing asks again');
  });

  // A pass nobody waits on announces itself before it returns, so the refresh
  // its announcement starts runs while the visit is still running.
  test('no read asks for another visit while the one it asked for is still running', async function (assert) {
    let { cache, state } = setup();
    setNow(1_000_000);
    state.failureWithheld = true;
    let release!: () => void;
    state.revisitGate = new Promise((resolve) => (release = resolve));
    await cache.get();
    assert.strictEqual(state.revisits.length, 1, 'a visit is asked for');

    noteRealmIndexMoved(ORG);
    await until(
      () => cache.stats.revalidations === 1,
      'the refresh after the move lands',
    );
    // Past the revalidation bound, and past the cooldown too, had the visit
    // settled when it was asked for.
    setNow(1_070_000);
    assert.true((await cache.get())?.uncompilable, 'the policy still refuses');
    assert.strictEqual(cache.stats.revalidations, 2);
    assert.strictEqual(
      state.revisits.length,
      1,
      'and neither the refresh nor the read asks for another visit',
    );
    release();
  });

  test('reads of a cold cache share one compile', async function (assert) {
    let { cache, state } = setup();
    let [a, b, c] = await Promise.all([cache.get(), cache.get(), cache.get()]);
    assert.strictEqual(state.reads, 1, 'one read of the card');
    assert.strictEqual(cache.stats.compiles, 1, 'one compile');
    assert.strictEqual(b, a, 'one compiled policy answers every read');
    assert.strictEqual(c, a, 'one compiled policy answers every read');
  });

  // A classroom links to its students, who link to their guardians, and the
  // policy grants a read of classrooms alone. What the reach check walks
  // decides no grant, so a guardian's definition that cannot be read leaves
  // that branch unwalked rather than failing the policy.
  function reachSetup() {
    let card = `${ORG}policies/education`;
    let ref = (name: string): ResolvedCodeRef => ({
      module: rri(`${EDUCATION}classroom`),
      name,
    });
    let [classroom, student, guardian] = [
      ref('Classroom'),
      ref('Student'),
      ref('Guardian'),
    ];
    let link = (fieldOrCard: ResolvedCodeRef): FieldDefinition => ({
      type: 'linksTo',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard,
    });
    let definitions = new Map<string, Definition>(
      [
        [classroom, { students: link(student) }],
        [student, { guardian: link(guardian) }],
        [guardian, {}],
      ].map(([codeRef, fields]) => {
        let named = fields as Record<string, FieldDefinition>;
        return [
          (codeRef as ResolvedCodeRef).name,
          {
            type: 'card-def',
            codeRef: codeRef as ResolvedCodeRef,
            displayName: (codeRef as ResolvedCodeRef).name,
            fields: Object.fromEntries(Object.keys(named).map((n) => [n, n])),
            fieldDefs: named,
          },
        ];
      }),
    );
    let state = { guardianFailure: undefined as Error | undefined };
    let typeKey = (codeRef: ResolvedCodeRef) =>
      `${codeRef.module}/${codeRef.name}`;
    let cache = new RealmPolicyCache({
      policyCard: async () => card,
      readCard: async (): Promise<IndexedInstanceSource> => ({
        realmURL: ORG,
        generation: 1,
        sourceContentHash: 'v1',
        types: [typeKey(realmPolicyRef)],
        error: null,
        failureWithheld: false,
        instance: {
          id: rri(card),
          type: 'card',
          attributes: {
            rules: [
              {
                targetType: { module: classroom.module, name: 'Classroom' },
                grants: [{ operation: 'read' }],
              },
            ],
          },
          meta: { adoptsFrom: realmPolicyRef },
        },
      }),
      resolveCodeRef: (codeRef) =>
        codeRef.name === 'Classroom' ? classroom : undefined,
      lookupDefinitionEntry: async (codeRef) => {
        if (codeRef.name === 'Guardian' && state.guardianFailure) {
          throw state.guardianFailure;
        }
        let found = definitions.get(codeRef.name);
        if (!found) {
          throw new FilterRefersToNonexistentTypeError(codeRef);
        }
        return { definition: found, types: [typeKey(codeRef)] };
      },
      toURL: (identifier) => new URL(identifier),
      isPolicyCard: (types) => types.includes(typeKey(realmPolicyRef)),
      typeKey,
      realmURL: EDUCATION,
      instanceTypesUnder: async () => [],
      instanceTypeKeys: async () => [],
    });
    return { cache, state };
  }

  function reachedVia(
    policy: Awaited<ReturnType<RealmPolicyCache['get']>>,
  ): (string | undefined)[] {
    return (policy?.issues ?? []).map(
      ({ message }) => /linked through `([^`]+)`/.exec(message)?.[1],
    );
  }

  test('a type the reach check cannot read leaves its branch unwalked, and is walked once it can be read', async function (assert) {
    let { cache, state } = reachSetup();
    state.guardianFailure = new Error('connection reset');
    let policy = await cache.get();
    assert.deepEqual(
      policy?.rules.map((rule) => rule.grants.map((grant) => grant.operation)),
      [['read']],
      'the policy compiles, and its grant is kept',
    );
    assert.deepEqual(
      reachedVia(policy),
      ['students'],
      'the students are walked, and the guardians are not',
    );

    noteRealmIndexMoved(EDUCATION);
    await until(
      () => cache.stats.revalidations === 1,
      'the move while the guardian still cannot be read lands',
    );
    assert.strictEqual(
      cache.stats.compiles,
      1,
      'a revalidation while it still cannot be read does not recompile',
    );

    state.guardianFailure = undefined;
    noteRealmIndexMoved(EDUCATION);
    await until(
      () => cache.stats.compiles === 2,
      'the move after the guardian can be read lands',
    );
    assert.deepEqual(
      reachedVia(await cache.get()),
      ['students', 'students.guardian'],
      'and the recompile walks it',
    );
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
