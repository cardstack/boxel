import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import {
  prerenderedHtmlRowFor,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';
import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// ============================================================================
// A capture a reader asks for renders with that reader's authority.
//
// A realm renders its own cards under its own authority, which no policy
// scopes. A capture is different: a reader asks for it, so it draws what that
// reader may see — the realms their ACL lets them read, and the rows a
// realm's policy grants them — and it is served back to them alone.
//
// Five realms on one server:
//
// - Lib: public. Holds the schedule type, whose `listOpen` is a named query,
//   and the board type, whose isolated template runs `listOpen` over Board,
//   Grants and Private and draws each row it gets back as a block whose
//   height says which realm it came from.
// - Grants: neither reader may read it. Its policy admits anyone to their own
//   schedules through `listOpen`, and it holds one for the requester.
// - Private: the requester may read it; the board's owner and the other
//   reader may not. It holds one open schedule.
// - Board: owned by the board's owner. Both readers may read it. Holds the
//   board and one open schedule of its own, and lets a reader capture on
//   demand.
//
// So the requester sees three rows through the board and the other reader
// sees one. A capture's height is the board's own chrome plus its rows, so
// the difference between the two readers' captures of one spec is exactly
// the rows the requester sees and the other does not.
// ============================================================================

// Paths of this file's own: a prerender tab pooled by realm keeps the modules
// it loaded, so realms that share a URL with another suite's would render
// that suite's cards.
const LIB = 'http://127.0.0.1:4444/capture-lib/';
const BOARD = 'http://127.0.0.1:4444/capture-board/';
const GRANTS = 'http://127.0.0.1:4444/capture-grants/';
const PRIVATE = 'http://127.0.0.1:4444/capture-private/';

const OWNER = '@owner:localhost';
const BOARD_OWNER = '@board-owner:localhost';
const REQUESTER = '@requester:localhost';
const OTHER_READER = '@other-reader:localhost';

const BOARD_CARD = `${BOARD}boards/board`;
const BOARD_SCHEDULE = `${BOARD}schedules/open`;

// Each realm's rows draw at their own height, so a sum of heights names the
// rows that drew it.
const BOARD_ROW_HEIGHT = 100;
const GRANTED_ROW_HEIGHT = 200;
const PRIVATE_ROW_HEIGHT = 400;

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const SCHEDULE = { module: `${LIB}schedule`, name: 'ServicePlanSchedule' };

const SCHEDULE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";

  export class ServicePlanSchedule extends CardDef {
    @field title = contains(StringField);
    @field providerId = contains(StringField);
    @field status = contains(StringField);

    @operation static listOpen = {
      base: 'query',
      query: {
        filter: { on: () => ServicePlanSchedule, eq: { status: 'open' } },
      },
    };
  }
`;

const BOARD_MODULE = `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import NumberField from "@cardstack/base/number";
  import { operations } from "@cardstack/base/operations";
  import { ServicePlanSchedule } from "./schedule";

  export class Board extends CardDef {
    @field revision = contains(NumberField);

    static isolated = class extends Component<typeof this> {
      get query() {
        return operations(ServicePlanSchedule).listOpen.query(undefined, {
          realms: ["${BOARD}", "${GRANTS}", "${PRIVATE}"],
        });
      }

      rowClass = (id: string) =>
        id.startsWith("${GRANTS}")
          ? "board-row granted-row"
          : id.startsWith("${PRIVATE}")
            ? "board-row private-row"
            : "board-row";

      <template>
        <div class="board-search">
          {{#if @context.searchResultsComponent}}
            <@context.searchResultsComponent @query={{this.query}} @mode="none" as |results|>
              {{#each results.entries as |entry|}}
                <div class={{this.rowClass entry.id}}>{{entry.id}}</div>
              {{/each}}
            </@context.searchResultsComponent>
          {{else}}
            <span class="board-no-search-component">missing</span>
          {{/if}}
        </div>
        <style scoped>
          .board-row {
            display: block;
            box-sizing: border-box;
            margin: 0;
            overflow: hidden;
            height: ${BOARD_ROW_HEIGHT}px;
          }
          .granted-row {
            height: ${GRANTED_ROW_HEIGHT}px;
          }
          .private-row {
            height: ${PRIVATE_ROW_HEIGHT}px;
          }
        </style>
      </template>
    };
  }
`;

function policyCard() {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [
          {
            targetType: SCHEDULE,
            grants: [
              { operation: 'listOpen', where: '.providerId == actor()' },
            ],
          },
        ],
      },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function schedule(title: string, providerId: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, providerId, status: 'open' },
      meta: {
        adoptsFrom: { module: rri(SCHEDULE.module), name: SCHEDULE.name },
      },
    },
  });
}

function board() {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { revision: 1 },
      meta: { adoptsFrom: { module: rri(`${LIB}board`), name: 'Board' } },
    },
  });
}

// A PNG's height, from its header.
function pngHeight(bytes: Buffer): number {
  return bytes.readUInt32BE(20);
}

module(basename(import.meta.filename), function (hooks) {
  let realms: Record<string, Realm> = {};
  let request: SuperTest<Test>;
  let server: Server;
  let db: PgAdapter;
  let pagePatch: { restore: () => Promise<void> } | undefined;

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    db = dbAdapter;
    let owner: RealmPermissions = {
      [OWNER]: ['read', 'write', 'realm-owner'],
    };
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(LIB),
          fileSystem: {
            'schedule.gts': SCHEDULE_MODULE,
            'board.gts': BOARD_MODULE,
          },
          permissions: { ...owner, '*': ['read'] },
        },
        {
          realmURL: new URL(GRANTS),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Grants',
              policy: `${GRANTS}policies/policy`,
            }),
            'policies/policy.json': policyCard(),
            'schedules/requester-open.json': schedule(
              "The requester's",
              REQUESTER,
            ),
          },
          permissions: { ...owner },
        },
        {
          realmURL: new URL(PRIVATE),
          fileSystem: {
            'schedules/open.json': schedule('Private open', OWNER),
          },
          permissions: { ...owner, [REQUESTER]: ['read'] },
        },
        {
          realmURL: new URL(BOARD),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Board',
              allowArbitraryScreenshots: true,
            }),
            'boards/board.json': board(),
            'schedules/open.json': schedule('Board open', OWNER),
          },
          permissions: {
            [BOARD_OWNER]: ['read', 'write', 'realm-owner'],
            [REQUESTER]: ['read'],
            [OTHER_READER]: ['read'],
          },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
      mediaCacheAdapter: new FakeMediaCacheAdapter(),
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    for (let realm of result.realms) {
      realms[realm.url] = realm;
    }
  }

  setupCatalogTestSubset(hooks);

  // Booting indexes four realms and renders the board's HTML, which runs
  // inside the first test's budget, and each capture is a render of its own.
  hooks.before(function (assert) {
    assert.timeout(300_000);
  });
  hooks.beforeEach(function (assert) {
    assert.timeout(300_000);
  });

  setupDB(hooks, {
    before: async (dbAdapter, publisher, runner) => {
      // The host checks that a search goes to the realm server it was
      // configured with, and these realms are served from a test origin. It
      // is patched on each page the render server hands out, so it has to be
      // in place before the realms first index.
      pagePatch = installRealmServerAssertOwnRealmServerBypassPatch();
      await start({ dbAdapter, publisher, runner });
      await settlePrerenderHtmlJobs(db, BOARD, { timeout: 120_000 });
    },
    after: async () => {
      // Guarded, so a boot that failed partway still closes what it opened.
      for (let realm of Object.values(realms)) {
        realm?.unsubscribe();
      }
      if (server) {
        await closeServer(server);
      }
      await pagePatch?.restore();
      resetCatalogRealms();
    },
  });

  function postCapture(user: string, captureSpec: Record<string, unknown>) {
    return request
      .post('/_screenshot-card')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/vnd.api+json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user, sessionRoom: `session-room-${user}` },
          realmSecretSeed,
        )}`,
      )
      .send({
        data: {
          type: 'screenshot-card',
          attributes: {
            realmURL: BOARD,
            cardId: BOARD_CARD,
            format: 'isolated',
            includeBase64: false,
            captureSpec,
          },
        },
      });
  }

  // A reader's GET of a capture URL on the board's realm, with their own
  // session there.
  function getCapture(user: string, url: string) {
    let { pathname, search } = new URL(url);
    return request
      .get(`${pathname}${search}`)
      .set(
        'Authorization',
        `Bearer ${createJWT(realms[BOARD], user, ['read'])}`,
      );
  }

  test('a capture its requester POSTs draws what they may see, and serves back to them alone', async function (assert) {
    let captureSpec = { viewport: { width: 400, height: 100 }, fullPage: true };

    let requesters = await postCapture(REQUESTER, captureSpec);
    assert.strictEqual(
      requesters.status,
      201,
      `the requester's capture: ${JSON.stringify(requesters.body)}`,
    );
    let others = await postCapture(OTHER_READER, captureSpec);
    assert.strictEqual(
      others.status,
      201,
      `the other reader's capture: ${JSON.stringify(others.body)}`,
    );

    assert.strictEqual(
      requesters.body.data.attributes.status,
      'ready',
      `the requester's capture rendered: ${requesters.body.data.attributes.error}`,
    );
    assert.strictEqual(
      others.body.data.attributes.status,
      'ready',
      `the other reader's capture rendered: ${others.body.data.attributes.error}`,
    );
    let requesterCapture = requesters.body.data.attributes.captures[0];
    let otherCapture = others.body.data.attributes.captures[0];
    assert.strictEqual(
      requesterCapture.height - otherCapture.height,
      GRANTED_ROW_HEIGHT + PRIVATE_ROW_HEIGHT,
      `the requester's capture drew the row their grant admits them to in Grants and the row they may read in Private, which the other reader's did not (${requesterCapture.height}px against ${otherCapture.height}px)`,
    );
    assert.strictEqual(
      requesterCapture.url,
      otherCapture.url,
      'both captures answer to the one URL their spec names',
    );

    let served = await getCapture(REQUESTER, requesterCapture.url);
    assert.strictEqual(served.status, 200, 'the requester is served it');
    assert.strictEqual(
      pngHeight(served.body as Buffer),
      requesterCapture.height,
      'the capture drawn as them',
    );
    assert.true(
      served.headers['cache-control']?.startsWith('private,'),
      `and no shared cache may hold it: ${served.headers['cache-control']}`,
    );

    let servedToOther = await getCapture(OTHER_READER, otherCapture.url);
    assert.strictEqual(servedToOther.status, 200, 'the other reader is too');
    assert.strictEqual(
      pngHeight(servedToOther.body as Buffer),
      otherCapture.height,
      'the capture drawn as them, never the requester’s',
    );
  });

  test('a capture a reader asks for on the GET route renders as them', async function (assert) {
    let url = `${BOARD}_screenshot/boards/board?viewport=400x120&fullPage=true`;

    let requesters = await getCapture(REQUESTER, url);
    assert.strictEqual(
      requesters.status,
      200,
      `the requester's capture: ${requesters.text}`,
    );
    let others = await getCapture(OTHER_READER, url);
    assert.strictEqual(
      others.status,
      200,
      `the other reader's capture: ${others.text}`,
    );

    let requesterHeight = pngHeight(requesters.body as Buffer);
    let otherHeight = pngHeight(others.body as Buffer);
    assert.strictEqual(
      requesterHeight - otherHeight,
      GRANTED_ROW_HEIGHT + PRIVATE_ROW_HEIGHT,
      `the requester's capture drew the row their grant admits them to in Grants and the row they may read in Private, which the other reader's did not (${requesterHeight}px against ${otherHeight}px)`,
    );

    let again = await getCapture(REQUESTER, url);
    assert.strictEqual(
      pngHeight(again.body as Buffer),
      requesterHeight,
      'the requester is served their own capture again, not the last one drawn',
    );
  });

  test("the realm's own render of the card draws neither reader's rows", async function (assert) {
    let row = await prerenderedHtmlRowFor(db, `${BOARD_CARD}.json`);
    let errorDoc = row?.error_doc ?? null;
    assert.strictEqual(
      errorDoc,
      null,
      `the board rendered cleanly: ${JSON.stringify(errorDoc)}`,
    );
    let html = row?.isolated_html ?? '';
    assert.notOk(
      html.includes('board-no-search-component'),
      `the render had a search component to run the query with: ${html}`,
    );
    let drawn = [...html.matchAll(/class="board-row[^"]*"[^>]*>([^<]*)</g)]
      .map(([, id]) => id.trim())
      .sort();
    assert.deepEqual(
      drawn,
      [BOARD_SCHEDULE],
      `the realm's render drew its own schedule, and neither the grant nor the private realm's row: ${html}`,
    );
  });
});
