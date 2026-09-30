import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { isResolvedCodeRef, rri } from '@cardstack/runtime-common';
import type {
  CodeRef,
  CompiledOperationGrant,
  CompiledRealmPolicy,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  policyQueryScope,
  type OperationCore,
  type OperationDefinition,
} from '@cardstack/runtime-common/card-operations';
import type { Definition } from '@cardstack/runtime-common/definitions';

// ============================================================================
// What a realm's policy contributes to one named query, decided against a
// stubbed definition cache and compiled policy, so what is under test is the
// lookup alone: which grants contribute a filter, what `actor()` becomes in
// it, and which declarations no grant can reach. The endpoints that compose
// the result into a search are covered against real realms in
// `server-endpoints/policy-scoped-search-test`.
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
]);

// The filter a query grant compiles to: the caller's own schedules.
const OWN_FILTER = {
  'item.on': SCHEDULE,
  eq: { 'item.providerId': { $ref: 'actor' } },
} as CompiledOperationGrant['filter'];

// A grant as a test writes it. Its position in the policy is filled in.
type Grant = Omit<CompiledOperationGrant, 'path'>;

function stubCore(grants: Grant[]): OperationCore {
  let policy: CompiledRealmPolicy = {
    card: `${REALM}policies/policy`,
    version: '1',
    rules: [
      {
        targetType: SCHEDULE,
        path: 'rules[0]',
        grants: grants.map((grant, index) => ({
          ...grant,
          path: `rules[0].grants[${index}]`,
        })),
      },
    ],
    issues: [],
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
          types: [key(SCHEDULE), key(BASE_SCHEDULE)],
        };
      },
    },
    policy: {
      compiledPolicy: async () => policy,
      typeKeys: async (ref: ResolvedCodeRef) => [key(ref)],
      resolvedLink: (selfLink: string) => selfLink,
      policyCard: async () => policy.card,
    },
  } as unknown as OperationCore;
}

function scope(operation: string, grants: Grant[]) {
  return policyQueryScope(stubCore(grants), {
    operation,
    on: SCHEDULE,
    actor: ACTOR,
  });
}

module(basename(import.meta.filename), function () {
  test('a query grant contributes its filter, bound to the caller', async function (assert) {
    let result = await scope('listOpen', [
      { operation: 'listOpen', filter: OWN_FILTER },
    ]);
    assert.strictEqual(result.kind, 'scoped');
    assert.deepEqual(
      result.kind === 'scoped' ? result.filters : undefined,
      [{ on: SCHEDULE, eq: { providerId: ACTOR } }],
      'the filter in the grammar the engine runs, with actor() filled in',
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
