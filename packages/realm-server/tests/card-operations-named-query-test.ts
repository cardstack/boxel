import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { isResolvedCodeRef, rri } from '@cardstack/runtime-common';
import type { CodeRef, ResolvedCodeRef } from '@cardstack/runtime-common';
import {
  isNamedQueryPayload,
  isOperationFailure,
  resolveNamedQuery,
  type NamedQueryContext,
  type OperationCore,
  type OperationDefinition,
} from '@cardstack/runtime-common/card-operations';
import type { Definition } from '@cardstack/runtime-common/definitions';

// ============================================================================
// Resolving a named query against a type's stored definition.
//
// The definition cache is stubbed, so what is under test is the resolution
// alone: which members of the request survive it, what `actor()` becomes,
// which realms the query ends up scoped to, and what changes in a render. The
// endpoints that call it are covered against a real realm in
// `server-endpoints/named-query-test`.
// ============================================================================

const REALM_A = 'http://example.test/a/';
const REALM_B = 'http://example.test/b/';
const REPORT: ResolvedCodeRef = {
  module: rri(`${REALM_A}report`),
  name: 'Report',
};
const ANCHOR = { 'item.on': REPORT };

const OPERATIONS: Record<string, OperationDefinition> = {
  byStatus: {
    base: 'query',
    deterministic: true,
    params: { status: {} as any },
    query: {
      filter: {
        ...ANCHOR,
        eq: { 'item.status': { $ref: 'params', key: 'status' } as const },
      },
    },
  },
  mine: {
    base: 'query',
    deterministic: true,
    query: {
      filter: { ...ANCHOR, eq: { 'item.owner': { $ref: 'actor' } as const } },
    },
  },
  // A declaration may order a search without narrowing it.
  newestFirst: {
    base: 'query',
    deterministic: true,
    query: { sort: [{ by: 'item.createdAt', direction: 'desc' }] },
  },
  ranked: {
    base: 'query',
    deterministic: true,
    query: {
      filter: { ...ANCHOR, eq: { 'item.status': 'open' } },
      sort: [{ by: 'item.rank', 'item.on': REPORT, direction: 'asc' }],
      page: { size: 2 },
    },
  },
  inA: {
    base: 'query',
    deterministic: true,
    query: {
      filter: { ...ANCHOR, eq: { 'item.status': 'open' } },
      realms: [REALM_A],
    },
  },
  // Not something the authoring decorator lets a card declare, so it can only
  // reach a stored definition some other way; resolving one still refuses it.
  nowhere: {
    base: 'query',
    deterministic: true,
    query: { filter: { ...ANCHOR, eq: { 'item.status': 'open' } }, realms: [] },
  },
  retitle: { base: 'transform', deterministic: true },
};

function stubCore() {
  let definition: Definition = {
    type: 'card-def',
    codeRef: REPORT,
    displayName: 'Report',
    fields: {},
    fieldDefs: {},
    operations: OPERATIONS,
  } as unknown as Definition;
  let core = {
    realmURL: REALM_A,
    definitionLookup: {
      async lookupDefinition() {
        return definition;
      },
    },
    resolveCodeRef: (codeRef: CodeRef) =>
      isResolvedCodeRef(codeRef) ? codeRef : undefined,
  } as unknown as OperationCore;
  return { core };
}

const CONTEXT: NamedQueryContext = {
  actor: '@caller:localhost',
  realms: [REALM_A, REALM_B],
};

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    if (isOperationFailure(e)) {
      return e.error;
    }
    throw e;
  }
  throw new Error('expected the named query to be refused');
}

