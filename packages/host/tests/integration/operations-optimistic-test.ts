import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';
import type * as OperationsModule from '@cardstack/base/operations';

// ============================================================================
// Carrying an operation out locally before the realm answers.
//
// The realm under test is the in-browser one, so a call here is answered by
// the operation core rather than by a double: the program the ledger runs
// locally and the program the realm runs are the same lowered BXL, and what
// the realm is left holding afterwards is what the assertions read.
//
// What this suite is for is the *seam* — that eligibility is decided the way
// it is meant to be, that an eligible call leaves the card and the realm
// agreeing, and that an ineligible one behaves exactly as it did before this
// path existed. The ordering and reconciliation rules themselves are races,
// and they are stated as assertions rather than provoked in
// `tests/unit/operation-ledger-test.ts`.
//
// No declaration here reads the actor: a request from an integration test
// reaches the in-browser realm unauthenticated (the harness's `verifyJWT`
// treats an unexpired token as expired), and an operation that reads the actor
// is refused outright on such a request.
// ============================================================================

let loader: Loader;
let operations: (typeof OperationsModule)['operations'];

const REPORT_MODULE = `
  import {
    contains,
    containsMany,
    field,
    CardDef,
    Component,
    FieldDef,
  } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import { operation, params, bxl } from "@cardstack/base/operations";

  export class ReportComment extends FieldDef {
    @field body = contains(StringField);
  }

  export class Report extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @field comments = containsMany(ReportComment);
    @field tally = contains(NumberField);
    // A computed value. The realm answers a program reading one from its index
    // overlay; nothing in the browser can, which is what makes an operation
    // reading it ineligible rather than wrong.
    @field shouted = contains(StringField, {
      computeVia: function (this: Report) {
        return (this.headline ?? '').toUpperCase();
      },
    });

    @operation static addComment = {
      base: 'transform',
      params: { body: StringField },
      append: { to: 'comments', value: { body: params('body') } },
    };

    @operation static escalate = {
      base: 'transform',
      set: { status: 'escalated' },
    };

    // Eligible on every other count, and refused because the author said so.
    @operation static quietly = {
      base: 'transform',
      optimistic: false,
      set: { status: 'quiet' },
    };

    // Reads a value the realm computes, which no local run can supply.
    @operation static echoComputed = {
      base: 'transform',
      transformations: bxl\`.status = .shouted;\`,
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
      attributes: { headline, status: 'open', comments: [], tally: 0 },
      meta: { adoptsFrom: reportRef() },
    },
  };
}

// One report per test that writes to one, so no test reads another's
// leftovers.
function realmContents() {
  return {
    'report.gts': REPORT_MODULE,
    'report-applies.json': reportFile('Applies'),
    'report-chains.json': reportFile('Chains'),
    'report-opted-out.json': reportFile('Opted Out'),
    'report-computed.json': reportFile('Computed'),
    'report-agrees.json': reportFile('Agrees'),
  };
}

module('Integration | operations optimistic', function (hooks) {
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

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: realmContents(),
    });
    loader = getService('loader-service').loader;
    ({ operations } = await loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    ));
    await getService('realm').login(testRealmURL);
    // Looking the service up arms the bridge a card reads the transport back
    // through, the same as the app's own boot does.
    getService('operations');
  });

  // A card the tab is holding, as against one it merely read once. Holding a
  // reference is what subscribes the store to the card's realm and keeps the
  // instance from being collected — and the ledger only ever works on a card
  // the store is holding.
  async function cardAt(localPath: string): Promise<CardDefType> {
    let url = `${testRealmURL}${localPath}`;
    let store = getService('store');
    store.addReference(url);
    let instance = await store.get<CardDefType>(url);
    if (!instance || !('id' in instance)) {
      throw new Error(`${localPath} did not load: ${JSON.stringify(instance)}`);
    }
    return instance as CardDefType;
  }

  // Which cards the store went back to the realm for, which is how a re-read
  // is told from a retirement.
  function recordReads() {
    let cardService = getService('card-service');
    let reads: string[] = [];
    let originalFetchJSON = cardService.fetchJSON.bind(cardService);
    cardService.fetchJSON = async (url: any, args: any) => {
      if (!args?.method || args.method === 'GET') {
        reads.push(String(url));
      }
      return await originalFetchJSON(url, args);
    };
    return {
      reads,
      restore: () => {
        delete (cardService as any).fetchJSON;
      },
    };
  }

  // What the realm has on disk for a card, read straight from the adapter
  // rather than through the store, so an assertion about the realm is not
  // answered by the very state under test.
  async function storedAttributes(localPath: string): Promise<any> {
    let doc = (await getService('card-service').fetchJSON(
      `${testRealmURL}${localPath}`,
    )) as any;
    return doc.data.attributes;
  }

  test('an eligible transform leaves the card and the realm agreeing', async function (assert) {
    let report = await cardAt('report-applies');

    // "The card has one comment" is satisfied by an index event re-reading it
    // just as well as by a local application, so on its own it would pass
    // whether or not anything here ran. Pairing it with "the card was never
    // re-read" is what makes it a statement about this code: between them,
    // local application is the only thing that could have put the comment
    // there.
    let recorder = recordReads();
    let result: any;
    try {
      result = await (operations(report) as any).addComment({
        body: 'First comment.',
      });
      assert.deepEqual(
        recorder.reads.filter((url) => url.includes('report-applies')),
        [],
        'the card was never re-read, so nothing here came back from the realm',
      );
    } finally {
      recorder.restore();
    }

    assert.strictEqual(
      (report as any).comments[0].body,
      'First comment.',
      'with the payload the call supplied',
    );
    let stored = await storedAttributes('report-applies');
    assert.strictEqual(
      stored.comments.length,
      1,
      'and the realm stored exactly one comment, not two',
    );
    assert.strictEqual(
      stored.comments[0].body,
      'First comment.',
      'the same one — the local run and the realm ran the same program',
    );
    assert.ok(result.version, 'the write reported the version it produced');
  });

  test('consecutive operations chain their versions and never re-read', async function (assert) {
    // The card+json GET reports the version of the bytes its document was
    // built from, so a card this tab has only read already carries a base.
    // Every operation therefore names one — the first from the read, each
    // later one from what its predecessor's write returned — and a confirmed
    // base means local state already equals the authoritative result, so
    // nothing is re-read at any point.
    let report = await cardAt('report-chains');
    let recorder = recordReads();
    try {
      await (operations(report) as any).addComment({ body: 'One.' });
      await (operations(report) as any).addComment({ body: 'Two.' });

      assert.deepEqual(
        recorder.reads.filter((url) => url.includes('report-chains')),
        [],
        'neither operation re-read the card, because the realm confirmed both bases',
      );
    } finally {
      recorder.restore();
    }

    assert.strictEqual(
      (report as any).comments.length,
      2,
      'the card carries both comments',
    );
    assert.deepEqual(
      (report as any).comments.map((c: any) => c.body),
      ['One.', 'Two.'],
      'in the order they were asked for',
    );
    let stored = await storedAttributes('report-chains');
    assert.deepEqual(
      stored.comments.map((c: any) => c.body),
      ['One.', 'Two.'],
      'and the realm holds exactly the same two — neither applied twice nor lost',
    );
  });

  test('an operation the author opted out of is sent and awaited', async function (assert) {
    let report = await cardAt('report-opted-out');

    await (operations(report) as any).quietly();

    assert.strictEqual(
      (report as any).status,
      'open',
      'the local card is untouched by the call itself, since nothing was applied here',
    );
    let stored = await storedAttributes('report-opted-out');
    assert.strictEqual(
      stored.status,
      'quiet',
      'and the write still lands, exactly as it did before this path existed',
    );
  });

  test('an operation reading a computed value falls back rather than guessing', async function (assert) {
    // The realm answers `.shouted` from its index overlay. Nothing in the
    // browser can, so the program refuses locally — and the operation is sent
    // and awaited instead of being applied with a value this client invented.
    let report = await cardAt('report-computed');

    await (operations(report) as any).echoComputed();

    let stored = await storedAttributes('report-computed');
    assert.strictEqual(
      stored.status,
      'COMPUTED',
      'the realm applied the program against the value only it can supply',
    );
    // The local card's status is whatever it held or whatever a re-read
    // brought — what it must never be is the `null` a local run would have
    // produced by reading a computed field the browser cannot answer for.
    // Asserted as "not null" rather than as a value, because which of the two
    // it is depends on an index event this test does not wait for.
    assert.notStrictEqual(
      (report as any).status,
      null,
      'and the card never took the null a local run would have computed',
    );
  });

  test('a declarative set applies locally and matches what the realm stores', async function (assert) {
    let report = await cardAt('report-agrees');

    await (operations(report) as any).escalate();

    assert.strictEqual(
      (report as any).status,
      'escalated',
      'the local card carries the new status',
    );
    let stored = await storedAttributes('report-agrees');
    assert.strictEqual(stored.status, 'escalated', 'and so does the realm');
    assert.strictEqual(
      stored.headline,
      'Agrees',
      'with nothing else disturbed',
    );
  });
});
