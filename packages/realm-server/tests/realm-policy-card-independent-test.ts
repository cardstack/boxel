import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  FilterRefersToNonexistentTypeError,
  realmPolicyRef,
  rri,
  type CompiledOperationGrant,
  type CompiledRealmPolicy,
  type Definition,
  type FieldDefinition,
  type IndexedInstanceSource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { RealmPolicyCache } from '@cardstack/runtime-common/card-operations';
import { readsNothingOfTheCard } from '@cardstack/runtime-common/card-operations/policy-card-independent';
import { profileRefusals } from '@cardstack/runtime-common/card-operations/policy-profile';
import { parseBxlAst } from '@cardstack/bxl';

// ============================================================================
// A query grant whose predicate reads nothing of the card: which predicates
// those are, and what such a grant compiles to. Driven through the
// compiled-policy cache over an environment held in memory, with no realm, no
// database and no prerender. What a search composes from such a grant is in
// `policy-query-scope-test`, and a search a real realm answers with it in
// `server-endpoints/policy-scoped-search-test`.
// ============================================================================

const ORG = 'http://card-independent.test/org/';
const GOVERNED = 'http://card-independent.test/governed/';
const POLICY_CARD = `${ORG}policies/notes`;

const NOTE: ResolvedCodeRef = {
  module: rri(`${GOVERNED}note`),
  name: 'Note',
};
const STRING_FIELD = {
  module: rri('@cardstack/base/card-api'),
  name: 'StringField',
};

const REVIEWERS = 'realmConfig("reviewers") | any(. == actor())';

function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: STRING_FIELD,
    ...overrides,
  };
}

// A note stores its status and its owner, and computes a summary, which only
// the index holds.
const NOTE_DEFINITION = {
  type: 'card-def',
  codeRef: NOTE,
  displayName: 'Note',
  fields: { status: 'status', owner: 'owner', summary: 'summary' },
  fieldDefs: {
    status: field(),
    owner: field(),
    summary: field({ isComputed: true }),
  },
  operations: {},
} as unknown as Definition;

type Grant = { operation: string; where?: string };

async function compile(grants: Grant[]): Promise<CompiledRealmPolicy> {
  let typeKey = (ref: ResolvedCodeRef) => `${ref.module}/${ref.name}`;
  let policyKey = typeKey(realmPolicyRef);
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
          reviewers: ['@reviewer:localhost'],
          rules: [
            {
              targetType: { module: NOTE.module, name: NOTE.name },
              grants,
            },
          ],
        },
        meta: { adoptsFrom: realmPolicyRef },
      },
    }),
    resolveCodeRef: (codeRef) =>
      codeRef.module === NOTE.module ? NOTE : undefined,
    lookupDefinitionEntry: async (codeRef) => {
      if (codeRef.module !== NOTE.module) {
        throw new FilterRefersToNonexistentTypeError(
          codeRef as ResolvedCodeRef,
        );
      }
      return { definition: NOTE_DEFINITION, types: [typeKey(NOTE)] };
    },
    toURL: (identifier) => new URL(identifier),
    isPolicyCard: (types) => types.includes(policyKey),
    typeKey,
    realmURL: GOVERNED,
    instanceTypesUnder: async () => [],
    instanceTypeKeys: async () => [],
    revisitCard: async () => {},
  });
  let policy = await cache.get();
  if (!policy) {
    throw new Error('the realm has no policy');
  }
  return policy;
}

// What a policy records about its grants beyond the code they need, which
// `realm-policy-module-access-test` covers.
function issuesOf(policy: CompiledRealmPolicy) {
  return policy.issues
    .filter(({ code }) => code !== 'module-not-granted')
    .map(({ code, path }) => ({ code, path }));
}

function grantOf(policy: CompiledRealmPolicy): CompiledOperationGrant {
  return policy.rules[0].grants[0];
}

function reads(source: string): boolean {
  let { body, profileIssues } = parseBxlAst(source, { profile: 'policy' });
  let refusals = profileRefusals(profileIssues, [
    'actor',
    'instance',
    'realmConfig',
    'policy',
  ]);
  if (refusals.length > 0) {
    throw new Error(`the policy profile refuses ${source}`);
  }
  return !readsNothingOfTheCard(body);
}