module(basename(import.meta.filename), function () {
  test('the named form is decided by `operation` alone', function (assert) {
    assert.true(isNamedQueryPayload({ operation: 'byStatus', on: REPORT }));
    assert.false(
      isNamedQueryPayload({ on: REPORT, params: {} }),
      'a body without it is an ad-hoc query, refused there for what it carries',
    );
    assert.false(isNamedQueryPayload({ filter: ANCHOR }));
  });

  test('the declaration’s filter replaces the one the request carries', async function (assert) {
    let { core } = stubCore();
    let resolved = await resolveNamedQuery(
      core,
      {
        operation: 'byStatus',
        on: REPORT,
        params: { status: 'open' },
        filter: { 'item.on': { module: `${REALM_A}anything`, name: 'Any' } },
        realms: [REALM_A],
      },
      CONTEXT,
    );

    assert.deepEqual(resolved.filter, {
      ...ANCHOR,
      eq: { 'item.status': 'open' },
    });
    assert.deepEqual(
      Object.keys(resolved).sort(),
      ['filter', 'realms'],
      'and what it resolves to is an ad-hoc query, carrying none of the members that named it',
    );
  });

  test('a declaration that writes no filter still drops the caller’s', async function (assert) {
    let { core } = stubCore();
    let resolved = await resolveNamedQuery(
      core,
      {
        operation: 'newestFirst',
        on: REPORT,
        filter: { ...ANCHOR, eq: { 'item.status': 'open' } },
        realms: [REALM_A],
      },
      CONTEXT,
    );

    assert.strictEqual(
      resolved.filter,
      undefined,
      'the declaration searches everything it is scoped to, and a caller cannot narrow that into a query of its own choosing',
    );
    assert.deepEqual(resolved.sort, [
      { by: 'item.createdAt', direction: 'desc' },
    ]);
  });

  test('the rendering a caller asks for carries over onto the declaration’s filter', async function (assert) {
    let { core } = stubCore();
    let htmlQuery = { eq: { format: 'embedded' } };
    let forged = {
      ...ANCHOR,
      eq: { 'item.status': 'closed', htmlQuery },
    };

    let declared = await resolveNamedQuery(
      core,
      {
        operation: 'byStatus',
        on: REPORT,
        params: { status: 'open' },
        filter: forged,
        realms: [REALM_A],
      },
      CONTEXT,
    );
    assert.deepEqual(
      declared.filter,
      { ...ANCHOR, eq: { 'item.status': 'open', htmlQuery } },
      'the binding joins the declared filter, and nothing else of the caller’s does',
    );

    let unfiltered = await resolveNamedQuery(
      core,
      {
        operation: 'newestFirst',
        on: REPORT,
        filter: forged,
        realms: [REALM_A],
      },
      CONTEXT,
    );
    assert.deepEqual(
      unfiltered.filter,
      { eq: { htmlQuery } },
      'and a declaration with no filter carries the binding alone, which matches every row',
    );
  });

  test('the declaration wins where it speaks, and the caller fills what it left open', async function (assert) {
    let { core } = stubCore();
    let callerSort = [
      { by: 'item.rank', 'item.on': REPORT, direction: 'desc' as const },
    ];
    let callerMembers = {
      sort: callerSort,
      page: { size: 10, number: 3 },
      fields: { entry: ['item'] },
      cardUrls: [`${REALM_A}r1`],
      scope: 'cards',
      realms: [REALM_A],
    };

    let declared = await resolveNamedQuery(
      core,
      { operation: 'ranked', on: REPORT, ...callerMembers },
      CONTEXT,
    );
    assert.deepEqual(
      declared.sort,
      [{ by: 'item.rank', 'item.on': REPORT, direction: 'asc' }],
      'a declared sort stands',
    );
    assert.deepEqual(declared.page, { size: 2 }, 'a declared page stands');
    assert.deepEqual(
      declared.fields,
      { entry: ['item'] },
      'the caller’s fields',
    );
    assert.deepEqual(
      declared.cardUrls,
      [`${REALM_A}r1`],
      'the caller’s cardUrls',
    );
    assert.strictEqual(declared.scope, 'cards', 'the caller’s scope');

    let open = await resolveNamedQuery(
      core,
      {
        operation: 'byStatus',
        on: REPORT,
        params: { status: 'open' },
        ...callerMembers,
      },
      CONTEXT,
    );
    assert.deepEqual(
      open.sort,
      callerSort,
      'no declared sort takes the caller’s',
    );
    assert.deepEqual(open.page, { size: 10, number: 3 }, 'and so does page');
  });

  test('actor() is the context’s user, never anything the request carries', async function (assert) {
    let { core } = stubCore();
    let resolved = await resolveNamedQuery(
      core,
      {
        operation: 'mine',
        on: REPORT,
        params: { actor: '@someone-else:localhost' },
        realms: [REALM_A],
      },
      CONTEXT,
    );
    assert.deepEqual(resolved.filter?.eq, {
      'item.owner': '@caller:localhost',
    });

    let anonymous = await refusal(
      resolveNamedQuery(
        core,
        { operation: 'mine', on: REPORT, realms: [REALM_A] },
        { ...CONTEXT, actor: undefined },
      ),
    );
    assert.strictEqual(anonymous.code, 'actor-required');
  });

  test('a declaration that names no realms searches the request’s', async function (assert) {
    let { core } = stubCore();
    let resolved = await resolveNamedQuery(
      core,
      { operation: 'byStatus', on: REPORT, params: { status: 'open' } },
      CONTEXT,
    );
    assert.deepEqual(resolved.realms, [REALM_A, REALM_B]);
  });

  test('a declaration’s own realms are narrowed to the ones the request may search', async function (assert) {
    let { core } = stubCore();
    let both = await resolveNamedQuery(
      core,
      { operation: 'inA', on: REPORT },
      CONTEXT,
    );
    assert.deepEqual(
      both.realms,
      [REALM_A],
      'never a realm the declaration left out',
    );

    let outside = await refusal(
      resolveNamedQuery(
        core,
        { operation: 'inA', on: REPORT },
        { ...CONTEXT, realms: [REALM_B] },
      ),
    );
    assert.strictEqual(outside.status, 400);
    assert.true(/may search none of them/.test(outside.detail));
    assert.false(
      outside.detail.includes(REALM_A),
      'the refusal does not name the realms a declaration is scoped to, which the caller may not be able to read',
    );
  });

  test('a scope that resolves to no realm is refused', async function (assert) {
    let { core } = stubCore();
    let empty = await refusal(
      resolveNamedQuery(core, { operation: 'nowhere', on: REPORT }, CONTEXT),
    );
    assert.strictEqual(empty.status, 400);
    assert.true(
      /names an empty list of realms/.test(empty.detail),
      'a declared empty list is not read as every realm',
    );

    let unnamed = await refusal(
      resolveNamedQuery(
        core,
        { operation: 'byStatus', on: REPORT, params: { status: 'open' } },
        { ...CONTEXT, realms: [] },
      ),
    );
    assert.strictEqual(unnamed.status, 400);
    assert.true(/neither does the request/.test(unnamed.detail));
  });

  test('a render has no actor', async function (assert) {
    let { core } = stubCore();
    let resolved = await resolveNamedQuery(
      core,
      { operation: 'byStatus', on: REPORT, params: { status: 'open' } },
      { ...CONTEXT, duringRender: true },
    );
    assert.deepEqual(
      resolved.filter?.eq,
      { 'item.status': 'open' },
      'a declaration that does not compare against the caller resolves as usual',
    );

    let noActor = await refusal(
      resolveNamedQuery(
        core,
        { operation: 'mine', on: REPORT },
        { ...CONTEXT, duringRender: true },
      ),
    );
    assert.strictEqual(
      noActor.code,
      'actor-required',
      'the render’s own identity is not an actor to compare against',
    );
  });

  test('what the request names has to resolve to a declared query', async function (assert) {
    let { core } = stubCore();
    let unknown = await refusal(
      resolveNamedQuery(core, { operation: 'everything', on: REPORT }, CONTEXT),
    );
    assert.strictEqual(unknown.code, 'unknown-operation');

    let notAQuery = await refusal(
      resolveNamedQuery(core, { operation: 'retitle', on: REPORT }, CONTEXT),
    );
    assert.strictEqual(notAQuery.code, 'invalid-params');

    let noOperation = await refusal(
      resolveNamedQuery(core, { operation: '', on: REPORT }, CONTEXT),
    );
    assert.true(/"operation"/.test(noOperation.detail));

    let noType = await refusal(
      resolveNamedQuery(core, { operation: 'byStatus' }, CONTEXT),
    );
    assert.true(/"on"/.test(noType.detail));

    let listParams = await refusal(
      resolveNamedQuery(
        core,
        { operation: 'byStatus', on: REPORT, params: ['open'] },
        CONTEXT,
      ),
    );
    assert.true(/"params"/.test(listParams.detail));
  });
});
