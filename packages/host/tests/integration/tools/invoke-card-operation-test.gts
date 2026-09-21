import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type {
  OperationsAnswer,
  OperationsEnvelope,
  OperationsMethod,
  OperationsTransport,
} from '@cardstack/runtime-common';
import { isCardErrorJSONAPI } from '@cardstack/runtime-common/error';

import InvokeCardOperationTool from '@cardstack/host/tools/invoke-card-operation';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { TestRealmAdapter } from '../../helpers/adapter';
import type * as BaseToolModule from '@cardstack/base/command';

// The card the suite invokes operations on, as realm source: the realm
// compiles it and the in-browser indexer lowers it, which is what puts real
// `@operation` declarations in front of the endpoint the tool's call reaches.
//
// `restate` is the one declaration carrying an `input` program. That program
// runs over the payload before the realm checks the params, so `headline` has
// a value even when the caller sends none — which is why an operation that
// carries one is exempt from the tool's own check.
const REPORT_MODULE = `
  import {
    contains,
    containsMany,
    field,
    linksTo,
    CardDef,
    FieldDef,
  } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, bxl } from "@cardstack/base/operations";

  export class ReportComment extends FieldDef {
    @field body = contains(StringField);
  }

  export class Activity extends CardDef {
    @field headline = contains(StringField);
  }

  export class Report extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @field comments = containsMany(ReportComment);
    @field activity = linksTo(() => Activity);

    @operation static addComment = {
      base: 'transform',
      params: { body: StringField },
      append: { to: 'comments', value: { body: params('body') } },
    };

    @operation static restate = {
      base: 'transform',
      params: { headline: StringField },
      input: bxl\`. + {headline: (.headline // "Restated by default")}\`,
      set: { headline: params('headline') },
    };

    @operation static details = {
      base: 'read',
    };

    @operation static retire = {
      base: 'delete',
    };

    @operation static openReports = {
      base: 'query',
      query: { filter: { on: () => Report, eq: { status: 'open' } } },
    };
  }
`;

function reportFile(headline: string) {
  return {
    data: {
      type: 'card',
      attributes: { headline, status: 'open', comments: [] },
      meta: {
        adoptsFrom: { module: `${testRealmURL}report`, name: 'Report' },
      },
    },
  };
}

// One report per test that writes one, so no test reads another's leftovers.
function realmContents() {
  return {
    'report.gts': REPORT_MODULE,
    'report-commented.json': reportFile('Quarterly Review'),
    'report-restated.json': reportFile('Before'),
    'report-read.json': reportFile('Read Me'),
    'report-unknown.json': reportFile('Unknown Operation'),
    'report-missing-param.json': reportFile('Missing Param'),
    'report-queried.json': reportFile('Queried'),
    'report-realm-given.json': reportFile('Realm Given'),
    'report-created-from.json': reportFile('Creator'),
    'report-linked-from.json': reportFile('Linker'),
    'report-relationships-refused.json': reportFile('Relationships Refused'),
    'report-retired.json': reportFile('Going Away'),
    'report-not-offered.json': reportFile('Not Offered'),
    'report-realm-forwarded.json': reportFile('Realm Forwarded'),
    'report-realm-defaulted.json': reportFile('Realm Defaulted'),
    'activity-lab-safety.json': {
      data: {
        type: 'card',
        attributes: { headline: 'Lab safety' },
        meta: {
          adoptsFrom: { module: `${testRealmURL}report`, name: 'Activity' },
        },
      },
    },
  };
}

// The tool's input as a caller writes it, which is the shape `execute` builds
// the input card from rather than the card type itself.
interface ToolInput {
  cardId: string;
  operation: string;
  payload?: Record<string, unknown>;
  realm?: string;
  relationships?: Record<string, unknown>;
}

interface SentRequest {
  realmURL: string;
  method: OperationsMethod;
  envelope: OperationsEnvelope;
}

// The realm this session would write to if nothing said otherwise. It is
// deliberately not the realm the fixtures live in: a create that fell back to
// the session default would be indistinguishable from one that took the target
// card's realm if the two were the same value, which is what makes an
// assertion about where a create was sent able to fail.
const SESSION_DEFAULT_REALM = 'http://test-realm/somewhere-else/';