module(basename(import.meta.filename), function () {
  module('which predicates read nothing of the card', function () {
    test('a predicate over the caller, the realm and the policy card alone', function (assert) {
      for (let source of [
        REVIEWERS,
        'actor() == "@reviewer:localhost"',
        'actor() != "anonymous"',
        'policy().reviewers | any(. == actor())',
        'realmConfig("reviewers") as $list | $list | any(. == actor())',
        '(realmConfig("open") == true) and (realmConfig("reviewers") | any(. == actor()))',
        'realmConfig("teams") | map(.members) | any(any(. == actor()))',
        // The card is put in an array and dropped, unread.
        '[.] | true',
      ]) {
        assert.false(reads(source), source);
      }
    });

    test('a predicate that reads the card anywhere', function (assert) {
      for (let source of [
        '.owner == actor()',
        '.reviewers | any(. == actor())',
        'instance().owner == actor()',
        '(realmConfig("reviewers") | any(. == actor())) and .status == "open"',
        '. as $note | true',
        '(., .[]) | true',
        'if . then true else false end',
        'realmConfig(.key) | any(. == actor())',
        '[.[]] | length > 0',
        '"\\(.status)" == "open"',
        'has("owner")',
        '{owner} | .owner == actor()',
        '.[0] == 1',
        '(.status | length) > 0',
        'IF(.status == "open"; true; false)',
      ]) {
        assert.true(reads(source), source);
      }
    });
  });

  module(
    'a query grant whose predicate reads nothing of the card',
    function () {
      test('carries the filter it composes once settled, and no filter of its own', async function (assert) {
        let policy = await compile([{ operation: 'query', where: REVIEWERS }]);
        assert.deepEqual(issuesOf(policy), [], 'nothing is recorded');
        let grant = grantOf(policy);
        assert.deepEqual(grant.settledFilter, { 'item.on': NOTE });
        assert.strictEqual(
          grant.filter,
          undefined,
          'nothing composes it without settling it',
        );
        assert.ok(grant.where, 'and it keeps its predicate');
      });

      test("one reading the policy card's fields compiles the same way", async function (assert) {
        let policy = await compile([
          {
            operation: 'query',
            where: 'policy().reviewers | any(. == actor())',
          },
        ]);
        assert.deepEqual(issuesOf(policy), []);
        assert.deepEqual(grantOf(policy).settledFilter, { 'item.on': NOTE });
      });

      test('a predicate that also reads the card is compiled to a filter, or recorded as not filterable, as any other is', async function (assert) {
        let mixed = await compile([
          {
            operation: 'query',
            where: `(${REVIEWERS}) and .status == "open"`,
          },
        ]);
        assert.deepEqual(issuesOf(mixed), [
          { code: 'policy-not-filterable', path: 'rules[0].grants[0].where' },
        ]);
        assert.strictEqual(grantOf(mixed).settledFilter, undefined);
        assert.strictEqual(grantOf(mixed).filter, undefined);

        let own = await compile([
          { operation: 'query', where: '.owner == actor()' },
        ]);
        assert.deepEqual(issuesOf(own), []);
        assert.deepEqual(grantOf(own).filter, {
          'item.on': NOTE,
          eq: { 'item.owner': { $ref: 'actor' } },
        });
        assert.strictEqual(grantOf(own).settledFilter, undefined);
      });

      test('a reading settled when the policy compiles is compiled as it was settled', async function (assert) {
        let signedIn = await compile([
          { operation: 'query', where: 'actor() != "anonymous"' },
        ]);
        assert.deepEqual(grantOf(signedIn).filter, { 'item.on': NOTE });
        assert.strictEqual(grantOf(signedIn).settledFilter, undefined);

        let either = await compile([
          {
            operation: 'query',
            where: `actor() == "anonymous" or (${REVIEWERS})`,
          },
        ]);
        assert.deepEqual(issuesOf(either), []);
        let grant = grantOf(either);
        assert.deepEqual(
          grant.anonymousFilter,
          { 'item.on': NOTE },
          "a caller who isn't signed in is admitted outright",
        );
        assert.strictEqual(grant.anonymousSettledFilter, undefined);
        assert.deepEqual(
          grant.settledFilter,
          { 'item.on': NOTE },
          'a signed-in caller is admitted once the predicate holds for them',
        );
        assert.strictEqual(grant.filter, undefined);
      });

      test("a reading for callers who aren't signed in that still reads the realm is settled per search too", async function (assert) {
        let policy = await compile([
          {
            operation: 'query',
            where: `actor() == "anonymous" and realmConfig("open") == true`,
          },
        ]);
        let grant = grantOf(policy);
        assert.deepEqual(grant.anonymousSettledFilter, { 'item.on': NOTE });
        assert.strictEqual(grant.anonymousFilter, undefined);
        assert.strictEqual(
          grant.settledFilter,
          undefined,
          'a signed-in caller never holds',
        );
        assert.strictEqual(grant.filter, undefined);
      });

      test('a read grant carries no filter of either kind', async function (assert) {
        let policy = await compile([{ operation: 'read', where: REVIEWERS }]);
        let grant = grantOf(policy);
        assert.strictEqual(grant.settledFilter, undefined);
        assert.strictEqual(grant.filter, undefined);
      });
    },
  );
});
