import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  batchEntryFor,
  invocationsIn,
  isGroup,
  isOperationFailure,
  newOperationScope,
  parseOperationsEnvelope,
  resolveQueryTargets,
  resultsTree,
  stagedTree,
  type BatchEntry,
  type EntryPosition,
  type EnvelopeEntry,
  type EnvelopeNode,
  type EnvelopeResult,
  type OperationCore,
  type OperationDefinition,
  type OperationError,
} from '@cardstack/runtime-common/card-operations';
import type { ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';
import type {
  Definition,
  FieldDefinition,
} from '@cardstack/runtime-common/definitions';
import type { SearchEntryQuery } from '@cardstack/runtime-common/search-entry';
import type { CardResource, Relationship } from '@cardstack/runtime-common';

// ============================================================================
// Query-defined targets: the cards an entry describes rather than names.
//
// What is under test is the resolution — the grammar `boxel:target` is read
// with, which cards a filter and an optional link hop resolve to, and the
// shape the entry takes once they have. The realm's index and definition cache
// are stubbed, which is the point twice over: the cases a real realm is
// expensive to put into (a match whose row vanished, a link pointing out of
// the realm) cost the same as the ordinary ones, and the query the realm
// actually issues is readable, so "this reads identities and not renderings"
// is checkable rather than merely asserted.
//
// Whether a found target then takes the write lock, collides with a parallel
// sibling and rolls back with the rest of the batch is the realm-server
// endpoint suite's, against a real realm — the claim this file makes is the
// one that makes those follow: resolution answers entries carrying an ordinary
// `href`, and nothing downstream is told they were found.
// ============================================================================

const REALM = 'http://example.com/test/';
const OTHER_REALM = 'http://example.com/other/';
const ACTIVITY = {
  module: `${REALM}activity`,
  name: 'Activity',
} as unknown as ResolvedCodeRef;

// The filter shape every case here sends, in the `item.`-prefixed grammar the
// realm's own search endpoints take.
function openActivities(): Record<string, unknown> {
  return { 'item.on': ACTIVITY, eq: { 'item.status': 'open' } };
}

interface Stub {
  core: OperationCore;
  // Every query the resolution issued, parsed as the search engine takes it.
  queries: SearchEntryQuery[];
  // Every card URL whose index row the resolution read.
  peeked: string[];
}

interface Card {
  // The links the card's stored JSON carries, keyed the way the canonical
  // serialization writes them: `field` for a `linksTo`, `field.0` … for the
  // members of a `linksToMany`, and `field` carrying a null link for either
  // one an author cleared.
  relationships?: Record<string, Relationship>;
  // Absent stands for a card whose row carries no type, which is what an
  // unreadable definition looks like from here.
  adoptsFrom?: ResolvedCodeRef;
}

interface StubOptions {
  // What each query answers, in the order the queries are issued. A single
  // array answers every query.
  matches: string[] | string[][];
  // The realm's cards, by URL. A URL absent from this has no readable index
  // row.
  cards?: Record<string, Card>;
  // The fields the matched cards' type declares.
  fields?: Record<string, Partial<FieldDefinition>>;
  // How long each query takes to come back, in the order the queries are
  // issued. What it buys is a test that a refusal is chosen by request order
  // rather than by which search finished first: with the earliest entry's
  // search the slowest, an implementation that reported whichever rejected
  // first would name the later entry.
  delays?: number[];
}

function stub(opts: StubOptions): Stub {
  let queries: SearchEntryQuery[] = [];
  let peeked: string[] = [];
  let { cards = {}, fields = {}, delays = [] } = opts;
  let answers: string[][] = Array.isArray(opts.matches[0])
    ? (opts.matches as string[][])
    : [opts.matches as string[]];

  let fieldDefs: Definition['fieldDefs'] = {};
  let fieldIds: Definition['fields'] = {};
  for (let [name, field] of Object.entries(fields)) {
    fieldDefs[name] = {
      type: 'linksTo',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: ACTIVITY,
      ...field,
    } as FieldDefinition;
    fieldIds[name] = name;
  }
  let definition: Definition = {
    type: 'card-def',
    codeRef: ACTIVITY,
    displayName: 'Activity',
    fields: fieldIds,
    fieldDefs,
  };

  let notReached = (name: string) => () => {
    throw new Error(`resolution reached ${name}, which it has no use for`);
  };

  let core: OperationCore = {
    realmURL: REALM,
    definitionLookup: {
      async lookupDefinition(codeRef) {
        return codeRef.module === ACTIVITY.module ? definition : undefined;
      },
    },
    indexQueryEngine: {
      async searchEntries(query) {
        queries.push(query);
        let at = queries.length - 1;
        let delay = delays[at];
        if (delay !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        let urls = answers[Math.min(at, answers.length - 1)];
        // The page is the realm's own, and the count is not what the page
        // held: an entry expecting one card reads at most two rows and takes
        // the count off the meta, so the stub has to answer the way the
        // engine does — a truncated `data` beside the true total.
        let size = query.itemQuery.page?.size;
        return {
          data: (size === undefined ? urls : urls.slice(0, size)).map(
            (id) => ({ id }) as any,
          ),
          meta: { page: { total: urls.length } },
        };
      },
      async instance(url) {
        peeked.push(url.href);
        let card = cards[url.href];
        if (!card) {
          return undefined;
        }
        return {
          type: 'instance',
          instance: {
            id: url.href,
            type: 'card',
            attributes: {},
            ...(card.relationships
              ? { relationships: card.relationships }
              : {}),
            meta: {
              ...(card.adoptsFrom ? { adoptsFrom: card.adoptsFrom } : {}),
            },
          } as unknown as CardResource,
        } as any;
      },
      cardDocument: notReached('cardDocument') as any,
      file: notReached('file') as any,
    },
    readFileAsText: notReached('readFileAsText') as any,
    openStoredFile: notReached('openStoredFile') as any,
    storedFileMeta: notReached('storedFileMeta') as any,
    isIgnored: notReached('isIgnored') as any,
    fileMetaDocument: notReached('fileMetaDocument') as any,
    resolveCodeRef: (codeRef) => codeRef as any,
    fileDefCodeRef: notReached('fileDefCodeRef') as any,
    unresolveInstanceIds: notReached('unresolveInstanceIds') as any,
  };
  return { core, queries, peeked };
}

// One entry, sent as the caller writes it.
function invoke(operation: Record<string, unknown>): Record<string, unknown> {
  return { op: 'invoke', 'boxel:name': 'update', ...operation };
}

function body(...operations: unknown[]): Record<string, unknown> {
  return { 'boxel:operations': operations };
}

function parse(...operations: unknown[]): EnvelopeNode[] {
  return parseOperationsEnvelope(body(...operations), REALM);
}

async function resolve(
  stubbed: Stub,
  ...operations: unknown[]
): Promise<EnvelopeNode[]> {
  return await resolveQueryTargets(
    stubbed.core,
    newOperationScope(stubbed.core),
    parse(...operations),
  );
}

function errorOf(err: unknown): OperationError {
  if (!isOperationFailure(err)) {
    throw err;
  }
  return err.error;
}

async function refusal(fn: () => unknown): Promise<OperationError> {
  try {
    await fn();
  } catch (err: unknown) {
    return errorOf(err);
  }
  throw new Error('expected a refusal, and the call answered');
}

// The one entry a node holds, for a case that resolved to exactly one.
function only(node: EnvelopeNode): EnvelopeEntry {
  if (isGroup(node)) {
    throw new Error(`expected one entry, and got a "${node.op}" group`);
  }
  return node;
}

function membersOf(node: EnvelopeNode): EnvelopeEntry[] {
  if (!isGroup(node)) {
    throw new Error(`expected a group, and got an entry`);
  }
  return node.members.map(only);
}

module(basename(__filename), function () {
  module('the wire grammar', function () {
    test('an entry describes its target with a query, a field and a count', async function (assert) {
      let [node] = parse(
        invoke({
          'boxel:target': {
            query: openActivities(),
            field: 'classroom',
            expect: 'many',
          },
        }),
      );
      assert.deepEqual(only(node).find, {
        query: openActivities(),
        field: 'classroom',
        expect: 'many',
      });
    });

    test('an entry that says nothing about the count expects one card', async function (assert) {
      let [node] = parse(invoke({ 'boxel:target': { query: {} } }));
      assert.strictEqual(only(node).find?.expect, 'one');
      assert.strictEqual(only(node).find?.field, undefined);
    });

    test('an entry naming its target and describing it is refused', async function (assert) {
      let error = await refusal(() =>
        parse(
          invoke({
            href: 'reports/a',
            'boxel:target': { query: openActivities() },
          }),
        ),
      );
      assert.strictEqual(error.status, 400);
      assert.strictEqual(error.code, 'invalid-params');
      assert.true(
        error.detail?.includes('both an "href" and a "boxel:target"'),
        error.detail,
      );
      assert.strictEqual(error.meta?.entry, 0);
    });

    test('a target that is not an object is refused', async function (assert) {
      let error = await refusal(() =>
        parse(invoke({ 'boxel:target': 'open' })),
      );
      assert.true(
        error.detail?.includes('"boxel:target" that is not an object'),
        error.detail,
      );
    });

    test('a target carrying no query is refused', async function (assert) {
      let error = await refusal(() =>
        parse(invoke({ 'boxel:target': { field: 'classroom' } })),
      );
      assert.true(error.detail?.includes('no "query" filter'), error.detail);
    });

    test('a target carrying a member the realm does not read is refused', async function (assert) {
      // `expects` for `expect` is the typo that matters: read past, it would
      // leave the entry quietly demanding exactly one match.
      let error = await refusal(() =>
        parse(
          invoke({
            'boxel:target': { query: {}, expects: 'many' },
          }),
        ),
      );
      assert.true(error.detail?.includes('"expects"'), error.detail);
    });

    test('a field that is not the name of a field is refused', async function (assert) {
      for (let field of ['', 42, null]) {
        let error = await refusal(() =>
          parse(invoke({ 'boxel:target': { query: {}, field } })),
        );
        assert.true(
          error.detail?.includes('"field" is not the name of a field'),
          `${JSON.stringify(field)}: ${error.detail}`,
        );
      }
    });

    test('a count the realm does not offer is refused', async function (assert) {
      let error = await refusal(() =>
        parse(invoke({ 'boxel:target': { query: {}, expect: 'all' } })),
      );
      assert.true(error.detail?.includes('expecting "all"'), error.detail);
    });

    test('a group carrying a query target is refused', async function (assert) {
      let error = await refusal(() =>
        parse({
          op: 'parallel',
          'boxel:target': { query: {} },
          'boxel:operations': [invoke({ href: 'reports/a' })],
        }),
      );
      assert.true(
        error.detail?.includes('carries "boxel:target"'),
        error.detail,
      );
    });
  });

  module('what the realm asks its index', function () {
    test('a batch naming every target issues no query at all', async function (assert) {
      let stubbed = stub({ matches: [] });
      let tree = await resolve(
        stubbed,
        invoke({ href: 'reports/a' }),
        invoke({ href: 'reports/b' }),
      );
      assert.deepEqual(stubbed.queries, []);
      assert.deepEqual(stubbed.peeked, []);
      assert.deepEqual(
        invocationsIn(tree).map((entry) => entry.href),
        [`${REALM}reports/a`, `${REALM}reports/b`],
      );
    });

    test('the query is scoped to cards, reads identities and pages for the count it reports', async function (assert) {
      let stubbed = stub({ matches: [`${REALM}activities/a`] });
      await resolve(
        stubbed,
        invoke({ 'boxel:target': { query: openActivities() } }),
      );
      let [query] = stubbed.queries;
      // Cards, because a realm-wide query answers a card's own row *and* the
      // dual-indexed `.json` file row beside it — two rows for one card, which
      // would read as two matches.
      assert.strictEqual(query.scope, 'cards');
      // Identities, not renderings: the default fieldset is the selected
      // renderings, which would have the realm assemble every match's HTML and
      // side-load its links to answer a question about which cards exist.
      assert.false(query.fieldset.html);
      assert.strictEqual(query.fieldset.item.kind, 'sparse');
      // Two rows is enough to tell none from one from several; the count the
      // refusal names comes off the meta.
      assert.strictEqual(query.itemQuery.page?.size, 2);
      assert.deepEqual(query.itemQuery.filter, {
        on: ACTIVITY,
        eq: { status: 'open' },
      });
    });

    test('an entry expecting many asks for every match', async function (assert) {
      let stubbed = stub({ matches: [`${REALM}activities/a`] });
      await resolve(
        stubbed,
        invoke({
          'boxel:target': { query: openActivities(), expect: 'many' },
        }),
      );
      assert.strictEqual(stubbed.queries[0].itemQuery.page, undefined);
    });

    test('a query the realm does not accept is refused against the entry', async function (assert) {
      let stubbed = stub({ matches: [] });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({ href: 'reports/a' }),
          invoke({ 'boxel:target': { query: { nonsense: true } } }),
        ),
      );
      assert.strictEqual(error.status, 400);
      assert.strictEqual(error.meta?.entry, 1);
      assert.true(
        error.detail?.includes('a query the realm does not accept'),
        error.detail,
      );
    });
  });

  module('expecting one card', function () {
    test('the one match becomes the entry target, where the caller put it', async function (assert) {
      let stubbed = stub({ matches: [`${REALM}activities/a`] });
      let tree = await resolve(
        stubbed,
        invoke({ href: 'reports/a' }),
        invoke({
          'boxel:target': { query: openActivities() },
          data: { status: 'reviewed' },
        }),
      );
      let entry = only(tree[1]);
      assert.strictEqual(entry.href, `${REALM}activities/a`);
      // The caller's own numbering, so anything this entry later refuses is
      // labelled with the position the caller sent.
      assert.strictEqual(entry.position, 1);
      // The query is spent: nothing downstream of resolution distinguishes a
      // target that was found from one that was named.
      assert.strictEqual(entry.find, undefined);
      assert.deepEqual(entry.data, { status: 'reviewed' });
    });

    test('matching nothing is refused, naming none', async function (assert) {
      let stubbed = stub({ matches: [] });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({ 'boxel:target': { query: openActivities() } }),
        ),
      );
      assert.strictEqual(error.status, 400);
      assert.strictEqual(error.meta?.entry, 0);
      assert.true(error.detail?.includes('matched no card'), error.detail);
      // Nothing about creates: this batch mints no card, so the pre-batch-state
      // explanation would be describing a mistake the caller did not make.
      assert.false(error.detail?.includes('is not one it can match'));
    });

    test('matching nothing in a batch that mints cards says a card this batch creates is not findable', async function (assert) {
      let stubbed = stub({ matches: [] });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({ data: { lid: 'new-activity' } }),
          invoke({ 'boxel:target': { query: openActivities() } }),
        ),
      );
      assert.true(
        error.detail?.includes(
          'a card another entry of this batch creates is not one it can match',
        ),
        error.detail,
      );
    });

    test('matching several is refused, naming how many', async function (assert) {
      let stubbed = stub({
        matches: [
          `${REALM}activities/a`,
          `${REALM}activities/b`,
          `${REALM}activities/c`,
        ],
      });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({ 'boxel:target': { query: openActivities() } }),
        ),
      );
      // Three, not the two the page held — the count is read off the meta,
      // which counts every matching row.
      assert.true(error.detail?.includes('3 cards answer to it'), error.detail);
      assert.true(error.detail?.includes('"expect": "many"'), error.detail);
    });
  });

  module('expecting many cards', function () {
    test('every match becomes an entry, in index order, under a position naming where it came from', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`, `${REALM}activities/b`],
      });
      let tree = await resolve(
        stubbed,
        invoke({ href: 'reports/a' }),
        invoke({
          'boxel:target': { query: openActivities(), expect: 'many' },
          data: { status: 'reviewed' },
        }),
      );
      let members = membersOf(tree[1]);
      assert.deepEqual(
        members.map((entry) => entry.href),
        [`${REALM}activities/a`, `${REALM}activities/b`],
      );
      assert.deepEqual(
        members.map((entry) => entry.position),
        ['[1].boxel:target[0]', '[1].boxel:target[1]'],
      );
      // Each carries the entry the caller wrote, target aside.
      assert.deepEqual(
        members.map((entry) => entry.data),
        [{ status: 'reviewed' }, { status: 'reviewed' }],
      );
    });

    test('the expansion runs its targets in order and answers as an array', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`, `${REALM}activities/b`],
      });
      let tree = await resolve(
        stubbed,
        invoke({
          'boxel:target': { query: openActivities(), expect: 'many' },
        }),
      );
      // Serial, so the targets are carried out in the order the index
      // returned them.
      assert.strictEqual(isGroup(tree[0]) && tree[0].op, 'serial');
      let results = new Map<EntryPosition, EnvelopeResult>(
        invocationsIn(tree).map((entry) => [
          entry.position,
          { data: { id: entry.href! } },
        ]),
      );
      assert.deepEqual(resultsTree(tree, results), [
        [
          { data: { id: `${REALM}activities/a` } },
          { data: { id: `${REALM}activities/b` } },
        ],
      ]);
    });

    test('matching nothing is an empty result rather than a refusal', async function (assert) {
      let stubbed = stub({ matches: [] });
      let tree = await resolve(
        stubbed,
        invoke({
          'boxel:target': { query: openActivities(), expect: 'many' },
        }),
      );
      assert.deepEqual(invocationsIn(tree), []);
      assert.deepEqual(resultsTree(tree, new Map()), [[]]);
      // And nothing is staged for it, so a batch whose only entry matched
      // nothing takes no lock and announces nothing.
      assert.deepEqual(stagedTree(tree, new Map()), []);
    });

    test('an expansion inside a parallel group stays inside it', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`, `${REALM}activities/b`],
      });
      let tree = await resolve(stubbed, {
        op: 'parallel',
        'boxel:operations': [
          invoke({ href: 'reports/a' }),
          invoke({
            'boxel:target': { query: openActivities(), expect: 'many' },
          }),
        ],
      });
      // The caller's entry expanded in place: the group is still parallel and
      // still holds two members, the second of which is the expansion. That is
      // what puts the found targets and the sibling's href under one parallel
      // group, which is what makes them collide.
      assert.strictEqual(isGroup(tree[0]) && tree[0].op, 'parallel');
      let [sibling, expansion] = (tree[0] as any).members as EnvelopeNode[];
      assert.strictEqual(only(sibling).href, `${REALM}reports/a`);
      assert.deepEqual(
        membersOf(expansion).map((entry) => entry.position),
        [
          '[0].boxel:operations[1].boxel:target[0]',
          '[0].boxel:operations[1].boxel:target[1]',
        ],
      );
    });
  });

  module('following a link from what matched', function () {
    const CLASSROOM = `${REALM}classrooms/maths`;

    function linksTo(target: string | null): Record<string, Relationship> {
      return { classroom: { links: { self: target } } };
    }

    test('a linksTo hop makes the linked card the target', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`],
        cards: {
          [`${REALM}activities/a`]: {
            adoptsFrom: ACTIVITY,
            relationships: linksTo(CLASSROOM),
          },
        },
        fields: { classroom: { type: 'linksTo' } },
      });
      let tree = await resolve(
        stubbed,
        invoke({
          'boxel:target': { query: openActivities(), field: 'classroom' },
        }),
      );
      assert.strictEqual(only(tree[0]).href, CLASSROOM);
      assert.deepEqual(stubbed.peeked, [`${REALM}activities/a`]);
    });

    test('a link stored relative to the card it hangs off resolves against that card', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`],
        cards: {
          [`${REALM}activities/a`]: {
            adoptsFrom: ACTIVITY,
            relationships: linksTo('../classrooms/maths'),
          },
        },
        fields: { classroom: { type: 'linksTo' } },
      });
      let tree = await resolve(
        stubbed,
        invoke({
          'boxel:target': { query: openActivities(), field: 'classroom' },
        }),
      );
      assert.strictEqual(only(tree[0]).href, CLASSROOM);
    });

    test('a linksToMany hop makes every linked card a target', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`],
        cards: {
          [`${REALM}activities/a`]: {
            adoptsFrom: ACTIVITY,
            relationships: {
              'attendees.0': { links: { self: `${REALM}people/ann` } },
              'attendees.1': { links: { self: `${REALM}people/bo` } },
            },
          },
        },
        fields: { attendees: { type: 'linksToMany' } },
      });
      let tree = await resolve(
        stubbed,
        invoke({
          'boxel:target': {
            query: openActivities(),
            field: 'attendees',
            expect: 'many',
          },
        }),
      );
      assert.deepEqual(
        membersOf(tree[0]).map((entry) => entry.href),
        [`${REALM}people/ann`, `${REALM}people/bo`],
      );
    });

    test('a collection hop under one card is refused, naming how many it links to', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`],
        cards: {
          [`${REALM}activities/a`]: {
            adoptsFrom: ACTIVITY,
            relationships: {
              'attendees.0': { links: { self: `${REALM}people/ann` } },
              'attendees.1': { links: { self: `${REALM}people/bo` } },
            },
          },
        },
        fields: { attendees: { type: 'linksToMany' } },
      });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({
            'boxel:target': { query: openActivities(), field: 'attendees' },
          }),
        ),
      );
      assert.true(error.detail?.includes('links to 2 cards'), error.detail);
    });

    test('a field the matched card does not declare is refused', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`],
        cards: { [`${REALM}activities/a`]: { adoptsFrom: ACTIVITY } },
        fields: { classroom: { type: 'linksTo' } },
      });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({
            'boxel:target': { query: openActivities(), field: 'class' },
          }),
        ),
      );
      assert.true(
        error.detail?.includes('no field by that name'),
        error.detail,
      );
      assert.strictEqual(error.id, `${REALM}activities/a`);
    });

    test('a field that is not a link is refused, naming what it is', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`],
        cards: { [`${REALM}activities/a`]: { adoptsFrom: ACTIVITY } },
        fields: { status: { type: 'contains', isPrimitive: true } },
      });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({
            'boxel:target': { query: openActivities(), field: 'status' },
          }),
        ),
      );
      assert.true(error.detail?.includes('is a contains field'), error.detail);
    });

    test('a computed link is refused, because the realm stored no link to follow', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`],
        cards: {
          [`${REALM}activities/a`]: {
            adoptsFrom: ACTIVITY,
            relationships: linksTo(CLASSROOM),
          },
        },
        fields: { classroom: { type: 'linksTo', isComputed: true } },
      });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({
            'boxel:target': { query: openActivities(), field: 'classroom' },
          }),
        ),
      );
      assert.true(error.detail?.includes('is computed'), error.detail);
    });

    test('a match whose link is empty is refused under one card', async function (assert) {
      for (let relationships of [linksTo(null), undefined]) {
        let stubbed = stub({
          matches: [`${REALM}activities/a`],
          cards: {
            [`${REALM}activities/a`]: {
              adoptsFrom: ACTIVITY,
              ...(relationships ? { relationships } : {}),
            },
          },
          fields: { classroom: { type: 'linksTo' } },
        });
        let error = await refusal(() =>
          resolve(
            stubbed,
            invoke({
              'boxel:target': { query: openActivities(), field: 'classroom' },
            }),
          ),
        );
        assert.true(error.detail?.includes('links to no card'), error.detail);
      }
    });

    test('a match whose link is empty is skipped under many cards', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`, `${REALM}activities/b`],
        cards: {
          [`${REALM}activities/a`]: {
            adoptsFrom: ACTIVITY,
            relationships: linksTo(null),
          },
          [`${REALM}activities/b`]: {
            adoptsFrom: ACTIVITY,
            relationships: linksTo(CLASSROOM),
          },
        },
        fields: { classroom: { type: 'linksTo' } },
      });
      let tree = await resolve(
        stubbed,
        invoke({
          'boxel:target': {
            query: openActivities(),
            field: 'classroom',
            expect: 'many',
          },
        }),
      );
      assert.deepEqual(
        membersOf(tree[0]).map((entry) => entry.href),
        [CLASSROOM],
      );
    });

    test('a link leaving this realm is refused, naming both ends', async function (assert) {
      // A query cannot leave the realm — the engine is one realm's — but a hop
      // can: a card here may link to a card there. The batch commits under one
      // realm's write lock, so there is no lock that would make the write
      // atomic with the rest.
      let stubbed = stub({
        matches: [`${REALM}activities/a`],
        cards: {
          [`${REALM}activities/a`]: {
            adoptsFrom: ACTIVITY,
            relationships: linksTo(`${OTHER_REALM}classrooms/maths`),
          },
        },
        fields: { classroom: { type: 'linksTo' } },
      });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({
            'boxel:target': { query: openActivities(), field: 'classroom' },
          }),
        ),
      );
      assert.true(
        error.detail?.includes(`which realm ${REALM} does not contain`),
        error.detail,
      );
      assert.strictEqual(error.id, `${OTHER_REALM}classrooms/maths`);
    });

    test('a match the realm has no readable row for is refused', async function (assert) {
      let stubbed = stub({
        matches: [`${REALM}activities/a`],
        cards: {},
        fields: { classroom: { type: 'linksTo' } },
      });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({
            'boxel:target': { query: openActivities(), field: 'classroom' },
          }),
        ),
      );
      assert.true(
        error.detail?.includes('no readable index row'),
        error.detail,
      );
    });
  });

  module('a batch with more than one query target', function () {
    test('the earliest entry the caller got wrong is the one reported', async function (assert) {
      // Both query entries are wrong, and the earliest one is the answer — so
      // the earliest one's search is made the slowest. An implementation that
      // reported whichever refusal arrived first would name entry 2.
      let stubbed = stub({ matches: [[], []], delays: [40, 0] });
      let error = await refusal(() =>
        resolve(
          stubbed,
          invoke({ href: 'reports/a' }),
          invoke({ 'boxel:target': { query: openActivities() } }),
          invoke({ 'boxel:target': { query: openActivities() } }),
        ),
      );
      assert.strictEqual(error.meta?.entry, 1);
    });

    test('each entry resolves against its own query', async function (assert) {
      let stubbed = stub({
        matches: [[`${REALM}activities/a`], [`${REALM}activities/b`]],
      });
      let tree = await resolve(
        stubbed,
        invoke({ 'boxel:target': { query: openActivities() } }),
        invoke({ 'boxel:target': { query: openActivities() } }),
      );
      assert.deepEqual(
        invocationsIn(tree).map((entry) => entry.href),
        [`${REALM}activities/a`, `${REALM}activities/b`],
      );
    });
  });

  module('what a found target may be invoked as', function () {
    function stage(
      entry: EnvelopeEntry,
      definition: Partial<OperationDefinition>,
    ): BatchEntry {
      return batchEntryFor(entry, {
        deterministic: true,
        ...definition,
      } as OperationDefinition);
    }

    async function found(): Promise<EnvelopeEntry> {
      let stubbed = stub({ matches: [`${REALM}activities/a`] });
      let tree = await resolve(stubbed, {
        op: 'invoke',
        'boxel:name': 'archive',
        'boxel:target': { query: {} },
      });
      return only(tree[0]);
    }

    test('a create cannot take its target from a query', async function (assert) {
      let error = await refusal(async () =>
        stage(await found(), { base: 'create' }),
      );
      assert.strictEqual(error.status, 400);
      assert.true(
        error.detail?.includes('takes its target from a query'),
        error.detail,
      );
      assert.strictEqual(error.meta?.entry, 0);
    });

    test('a named create cannot take its target from a query either', async function (assert) {
      // The case the found mark exists for. A named create may carry an href —
      // the card it reads for context — so the refusal a base create gets for
      // naming one does not reach this, and without the mark a query target
      // would be read as that context card.
      let error = await refusal(async () =>
        stage(await found(), {
          base: 'create',
          of: { module: `${REALM}activity`, name: 'Activity' },
        } as Partial<OperationDefinition>),
      );
      assert.strictEqual(error.status, 400);
      assert.true(
        error.detail?.includes('takes its target from a query'),
        error.detail,
      );
    });

    test('an update takes a found target the way it takes a named one', async function (assert) {
      let stubbed = stub({ matches: [`${REALM}activities/a`] });
      let tree = await resolve(
        stubbed,
        invoke({
          'boxel:target': { query: openActivities() },
          data: { status: 'reviewed' },
        }),
      );
      let staged = stage(only(tree[0]), { base: 'update' });
      assert.strictEqual(staged.op, 'update');
      assert.strictEqual(
        (staged as { href: string }).href,
        `${REALM}activities/a`,
      );
      assert.strictEqual(staged.label, 0);
    });
  });
});