// A transport that records instead of reaching the realm, for the cases about
// what a call puts on the wire, and about a refusal that has to happen before
// a request is sent at all.
function recordingTransport(): { sent: SentRequest[] } {
  let sent: SentRequest[] = [];
  let transport: OperationsTransport = {
    async send(realmURL, method, envelope): Promise<OperationsAnswer> {
      sent.push({ realmURL, method, envelope });
      return {
        'atomic:results': [
          { data: { type: 'card', id: `${testRealmURL}minted`, meta: {} } },
        ],
      };
    },
    defaultWritableRealm() {
      return SESSION_DEFAULT_REALM;
    },
  };
  (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT = transport;
  return { sent };
}

module('Integration | tools | invoke-card-operation', function (hooks) {
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
    await getService('realm').login(testRealmURL);
    // Looking the service up is what arms the bridge an operation reads its
    // transport back through, the same as the app's own boot does.
    getService('operations');
    hostTransport = (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT;
  });

  hooks.afterEach(function () {
    (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT = hostTransport;
  });

  function invoke(
    input: ToolInput,
  ): Promise<BaseToolModule.InvokeCardOperationResult> {
    let tool = new InvokeCardOperationTool(
      getService('tool-service').toolContext,
    );
    return tool.execute(input as any);
  }

  async function refusal(input: ToolInput): Promise<string> {
    try {
      await invoke(input);
    } catch (err: any) {
      return String(err.message);
    }
    throw new Error('expected the invocation to be refused, and it was not');
  }

  async function storedCard(localPath: string): Promise<any> {
    let file = await adapter.openFile(localPath);
    if (!file) {
      throw new Error(`${localPath} is not in the realm`);
    }
    return JSON.parse(file.content as string);
  }

  test('a declared transform writes the card and answers the lean result', async function (assert) {
    let result = await invoke({
      cardId: `${testRealmURL}report-commented`,
      operation: 'addComment',
      payload: { body: 'Reviewed and approved.' },
    });

    assert.strictEqual(
      result.cardId,
      `${testRealmURL}report-commented`,
      'the result names the card the operation wrote',
    );
    assert.ok(result.version, 'and the version that card now holds');
    assert.ok(result.lastModified > 0, 'and when it was written');

    let stored = await storedCard('report-commented.json');
    assert.deepEqual(
      stored.data.attributes.comments,
      [{ body: 'Reviewed and approved.' }],
      'the payload reached the card as the declaration describes',
    );
  });

  test('a declared read answers the document rather than a lean result', async function (assert) {
    let result = await invoke({
      cardId: `${testRealmURL}report-read`,
      operation: 'details',
    });

    let document = result.document as any;
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
    assert.notOk(result.cardId, 'a read names no card it wrote');
  });

  test('a class-scoped create mints a card in the realm it is given', async function (assert) {
    let result = await invoke({
      cardId: `${testRealmURL}report-created-from`,
      operation: 'create',
      payload: { headline: 'Minted' },
      realm: testRealmURL,
    });

    assert.ok(
      result.cardId.startsWith(testRealmURL),
      `the new card was minted in the realm it was given: ${result.cardId}`,
    );
    assert.notStrictEqual(
      result.cardId,
      `${testRealmURL}report-created-from`,
      'and it is a new card rather than the one that named its type',
    );

    let stored = await storedCard(
      `${result.cardId.slice(testRealmURL.length)}.json`,
    );
    assert.strictEqual(
      stored.data.attributes.headline,
      'Minted',
      'the field values the caller supplied reached the new card',
    );
    assert.strictEqual(
      stored.data.meta.adoptsFrom.name,
      'Report',
      'and its type came from the card the call named',
    );
  });

  test('a create is minted holding the links it was given', async function (assert) {
    let result = await invoke({
      cardId: `${testRealmURL}report-linked-from`,
      operation: 'create',
      payload: { headline: 'Linked' },
      relationships: {
        activity: { links: { self: `${testRealmURL}activity-lab-safety` } },
      },
      realm: testRealmURL,
    });

    let stored = await storedCard(
      `${result.cardId.slice(testRealmURL.length)}.json`,
    );
    // A stored link is written relative to the card holding it, so it is
    // resolved before being compared rather than matched as text.
    let link = stored.data.relationships?.activity?.links?.self;
    assert.strictEqual(
      link === undefined ? undefined : new URL(link, result.cardId).href,
      `${testRealmURL}activity-lab-safety`,
      'the new card holds the link the caller named, which it could not if links travelled as attributes',
    );
    assert.strictEqual(
      stored.data.attributes.headline,
      'Linked',
      'and its field values arrived beside them',
    );
    assert.strictEqual(
      stored.data.attributes.activity,
      undefined,
      'with nothing written under the link field as an attribute',
    );
  });

  test('relationships are refused for an operation that mints no card', async function (assert) {
    let { sent } = recordingTransport();

    let message = await refusal({
      cardId: `${testRealmURL}report-relationships-refused`,
      operation: 'addComment',
      payload: { body: 'Somewhere else' },
      relationships: {
        activity: { links: { self: `${testRealmURL}activity-lab-safety` } },
      },
    });

    assert.true(
      message.includes('no new card for "relationships" to describe'),
      `the refusal says why they have nowhere to go: ${message}`,
    );
    assert.strictEqual(sent.length, 0, 'and nothing was sent to the realm');
  });

  test('a declared delete answers with nothing left to describe', async function (assert) {
    let result = await invoke({
      cardId: `${testRealmURL}report-retired`,
      operation: 'retire',
    });

    assert.notOk(result.cardId, 'a delete names no card it wrote');
    assert.notOk(result.version, 'and no version it left behind');
    assert.notOk(result.document, 'and no document');
    assert.false(
      await adapter.exists('report-retired.json'),
      'and the card is gone from the realm',
    );
  });

  test('a behavior every card carries is not invoked here', async function (assert) {
    let { sent } = recordingTransport();

    let message = await refusal({
      cardId: `${testRealmURL}report-not-offered`,
      operation: 'update',
      payload: { attributes: { headline: 'Patched' } },
    });

    assert.true(
      message.includes('is a behavior every card carries'),
      `the refusal says what "update" is: ${message}`,
    );
    assert.true(
      message.includes('patch-fields'),
      `and where a card is changed instead: ${message}`,
    );
    assert.strictEqual(sent.length, 0, 'and nothing was sent to the realm');
  });

  test('a create is sent to the realm it was given', async function (assert) {
    let { sent } = recordingTransport();

    await invoke({
      cardId: `${testRealmURL}report-realm-forwarded`,
      operation: 'create',
      payload: { headline: 'Elsewhere' },
      realm: SESSION_DEFAULT_REALM,
    });

    assert.strictEqual(sent.length, 1, 'one batch was sent');
    assert.strictEqual(
      sent[0].realmURL,
      SESSION_DEFAULT_REALM,
      'to the realm the caller named rather than the one holding the card',
    );
  });

  test('a create with no realm is sent to the realm holding the card that named its type', async function (assert) {
    let { sent } = recordingTransport();

    await invoke({
      cardId: `${testRealmURL}report-realm-defaulted`,
      operation: 'create',
      payload: { headline: 'Beside It' },
    });

    assert.strictEqual(sent.length, 1, 'one batch was sent');
    assert.strictEqual(
      sent[0].realmURL,
      testRealmURL,
      'to the realm holding the target card, not to the realm this session writes to by default',
    );
  });

  test('an unknown operation is refused, naming the ones the card carries', async function (assert) {
    let message = await refusal({
      cardId: `${testRealmURL}report-unknown`,
      operation: 'escalate',
    });

    assert.true(
      message.includes('"escalate" is not an operation Report carries'),
      `the refusal names what was asked for: ${message}`,
    );
    for (let name of ['addComment', 'restate', 'details', 'retire', 'create']) {
      assert.true(
        message.includes(name),
        `the refusal offers "${name}": ${message}`,
      );
    }
    assert.false(
      message.includes('openReports'),
      'and does not offer a query, which answers a live set of results',
    );
    assert.false(
      message.includes('update'),
      'nor a behavior every card carries, which has its own tool',
    );
    assert.false(
      message.includes('atomic'),
      'nor the batch member, which is not an operation',
    );
  });

  test('a payload missing a declared param is refused before any request', async function (assert) {
    let { sent } = recordingTransport();

    let message = await refusal({
      cardId: `${testRealmURL}report-missing-param`,
      operation: 'addComment',
      payload: { note: 'not the declared name' },
    });

    assert.true(
      message.includes('requires a value for params("body")'),
      `the refusal names the param that has no value: ${message}`,
    );
    assert.strictEqual(sent.length, 0, 'and nothing was sent to the realm');
  });

  test('an input program supplies a param the caller left out', async function (assert) {
    let result = await invoke({
      cardId: `${testRealmURL}report-restated`,
      operation: 'restate',
    });

    assert.strictEqual(
      result.cardId,
      `${testRealmURL}report-restated`,
      'the invocation ran rather than being refused for the param it did not send',
    );
    let stored = await storedCard('report-restated.json');
    assert.strictEqual(
      stored.data.attributes.headline,
      'Restated by default',
      'and the value the input program produced is what the operation used',
    );
  });

  test('a query is refused, since it answers a live set of results', async function (assert) {
    let message = await refusal({
      cardId: `${testRealmURL}report-queried`,
      operation: 'openReports',
    });

    assert.true(
      message.includes('"openReports" is a query operation'),
      `the refusal says what the name is: ${message}`,
    );
    assert.true(
      message.includes('search-entries'),
      `and where results are read instead: ${message}`,
    );
  });

  test('an operation that acts on the card cannot be given a realm to run in', async function (assert) {
    let { sent } = recordingTransport();

    let message = await refusal({
      cardId: `${testRealmURL}report-realm-given`,
      operation: 'addComment',
      payload: { body: 'Somewhere else' },
      realm: testRealmURL,
    });

    assert.true(
      message.includes('runs in the realm that holds it'),
      `the refusal says where the operation runs: ${message}`,
    );
    assert.strictEqual(sent.length, 0, 'and nothing was sent to the realm');
  });

  test('a card that does not load is reported as the reason the operation did not run', async function (assert) {
    let missing = `${testRealmURL}report-nonexistent`;
    let message = await refusal({
      cardId: missing,
      operation: 'addComment',
      payload: { body: 'Nowhere' },
    });

    assert.true(
      message.includes(missing),
      `the refusal names the card that did not load: ${message}`,
    );
    // `assert.ok` rather than `assert.true`: the predicate answers with the
    // last truthy member it looked at rather than with a boolean.
    assert.ok(
      isCardErrorJSONAPI(await getService('store').get(missing)),
      'and the store is what reported it missing',
    );
  });
});
