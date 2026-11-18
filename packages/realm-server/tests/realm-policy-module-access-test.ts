import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  FilterRefersToNonexistentTypeError,
  realmPolicyRef,
  rri,
  type CompiledRealmPolicy,
  type Definition,
  type IndexedInstanceSource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { RealmPolicyCache } from '@cardstack/runtime-common/card-operations';

// ============================================================================
// Whether the callers a `read` or `query` grant admits can load the code that
// renders the cards, decided when the policy compiles: driven through the
// compiled-policy cache over an environment held in memory, with no realm, no
// database and no prerender.
//
// The governed realm defines a note type and a pinned note descending from
// it. A shared realm, whose code every caller can load under its own
// permissions, defines a shared note. The policy card lives in an org realm.
// ============================================================================

const GOVERNED = 'http://module-access.test/governed/';
const SHARED = 'http://module-access.test/shared/';
const ORG = 'http://module-access.test/org/';
const BASE = 'http://module-access.test/base/';
const POLICY_CARD = `${ORG}policies/access`;

const NOTE: ResolvedCodeRef = {
  module: rri(`${GOVERNED}notes/note`),
  name: 'Note',
};
const PINNED: ResolvedCodeRef = {
  module: rri(`${GOVERNED}notes/pinned`),
  name: 'PinnedNote',
};
const SHARED_NOTE: ResolvedCodeRef = {
  module: rri(`${SHARED}note`),
  name: 'SharedNote',
};
const CARD_DEF: ResolvedCodeRef = {
  module: rri('@cardstack/base/card-api'),
  name: 'CardDef',
};
const FILE_DEF: ResolvedCodeRef = {
  module: rri('@cardstack/base/file-api'),
  name: 'FileDef',
};
const TS_FILE_DEF: ResolvedCodeRef = {
  module: rri('@cardstack/base/ts-file-def'),
  name: 'TsFileDef',
};
const GTS_FILE_DEF: ResolvedCodeRef = {
  module: rri('@cardstack/base/gts-file-def'),
  name: 'GtsFileDef',
};

const READERS = 'realmConfig("readers") | any(. == actor())';

function key(ref: ResolvedCodeRef) {
  return `${ref.module}/${ref.name}`;
}

function definition(
  codeRef: ResolvedCodeRef,
  type: 'card-def' | 'file-def' = 'card-def',
): Definition {
  return {
    type,
    codeRef,
    displayName: codeRef.name,
    fields: {},
    fieldDefs: {},
    operations: {},
  } as unknown as Definition;
}

// Each type's definition, and the adoption chain recorded beside it.
const TYPES = new Map<string, { definition: Definition; types: string[] }>([
  [key(CARD_DEF), { definition: definition(CARD_DEF), types: [key(CARD_DEF)] }],
  [
    key(NOTE),
    { definition: definition(NOTE), types: [key(NOTE), key(CARD_DEF)] },
  ],
  [
    key(PINNED),
    {
      definition: definition(PINNED),
      types: [key(PINNED), key(NOTE), key(CARD_DEF)],
    },
  ],
  [
    key(SHARED_NOTE),
    {
      definition: definition(SHARED_NOTE),
      types: [key(SHARED_NOTE), key(CARD_DEF)],
    },
  ],
  [
    key(FILE_DEF),
    { definition: definition(FILE_DEF, 'file-def'), types: [key(FILE_DEF)] },
  ],
  [
    key(TS_FILE_DEF),
    {
      definition: definition(TS_FILE_DEF, 'file-def'),
      types: [key(TS_FILE_DEF), key(FILE_DEF)],
    },
  ],
  [
    key(GTS_FILE_DEF),
    {
      definition: definition(GTS_FILE_DEF, 'file-def'),
      types: [key(GTS_FILE_DEF), key(TS_FILE_DEF), key(FILE_DEF)],
    },
  ],
]);

type Grant = { operation: string; where?: string };
type Rule = { on: ResolvedCodeRef; grants: Grant[] };

// The types the governed realm holds cards of, as the first key of each
// card's adoption chain.
type Held = ResolvedCodeRef[];

