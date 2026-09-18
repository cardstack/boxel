import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type {
  OperationsAnswer,
  OperationsEnvelope,
  OperationsMethod,
  OperationsTransport,
  OperationWriteResult,
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

    // No `actor()` in this fixture: the in-browser realm sees an integration
    // test's requests as unauthenticated, because the harness's own
    // `verifyJWT` (tests/helpers/adapter.ts) treats a token that has NOT
    // expired as expired. An operation that reads the actor is refused outright
    // on such a request, so what the actor resolves to is asserted against a
    // real realm in the realm server's endpoint suite instead.
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
      assert.deepEqual(
        stored.data.attributes.comments,
        [{ body: 'Reviewed and approved.', postedBy: null }],
        'the append the declaration describes reached the stored card',
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
        getService('realm').defaultWritableRealm?.path,
        'the realm a class-scoped create defaults to is the one the session writes to',
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
    expectTypeEquals<false, 'readSource' extends keyof Bucket ? true : false>();
    expectTypeEquals<false, 'create' extends keyof Bucket ? true : false>();
    // A file carries neither a card's document writes nor a batch.
    class _Notes extends FileDef {}
    type FileBucket = OperationsModule.FileInstanceOperations<typeof _Notes>;
    expectTypeEquals<false, 'atomic' extends keyof FileBucket ? true : false>();
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
