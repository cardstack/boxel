import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type {
  OperationsAnswer,
  OperationsEnvelope,
  OperationsMethod,
  OperationsTransport,
  OperationWriteResult,
  WireGroup,
  WireInvocation,
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
// Two of the wire forms the builder emits are carried out by realms this
// endpoint does not have yet: a `parallel`/`serial` group, and a target found
// by search. Their coverage here is the request the builder produces and the
// answer it reads back, driven through a recording transport — what those
// forms mean once the realm runs them belongs where that behavior lives.
// ============================================================================

const testRealm2URL = 'http://test-realm/test2/';

let loader: Loader;
let operations: (typeof OperationsModule)['operations'];

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
  import { operation, params, actor, card, linkTo } from "@cardstack/base/operations";

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
      append: {
        to: 'comments',
        value: { body: params('body'), postedBy: actor() },
      },
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

function invocations(envelope: OperationsEnvelope): WireInvocation[] {
  return envelope['boxel:operations'] as WireInvocation[];
}

function writeAnswer(id: string, version = 'v1'): OperationsAnswer {
  return {
    'atomic:results': [
      {
        data: {
          type: 'card',
          id,
          meta: { version, generation: 7, lastModified: 1725300000 },
        },
      },
    ],
  };
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
    activeRealms: [testRealmURL, testRealm2URL],
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
      assert.deepEqual(
        stored.data.attributes.comments,
        [{ body: 'Reviewed and approved.', postedBy: '@testuser:localhost' }],
        'the append the declaration describes reached the stored card, with the caller as the actor',
      );
    });

    test('a write carries a client request id the store recognizes as its own echo', async function (assert) {
      let report = await cardAt('report-transformed');
      await (operations(report) as any).escalate();

      let ids = [...getService('card-service').clientRequestIds.values()];
      let mine = ids.filter((id) => id.startsWith('instance:'));
      assert.strictEqual(
        mine.length,
        1,
        'the write registered one `instance:`-prefixed request id',
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

    test('the method a batch is sent under follows whether any of it writes', async function (assert) {
      let report = await cardAt('report-read');
      let { sent } = recordingTransport({
        answer: writeAnswer(`${testRealmURL}report-read`),
      });

      // Read-only, so the batch is authorized to read and nothing more.
      await (operations(report) as any).read();
      assert.strictEqual(sent[0].method, 'QUERY', 'a read is sent as a QUERY');

      // One case per behavior that changes stored state, so a behavior that
      // stopped counting as a write — and would then be sent on a request
      // authorized only to read — fails here rather than reaching a realm.
      let writes: [string, unknown][] = [
        ['escalate', {}],
        ['addComment', { body: 'x' }],
        ['update', { attributes: { headline: 'x' } }],
        ['appendContainsMany', { field: 'comments', items: [] }],
        ['delete', undefined],
      ];
      for (let [name, payload] of writes) {
        sent.length = 0;
        await (operations(report) as any)[name](payload);
        assert.strictEqual(sent[0].method, 'POST', `${name} is sent as a POST`);
      }
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

    test('a class-scoped create with no realm lands in the realm the session writes to', async function (assert) {
      let { Activity } = await loader.import<any>(`${testRealmURL}report`);
      let { sent } = recordingTransport({
        answer: writeAnswer(`${testRealmURL}Activity/1`),
        defaultRealm: testRealmURL,
      });

      await (operations(Activity) as any).create({ headline: 'Defaulted' });

      assert.strictEqual(
        sent[0].realmURL,
        testRealmURL,
        'the batch was sent to the default writable realm',
      );
      assert.strictEqual(
        getService('operations').defaultWritableRealm(),
        getService('realm').defaultWritableRealm?.path,
        'which the transport reads from the realm the session would create a card in',
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

    test('a type-scoped entry names the type whose operations it invokes', async function (assert) {
      let { Report } = await loader.import<any>(`${testRealmURL}report`);
      let { sent } = recordingTransport({
        answer: writeAnswer(`${testRealmURL}Activity/1`),
        defaultRealm: testRealmURL,
      });

      await (operations(Report) as any).createActivity({ headline: 'Named' });

      let [entry] = invocations(sent[0].envelope);
      assert.strictEqual(
        entry.href,
        undefined,
        'a call on the class names no resource',
      );
      assert.strictEqual(
        (entry.data as any).meta.adoptsFrom.name,
        'Report',
        "so the type it invokes travels in the entry's own meta",
      );
      assert.strictEqual(
        (entry.data as any).headline,
        'Named',
        'beside the payload the operation declared',
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
      let report = await cardAt('report-refused');
      let { sent } = recordingTransport({
        answer: {
          'atomic:results': [
            { data: { type: 'card', id: `${testRealmURL}report-refused` } },
          ],
        },
      });
      (globalThis as any).__boxelPrerenderApp = true;

      await assert.rejects(
        (operations(report) as any).escalate(),
        /cannot run in a render/,
        'a write from a render would wait on the worker the render is holding',
      );
      assert.strictEqual(sent.length, 0, 'and nothing was sent');

      // A read takes no lock and waits on no indexing, so there is nothing for
      // it to deadlock with — the refusal is about writes, not about renders.
      let document = (await (operations(report) as any).read()) as any;
      assert.strictEqual(
        document.data.id,
        `${testRealmURL}report-refused`,
        'a read from the same render is carried out',
      );
      assert.strictEqual(sent.length, 1, 'and it did reach the transport');
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

    test('stored bytes and queries are reached somewhere other than a batch', async function (assert) {
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

      let { Report } = await loader.import<any>(`${testRealmURL}report`);
      await assert.rejects(
        (operations(Report) as any).openReports(),
        /runs on the search engine/,
        'a declared query says where a query is reached instead of sending a batch',
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

    test('entries are registered in call order, and their results come back in it', async function (assert) {
      let report = await cardAt('report-read');
      let { sent } = recordingTransport({
        answer: {
          'atomic:results': [
            {
              data: { type: 'card', id: 'http://x/a', meta: { version: 'a' } },
            },
            { data: null },
          ],
        },
      });

      let results = (await (operations(report) as any).atomic((b: any) => {
        b.escalate();
        b.delete();
      })) as any[];

      assert.deepEqual(
        invocations(sent[0].envelope).map((entry) => entry['boxel:name']),
        ['escalate', 'delete'],
        'the entries sit in the order the builder registered them',
      );
      assert.strictEqual(results[0].version, 'a', 'the write result is first');
      assert.strictEqual(results[1], null, 'and the delete reports nothing');
    });

    test('a builder returns the handles whose results it wants', async function (assert) {
      let report = await cardAt('report-read');
      recordingTransport({
        answer: {
          'atomic:results': [
            { data: null },
            {
              data: {
                type: 'card',
                id: 'http://x/b',
                meta: { version: 'b', generation: 3, lastModified: 12 },
              },
            },
          ],
        },
      });

      let [second] = (await (operations(report) as any).atomic((b: any) => {
        b.delete();
        let escalated = b.escalate();
        return [escalated];
      })) as [OperationWriteResult];

      assert.strictEqual(
        second.version,
        'b',
        "the handle's own result comes back, not the first entry's",
      );
      assert.strictEqual(second.generation, 3);
    });

    test('a group nests its members in the request and in the answer', async function (assert) {
      let report = await cardAt('report-read');
      let { sent } = recordingTransport({
        answer: {
          'atomic:results': [
            {
              data: { type: 'card', id: 'http://x/a', meta: { version: 'a' } },
            },
            [
              {
                data: {
                  type: 'card',
                  id: 'http://x/b',
                  meta: { version: 'b' },
                },
              },
              [
                {
                  data: {
                    type: 'card',
                    id: 'http://x/c',
                    meta: { version: 'c' },
                  },
                },
              ],
            ],
          ],
        },
      });

      let results = (await (operations(report) as any).atomic((b: any) => {
        b.escalate();
        b.parallel((p: any) => {
          p.escalate();
          p.serial((s: any) => {
            s.escalate();
          });
        });
      })) as any[];

      let [first, group] = sent[0].envelope['boxel:operations'];
      assert.strictEqual((first as WireInvocation).op, 'invoke');
      assert.strictEqual(
        (group as WireGroup).op,
        'parallel',
        'the group is emitted as a group entry',
      );
      let members = (group as WireGroup)['boxel:operations'];
      assert.strictEqual(
        (members[0] as WireInvocation)['boxel:name'],
        'escalate',
        'with its own members inside it',
      );
      assert.strictEqual(
        (members[1] as WireGroup).op,
        'serial',
        'nested to whatever depth the builder wrote',
      );

      assert.strictEqual(
        results[0].version,
        'a',
        'the entry outside the group',
      );
      assert.strictEqual(
        results[1][0].version,
        'b',
        "the group's position holds its members' results",
      );
      assert.strictEqual(
        results[1][1][0].version,
        'c',
        'and the nesting is the nesting the batch had',
      );
    });

    test('a target found by search names the cards an entry runs against', async function (assert) {
      let report = await cardAt('report-read');
      let { Report } = await loader.import<any>(`${testRealmURL}report`);
      let { sent } = recordingTransport({
        answer: {
          'atomic:results': [
            [
              { data: { type: 'card', id: 'http://x/a' } },
              { data: { type: 'card', id: 'http://x/b' } },
            ],
          ],
        },
      });

      let [matched] = (await (operations(report) as any).atomic((b: any) => {
        let open = b.find(
          { on: Report, eq: { status: 'open' } },
          { expect: 'many' },
        );
        return [b.on(open).escalate()];
      })) as [unknown[]];

      let [entry] = invocations(sent[0].envelope);
      assert.strictEqual(entry.href, undefined, 'the entry names no href');
      let target = entry['boxel:target'] as any;
      assert.deepEqual(
        Object.keys(target).sort(),
        ['expect', 'query'],
        'the target carries the filter and how many cards it expects, and nothing the realm supplies itself',
      );
      assert.strictEqual(target.expect, 'many');
      assert.deepEqual(
        target.query.eq,
        { 'item.status': 'open' },
        'the filter travels in the search grammar, entry-addressed',
      );
      assert.strictEqual(
        target.query['item.on'].name,
        'Report',
        'with the card class read as the code ref that names its type',
      );
      assert.strictEqual(
        (matched as unknown[]).length,
        2,
        'an entry that expects many is answered once per card the search reached',
      );
    });

    test('a link to a card the batch mints travels as the local id the batch named it', async function (assert) {
      let report = await cardAt('report-read');
      let { Activity } = await loader.import<any>(`${testRealmURL}report`);
      let { sent } = recordingTransport({
        answer: {
          'atomic:results': [
            { data: { type: 'card', id: 'http://x/a', lid: 'l1' } },
            { data: { type: 'card', id: 'http://x/b' } },
          ],
        },
      });

      await (operations(report) as any).atomic((b: any) => {
        let activity = b.create(Activity, { headline: 'Lab safety' });
        b.appendContainsMany({
          field: 'comments',
          items: [{ body: 'see activity', activity }],
        });
      });

      let [create, append] = invocations(sent[0].envelope);
      assert.strictEqual(
        (create.data as any).lid,
        'l1',
        'the create names the card with a local id',
      );
      assert.deepEqual(
        (append.data as any).items,
        [{ body: 'see activity', activity: { lid: 'l1' } }],
        'and the handle became that local id wherever it sat in the payload',
      );
    });

    test('a batch is built synchronously', async function (assert) {
      let report = await cardAt('report-read');
      recordingTransport();

      await assert.rejects(
        (operations(report) as any).atomic(async (b: any) => {
          b.escalate();
        }),
        /builds its batch synchronously/,
        'an async builder would register its later entries after the batch had been sent',
      );
    });

    test('find refuses a filter that names nothing', async function (assert) {
      let report = await cardAt('report-read');
      let { sent } = recordingTransport();

      await assert.rejects(
        (operations(report) as any).atomic((b: any) => {
          b.on(b.find({})).escalate();
        }),
        /names nothing/,
        'a filter that matches every card in the realm is not a target anyone meant to name',
      );
      assert.strictEqual(sent.length, 0, 'and nothing was sent');
    });
  });

  module('the typed surface', function () {
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
      let { operation, params } = await loader.import<typeof OperationsModule>(
        '@cardstack/base/operations',
      );

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
      // The two behaviors reached elsewhere are not members at all.
      expectTypeEquals<
        false,
        'readSource' extends keyof Bucket ? true : false
      >();
      expectTypeEquals<false, 'create' extends keyof Bucket ? true : false>();
      // A file carries neither a card's document writes nor a batch.
      class _Notes extends FileDef {}
      type FileBucket = OperationsModule.FileInstanceOperations<typeof _Notes>;
      expectTypeEquals<
        false,
        'atomic' extends keyof FileBucket ? true : false
      >();
      expectTypeEquals<
        false,
        'appendContainsMany' extends keyof FileBucket ? true : false
      >();
      expectTypeEquals<
        (payload: { line: string }) => Promise<OperationWriteResult>,
        FileBucket['appendLine']
      >();
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
});
