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
    CardDef,
    FieldDef,
  } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, bxl } from "@cardstack/base/operations";

  export class ReportComment extends FieldDef {
    @field body = contains(StringField);
  }

  export class Report extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @field comments = containsMany(ReportComment);

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
  };
}

// The tool's input as a caller writes it, which is the shape `execute` builds
// the input card from rather than the card type itself.
interface ToolInput {
  cardId: string;
  operation: string;
  payload?: Record<string, unknown>;
  realm?: string;
}

interface SentRequest {
  realmURL: string;
  method: OperationsMethod;
  envelope: OperationsEnvelope;
}

// A transport that records instead of reaching the realm, for the cases about
// a refusal that has to happen before a request is sent at all.
function recordingTransport(): { sent: SentRequest[] } {
  let sent: SentRequest[] = [];
  let transport: OperationsTransport = {
    async send(realmURL, method, envelope): Promise<OperationsAnswer> {
      sent.push({ realmURL, method, envelope });
      return { 'atomic:results': [] };
    },
    defaultWritableRealm() {
      return testRealmURL;
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

  test('a read answers the document rather than a lean result', async function (assert) {
    let result = await invoke({
      cardId: `${testRealmURL}report-read`,
      operation: 'read',
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

  test('an unknown operation is refused, naming the ones the card carries', async function (assert) {
    let message = await refusal({
      cardId: `${testRealmURL}report-unknown`,
      operation: 'escalate',
    });

    assert.true(
      message.includes('"escalate" is not an operation Report carries'),
      `the refusal names what was asked for: ${message}`,
    );
    for (let name of ['addComment', 'restate', 'create', 'read', 'update']) {
      assert.true(
        message.includes(name),
        `the refusal offers "${name}": ${message}`,
      );
    }
    assert.false(
      message.includes('openReports'),
      'and does not offer a query, which this tool will not invoke',
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
    assert.true(
      isCardErrorJSONAPI(await getService('store').get(missing)),
      'and the store is what reported it missing',
    );
  });
});
