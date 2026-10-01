import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { isResolvedCodeRef, rri } from '@cardstack/runtime-common';
import type {
  CodeRef,
  CompiledOperationGrant,
  CompiledRealmPolicy,
  Filter,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  isOperationFailure,
  policyQueryScope,
  RealmAuthorityPolicyScopeError,
  realmPolicyRef,
  searchInvocation,
  type OperationCore,
  type OperationDefinition,
  type SearchPrincipal,
} from '@cardstack/runtime-common/card-operations';
import type { Definition } from '@cardstack/runtime-common/definitions';

// ============================================================================
// What a realm's policy contributes to one query, named or ad hoc, decided
// against a stubbed definition cache and compiled policy, so what is under
// test is the lookup alone: which grants contribute a filter, what `actor()`
// becomes in it, which declarations no grant can reach, and how a search on
// several types is judged. The endpoints that compose the result into a search
// are covered against real realms in `server-endpoints/policy-scoped-search-test`.
// ============================================================================

const REALM = 'http://example.test/school/';
const ACTOR = '@provider:localhost';

// A subclass of the base schedule type. The base type declares `listGuarded`
// out of every policy's reach; the subclass redeclares it without saying so,
// which its author is free to do.
const BASE_SCHEDULE: ResolvedCodeRef = {
  module: rri(`${REALM}schedule`),
  name: 'Schedule',
};
const SCHEDULE: ResolvedCodeRef = {
  module: rri(`${REALM}service-plan`),
  name: 'ServicePlanSchedule',
};
// A type no rule names, and that descends from neither schedule type.
const NOTICE: ResolvedCodeRef = {
  module: rri(`${REALM}notice`),
  name: 'Notice',
};
// A type the realm cannot resolve a definition for, so nothing about it can be
// judged.
const ELSEWHERE: ResolvedCodeRef = {
  module: rri(`${REALM}elsewhere`),
  name: 'Elsewhere',
};

function key(ref: ResolvedCodeRef) {
  return `${ref.module}/${ref.name}`;
}

function listing(nonGrantable?: true): OperationDefinition {
  return {
    base: 'query',
    deterministic: true,
    ...(nonGrantable ? { nonGrantable } : {}),
    query: { filter: { 'item.on': SCHEDULE } },
  };
}

function definitionOf(
  codeRef: ResolvedCodeRef,
  operations: Record<string, OperationDefinition>,
): Definition {
  return {
    type: 'card-def',
    codeRef,
    displayName: codeRef.name,
    fields: {},
    fieldDefs: {},
    operations,
  } as unknown as Definition;
}

const DEFINITIONS = new Map<string, Definition>([
  [
    key(BASE_SCHEDULE),
    definitionOf(BASE_SCHEDULE, { listGuarded: listing(true) }),
  ],
  [
    key(SCHEDULE),
    definitionOf(SCHEDULE, {
      listOpen: listing(),
      listLocked: listing(true),
      listGuarded: listing(),
    }),
  ],
  [key(NOTICE), definitionOf(NOTICE, {})],
]);

// The adoption chain the index records beside each type's definition.
const CHAINS = new Map<string, string[]>([
  [key(BASE_SCHEDULE), [key(BASE_SCHEDULE)]],
  [key(SCHEDULE), [key(SCHEDULE), key(BASE_SCHEDULE)]],
  [key(NOTICE), [key(NOTICE)]],
]);

// The filter a query grant compiles to: the caller's own schedules.
const OWN_FILTER = {
  'item.on': SCHEDULE,
  eq: { 'item.providerId': { $ref: 'actor' } },
} as CompiledOperationGrant['filter'];

// A grant as a test writes it. Its position in the policy is filled in.
type Grant = Omit<CompiledOperationGrant, 'path'>;

// `reads` counts how many times the compiled policy is read, and `ruleOn` is
// the type the policy's one rule targets. An `uncompilable` policy is one that
// did not compile as a whole, which has no rules whatever it was written with.
function stubCore(
  grants: Grant[],
  {
    reads = { policy: 0 },
    ruleOn = SCHEDULE,
    uncompilable,
  }: {
    reads?: { policy: number };
    ruleOn?: ResolvedCodeRef;
    uncompilable?: true;
  } = {},
): OperationCore {
  let policy: CompiledRealmPolicy = {
    card: `${REALM}policies/policy`,
    version: '1',
    rules: [
      {
        targetType: ruleOn,
        path: 'rules[0]',
        grants: grants.map((grant, index) => ({
          ...grant,
          path: `rules[0].grants[${index}]`,
        })),
      },
    ],
    issues: [],
    ...(uncompilable ? { rules: [], uncompilable } : {}),
  };
  return {
    realmURL: REALM,
    resolveCodeRef: (codeRef: CodeRef) =>
      isResolvedCodeRef(codeRef) ? codeRef : undefined,
    definitionLookup: {
      async lookupDefinition(ref: ResolvedCodeRef) {
        return DEFINITIONS.get(key(ref));
      },
      async lookupDefinitionEntry(ref: ResolvedCodeRef) {
        return {
          definition: DEFINITIONS.get(key(ref)),
          types: CHAINS.get(key(ref)),
        };
      },
    },
    policy: {
      compiledPolicy: async () => {
        reads.policy++;
        return policy;
      },
      typeKeys: async (ref: ResolvedCodeRef) => [key(ref)],
      resolvedLink: (selfLink: string) => selfLink,
      policyCard: async () => policy.card,
    },
  } as unknown as OperationCore;
}

