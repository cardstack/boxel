import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type {
  OperationsAnswer,
  OperationsEnvelope,
  OperationsMethod,
  OperationsTransport,
  OperationWriteResult,
  SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import { isCardErrorJSONAPI } from '@cardstack/runtime-common/error';
import type { CardErrorJSONAPI } from '@cardstack/runtime-common/error';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../helpers';
import {
  setupBaseRealm,
  CardDef,
  FileDef,
  StringField,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type { TestRealmAdapter } from '../helpers/adapter';

import type {
  CardDef as CardDefType,
  FileDef as FileDefType,
} from '@cardstack/base/card-api';
import type * as OperationsModule from '@cardstack/base/operations';

// ============================================================================
// Invoking operations from the host: `operations(x)`, the batch builder, and
// the service that carries a batch to its realm.
//
// The realm under test is the in-browser one, which serves the same
// `_operations` endpoint a deployed realm does — so a call made here is
// answered by the operation core rather than by a double, and what the realm
// is left holding afterwards is what the assertions read.
//
// One wire form the builder emits has no reader: an entry whose target is a
// search. The envelope's parse reads an entry's `href` and its `data`, so
// `boxel:target` reaches it as an entry naming nothing to run against — that
// form is covered as the request the builder produces, in the client core's
// own suite, and a batch using it is refused by this realm. Groups are not in
// that position: this realm carries them out, so a group batch here is run.
//
// A few cases still use a recording transport, and each is one where the realm
// would answer in place of the thing under test: what the host mints, what it
// refuses, and what it reads back.
// ============================================================================

const testRealm2URL = 'http://test-realm/test2/';

let loader: Loader;
let operations: (typeof OperationsModule)['operations'];

// The card the suite operates on, as realm source — compiled by the realm and
// lowered by the in-browser indexer, which is what puts real `@operation`
// declarations in front of the endpoint.
//
// No declaration here reads the actor. A request from an integration test
// reaches the in-browser realm unauthenticated, because the harness's own
// `verifyJWT` (`tests/helpers/adapter.ts`) treats a token that has *not*
// expired as expired — and an operation that reads the actor is refused
// outright on such a request. What the actor resolves to is asserted against a
// real realm in the realm server's endpoint suite instead.
const REPORT_MODULE = `
  import {
    contains,
    containsMany,
    field,
    linksToMany,
    CardDef,
    Component,
    FieldDef,
  } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, card, linkTo } from "@cardstack/base/operations";

  export class ReportComment extends FieldDef {
    @field body = contains(StringField);
    @field postedBy = contains(StringField);
  }

  export class Activity extends CardDef {
    @field headline = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
    static embedded = class Embedded extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
    static fitted = class Fitted extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
  }

  export class Report extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @field comments = containsMany(ReportComment);
    @field activities = linksToMany(() => Activity);

    @operation static escalate = {
      base: 'transform',
      set: { status: 'escalated' },
    };

    @operation static addComment = {
      base: 'transform',
      params: { body: StringField },
      append: { to: 'comments', value: { body: params('body') } },
    };

    @operation static addActivity = {
      base: 'transform',
      params: { activity: linkTo(() => Activity) },
      append: { to: 'activities', value: card(params('activity')) },
    };

    @operation static createActivity = {
      base: 'create',
      of: Activity,
      params: { headline: StringField },
      fill: { headline: params('headline') },
    };

    @operation static openReports = {
      base: 'query',
      query: { filter: { on: () => Report, eq: { status: 'open' } } },
    };

    static isolated = class Isolated extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
    static embedded = class Embedded extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
    static fitted = class Fitted extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
  }
`;

function reportRef() {
  return { module: `${testRealmURL}report`, name: 'Report' };
}

function reportFile(headline: string) {
  return {
    data: {
      type: 'card',
      attributes: { headline, status: 'open', comments: [] },
      meta: { adoptsFrom: reportRef() },
    },
  };
}

// One report per test that changes one, so no test depends on another's
// leftovers.
function realmContents() {
  return {
    'report.gts': REPORT_MODULE,
    'report-transformed.json': reportFile('Quarterly Review'),
    'report-read.json': reportFile('Read Me'),
    'report-deleted.json': reportFile('Going Away'),
    'report-updated.json': reportFile('Before'),
    'report-appended.json': reportFile('Appended To'),
    'report-batched.json': reportFile('Batched'),
    'report-refused.json': reportFile('Refused'),
    'report-created-from.json': reportFile('Creator'),
    'report-grouped.json': reportFile('Grouped'),
    'report-typed.json': reportFile('Typed'),
    'notes.md': '# Notes\n',
  };
}

interface SentRequest {
  realmURL: string;
  method: OperationsMethod;
  envelope: OperationsEnvelope;
}

// A transport that answers from a script instead of reaching the realm, for the
// cases that are about the request a call produces — or about a refusal that
// has to happen before one is sent at all.
function recordingTransport(opts?: {
  answer?: OperationsAnswer | ((sent: SentRequest) => OperationsAnswer);
  defaultRealm?: string;
}): { sent: SentRequest[]; transport: OperationsTransport } {
  let sent: SentRequest[] = [];
  let transport: OperationsTransport = {
    async send(realmURL, method, envelope) {
      let request = { realmURL, method, envelope };
      sent.push(request);
      let { answer } = opts ?? {};
      if (typeof answer === 'function') {
        return answer(request);
      }
      return answer ?? { 'atomic:results': [] };
    },
    defaultWritableRealm() {
      return opts?.defaultRealm;
    },
  };
  (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT = transport;
  return { sent, transport };
}

module('Integration | operations invocation', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupCardLogs(hooks, async () =>
    getService('loader-service').loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let adapter: TestRealmAdapter;
  let hostTransport: unknown;

  hooks.beforeEach(async function () {
    ({ adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: realmContents(),
    }));
    // Imported after the realm is up, and through the loader the realm's own
    // instances were built by: `operations()` reads a def's declarations and
    // asks what a value is an instance of, so a copy of the module from an
    // earlier loader would not recognize the very cards the store hands back.
    loader = getService('loader-service').loader;
    ({ operations } = await loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    ));
    await getService('realm').login(testRealmURL);
    // Looking the service up is what arms the bridge a card reads the
    // transport back through, the same as the app's own boot does.
    getService('operations');
    hostTransport = (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT;
  });

  hooks.afterEach(function () {
    (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT = hostTransport;
    delete (globalThis as any).__boxelPrerenderApp;
  });

  // A card whose own fields include one named `status` is why this asks the
  // error predicate rather than testing for a `status` member: the card under
  // test declares that field, and a member test would read every instance of it
  // as an error.
  async function cardAt(localPath: string): Promise<CardDefType> {
    return loaded(
      await getService('store').get<CardDefType>(`${testRealmURL}${localPath}`),
      localPath,
    );
  }

  async function fileAt(localPath: string): Promise<FileDefType> {
    return loaded(
      await getService('store').get<FileDefType>(
        `${testRealmURL}${localPath}`,
        { type: 'file-meta' },
      ),
      localPath,
    );
  }

  function loaded<T>(
    instance: T | CardErrorJSONAPI | undefined,
    at: string,
  ): T {
    if (!instance || isCardErrorJSONAPI(instance)) {
      throw new Error(
        `expected ${at} to load, got ${JSON.stringify(instance)}`,
      );
    }
    return instance;
  }

  async function storedCard(localPath: string): Promise<any> {
    let file = await adapter.openFile(localPath);
    if (!file) {
      throw new Error(`${localPath} is not in the realm`);
    }
    return JSON.parse(file.content as string);
  }

  async function storedText(localPath: string): Promise<string> {
    let file = await adapter.openFile(localPath);
    if (!file) {
      throw new Error(`${localPath} is not in the realm`);
    }
    return file.content as string;
  }

  module('one operation at a time', function () {
    test('a named transform answers with the card it wrote, and the card holds the change', async function (assert) {
      let report = await cardAt('report-transformed');
      let result = (await (operations(report) as any).addComment({
        body: 'Reviewed and approved.',
      })) as OperationWriteResult;

      assert.strictEqual(
        result.id,
        `${testRealmURL}report-transformed`,
        'the result names the card the operation ran against',
      );
      assert.ok(result.version, 'the result carries the version it now holds');
      assert.ok(result.lastModified > 0, 'and when the card was last written');

      let stored = await storedCard('report-transformed.json');
      let comments = stored.data.attributes.comments as { body: string }[];
      assert.strictEqual(comments.length, 1, 'one comment was appended');
      assert.strictEqual(
        comments[0].body,
        'Reviewed and approved.',
        'carrying the value the payload supplied, as the declaration describes',
      );
    });

    test('a write carries a client request id to the realm, and does not suppress its own reload', async function (assert) {
      // Read off the event the realm broadcast, which is where the sent header
      // surfaces: the realm reads `X-Boxel-Client-Request-Id` and stamps it on
      // the index job. Asserting a local registry instead would pass for a
      // send that registered one id and sent another, or none.
      let report = await cardAt('report-transformed');
      let broadcast: any[] = [];
      let realmEvent = adapter.broadcastRealmEvent.bind(adapter);
      adapter.broadcastRealmEvent = async (...args: any[]) => {
        broadcast.push(args[0]);
        return (realmEvent as any)(...args);
      };
      let { clientRequestIds } = getService('card-service');
      let before = new Set(clientRequestIds.values());

      await (operations(report) as any).escalate();

      let ids = broadcast
        .map((event) => event?.clientRequestId)
        .filter(Boolean);
      assert.strictEqual(ids.length, 1, 'one write, one request id');
      assert.true(
        String(ids[0]).startsWith('instance:'),
        `the realm received the id under the host's own prefix: ${ids[0]}`,
      );

      // Not registered locally, on purpose. That registry is what makes the
      // store skip the reload, and it may skip only when a save has already
      // applied the document it sent — an operation's answer carries identity
      // and version, so a suppressed event would leave this card showing
      // pre-write values with nothing left to correct it.
      let added = [...clientRequestIds.values()].filter(
        (id) => !before.has(id),
      );
      assert.deepEqual(
        added,
        [],
        'and nothing was registered that would stop the store reloading the card',
      );
    });

    test('a read answers with the document', async function (assert) {
      let report = await cardAt('report-read');
      let document = (await (operations(report) as any).read()) as any;

      assert.strictEqual(
        document.data.id,
        `${testRealmURL}report-read`,
        'the document is the card that was read',
      );
      assert.strictEqual(
        document.data.attributes.headline,
        'Read Me',
        'and it carries the card values',
      );
    });

    test('a delete answers with nothing left to describe', async function (assert) {
      let report = await cardAt('report-deleted');
      let result = await (operations(report) as any).delete();

      assert.strictEqual(result, null, 'a delete reports no state');
      assert.false(
        await adapter.exists('report-deleted.json'),
        'and the card is gone from the realm',
      );
    });

    test('a base update merges the values it is given', async function (assert) {
      let report = await cardAt('report-updated');
      let result = (await (operations(report) as any).update({
        attributes: { headline: 'After' },
      })) as OperationWriteResult;

      assert.strictEqual(result.id, `${testRealmURL}report-updated`);
      let stored = await storedCard('report-updated.json');
      assert.strictEqual(
        stored.data.attributes.headline,
        'After',
        'the merged value reached the stored card',
      );
      assert.strictEqual(
        stored.data.attributes.status,
        'open',
        'and a value the patch did not name is left as it was',
      );
    });

    test('appendContainsMany adds to a collection without reading the card', async function (assert) {
      let report = await cardAt('report-appended');
      let result = (await (operations(report) as any).appendContainsMany({
        field: 'comments',
        items: [{ body: 'Appended.', postedBy: '@someone:localhost' }],
      })) as OperationWriteResult;

      assert.strictEqual(result.id, `${testRealmURL}report-appended`);
      let stored = await storedCard('report-appended.json');
      assert.deepEqual(stored.data.attributes.comments, [
        { body: 'Appended.', postedBy: '@someone:localhost' },
      ]);
    });

    test('a class-scoped create mints a card in the realm it was given', async function (assert) {
      let { Activity } = await loader.import<any>(`${testRealmURL}report`);
      let result = (await (operations(Activity) as any).create(
        { headline: 'Lab safety' },
        { realm: testRealmURL },
      )) as OperationWriteResult;

      assert.ok(
        result.id.startsWith(testRealmURL),
        `the new card was minted in the realm it was given: ${result.id}`,
      );
      let localPath = result.id.slice(testRealmURL.length);
      let stored = await storedCard(`${localPath}.json`);
      assert.strictEqual(
        stored.data.attributes.headline,
        'Lab safety',
        'the field values the caller supplied reached the new card',
      );
      assert.strictEqual(
        stored.data.meta.adoptsFrom.name,
        'Activity',
        'and its type came from the class the call was made on',
      );
      assert.true(
        String(stored.data.meta.adoptsFrom.module).endsWith('report'),
        `naming the module that exports it: ${stored.data.meta.adoptsFrom.module}`,
      );
    });

    test('the transport lands a create with no realm where the store would', async function (assert) {
      // What is the host's to answer is where the default comes from; which
      // realm a batch is then sent to is the client core's, and is covered
      // where that core is driven directly.
      assert.strictEqual(
        getService('operations').defaultWritableRealm(),
        testRealmURL,
        'a class-scoped create with no realm lands in the realm this session writes to',
      );
    });

    test('a declared create mints its own type, anchored on the card it was invoked on', async function (assert) {
      let report = await cardAt('report-created-from');
      let result = (await (operations(report) as any).createActivity({
        headline: 'Lab safety',
      })) as OperationWriteResult;

      let stored = await storedCard(
        `${result.id.slice(testRealmURL.length)}.json`,
      );
      assert.strictEqual(
        stored.data.attributes.headline,
        'Lab safety',
        "the declaration's fill wrote the new card's values",
      );
      assert.strictEqual(
        stored.data.meta.adoptsFrom.name,
        'Activity',
        'and what it minted is the type its declaration names, not the card it was invoked on',
      );
    });

    test('an operation on a card that was never saved is refused before any request', async function (assert) {
      let { Report } = await loader.import<any>(`${testRealmURL}report`);
      let unsaved = new Report({ headline: 'Unsaved' });
      let { sent } = recordingTransport();

      await assert.rejects(
        (operations(unsaved) as any).escalate(),
        /no realm yet|never been saved/,
        'a card with no stored state has nothing for an operation to run against',
      );
      assert.strictEqual(sent.length, 0, 'and nothing was sent');
    });

    test('a write cannot run in a render, and a read still can', async function (assert) {
      // Against the realm rather than through a recording transport: the
      // refusal is the host transport's own, so a stand-in for it would prove
      // nothing, and what the realm is left holding is how "nothing was
      // written" is read.
      let report = await cardAt('report-refused');
      (globalThis as any).__boxelPrerenderApp = true;

      await assert.rejects(
        (operations(report) as any).escalate(),
        /cannot run in a render/,
        'a write from a render would wait on the worker the render is holding',
      );
      let stored = await storedCard('report-refused.json');
      assert.strictEqual(
        stored.data.attributes.status,
        'open',
        'and the card is as it was',
      );

      // A read takes no lock and waits on no indexing, so there is nothing for
      // it to deadlock with — the refusal is about writes, not about renders.
      let document = (await (operations(report) as any).read()) as any;
      assert.strictEqual(
        document.data.id,
        `${testRealmURL}report-refused`,
        'a read from the same render is carried out',
      );
    });

    test('an environment with no transport says so rather than half-working', async function (assert) {
      let report = await cardAt('report-read');
      delete (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT;

      assert.throws(
        () => operations(report),
        /no operations transport is available/,
        'an operation is carried out over HTTP, which the host supplies — in node there is nothing to register',
      );
    });

    test('stored bytes are reached somewhere other than a batch', async function (assert) {
      let report = await cardAt('report-read');
      let bucket = operations(report) as any;

      assert.strictEqual(
        bucket.readSource,
        undefined,
        'a stored-bytes read has no member: the card source and byte routes serve it',
      );
      assert.strictEqual(
        bucket.transform,
        undefined,
        'and a bare transform has none either: a transform runs a program, which a batch entry cannot carry',
      );
      assert.strictEqual(
        bucket.create,
        undefined,
        'a create targets a type, so it is invoked on the class',
      );
      assert.strictEqual(
        bucket.openReports,
        undefined,
        'a saved search reads a collection of a type, so it is invoked on the class as well',
      );

      let { Report } = await loader.import<any>(`${testRealmURL}report`);
      let savedSearch = (operations(Report) as any).openReports;
      assert.strictEqual(
        typeof savedSearch,
        'function',
        'a declared query is invocable on the class that declares it',
      );
      assert.strictEqual(
        typeof savedSearch.query,
        'function',
        'and answers the wire query it resolves to, for a card that renders the rows itself',
      );
    });
  });

  // Reached through `operations()` with no cast and no type argument, which is
  // the one thing the hand-built bucket types in the types module cannot say
  // anything about: every other call in this file goes through `as any`, so a
  // typed surface that made the ordinary spelling uncallable would not show up
  // anywhere else.
  module("the entry point's own typing", function () {
    test('the ordinary spelling compiles, and answers what its type says', async function (assert) {
      let report = await cardAt('report-typed');
      let nearby = await cardAt('report-read');
      let { Report } = await loader.import<{ Report: typeof CardDef }>(
        `${testRealmURL}report`,
      );

      let result = await operations(report).addComment({
        body: 'Typed straight through.',
      });
      assert.strictEqual(
        result.id,
        `${testRealmURL}report-typed`,
        'the lean result is typed as one, and names the card it wrote',
      );

      await operations(report).atomic((b) => {
        b.on(nearby).escalate();
      });
      let stored = await storedCard('report-read.json');
      assert.strictEqual(
        stored.data.attributes.status,
        'escalated',
        'a card named through on() carries its operations by name too',
      );

      let created = await operations(Report).create({ headline: 'From class' });
      assert.ok(
        created.id.startsWith(testRealmURL),
        `a class-scoped create answers with the minted id: ${created.id}`,
      );
    });
  });

  module("a file's operations", function () {
    test('a file reads its metadata document, replaces its content, and takes an appended line', async function (assert) {
      let notes = await fileAt('notes.md');
      let bucket = operations(notes) as any;

      let document = (await bucket.read()) as any;
      assert.strictEqual(
        document.data.attributes.name,
        'notes.md',
        'a file read answers with the metadata document',
      );

      let replaced = (await bucket.update({
        content: '# Replaced\n',
      })) as OperationWriteResult;
      assert.ok(replaced.version, 'the write reports the content it now holds');
      assert.strictEqual(
        await storedText('notes.md'),
        '# Replaced\n',
        'and the file holds exactly what it was given',
      );

      await bucket.appendLine({ line: 'one more line' });
      assert.strictEqual(
        await storedText('notes.md'),
        '# Replaced\none more line\n',
        'an appended line is newline-terminated and lands at the end',
      );
    });

    test('a file carries its reads and the writes that work on its bytes, and nothing else', async function (assert) {
      let notes = await fileAt('notes.md');
      let bucket = operations(notes) as any;

      assert.strictEqual(typeof bucket.read, 'function', 'read');
      assert.strictEqual(typeof bucket.update, 'function', 'update');
      assert.strictEqual(typeof bucket.appendLine, 'function', 'appendLine');
      for (let absent of [
        'create',
        'delete',
        'transform',
        'atomic',
        'appendContainsMany',
        'readSource',
      ]) {
        assert.strictEqual(
          bucket[absent],
          undefined,
          `a file's bucket carries no ${absent}`,
        );
      }
    });
  });

  module('a batch', function () {
    test('a create-and-link batch answers with the minted id, and both entries commit together', async function (assert) {
      let report = await cardAt('report-batched');
      let { Activity } = await loader.import<any>(`${testRealmURL}report`);

      let [created] = (await (operations(report) as any).atomic((b: any) => {
        let activity = b.create(Activity, { headline: 'Lab safety' });
        b.addActivity({ activity });
        return [activity];
      })) as [OperationWriteResult];

      assert.ok(
        created.id.startsWith(testRealmURL),
        `the create answers with the id the realm minted: ${created.id}`,
      );
      assert.strictEqual(
        created.lid,
        'l1',
        'beside the local id the batch named it with',
      );

      let stored = await storedCard('report-batched.json');
      let links = Object.values(
        (stored.data.relationships ?? {}) as Record<string, any>,
      ).map((relationship) => relationship?.links?.self);
      assert.true(
        links.some((link: string | undefined) =>
          link?.endsWith(created.id.slice(testRealmURL.length)),
        ),
        `the second entry linked the card the first minted: ${JSON.stringify(links)}`,
      );
      let activity = await storedCard(
        `${created.id.slice(testRealmURL.length)}.json`,
      );
      assert.strictEqual(
        activity.data.attributes.headline,
        'Lab safety',
        'and the minted card holds what the batch described',
      );
    });

    test('a parallel group commits its members together', async function (assert) {
      // Run against the realm rather than recorded: this realm reads groups,
      // so what a group means — both members committed, or neither — is
      // available here rather than only in what the builder emitted.
      let report = await cardAt('report-grouped');
      let { Activity } = await loader.import<any>(`${testRealmURL}report`);

      let [group] = (await (operations(report) as any).atomic((b: any) => {
        let members = b.parallel((p: any) => {
          let activity = p.create(Activity, { headline: 'Lab safety' });
          let comment = p.addComment({ body: 'Both or neither.' });
          return [activity, comment];
        });
        return [members];
      })) as [[OperationWriteResult, OperationWriteResult]];
      let [created, appended] = group;

      assert.ok(
        created.id.startsWith(testRealmURL),
        `the group's create minted a card: ${created.id}`,
      );
      assert.strictEqual(
        appended.id,
        `${testRealmURL}report-grouped`,
        "and its sibling wrote the group's anchor card",
      );

      let stored = await storedCard('report-grouped.json');
      let comments = stored.data.attributes.comments as { body: string }[];
      assert.strictEqual(comments.length, 1, 'the append landed');
      assert.strictEqual(comments[0].body, 'Both or neither.');
      let activity = await storedCard(
        `${created.id.slice(testRealmURL.length)}.json`,
      );
      assert.strictEqual(
        activity.data.attributes.headline,
        'Lab safety',
        'and so did the card the group minted, in the same commit',
      );
    });

    test('a batch that targets a card in another realm is refused before any request', async function (assert) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealm2URL,
        contents: {
          'elsewhere.json': {
            data: {
              type: 'card',
              attributes: { headline: 'Elsewhere', status: 'open' },
              meta: { adoptsFrom: reportRef() },
            },
          },
        },
      });
      await getService('realm').login(testRealm2URL);
      // Mounting a realm resets the loader, so the module and both cards are
      // read after it: `operations()` asks what a value is an instance of, and
      // a copy of it from the earlier loader would not recognize a card the
      // store built with the new one.
      ({ operations } = await getService('loader-service').loader.import<
        typeof OperationsModule
      >('@cardstack/base/operations'));
      let elsewhere = loaded(
        await getService('store').get<CardDefType>(`${testRealm2URL}elsewhere`),
        'test2/elsewhere',
      );
      let report = await cardAt('report-refused');
      let { sent } = recordingTransport();

      await assert.rejects(
        (operations(report) as any).atomic((b: any) => {
          b.on(elsewhere).escalate();
        }),
        /a batch commits to one realm/,
        'a batch commits under one realm write lock, so it cannot reach another realm',
      );
      assert.strictEqual(sent.length, 0, 'and nothing was sent');
    });
  });
});

// The typed surface, and the declarations it is read from.
//
// No realm is mounted here on purpose: mounting one resets the loader, and
// these tests declare their own cards — so the card API the classes extend and
// the module that reads their declarations have to be the same copy, which they
// are only while nothing has reset the loader underneath them.
module('Integration | operations invocation types', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupCardLogs(hooks, async () =>
    getService('loader-service').loader.import('@cardstack/base/card-api'),
  );
  setupMockMatrix(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  // Compile-time assertions. The call does nothing at run time; it fails to
  // type-check unless the two types are identical, so the call is the
  // assertion.
  type Identical<Left, Right> =
    (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
      ? true
      : false;

  function expectTypeEquals<Expected, Actual>(
    ..._assertion: Identical<Expected, Actual> extends true
      ? []
      : ['the two types are not identical']
  ) {}

  test('an operation takes the payload its declaration types, and answers by the behavior it is built on', async function (assert) {
    let { operation, params, getDeclaredOperations } = await loader.import<
      typeof OperationsModule
    >('@cardstack/base/operations');

    class Report extends CardDef {
      @operation static addComment = {
        base: 'transform',
        params: { body: StringField },
        append: { to: 'comments', value: { body: params('body') } },
      } satisfies OperationsModule.OperationDeclaration;
      @operation static archive = {
        base: 'delete',
      } satisfies OperationsModule.OperationDeclaration;
    }

    type Bucket = OperationsModule.CardInstanceOperations<typeof Report>;

    expectTypeEquals<
      (payload: { body: string }) => Promise<OperationWriteResult>,
      Bucket['addComment']
    >();
    // A declaration takes the place of the base operation it names, so the
    // rebound `delete` is the declared one — and a delete still reports that
    // there is no state left to describe.
    // A payload stays optional on a declaration that names no params: an
    // operation annotated `: OperationDeclaration` for a subclass to reshape
    // widens its schema away, and it is still invocable with one.
    expectTypeEquals<
      (payload?: Record<string, unknown>) => Promise<null>,
      Bucket['archive']
    >();
    expectTypeEquals<
      (patch: OperationsModule.CardPatch) => Promise<OperationWriteResult>,
      Bucket['update']
    >();
    // A base read takes no payload at all: the read executor reads none, and a
    // declaration that would give one meaning is refused as a stage a batch
    // does not run.
    expectTypeEquals<
      () => Promise<OperationsModule.OperationDocument>,
      Bucket['read']
    >();
    // A declared create invoked on the class may name its realm, the same way
    // the base create does: a type has no instance to read one from.
    class Activities extends CardDef {
      @operation static createActivity = {
        base: 'create',
        of: () => Activities,
        params: { headline: StringField },
        fill: { headline: params('headline') },
      } satisfies OperationsModule.OperationDeclaration;
    }
    expectTypeEquals<
      (
        payload: { headline: string },
        opts?: OperationsModule.InvokeOptions,
      ) => Promise<OperationWriteResult>,
      OperationsModule.CardTypeOperations<typeof Activities>['createActivity']
    >();
    // A declared query is the one member that is not awaited: the search
    // engine carries it out, so it answers the live entries resource — and
    // `.query()` answers the wire query behind it, for a card that renders the
    // rows itself.
    class Reports extends CardDef {
      @operation static openReports = {
        base: 'query',
        query: { filter: { on: () => Reports, eq: { status: 'open' } } },
      } satisfies OperationsModule.OperationDeclaration;
    }
    type SavedSearch = OperationsModule.CardTypeOperations<
      typeof Reports
    >['openReports'];
    expectTypeEquals<
      (
        payload?: Record<string, unknown>,
        opts?: OperationsModule.SearchInvokeOptions,
      ) => OperationsModule.SearchEntries,
      (...args: Parameters<SavedSearch>) => ReturnType<SavedSearch>
    >();
    expectTypeEquals<SearchEntryWireQuery, ReturnType<SavedSearch['query']>>();
    assert.deepEqual(
      Object.keys(getDeclaredOperations(Reports)),
      ['openReports'],
      'and the reader agrees with the type about the declared query',
    );
    assert.deepEqual(
      Object.keys(getDeclaredOperations(Activities)),
      ['createActivity'],
      'and the reader agrees with the type about the declared create',
    );

    // The two behaviors reached elsewhere are not members at all.
    expectTypeEquals<false, 'readSource' extends keyof Bucket ? true : false>();
    expectTypeEquals<false, 'create' extends keyof Bucket ? true : false>();
    // A file carries neither a card's document writes nor a batch.
    //
    // The fixture declares an operation rather than extending `FileDef` bare,
    // and that is load-bearing: the predicate that decides whether a call
    // named its class compares the type against its own constraint, so a
    // subclass that adds nothing at all is indistinguishable from the
    // constraint and reads as unnamed — which mixes the unchecked fallback in
    // and makes every name present. A def with something of its own is both
    // the realistic case and the one that can assert an absence.
    class Notes extends FileDef {
      @operation static appendAudit = {
        base: 'appendLine',
        params: { line: StringField },
      } satisfies OperationsModule.OperationDeclaration;
    }
    type FileBucket = OperationsModule.FileInstanceOperations<typeof Notes>;
    expectTypeEquals<false, 'atomic' extends keyof FileBucket ? true : false>();
    expectTypeEquals<
      false,
      'appendContainsMany' extends keyof FileBucket ? true : false
    >();
    expectTypeEquals<
      (payload: { line: string }) => Promise<OperationWriteResult>,
      FileBucket['appendLine']
    >();
    expectTypeEquals<
      (payload: { line: string }) => Promise<OperationWriteResult>,
      FileBucket['appendAudit']
    >();
    assert.deepEqual(
      Object.keys(getDeclaredOperations(Notes)),
      ['appendAudit'],
      'and the reader agrees with the type about what the file def declares',
    );
    assert.ok(Report, 'the declarations are read off the class');
  });

  test("a batch's results are typed from the handles the builder returns", async function (assert) {
    let { operation, params, linkTo } = await loader.import<
      typeof OperationsModule
    >('@cardstack/base/operations');

    class Activity extends CardDef {}
    class Classroom extends CardDef {
      @operation static addActivity = {
        base: 'transform',
        params: { activity: linkTo(() => Activity) },
        append: { to: 'activities', value: params('activity') },
      } satisfies OperationsModule.OperationDeclaration;
    }

    // Never called: the assertions are the types it is written in.
    async function typeChecks(
      classroom: OperationsModule.CardInstanceOperations<typeof Classroom>,
    ) {
      let _pair = await classroom.atomic((b) => {
        let activity = b.create(Activity, { headline: 'Lab safety' });
        let linked = b.addActivity({ activity });
        return [activity, linked];
      });
      expectTypeEquals<
        [OperationWriteResult, OperationWriteResult],
        typeof _pair
      >();

      // A builder that returns nothing is answered positionally, which is a
      // tree rather than a tuple: a group's position holds its members'
      // results.
      let _positional = await classroom.atomic((b) => {
        b.addActivity({ activity: 'http://x/a' });
      });
      expectTypeEquals<
        OperationsModule.OperationResultTree,
        typeof _positional
      >();

      // A group's handle carries its members' results, so the nesting the
      // builder wrote is the nesting the tuple has.
      let _nested = await classroom.atomic((b) => {
        let group = b.parallel((p) => {
          let one = p.addActivity({ activity: 'http://x/a' });
          return [one];
        });
        return [group];
      });
      expectTypeEquals<[[OperationWriteResult]], typeof _nested>();
    }
    void typeChecks;
    assert.ok(Classroom, 'the batch surface is typed from the declarations');
  });
});
