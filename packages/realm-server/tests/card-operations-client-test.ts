import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  buildOperations,
  mintedIdentities,
  rri,
  type CarriedOperationInfo,
  type CarriedQueryDeclaration,
  type OperationsAnswer,
  type OperationsEnvelope,
  type OperationsEnvironment,
  type OperationsMethod,
  type OperationsSearch,
  type OperationsSubject,
  type OperationsTransport,
  type SearchEntries,
  type SearchEntryWireQuery,
  type WireGroup,
  type WireInvocation,
} from '@cardstack/runtime-common';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';

// ============================================================================
// The request a call produces, and the value its answer becomes.
//
// The client core is the half of an operation that runs where the caller is:
// it turns a call into an envelope, decides which method carries it, and reads
// the realm's answer back as the value the caller awaited. None of that needs
// a realm, a loader or a card module — the core takes what it knows about a
// def as data and its transport as an argument — so it is driven here with a
// transport that records what it was handed and answers from a script.
//
// What the same calls do against a realm that carries them out is covered by
// the host's integration suite, which reaches this core through
// `@cardstack/base/operations` and real `@operation` declarations — groups
// included, since the realm reads them.
//
// One form is checked only here, because no realm reads it: an entry whose
// target is a search. The envelope's parse reads an entry's `href` and its
// `data`, so `boxel:target` reaches it as an entry naming nothing to run
// against. What the builder emits for it is a contract in its own right, and
// the assertions below are that contract.
// ============================================================================

const REALM = 'http://example.com/test/';
const REPORT: CodeRef = { module: rri(`${REALM}report`), name: 'Report' };
const ACTIVITY: CodeRef = { module: rri(`${REALM}report`), name: 'Activity' };

// A stand-in for a class, for the one place the core asks its caller to read
// one: a filter names types with the classes themselves.
const REPORT_CLASS = () => REPORT;

// Who the session this core runs in authenticates the caller as.
const ACTOR = '@tester:localhost';

function carried(
  entries: Record<
    string,
    [base: string, declared: boolean, query?: CarriedQueryDeclaration]
  >,
): Record<string, CarriedOperationInfo> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, [base, declared, query]]) => [
      name,
      { base, declared, ...(query ? { query } : {}) } as CarriedOperationInfo,
    ]),
  );
}

// A saved search as its author wrote it: the type named by the class itself,
// and a marker where the caller's identity goes.
const OPEN_REPORTS: CarriedQueryDeclaration = {
  query: {
    filter: {
      on: REPORT_CLASS,
      eq: { status: 'open', 'author.userId': { $ref: 'actor' } },
    },
    sort: [{ on: REPORT_CLASS, by: 'createdAt', direction: 'desc' }],
  },
};

// Everything a card def carries, as the card-facing module reports it: the base
// operations its def type implies, plus what its author declared.
const CARD_OPERATIONS = carried({
  read: ['read', false],
  readSource: ['readSource', false],
  create: ['create', false],
  update: ['update', false],
  delete: ['delete', false],
  query: ['query', false],
  transform: ['transform', false],
  appendContainsMany: ['appendContainsMany', false],
  escalate: ['transform', true],
  addComment: ['transform', true],
  addActivity: ['transform', true],
  createActivity: ['create', true],
  openReports: ['query', true, OPEN_REPORTS],
});

const FILE_OPERATIONS = carried({
  read: ['read', false],
  readSource: ['readSource', false],
  update: ['update', false],
  appendLine: ['appendLine', false],
});

function reportInstance(
  overrides: Partial<OperationsSubject> = {},
): OperationsSubject {
  return {
    scope: 'instance',
    family: 'card',
    displayName: 'Report',
    id: `${REALM}report-1`,
    realmURL: REALM,
    codeRef: REPORT,
    operations: CARD_OPERATIONS,
    ...overrides,
  };
}

function reportType(
  overrides: Partial<OperationsSubject> = {},
): OperationsSubject {
  return {
    scope: 'type',
    family: 'card',
    displayName: 'Report',
    codeRef: REPORT,
    operations: CARD_OPERATIONS,
    ...overrides,
  } as OperationsSubject;
}

// A saved search whose scope the caller fills and whose filter reads a payload
// member, for the cases about what an invocation supplies.
function statusType(): OperationsSubject {
  return {
    scope: 'type',
    family: 'card',
    displayName: 'Report',
    codeRef: REPORT,
    operations: carried({
      byStatus: [
        'query',
        true,
        {
          query: {
            filter: {
              on: REPORT_CLASS,
              eq: { status: { $ref: 'params', key: 'status' } },
            },
          },
          params: { status: 'the field class' },
        },
      ],
    }),
  };
}

function activityType(): OperationsSubject {
  return {
    scope: 'type',
    family: 'card',
    displayName: 'Activity',
    codeRef: ACTIVITY,
    operations: carried({
      create: ['create', false],
      read: ['read', false],
    }),
  };
}

function fileInstance(): OperationsSubject {
  return {
    scope: 'instance',
    family: 'file',
    displayName: 'File',
    id: `${REALM}notes.md`,
    realmURL: REALM,
    operations: FILE_OPERATIONS,
  };
}

interface Sent {
  realmURL: string;
  method: OperationsMethod;
  envelope: OperationsEnvelope;
  opts?: { clientRequestId?: string; adopted?: string[] };
}

// One search a query asked the session for: the wire query it resolved to, the
// thunk it is read back through, and what the caller was handed.
interface Searched {
  // What the search resolved to when the session was asked for it, and the
  // thunk it is read back through — which answers nothing at all once the
  // session can no longer resolve the query.
  query: SearchEntryWireQuery | undefined;
  owner: object | undefined;
  getQuery: () => SearchEntryWireQuery | undefined;
  resource: SearchEntries;
}

interface Harness {
  sent: Sent[];
  searched: Searched[];
  session: { actor: string | undefined; realmsKnown: boolean };
  env: OperationsEnvironment;
}