function setup(rules: Rule[], held: Held = [NOTE]) {
  let state = { asked: 0 };
  let policyKey = key(realmPolicyRef);
  let cache = new RealmPolicyCache({
    policyCard: async () => POLICY_CARD,
    readCard: async (): Promise<IndexedInstanceSource> => ({
      url: `${POLICY_CARD}.json`,
      realmURL: ORG,
      generation: 1,
      sourceContentHash: 'v1',
      types: [policyKey],
      error: null,
      failureWithheld: false,
      instance: {
        id: rri(POLICY_CARD),
        type: 'card',
        attributes: {
          rules: rules.map(({ on, grants }) => ({
            targetType: { module: on.module, name: on.name },
            grants,
          })),
        },
        meta: { adoptsFrom: realmPolicyRef },
      },
    }),
    resolveCodeRef: (codeRef) =>
      TYPES.has(`${codeRef.module}/${codeRef.name}`)
        ? (codeRef as ResolvedCodeRef)
        : undefined,
    lookupDefinitionEntry: async (codeRef) => {
      let found = TYPES.get(key(codeRef as ResolvedCodeRef));
      if (!found) {
        throw new FilterRefersToNonexistentTypeError(
          codeRef as ResolvedCodeRef,
        );
      }
      return found;
    },
    toURL: (identifier) =>
      new URL(identifier.replace(/^@cardstack\/base\//, BASE)),
    isPolicyCard: (types) => types.includes(policyKey),
    typeKey: key,
    realmURL: GOVERNED,
    instanceTypesUnder: async (codeRef) => {
      state.asked++;
      return held
        .filter((type) =>
          TYPES.get(key(type))?.types.includes(key(codeRef as ResolvedCodeRef)),
        )
        .map(key)
        .sort();
    },
    instanceTypeKeys: async () => held.map(key).sort(),
    revisitCard: async () => {},
  });
  return { cache, state };
}

async function compile(
  rules: Rule[],
  held?: Held,
): Promise<CompiledRealmPolicy> {
  let policy = await setup(rules, held).cache.get();
  if (!policy) {
    throw new Error('the realm has no policy');
  }
  return policy;
}

function moduleIssues(
  policy: CompiledRealmPolicy,
): CompiledRealmPolicy['issues'] {
  return policy.issues.filter(({ code }) => code === 'module-not-granted');
}

const CODE_GRANT: Rule = {
  on: TS_FILE_DEF,
  grants: [{ operation: 'readSource', where: READERS }],
};

module(basename(import.meta.filename), function () {
  test('a read grant on a type the realm defines, with no grant on its code, records a warning naming the module and the grant to add', async function (assert) {
    let policy = await compile([
      { on: NOTE, grants: [{ operation: 'read', where: READERS }] },
    ]);
    let [issue, ...rest] = moduleIssues(policy);
    assert.strictEqual(rest.length, 0, 'one issue');
    assert.strictEqual(issue?.path, 'rules[0].grants[0]');
    assert.strictEqual(issue?.severity, 'warning', 'the grant stays live');
    assert.ok(issue?.message.includes('`notes/note`'), 'names the module');
    assert.ok(
      issue?.message.includes(
        'Add a rule on `TsFileDef` (`@cardstack/base/ts-file-def`) that grants `readSource`',
      ),
      'names the grant to add',
    );
    assert.strictEqual(
      policy.rules[0].grants.length,
      1,
      'the read grant is kept',
    );
  });

  test('so does a query grant', async function (assert) {
    let policy = await compile([
      { on: NOTE, grants: [{ operation: 'query' }] },
    ]);
    assert.deepEqual(
      moduleIssues(policy).map(({ path }) => path),
      ['rules[0].grants[0]'],
    );
    assert.ok(
      moduleIssues(policy)[0].message.includes('find `Note` cards'),
      'says the grant lets its callers find the cards',
    );
  });

  test('a grant on a subtype names the modules of the types it descends from that the realm defines', async function (assert) {
    let policy = await compile(
      [{ on: PINNED, grants: [{ operation: 'read', where: READERS }] }],
      [PINNED],
    );
    let [issue] = moduleIssues(policy);
    assert.ok(issue?.message.includes('`notes/pinned`'));
    assert.ok(issue?.message.includes('`notes/note`'));
  });

  test('a readSource grant on TsFileDef clears it', async function (assert) {
    let policy = await compile([
      { on: NOTE, grants: [{ operation: 'read', where: READERS }] },
      CODE_GRANT,
    ]);
    assert.deepEqual(moduleIssues(policy), []);
  });

  test('so does one on GtsFileDef', async function (assert) {
    let policy = await compile([
      { on: NOTE, grants: [{ operation: 'read', where: READERS }] },
      { on: GTS_FILE_DEF, grants: [{ operation: 'readSource' }] },
    ]);
    assert.deepEqual(moduleIssues(policy), []);
  });

  test('a readSource grant on FileDef, which does not reach code, leaves it', async function (assert) {
    let policy = await compile([
      { on: NOTE, grants: [{ operation: 'read', where: READERS }] },
      { on: FILE_DEF, grants: [{ operation: 'readSource' }] },
    ]);
    assert.deepEqual(
      moduleIssues(policy).map(({ path }) => path),
      ['rules[0].grants[0]'],
    );
  });

  test('a read grant on CardDef names the modules of the types the realm defines and holds cards of, and a code grant clears it', async function (assert) {
    let rule: Rule = {
      on: CARD_DEF,
      grants: [{ operation: 'read', where: READERS }],
    };
    let policy = await compile([rule], [PINNED, SHARED_NOTE, NOTE]);
    let [issue, ...rest] = moduleIssues(policy);
    assert.strictEqual(rest.length, 0, 'one issue');
    assert.strictEqual(issue?.path, 'rules[0].grants[0]');
    assert.ok(issue?.message.includes('`notes/note`'));
    assert.ok(issue?.message.includes('`notes/pinned`'));
    assert.notOk(
      issue?.message.includes('shared'),
      'leaves out a module another realm serves',
    );

    let covered = await compile(
      [rule, CODE_GRANT],
      [PINNED, SHARED_NOTE, NOTE],
    );
    assert.deepEqual(moduleIssues(covered), []);
  });

  test('a grant on a type another realm defines, where the realm holds no card of a type of its own, records nothing and reads no card', async function (assert) {
    let { cache, state } = setup(
      [
        { on: SHARED_NOTE, grants: [{ operation: 'read', where: READERS }] },
        { on: CARD_DEF, grants: [{ operation: 'read', where: READERS }] },
      ],
      [SHARED_NOTE],
    );
    let policy = (await cache.get())!;
    assert.deepEqual(moduleIssues(policy), []);
    assert.strictEqual(
      state.asked,
      0,
      'the realm holds no type of its own, so nothing under a rule type is read',
    );
  });

  test("the realm's first card of a type it defines brings the warning to a cached policy, and a card of another realm's type does not recompile it", async function (assert) {
    let held: Held = [SHARED_NOTE];
    let { cache } = setup(
      [{ on: CARD_DEF, grants: [{ operation: 'read', where: READERS }] }],
      held,
    );
    assert.deepEqual(moduleIssues((await cache.get())!), []);

    held.push(FILE_DEF);
    cache.indexMoved(GOVERNED);
    assert.deepEqual(moduleIssues((await cache.get())!), []);
    assert.strictEqual(
      cache.stats.compiles,
      1,
      'a card of a type the realm does not define is revalidated, not compiled',
    );

    held.push(NOTE);
    cache.indexMoved(GOVERNED);
    let policy = (await cache.get())!;
    assert.strictEqual(cache.stats.compiles, 2, 'compiled again');
    assert.deepEqual(
      moduleIssues(policy).map(({ path }) => path),
      ['rules[0].grants[0]'],
    );
    assert.ok(moduleIssues(policy)[0].message.includes('`notes/note`'));
  });

  test('a policy whose code grant covers every caller reads no card', async function (assert) {
    let { cache, state } = setup([
      { on: CARD_DEF, grants: [{ operation: 'read', where: READERS }] },
      CODE_GRANT,
    ]);
    await cache.get();
    assert.strictEqual(state.asked, 0);
  });

  test('a grant that hands no card to read records nothing', async function (assert) {
    let policy = await compile([
      {
        on: NOTE,
        grants: [
          { operation: 'update', where: READERS },
          { operation: 'delete', where: READERS },
        ],
      },
    ]);
    assert.deepEqual(moduleIssues(policy), []);
  });

  module("callers who aren't signed in", function () {
    const OPEN = 'actor() == "anonymous"';

    test('a read grant opened to them, where the code grant is not, records a warning for them', async function (assert) {
      let policy = await compile([
        { on: NOTE, grants: [{ operation: 'read', where: OPEN }] },
        CODE_GRANT,
      ]);
      let [issue, ...rest] = moduleIssues(policy);
      assert.strictEqual(rest.length, 0, 'one issue');
      assert.strictEqual(issue?.path, 'rules[0].grants[0]');
      assert.ok(
        issue?.message.includes("callers who aren't signed in"),
        'says which callers',
      );
    });

    test('a code grant opened to them too clears it', async function (assert) {
      let policy = await compile([
        { on: NOTE, grants: [{ operation: 'read', where: OPEN }] },
        {
          on: TS_FILE_DEF,
          grants: [
            { operation: 'readSource', where: `${OPEN} or (${READERS})` },
          ],
        },
      ]);
      assert.deepEqual(moduleIssues(policy), []);
    });

    test('a code grant opened only to them leaves the warning on a grant for signed-in callers, naming them', async function (assert) {
      let policy = await compile([
        {
          on: NOTE,
          grants: [
            { operation: 'read', where: READERS },
            { operation: 'query', where: `${OPEN} or (${READERS})` },
          ],
        },
        { on: TS_FILE_DEF, grants: [{ operation: 'readSource', where: OPEN }] },
      ]);
      let issues = moduleIssues(policy);
      assert.deepEqual(
        issues.map(({ path }) => path),
        ['rules[0].grants[0]', 'rules[0].grants[1]'],
        'each grant that admits signed-in callers is warned about',
      );
      assert.ok(
        issues[1].message.includes('lets signed-in callers find `Note` cards'),
        'a grant that admits both kinds says which kind the code grant leaves out',
      );
      assert.ok(
        issues[1].message.includes(
          "The policy's `readSource` grants on code admit only callers who aren't signed in.",
        ),
        'says why the code grant does not cover them',
      );
    });

    test('a code grant opened only to them clears the warning on a grant opened only to them', async function (assert) {
      let policy = await compile([
        { on: NOTE, grants: [{ operation: 'read', where: OPEN }] },
        { on: TS_FILE_DEF, grants: [{ operation: 'readSource', where: OPEN }] },
      ]);
      assert.deepEqual(moduleIssues(policy), []);
    });
  });
});