function scope(
  operation: string,
  grants: Grant[],
  types: CodeRef[] = [SCHEDULE],
) {
  return policyQueryScope(stubCore(grants), {
    operation,
    types,
    principal: { kind: 'user', user: ACTOR },
  });
}

// The filter `OWN_FILTER` compiles to, in the grammar the engine runs.
const OWN = { on: SCHEDULE, eq: { providerId: ACTOR } };

// `filter` as a scope carries it: less the realm's config card, the card its
// policy key names, and every policy card, whichever grant it came from.
function scoped(filter: Filter): Filter {
  return {
    every: [
      filter,
      {
        not: {
          any: [
            { eq: { id: `${REALM}realm` } },
            { eq: { id: `${REALM}policies/policy` } },
            { type: realmPolicyRef },
          ],
        },
      },
    ],
  };
}

module(basename(import.meta.filename), function () {
  test('a query grant contributes its filter, bound to the caller', async function (assert) {
    let result = await scope('listOpen', [
      { operation: 'listOpen', filter: OWN_FILTER },
    ]);
    assert.strictEqual(result.kind, 'scoped');
    assert.deepEqual(
      result.kind === 'scoped' ? result.filters : undefined,
      [scoped(OWN)],
      'the filter in the grammar the engine runs, with actor() filled in',
    );
  });

  test('a realm-authority principal is refused before the policy is read, whatever the policy grants', async function (assert) {
    let reads = { policy: 0 };
    let core = stubCore(
      [
        { operation: 'listOpen', filter: OWN_FILTER },
        { operation: 'listOpen', filter: { 'item.on': SCHEDULE } },
      ],
      { reads },
    );
    let principal: SearchPrincipal = { kind: 'realm-authority', user: ACTOR };

    await assert.rejects(
      policyQueryScope(core, {
        operation: 'listOpen',
        types: [SCHEDULE],
        principal,
      }),
      (e: unknown) =>
        e instanceof RealmAuthorityPolicyScopeError &&
        e.message.includes(REALM) &&
        e.message.includes('"listOpen"'),
      'the lookup raises rather than answering with a scope, naming the realm and the query',
    );
    assert.strictEqual(reads.policy, 0, 'and the policy is never read');

    let scoped = await policyQueryScope(core, {
      operation: 'listOpen',
      types: [SCHEDULE],
      principal: { kind: 'user', user: ACTOR },
    });
    assert.strictEqual(
      scoped.kind,
      'scoped',
      'the same identity as a user is scoped by the grants as usual',
    );
  });

  test('an ad-hoc search is a query on its type, which a grant on a named query does not reach', async function (assert) {
    assert.deepEqual(
      await scope('query', [{ operation: 'listOpen', filter: OWN_FILTER }]),
      { kind: 'denied' },
      'a grant on a saved search is not a grant to write any filter over its type',
    );
    assert.deepEqual(
      await scope('query', [{ operation: 'query', filter: OWN_FILTER }]),
      { kind: 'scoped', filters: [scoped(OWN)] },
      'a grant on `query` is',
    );
  });

  test('a policy that did not compile refuses the query as the gate refuses, before any type is judged', async function (assert) {
    let core = stubCore([{ operation: 'query', filter: OWN_FILTER }], {
      uncompilable: true,
    });
    let refusedAsTheGateRefuses = (e: unknown) =>
      isOperationFailure(e) &&
      e.error.status === 500 &&
      e.error.title === 'Policy unavailable';
    for (let [types, what] of [
      [[SCHEDULE], 'a type the realm resolves'],
      [[ELSEWHERE], 'a type it cannot, which would otherwise be denied'],
      [[SCHEDULE, NOTICE], 'several types'],
    ] as [CodeRef[], string][]) {
      await assert.rejects(
        policyQueryScope(core, {
          operation: 'query',
          types,
          principal: { kind: 'user', user: ACTOR },
        }),
        refusedAsTheGateRefuses,
        `refused with the gate's 500 for ${what}`,
      );
    }
  });

  test('a search on no type is denied, and reads no policy to decide it', async function (assert) {
    let reads = { policy: 0 };
    let result = await policyQueryScope(
      stubCore([{ operation: 'query', filter: OWN_FILTER }], { reads }),
      {
        operation: 'query',
        types: [],
        principal: { kind: 'user', user: ACTOR },
      },
    );
    assert.deepEqual(result, { kind: 'denied' });
    assert.strictEqual(reads.policy, 0, 'no rule could admit it');
  });

  test('a search on several types admits each type only through its own grants', async function (assert) {
    assert.deepEqual(
      await scope(
        'query',
        [{ operation: 'query', filter: OWN_FILTER }],
        [SCHEDULE, NOTICE],
      ),
      { kind: 'scoped', filters: [scoped({ on: SCHEDULE, any: [OWN] })] },
      "the schedule type's grant, confined to schedules, and nothing for the type no rule names",
    );
    assert.deepEqual(
      await scope(
        'query',
        [{ operation: 'query', filter: OWN_FILTER }],
        [NOTICE],
      ),
      { kind: 'denied' },
      'which, searched alone, is denied',
    );
  });

  test('a grant on a type several share admits only the cards of a type whose own judgment admits them', async function (assert) {
    // The rule is on the base type, so its grant's filter is anchored there,
    // and it is matched for the schedule type, which descends from it. The
    // other type cannot be judged at all. Unconfined, the base type's filter
    // would admit the other type's cards too, were one of them a base
    // schedule, through the grant matched for the schedule type.
    const BASE_OWN_FILTER = {
      'item.on': BASE_SCHEDULE,
      eq: { 'item.providerId': { $ref: 'actor' } },
    } as CompiledOperationGrant['filter'];
    let result = await policyQueryScope(
      stubCore([{ operation: 'query', filter: BASE_OWN_FILTER }], {
        ruleOn: BASE_SCHEDULE,
      }),
      {
        operation: 'query',
        types: [SCHEDULE, ELSEWHERE],
        principal: { kind: 'user', user: ACTOR },
      },
    );
    assert.deepEqual(result, {
      kind: 'scoped',
      filters: [
        scoped({
          on: SCHEDULE,
          any: [{ on: BASE_SCHEDULE, eq: { providerId: ACTOR } }],
        }),
      ],
    });
  });

  test('a filter is judged by every type its matches adopt from, however its branches are ordered', async function (assert) {
    let typesOf = (filter: Record<string, unknown>) =>
      searchInvocation({ filter })!
        .types.map((type) => key(type as ResolvedCodeRef))
        .sort();
    let both = [key(BASE_SCHEDULE), key(SCHEDULE)].sort();
    let base = { 'item.on': BASE_SCHEDULE };
    let schedule = { 'item.on': SCHEDULE };
    assert.deepEqual(typesOf({ every: [base, schedule] }), both);
    assert.deepEqual(typesOf({ every: [schedule, base] }), both);
    assert.deepEqual(
      typesOf({ ...base, every: [schedule] }),
      both,
      'as is an anchored node over a body that names the other',
    );
    // An `every` may skip a branch that anchors nothing, since a match
    // satisfies every branch and so adopts from the anchored ones anyway. An
    // `any` may not: a match of its unanchored branch can be of any type at
    // all, so no list of types bounds what the filter matches.
    assert.deepEqual(
      typesOf({ any: [schedule, { eq: { 'item.title': 'x' } }] }),
      [],
      'an `any` with a branch that anchors nothing is judged by no type',
    );

    // Granted on the schedule type alone, which each match of either order
    // is, so both orders are admitted alike.
    for (let every of [
      [base, schedule],
      [schedule, base],
    ]) {
      assert.deepEqual(
        await scope(
          'query',
          [{ operation: 'query', filter: OWN_FILTER }],
          searchInvocation({ filter: { every } })!.types,
        ),
        { kind: 'scoped', filters: [scoped({ on: SCHEDULE, any: [OWN] })] },
      );
    }
  });

  test('a type named twice is judged once', async function (assert) {
    assert.deepEqual(
      await scope(
        'query',
        [{ operation: 'query', filter: OWN_FILTER }],
        [SCHEDULE, { ...SCHEDULE }],
      ),
      { kind: 'scoped', filters: [scoped(OWN)] },
      'as a search on the one type is',
    );
  });

  test('a grant on another operation, or with no filter, contributes nothing', async function (assert) {
    assert.deepEqual(
      await scope('listOpen', [{ operation: 'read', filter: OWN_FILTER }]),
      { kind: 'denied' },
      'a grant on `read`, even one carrying a filter',
    );
    assert.deepEqual(
      await scope('listOpen', [{ operation: 'listOpen' }]),
      { kind: 'denied' },
      'a query grant whose predicate compiled no filter',
    );
  });

  test('a query declared out of every policy’s reach contributes nothing, whatever the policy grants', async function (assert) {
    assert.deepEqual(
      await scope('listLocked', [
        { operation: 'listLocked', filter: OWN_FILTER },
      ]),
      { kind: 'denied' },
    );
  });

  test('a subclass cannot make grantable what the type it extends kept out of reach', async function (assert) {
    assert.deepEqual(
      await scope('listGuarded', [
        { operation: 'listGuarded', filter: OWN_FILTER },
      ]),
      { kind: 'denied' },
      'the base type declares it nonGrantable, and the subclass redeclaring it without the flag does not lift that',
    );
  });
});