// The search half of the bridge, as a record of what a query asked for. A host
// answers with a live resource; nothing here is live, so this reads the thunk
// once and keeps it, which is what lets a test read it again.
function searchOf(
  searched: Searched[],
  opts?: { actor?: string | null; realm?: string },
  session?: { actor: string | undefined; realmsKnown: boolean },
): OperationsSearch {
  return {
    actor: () => (session ? session.actor : undefined),
    realmFor: (identifier: string) => {
      if (session && !session.realmsKnown) {
        return undefined;
      }
      let realm = opts?.realm ?? REALM;
      return identifier.startsWith(realm) ? realm : undefined;
    },
    entries(getQuery, entryOpts) {
      let resource: SearchEntries = {
        entries: [],
        isLoading: false,
        meta: { page: { total: 0 } },
        errors: undefined,
      };
      searched.push({
        query: getQuery(),
        owner: entryOpts?.owner,
        getQuery,
        resource,
      });
      return resource;
    },
  };
}

// The transport, as a record of what a call handed it and a script for what to
// answer. A call whose answer the test does not read still needs one, since the
// core reads a result for every entry it sent.
function harness(opts?: {
  answer?: OperationsAnswer;
  defaultRealm?: string;
  subjects?: Record<string, OperationsSubject>;
  actor?: string | null;
  realm?: string;
  // A session that carries out no searches at all, which is every session
  // outside a host: a saved search answers with a live resource, and building
  // one is the host's.
  noSearch?: true;
  resources?: Record<string, Record<string, unknown>>;
}): Harness {
  let sent: Sent[] = [];
  let searched: Searched[] = [];
  // What the session answers for right now. A standing search reads it again
  // on every recompute, so a test moves the session by writing here.
  let session = {
    actor: opts?.actor === null ? undefined : (opts?.actor ?? ACTOR),
    realmsKnown: true,
  };
  let transport: OperationsTransport = {
    async send(realmURL, method, envelope, sendOpts) {
      sent.push({ realmURL, method, envelope, opts: sendOpts });
      return opts?.answer ?? { 'atomic:results': [] };
    },
    defaultWritableRealm() {
      return opts?.defaultRealm;
    },
    ...(opts?.noSearch ? {} : { search: searchOf(searched, opts, session) }),
  };
  return {
    sent,
    searched,
    session,
    env: {
      transport,
      subject(target: unknown) {
        let named = opts?.subjects?.[target as string];
        if (!named) {
          throw new Error(`the test did not describe ${String(target)}`);
        }
        return named;
      },
      codeRef(value: unknown) {
        return typeof value === 'function'
          ? (value as () => CodeRef)()
          : undefined;
      },
      resourceFor(instance: unknown) {
        let named = opts?.resources?.[instance as string];
        if (!named) {
          throw new Error(
            `the test did not describe a resource for ${String(instance)}`,
          );
        }
        return named;
      },
    },
  };
}

// The local id a batch gave the card its first entry mints.
function mintedLid(sent: Sent): string {
  return entries(sent)[0].data?.lid as string;
}

function writeAnswer(
  id: string,
  meta: Record<string, unknown> = { version: 'v1' },
): OperationsAnswer {
  return { 'atomic:results': [{ data: { type: 'card', id, ...{ meta } } }] };
}

function entries(sent: Sent): WireInvocation[] {
  return sent.envelope['boxel:operations'] as WireInvocation[];
}

module(basename(import.meta.filename), function () {
  module('what a bucket carries', function () {
    test('a card instance carries its reads, its document writes and a batch', function (assert) {
      let bucket = buildOperations(reportInstance(), harness().env);
      assert.deepEqual(
        Object.keys(bucket).sort(),
        [
          'addActivity',
          'addComment',
          'appendContainsMany',
          'atomic',
          'createActivity',
          'delete',
          'escalate',
          'read',
          'update',
        ],
        'the base operations a card carries, its declarations, and atomic',
      );
    });

    test('stored bytes and a bare transform have no member', function (assert) {
      let bucket = buildOperations(reportInstance(), harness().env);
      assert.strictEqual(
        bucket.readSource,
        undefined,
        'the card source and byte routes serve stored bytes',
      );
      assert.strictEqual(
        bucket.transform,
        undefined,
        'a transform runs a program, which an entry has no member to carry, so it is reached under a declared name',
      );
      assert.strictEqual(
        bucket.create,
        undefined,
        'a create targets a type, so it is invoked on the class',
      );
      assert.strictEqual(
        bucket.query,
        undefined,
        'and a bare query saves no search, so there is nothing for it to run',
      );
      assert.strictEqual(
        bucket.openReports,
        undefined,
        'a saved search reads a collection of a type, so it is invoked on the class rather than on one card',
      );
    });

    test('a class carries the creates, and nothing that runs against an instance', function (assert) {
      let bucket = buildOperations(reportType(), harness().env);
      assert.deepEqual(
        Object.keys(bucket).sort(),
        ['create', 'createActivity', 'openReports'],
        'the base create, a declared one, and the saved search a collection is read through',
      );
      assert.strictEqual(
        bucket.atomic,
        undefined,
        'a batch commits in one realm, which a class does not name',
      );
    });

    test('a file carries its reads and the writes that work on its bytes', function (assert) {
      let bucket = buildOperations(fileInstance(), harness().env);
      assert.deepEqual(Object.keys(bucket).sort(), [
        'appendLine',
        'read',
        'update',
      ]);
    });

    test('nothing a batch cannot carry reaches a batch', function (assert) {
      // Exhaustive over the behaviors reached elsewhere, so a later one that
      // grew a member here — and would then be sent as a batch entry the realm
      // answers with "not carried here" — fails on this list rather than in a
      // caller.
      for (let subject of [reportInstance(), reportType(), fileInstance()]) {
        let bucket = buildOperations(subject, harness().env);
        for (let [name, info] of Object.entries(subject.operations)) {
          if (info.base !== 'readSource') {
            continue;
          }
          assert.strictEqual(
            bucket[name],
            undefined,
            `${subject.displayName} carries no ${name} (${info.base})`,
          );
        }
      }
    });
  });

  module('one operation at a time', function () {
    test('an operation targets the instance it was called on, and reports what it wrote', async function (assert) {
      let { sent, env } = harness({
        answer: writeAnswer(`${REALM}report-1`, {
          version: 'v1',
          generation: 4,
          lastModified: 99,
        }),
      });
      let bucket = buildOperations(reportInstance(), env);
      let result = await (
        bucket.addComment as (payload: unknown) => Promise<any>
      )({ body: 'Reviewed.' });

      assert.deepEqual(entries(sent[0]), [
        {
          op: 'invoke',
          'boxel:name': 'addComment',
          href: `${REALM}report-1`,
          data: { body: 'Reviewed.' },
        },
      ]);
      assert.deepEqual(
        result,
        {
          id: `${REALM}report-1`,
          version: 'v1',
          generation: 4,
          lastModified: 99,
        },
        'a write answers with the card it wrote and the version it now holds',
      );
    });

    test('a delete reports that there is no state left to describe', async function (assert) {
      let { env } = harness({ answer: { 'atomic:results': [{ data: null }] } });
      let bucket = buildOperations(reportInstance(), env);
      assert.strictEqual(
        await (bucket.delete as () => Promise<unknown>)(),
        null,
      );
    });

    test('a read is answered with the document, and asks only to read', async function (assert) {
      let document = { data: { type: 'card', id: `${REALM}report-1` } };
      let { sent, env } = harness({ answer: { 'atomic:results': [document] } });
      let bucket = buildOperations(reportInstance(), env);

      assert.deepEqual(
        await (bucket.read as () => Promise<unknown>)(),
        document,
        'a read reports the document it was asked for',
      );
      assert.strictEqual(
        sent[0].method,
        'QUERY',
        'and travels as the method the realm reads as authorized to read',
      );
    });

    test('every behavior that changes stored state is sent as a write', async function (assert) {
      // One case per writing behavior, so a behavior that stopped counting as a
      // write — and would then travel on a request authorized only to read —
      // fails here rather than reaching a realm.
      let { sent, env } = harness({ answer: writeAnswer(`${REALM}report-1`) });
      let bucket = buildOperations(reportInstance(), env);
      let writes: [string, unknown][] = [
        ['escalate', undefined],
        ['addComment', { body: 'x' }],
        ['update', { attributes: { headline: 'x' } }],
        ['appendContainsMany', { field: 'comments', items: [] }],
        ['delete', undefined],
        ['createActivity', { headline: 'x' }],
      ];
      for (let [name, payload] of writes) {
        sent.length = 0;
        await (bucket[name] as (payload?: unknown) => Promise<unknown>)(
          payload,
        );
        assert.strictEqual(sent[0].method, 'POST', `${name} is sent as a POST`);
      }
    });

    test('a patch names the type it patches, filled from the card being patched', async function (assert) {
      let { sent, env } = harness({ answer: writeAnswer(`${REALM}report-1`) });
      let bucket = buildOperations(reportInstance(), env);
      await (bucket.update as (payload: unknown) => Promise<unknown>)({
        attributes: { headline: 'After' },
      });

      assert.deepEqual(
        entries(sent[0])[0].data,
        {
          attributes: { headline: 'After' },
          meta: { adoptsFrom: REPORT },
        },
        'an update of a card is a card resource, so it says what the card is',
      );
    });

    test("a file's update carries the content and nothing else", async function (assert) {
      let { sent, env } = harness({ answer: writeAnswer(`${REALM}notes.md`) });
      let bucket = buildOperations(fileInstance(), env);
      await (bucket.update as (payload: unknown) => Promise<unknown>)({
        content: '# Replaced\n',
      });

      assert.deepEqual(entries(sent[0])[0].data, { content: '# Replaced\n' });
    });

    test('a class-scoped create describes the card to mint', async function (assert) {
      let { sent, env } = harness({
        answer: writeAnswer(`${REALM}Activity/1`),
        defaultRealm: REALM,
      });
      let bucket = buildOperations(activityType(), env);
      await (bucket.create as (payload: unknown) => Promise<unknown>)({
        headline: 'Lab safety',
      });

      assert.deepEqual(
        entries(sent[0]),
        [
          {
            op: 'invoke',
            'boxel:name': 'create',
            data: {
              attributes: { headline: 'Lab safety' },
              meta: { adoptsFrom: ACTIVITY },
            },
          },
        ],
        'the field values the caller supplied, and the type from the class',
      );
      assert.strictEqual(
        sent[0].realmURL,
        REALM,
        'and it lands in the realm the session writes to when the caller names none',
      );
    });

    test('a declared create names the type whose operations it invokes', async function (assert) {
      let { sent, env } = harness({
        answer: writeAnswer(`${REALM}Activity/1`),
        defaultRealm: REALM,
      });
      let bucket = buildOperations(reportType(), env);
      await (bucket.createActivity as (payload: unknown) => Promise<unknown>)({
        headline: 'Named',
      });

      // What a named create mints is its declaration's; the type it names here
      // is the one whose operations are being invoked, which is how the realm
      // resolves the name against a definition.
      assert.deepEqual(entries(sent[0])[0].data, {
        headline: 'Named',
        meta: { adoptsFrom: REPORT },
      });
      assert.strictEqual(entries(sent[0])[0].href, undefined);
    });

    test('a call on a card with no stored state is refused before any request', async function (assert) {
      let { sent, env } = harness();
      let bucket = buildOperations(
        reportInstance({ id: undefined, realmURL: undefined }),
        env,
      );
      await assert.rejects(
        (bucket.escalate as () => Promise<unknown>)(),
        /in no realm yet/,
        'an operation runs in the realm that holds its target',
      );
      assert.strictEqual(sent.length, 0);
    });

    test('a class-scoped call with no realm to run in says so', async function (assert) {
      let { env } = harness();
      let bucket = buildOperations(activityType(), env);
      await assert.rejects(
        (bucket.create as (payload: unknown) => Promise<unknown>)({}),
        /could not find a writable realm/,
        'a type names no realm, so one has to be named or defaulted',
      );
    });
  });

  module('naming the cards a batch mints', function () {
    // The realm names a created card's file after the local id its entry
    // carried, so these names are URL tails the cards keep — not tokens that
    // only have to survive the request. Which is why the suite asserts they
    // differ between batches: a name reused across batches is a create refused
    // for writing a file an earlier batch already wrote.
    function mintingHarness(opts?: {
      resources?: Record<string, unknown>;
      answer?: OperationsAnswer;
    }) {
      return harness({
        answer: opts?.answer ?? {
          'atomic:results': [{ data: { type: 'card', id: 'a' } }],
        },
        subjects: {
          ACTIVITY: activityType(),
          UNSAVED: {
            scope: 'instance',
            family: 'card',
            displayName: 'Activity',
            localId: 'held-by-the-caller',
            realmURL: REALM,
            codeRef: ACTIVITY,
            operations: carried({ create: ['create', false] }),
          },
          SAVED: {
            scope: 'instance',
            family: 'card',
            displayName: 'Activity',
            id: `${REALM}Activity/7`,
            localId: 'held-by-the-caller',
            realmURL: REALM,
            codeRef: ACTIVITY,
            operations: carried({ create: ['create', false] }),
          },
          NAMELESS: {
            scope: 'instance',
            family: 'card',
            displayName: 'Activity',
            realmURL: REALM,
            codeRef: ACTIVITY,
            operations: carried({ create: ['create', false] }),
          },
        },
        resources: (opts?.resources ?? {
          UNSAVED: {
            attributes: { headline: 'Lab safety' },
            meta: { adoptsFrom: ACTIVITY },
          },
        }) as Record<string, Record<string, unknown>>,
      });
    }

    async function mint(
      env: OperationsEnvironment,
      target: string,
      attributes?: Record<string, unknown>,
    ) {
      let bucket = buildOperations(reportInstance(), env);
      return await (
        bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>
      )((b: any) => {
        if (attributes === undefined) {
          b.create(target);
        } else {
          b.create(target, attributes);
        }
      });
    }

    test('two batches in the same realm mint cards under different names', async function (assert) {
      let { sent, env } = mintingHarness();
      await mint(env, 'ACTIVITY', { headline: 'One' });
      await mint(env, 'ACTIVITY', { headline: 'Two' });

      let [first, second] = sent.map(mintedLid);
      assert.notStrictEqual(
        first,
        second,
        `two batches named their cards differently: ${first} and ${second}`,
      );
      for (let lid of [first, second]) {
        assert.ok(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_1$/.test(
            lid,
          ),
          `the name is the batch's own, and the card's position in it: ${lid}`,
        );
      }
    });

    test('one batch names each card it mints by its position', async function (assert) {
      let { sent, env } = harness({
        answer: {
          'atomic:results': [
            { data: { type: 'card', id: 'a' } },
            { data: { type: 'card', id: 'b' } },
          ],
        },
        subjects: { ACTIVITY: activityType() },
      });
      let bucket = buildOperations(reportInstance(), env);
      await (bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
        (b: any) => {
          b.create('ACTIVITY', { headline: 'One' });
          b.create('ACTIVITY', { headline: 'Two' });
        },
      );

      let [one, two] = entries(sent[0]).map((entry) => entry.data?.lid);
      assert.notStrictEqual(one, two, 'the two cards are named apart');
      assert.strictEqual(
        String(one).replace(/_1$/, ''),
        String(two).replace(/_2$/, ''),
        'and both under the name of the batch that minted them',
      );
    });

    test('a create hands an unsaved card the name its holder already knows it by', async function (assert) {
      let { sent, env } = mintingHarness();
      await mint(env, 'UNSAVED');

      assert.deepEqual(
        entries(sent[0])[0].data,
        {
          attributes: { headline: 'Lab safety' },
          meta: { adoptsFrom: ACTIVITY },
          lid: 'held-by-the-caller',
        },
        "the entry says what the instance holds, under the instance's own name",
      );
    });

    test('an adopted create tells the transport whose card it is', async function (assert) {
      let { sent, env } = mintingHarness();
      await mint(env, 'UNSAVED');
      assert.deepEqual(
        sent[0].opts?.adopted,
        ['held-by-the-caller'],
        'so the transport can lock and promote the instance behind it',
      );
    });

    test('a create from plain data reports no instance to the transport', async function (assert) {
      let { sent, env } = mintingHarness();
      await mint(env, 'ACTIVITY', { headline: 'Lab safety' });
      assert.strictEqual(
        sent[0].opts?.adopted,
        undefined,
        'nothing holds a card minted from data, so there is nothing to promote',
      );
    });

    test('one card named twice is reported once to the transport', async function (assert) {
      // The transport takes a lock per name before the write, one nesting
      // inside the last. A name arriving twice would have the inner
      // acquisition wait on the lock the outer one still holds, so the batch
      // would hang here rather than reaching the realm — which refuses a card
      // claimed twice, and is the answer the caller should get.
      let { sent, env } = mintingHarness({
        answer: {
          'atomic:results': [
            { data: { type: 'card', id: 'a' } },
            { data: { type: 'card', id: 'b' } },
          ],
        },
      });
      let bucket = buildOperations(reportInstance(), env);
      await (bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
        (b: any) => {
          b.create('UNSAVED');
          b.create('UNSAVED');
        },
      );

      assert.deepEqual(
        sent[0].opts?.adopted,
        ['held-by-the-caller', 'held-by-the-caller'],
        'the batch reports the name once per entry that used it',
      );
      assert.strictEqual(
        new Set(sent[0].opts?.adopted).size,
        1,
        'and they are the same name, which is what the realm refuses the batch for',
      );
    });

    test('a create of a card that is already stored is refused', async function (assert) {
      let { sent, env } = mintingHarness();
      await assert.rejects(
        mint(env, 'SAVED'),
        /already stored at/,
        'a create mints a card rather than reaching one',
      );
      assert.strictEqual(sent.length, 0, 'and nothing was sent');
    });

    test('a create given both an instance and field values is refused', async function (assert) {
      let { sent, env } = mintingHarness();
      await assert.rejects(
        mint(env, 'UNSAVED', { headline: 'Lab safety' }),
        /not both/,
        'the same card described twice is refused rather than resolved silently',
      );
      assert.strictEqual(sent.length, 0);
    });

    test('a create of an instance nothing names is refused', async function (assert) {
      let { sent, env } = mintingHarness();
      await assert.rejects(
        mint(env, 'NAMELESS'),
        /nothing names the card it would mint/,
        'an instance with neither a URL nor a local id names no card',
      );
      assert.strictEqual(sent.length, 0);
    });
  });

  module('reading what a batch minted', function () {
    test('every minted card is reported as its name beside its URL', function (assert) {
      assert.deepEqual(
        mintedIdentities({
          'atomic:results': [
            { data: { type: 'card', id: `${REALM}a`, lid: 'one' } },
            { data: { type: 'card', id: `${REALM}report-1` } },
            [
              { data: { type: 'card', id: `${REALM}b`, lid: 'two' } },
              [{ data: { type: 'card', id: `${REALM}c`, lid: 'three' } }],
            ],
            { data: null },
          ],
        }),
        [
          { lid: 'one', id: `${REALM}a` },
          { lid: 'two', id: `${REALM}b` },
          { lid: 'three', id: `${REALM}c` },
        ],
        'including the ones nested in a group, and excluding the writes that minted nothing',
      );
    });

    test('an answer that minted nothing reports nothing', function (assert) {
      assert.deepEqual(
        mintedIdentities({
          'atomic:results': [
            { data: { type: 'card', id: `${REALM}report-1` } },
          ],
        }),
        [],
      );
    });
  });

  module('a batch', function () {
    function batchHarness(answer: OperationsAnswer) {
      return harness({
        answer,
        subjects: {
          ACTIVITY: activityType(),
          NEARBY: reportInstance({ id: `${REALM}report-2` }),
          ELSEWHERE: reportInstance({
            id: 'http://example.com/other/report-9',
            realmURL: 'http://example.com/other/',
          }),
        },
      });
    }

    test('a create-and-link batch names the new card by the id the batch minted', async function (assert) {
      let { sent, env } = batchHarness({
        'atomic:results': [
          {
            data: {
              type: 'card',
              id: `${REALM}Activity/9`,
              lid: 'l1',
              meta: { version: 'a' },
            },
          },
          { data: { type: 'card', id: `${REALM}report-1`, meta: {} } },
        ],
      });
      let bucket = buildOperations(reportInstance(), env);
      let [created] = (await (
        bucket.atomic as (build: (b: any) => unknown) => Promise<any[]>
      )((b: any) => {
        let activity = b.create('ACTIVITY', { headline: 'Lab safety' });
        b.addActivity({ activity });
        return [activity];
      })) as any[];

      let lid = mintedLid(sent[0]);
      assert.deepEqual(
        entries(sent[0]),
        [
          {
            op: 'invoke',
            'boxel:name': 'create',
            data: {
              lid,
              attributes: { headline: 'Lab safety' },
              meta: { adoptsFrom: ACTIVITY },
            },
          },
          {
            op: 'invoke',
            'boxel:name': 'addActivity',
            href: `${REALM}report-1`,
            data: { activity: { lid } },
          },
        ],
        'the handle became the local id the later entry links the new card by',
      );
      assert.strictEqual(created.id, `${REALM}Activity/9`);
      assert.strictEqual(
        created.lid,
        'l1',
        'and the answer reports the local id back as the realm echoed it',
      );
    });

    test('a handle stands in wherever a link sits in the payload', async function (assert) {
      let { sent, env } = batchHarness({
        'atomic:results': [
          { data: { type: 'card', id: `${REALM}Activity/9`, meta: {} } },
          { data: { type: 'card', id: `${REALM}report-1`, meta: {} } },
        ],
      });
      let bucket = buildOperations(reportInstance(), env);
      await (bucket.atomic as (build: (b: any) => unknown) => Promise<any>)(
        (b: any) => {
          let activity = b.create('ACTIVITY', { headline: 'Lab safety' });
          b.appendContainsMany({
            field: 'comments',
            items: [{ body: 'see activity', activity }],
          });
        },
      );

      assert.deepEqual(
        entries(sent[0])[1].data,
        {
          field: 'comments',
          items: [
            { body: 'see activity', activity: { lid: mintedLid(sent[0]) } },
          ],
        },
        'a link can sit inside an appended item as readily as in the payload',
      );
    });

    test('entries are answered in the order they were registered', async function (assert) {
      let { sent, env } = batchHarness({
        'atomic:results': [
          { data: { type: 'card', id: 'a', meta: { version: 'a' } } },
          { data: null },
        ],
      });
      let bucket = buildOperations(reportInstance(), env);
      let results = (await (
        bucket.atomic as (build: (b: any) => unknown) => Promise<any[]>
      )((b: any) => {
        b.escalate();
        b.delete();
      })) as any[];

      assert.deepEqual(
        entries(sent[0]).map((entry) => entry['boxel:name']),
        ['escalate', 'delete'],
      );
      assert.strictEqual(results[0].version, 'a');
      assert.strictEqual(results[1], null);
    });

    test('a builder that returns handles is answered with those handles', async function (assert) {
      let { env } = batchHarness({
        'atomic:results': [
          { data: null },
          { data: { type: 'card', id: 'b', meta: { version: 'b' } } },
        ],
      });
      let bucket = buildOperations(reportInstance(), env);
      let [second] = (await (
        bucket.atomic as (build: (b: any) => unknown) => Promise<any[]>
      )((b: any) => {
        b.delete();
        let escalated = b.escalate();
        return [escalated];
      })) as any[];

      assert.strictEqual(
        second.version,
        'b',
        "the handle's own result, not the first entry's",
      );
    });

    test('a group is emitted as a group, and its answer keeps the nesting', async function (assert) {
      let { sent, env } = batchHarness({
        'atomic:results': [
          { data: { type: 'card', id: 'a', meta: { version: 'a' } } },
          [
            { data: { type: 'card', id: 'b', meta: { version: 'b' } } },
            [{ data: null }],
          ],
        ],
      });
      let bucket = buildOperations(reportInstance(), env);
      let results = (await (
        bucket.atomic as (build: (b: any) => unknown) => Promise<any[]>
      )((b: any) => {
        b.escalate();
        b.parallel((p: any) => {
          p.escalate();
          p.serial((s: any) => {
            s.delete();
          });
        });
      })) as any[];

      let [, group] = sent[0].envelope['boxel:operations'];
      assert.strictEqual((group as WireGroup).op, 'parallel');
      let members = (group as WireGroup)['boxel:operations'];
      assert.strictEqual(
        (members[0] as WireInvocation)['boxel:name'],
        'escalate',
      );
      assert.strictEqual(
        (members[1] as WireGroup).op,
        'serial',
        'nested to whatever depth the builder wrote',
      );
      assert.strictEqual(results[0].version, 'a');
      assert.strictEqual(results[1][0].version, 'b');
      assert.deepEqual(
        results[1][1],
        [null],
        "a group's position holds its members' results",
      );
    });

    test('a target found by search carries the filter in the search grammar', async function (assert) {
      let { sent, env } = batchHarness({
        'atomic:results': [
          [
            { data: { type: 'card', id: 'a' } },
            { data: { type: 'card', id: 'b' } },
          ],
        ],
      });
      let bucket = buildOperations(reportInstance(), env);
      let [matched] = (await (
        bucket.atomic as (build: (b: any) => unknown) => Promise<any[]>
      )((b: any) => {
        let open = b.find(
          { on: REPORT_CLASS, eq: { status: 'open' } },
          { expect: 'many' },
        );
        return [b.on(open).escalate()];
      })) as any[];

      let [entry] = entries(sent[0]);
      assert.strictEqual(entry.href, undefined, 'the entry names no href');
      assert.deepEqual(
        entry['boxel:target'],
        {
          query: { 'item.on': REPORT, eq: { 'item.status': 'open' } },
          expect: 'many',
        },
        'the card-rooted filter an author writes, entry-addressed for the realm',
      );
      assert.strictEqual(
        (matched as unknown[]).length,
        2,
        'and an entry that expects many is answered once per card the search reached',
      );
    });

    test('an entry targeting another realm is refused before anything is sent', async function (assert) {
      let { sent, env } = batchHarness({ 'atomic:results': [] });
      let bucket = buildOperations(reportInstance(), env);
      await assert.rejects(
        (bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
          (b: any) => {
            b.on('ELSEWHERE').escalate();
          },
        ),
        /a batch commits to one realm/,
        'a batch commits under one realm write lock',
      );
      assert.strictEqual(sent.length, 0);
    });

    test('a card in the same realm is targeted by its own url', async function (assert) {
      let { sent, env } = batchHarness({ 'atomic:results': [{ data: null }] });
      let bucket = buildOperations(reportInstance(), env);
      await (bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
        (b: any) => {
          b.on('NEARBY').delete();
        },
      );
      assert.strictEqual(entries(sent[0])[0].href, `${REALM}report-2`);
    });

    test('the batch refuses what it cannot carry out', async function (assert) {
      let { sent, env } = batchHarness({ 'atomic:results': [] });
      let bucket = buildOperations(reportInstance(), env);
      let atomic = bucket.atomic as (
        build: (b: any) => unknown,
      ) => Promise<unknown>;

      await assert.rejects(
        atomic(async () => {}),
        /builds its batch synchronously/,
        'an async builder would register its later entries after the batch had been sent',
      );
      await assert.rejects(
        atomic((b: any) => {
          b.on(b.find({})).delete();
        }),
        /names nothing/,
        'a filter that names nothing would target every card in the realm',
      );
      await assert.rejects(
        atomic((b: any) => {
          b.on(
            b.find({ on: REPORT_CLASS, eq: { owner: { $ref: 'actor' } } }),
          ).delete();
        }),
        /stands for a value a declared operation is supplied/,
        'a marker stands for a value an invocation supplies, and a target written at the call site supplies none',
      );
      await assert.rejects(
        atomic((b: any) => {
          let created = b.create('ACTIVITY');
          b.on(created).delete();
        }),
        /no URL to target/,
        'a card the batch is minting has no URL until the batch commits',
      );
      await assert.rejects(
        atomic((b: any) => {
          b.addComment({ body: 'x' });
          return ['not a handle'];
        }),
        /returns handles its own calls produced/,
        'the results a builder asks for are named by its own handles',
      );
      assert.strictEqual(sent.length, 0, 'none of them reached the transport');
    });

    test("a handle from another batch is refused rather than read as this batch's", async function (assert) {
      // A local id is the batch's own sequence, so a retained handle's `l1` is
      // *this* batch's `l1`: substituted by id alone it would link whatever
      // card this batch mints first, which is a wrong link that looks like a
      // right one.
      let first = batchHarness({
        'atomic:results': [
          { data: { type: 'card', id: `${REALM}Activity/1`, meta: {} } },
        ],
      });
      let bucket = buildOperations(reportInstance(), first.env);
      let escaped: unknown;
      await (bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
        (b: any) => {
          escaped = b.create('ACTIVITY', { headline: 'From batch one' });
        },
      );

      let second = batchHarness({ 'atomic:results': [{ data: null }] });
      let later = buildOperations(reportInstance(), second.env);
      await assert.rejects(
        (later.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
          (b: any) => {
            b.create('ACTIVITY', { headline: 'From batch two' });
            b.addActivity({ activity: escaped });
          },
        ),
        /handle from another atomic\(\) call/,
        'the handle names a card the batch it was made in mints',
      );
      assert.strictEqual(
        second.sent.length,
        0,
        'and the second batch never went out',
      );
    });

    test('a payload may name the same value twice', async function (assert) {
      // Two references to one value serialize as two copies; only a value that
      // contains itself cannot be sent. The guard tracks the path it is
      // walking, so the first is carried and the second is refused.
      let { sent, env } = batchHarness({
        'atomic:results': [{ data: { type: 'card', id: 'a', meta: {} } }],
      });
      let bucket = buildOperations(reportInstance(), env);
      let shared = { body: 'said once' };
      await (
        bucket.appendContainsMany as (payload: unknown) => Promise<unknown>
      )({ field: 'comments', items: [shared, shared] });

      assert.deepEqual(
        (entries(sent[0])[0].data as any).items,
        [{ body: 'said once' }, { body: 'said once' }],
        'a repeated reference travels as two values',
      );

      let cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      await assert.rejects(
        (bucket.appendContainsMany as (payload: unknown) => Promise<unknown>)({
          field: 'comments',
          items: [cyclic],
        }),
        /contains itself/,
        'and a value that contains itself is still refused',
      );
    });

    test("a group's builder projects its results the way the batch's does", async function (assert) {
      let { sent, env } = batchHarness({
        'atomic:results': [
          [
            { data: { type: 'card', id: 'a', meta: { version: 'a' } } },
            { data: { type: 'card', id: 'b', meta: { version: 'b' } } },
          ],
        ],
      });
      let bucket = buildOperations(reportInstance(), env);
      let [group] = (await (
        bucket.atomic as (build: (b: any) => unknown) => Promise<any[]>
      )((b: any) => {
        let members = b.parallel((p: any) => {
          p.escalate();
          let second = p.addComment({ body: 'x' });
          return [second];
        });
        return [members];
      })) as any[];

      assert.strictEqual(
        (sent[0].envelope['boxel:operations'][0] as WireGroup)[
          'boxel:operations'
        ].length,
        2,
        'both members are registered and sent',
      );
      assert.deepEqual(
        (group as any[]).map((one) => one.version),
        ['b'],
        'and the group answers with the member its own builder asked for, not with everything it registered',
      );

      await assert.rejects(
        (bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
          (b: any) => {
            b.parallel(() => ['not a handle']);
          },
        ),
        /returns handles its own calls produced/,
        'and a group is held to the same rule about what it may return',
      );
    });

    test('a name the builder owns is refused rather than shadowed', async function (assert) {
      // `create` is the one operation name that can legitimately collide: a
      // card may specialize the base behavior, and a batch reads `create` as
      // its own way to mint a card of any type. The rest of the builder's
      // members are refused at declaration time, where they are written.
      let declares = reportInstance();
      declares.operations = {
        ...declares.operations,
        create: { base: 'create', declared: true } as CarriedOperationInfo,
      };
      let bucket = buildOperations(declares, harness().env);
      await assert.rejects(
        (bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
          (b: any) => {
            b.escalate();
          },
        ),
        /declares an operation named "create"/,
        'the batch says which two spellings collided rather than picking one',
      );
      assert.strictEqual(
        typeof bucket.create,
        'function',
        'and the declared create is still invocable outside a batch',
      );
    });

    test('a read-only batch asks only to read', async function (assert) {
      let { sent, env } = batchHarness({
        'atomic:results': [{ data: { type: 'card', id: 'a' } }],
      });
      let bucket = buildOperations(reportInstance(), env);
      await (bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
        (b: any) => {
          b.read();
        },
      );
      assert.strictEqual(sent[0].method, 'QUERY');
    });

    test('a saved search is never an entry of a batch', async function (assert) {
      let { sent, env } = batchHarness({
        'atomic:results': [{ data: { type: 'card', id: 'a', meta: {} } }],
      });
      let bucket = buildOperations(reportInstance(), env);
      await (bucket.atomic as (build: (b: any) => unknown) => Promise<unknown>)(
        (b: any) => {
          assert.strictEqual(
            b.openReports,
            undefined,
            'a batch is anchored on a card and a saved search runs against a type, so no entry of one can name a search',
          );
          b.escalate();
        },
      );
      assert.strictEqual(
        entries(sent[0]).length,
        1,
        'so only the operation the batch could carry was sent',
      );
    });
  });

  // A saved search is declared like any other operation and carried out
  // nowhere near the others: it is planned and run by the search engine, so
  // what a call produces is a wire query and a live resource rather than an
  // envelope and an awaited result.
  module('a saved search', function () {
    function openReports(env: OperationsEnvironment) {
      return buildOperations(reportType(), env).openReports as any;
    }

    test('resolves its markers and addresses the query for the search engine', function (assert) {
      let { env } = harness();

      assert.deepEqual(
        openReports(env).query(),
        {
          filter: {
            'item.on': REPORT,
            eq: {
              'item.status': 'open',
              'item.author.userId': ACTOR,
            },
          },
          sort: [
            { by: 'item.createdAt', 'item.on': REPORT, direction: 'desc' },
          ],
          realms: [REALM],
        },
        'the class became the type it names, the actor marker became the caller, and the card-rooted query became the entry-addressed one',
      );
    });

    test('answers with the resource the session builds, and the search follows what the thunk reads', function (assert) {
      let { searched, session, env } = harness();
      let owner = {};
      let payload = { status: 'open' } as Record<string, unknown>;
      let byStatus = buildOperations(statusType(), env).byStatus as any;

      let results = byStatus(payload, { owner });

      assert.strictEqual(searched.length, 1, 'one search was asked for');
      assert.strictEqual(
        results,
        searched[0].resource,
        'and what the call answers with is what the session built for it',
      );
      assert.strictEqual(
        searched[0].owner,
        owner,
        'tied to the life the caller named, so the search ends when that does',
      );

      // The thunk is the whole affordance: one call stands for a search that
      // moves, so re-reading it has to follow both of the things it resolves
      // against — the payload the caller handed over, and the session.
      payload.status = 'closed';
      assert.deepEqual(
        (searched[0].getQuery() as any).filter.eq,
        { 'item.status': 'closed' },
        'a re-read follows the payload the call was given, rather than pinning what it resolved to once',
      );

      session.actor = '@someone-else:localhost';
      assert.deepEqual(
        (buildOperations(reportType(), env).openReports as any).query().filter
          .eq['item.author.userId'],
        '@someone-else:localhost',
        'and it follows the session, which is what the actor is read from',
      );
    });

    test('a standing search parks when the session can no longer resolve it', function (assert) {
      let { searched, session, env } = harness();

      openReports(env)();
      assert.ok(searched[0].getQuery(), 'the search has a query to run');

      session.actor = undefined;
      assert.strictEqual(
        searched[0].getQuery(),
        undefined,
        'signing out withdraws what the query compares against, so the search parks rather than throwing inside a render',
      );

      session.actor = ACTOR;
      session.realmsKnown = false;
      assert.strictEqual(
        searched[0].getQuery(),
        undefined,
        'and so does losing the realms it covers, which a sign-out takes with it',
      );

      session.realmsKnown = true;
      assert.ok(
        searched[0].getQuery(),
        'a session that can answer again resumes the same search',
      );
    });

    test('a payload the declaration cannot resolve is refused at the call, not in a render', function (assert) {
      let { searched, env } = harness();
      let byStatus = buildOperations(statusType(), env).byStatus as any;

      assert.throws(
        () => byStatus({}),
        /requires a value for params\("status"\)/,
        'the call raises it where the caller is',
      );
      assert.strictEqual(
        searched.length,
        0,
        'and no search was started for a query that never resolved',
      );
    });

    test('a type named by a nested code ref still covers its own realm', function (assert) {
      let { env } = harness();
      // What `identifyCard` answers for a card class reached as a superclass
      // rather than as its own module export.
      let nested = reportType({
        codeRef: { type: 'ancestorOf', card: REPORT },
      });

      assert.deepEqual(
        (buildOperations(nested, env).openReports as any).query().realms,
        [REALM],
        'the module the ref wraps is what says which realm the type sits in',
      );
    });

    test('a payload fills the markers its declaration names', function (assert) {
      let { env } = harness();
      let byStatus = buildOperations(statusType(), env).byStatus as any;

      assert.deepEqual(
        byStatus.query({ status: 'escalated' }).filter,
        { 'item.on': REPORT, eq: { 'item.status': 'escalated' } },
        'the payload member the declaration names is what the filter compares against',
      );
      assert.throws(
        () => byStatus.query({}),
        /requires a value for params\("status"\)/,
        'and a payload that leaves one unsupplied is refused rather than compared against nothing',
      );
    });

    test('the realms a search covers are the declaration\u2019s, then the call\u2019s, then the type\u2019s own', function (assert) {
      let { env } = harness();
      let elsewhere = 'http://example.com/other/';

      assert.deepEqual(
        openReports(env).query(undefined, { realms: [elsewhere] }).realms,
        [elsewhere],
        'a declaration that named no scope leaves it to the caller',
      );

      let pinned = reportType({
        operations: carried({
          pinnedReports: [
            'query',
            true,
            {
              query: {
                filter: { on: REPORT_CLASS, eq: { status: 'open' } },
                realms: [elsewhere],
              },
            },
          ],
        }),
      });
      assert.deepEqual(
        (buildOperations(pinned, env).pinnedReports as any).query(undefined, {
          realms: [REALM],
        }).realms,
        [elsewhere],
        'a declaration that named its scope has decided, and a call does not widen it',
      );
    });

    test('a search that would cover every readable realm is refused', function (assert) {
      let { env } = harness({ realm: 'http://example.com/nowhere-near/' });

      assert.throws(
        () => openReports(env).query(),
        /names no realm to search/,
        'a saved search whose scope nobody named would fan out across the whole session, which is never what it meant',
      );

      let empty = reportType({
        operations: carried({
          everywhere: [
            'query',
            true,
            {
              query: {
                filter: { on: REPORT_CLASS, eq: { status: 'open' } },
                realms: [],
              },
            },
          ],
        }),
      });
      assert.throws(
        () => (buildOperations(empty, env).everywhere as any).query(),
        /names an empty list of realms/,
        'and a declaration that writes the empty list is refused for what it wrote, since no realms on the wire means every realm',
      );
    });

    test('a session that cannot say who the caller is answers no query at all', function (assert) {
      let { searched, env } = harness({ actor: null });

      assert.strictEqual(
        openReports(env).query(),
        undefined,
        'a search comparing against the caller has nothing to compare, and nothing the caller sent is wrong — so it answers no query rather than refusing one',
      );

      let idle = openReports(env)();
      assert.strictEqual(
        searched[0].getQuery(),
        undefined,
        'and the resource it answers with is an idle search, which renders no rows rather than somebody else\u2019s',
      );
      assert.ok(idle, 'the caller still gets a resource to hold');

      let openToAll = reportType({
        operations: carried({
          everyReport: [
            'query',
            true,
            { query: { filter: { on: REPORT_CLASS, eq: { status: 'open' } } } },
          ],
        }),
      });
      assert.ok(
        (buildOperations(openToAll, env).everyReport as any).query(),
        'a saved search that does not read the caller is unaffected',
      );
    });

    test('a session that carries out no searches says so', function (assert) {
      let { env } = harness({ noSearch: true });

      assert.throws(
        () => openReports(env)(),
        /nothing in this environment registered a search/,
        'a query is carried out by the search engine, which is the one half of the bridge an environment can lack',
      );
    });
  });
});
