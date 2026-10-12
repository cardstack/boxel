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
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import {
  prerenderedHtmlRowFor,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';
import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// ============================================================================
// A render a user asks for resolves `actor()` to that user.
//
// One realm, which both readers may read. It holds a schedule type whose
// `listMine` is a named query comparing against `actor()`, one schedule for
// each reader, and a board whose isolated template runs `listMine` and draws
// each row it gets back at a height that says whose schedule it is.
//
// A capture a reader asks for renders on that reader's ordinary session, so
// the board draws their schedule alone. The realm's own render of the board
// runs on a realm-authority session, which has no actor, so it draws none.
// ============================================================================

// A path of this file's own: a prerender tab pooled by realm keeps the
// modules it loaded, so a realm that shared a URL with another suite's would
// render that suite's cards.
const REALM = 'http://127.0.0.1:4444/capture-actor/';

const OWNER = '@owner:localhost';
const REQUESTER = '@requester:localhost';
const OTHER_READER = '@other-reader:localhost';

const BOARD_CARD = `${REALM}boards/board`;

// Each reader's row draws at its own height, so a capture's height names the
// row that drew it.
const REQUESTER_ROW_HEIGHT = 200;
const OTHER_ROW_HEIGHT = 400;

const SCHEDULE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, actor } from "@cardstack/base/operations";

  export class ServicePlanSchedule extends CardDef {
    @field title = contains(StringField);
    @field providerId = contains(StringField);

    @operation static listMine = {
      base: 'query',
      query: {
        filter: { on: () => ServicePlanSchedule, eq: { providerId: actor() } },
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
        return operations(ServicePlanSchedule).listMine.query(undefined, {
          realms: ["${REALM}"],
        });
      }

      rowClass = (id: string) =>
        id.endsWith("/requester") ? "board-row requester-row" : "board-row other-row";

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
          .board-search {
            margin: 0;
            padding: 0;
          }
          .board-row {
            display: block;
            box-sizing: border-box;
            margin: 0;
            overflow: hidden;
          }
          .requester-row {
            height: ${REQUESTER_ROW_HEIGHT}px;
          }
          .other-row {
            height: ${OTHER_ROW_HEIGHT}px;
          }
        </style>
      </template>
    };
  }
`;

function schedule(title: string, providerId: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, providerId },
      meta: {
        adoptsFrom: {
          module: rri(`${REALM}schedule`),
          name: 'ServicePlanSchedule',
        },
      },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm | undefined;
  let request: SuperTest<Test>;
  let server: Server | undefined;
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
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(REALM),
          fileSystem: {
            'schedule.gts': SCHEDULE_MODULE,
            'board.gts': BOARD_MODULE,
            'boards/board.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: { revision: 1 },
                meta: {
                  adoptsFrom: { module: rri(`${REALM}board`), name: 'Board' },
                },
              },
            }),
            'schedules/requester.json': schedule("The requester's", REQUESTER),
            'schedules/other.json': schedule(
              "The other reader's",
              OTHER_READER,
            ),
          },
          permissions: {
            [OWNER]: ['read', 'write', 'realm-owner'],
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
    realm = result.realms[0];
  }

  // Booting indexes the realm and renders the board's HTML, which runs inside
  // the first test's budget, and each capture is a render of its own.
  hooks.before(function (assert) {
    assert.timeout(300_000);
  });
  hooks.beforeEach(function (assert) {
    assert.timeout(300_000);
  });

  setupDB(hooks, {
    before: async (dbAdapter, publisher, runner) => {
      // The host checks that a search goes to the realm server it was
      // configured with, and this realm is served from a test origin. It is
      // patched on each page the render server hands out, so it has to be in
      // place before the realm first indexes.
      pagePatch = installRealmServerAssertOwnRealmServerBypassPatch();
      await start({ dbAdapter, publisher, runner });
      await settlePrerenderHtmlJobs(db, REALM, { timeout: 120_000 });
    },
    after: async () => {
      // Guarded, so a boot that failed partway still closes what it opened.
      realm?.unsubscribe();
      if (server) {
        await closeServer(server);
      }
      await pagePatch?.restore();
    },
  });

  function postCapture(user: string) {
    return request
      .post('/_capture')
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
          type: 'capture',
          attributes: {
            realmURL: REALM,
            cardId: BOARD_CARD,
            format: 'isolated',
            includeBase64: false,
            // Shorter than any row, so a full-page capture's height is the
            // rows the board drew.
            captureSpec: {
              viewport: { width: 400, height: 1 },
              fullPage: true,
            },
          },
        },
      });
  }

  test('a capture a reader asks for draws the rows whose actor is them', async function (assert) {
    for (let [who, user, height] of [
      ['the requester', REQUESTER, REQUESTER_ROW_HEIGHT],
      ['the other reader', OTHER_READER, OTHER_ROW_HEIGHT],
    ] as const) {
      let response = await postCapture(user);
      assert.strictEqual(
        response.status,
        201,
        `${who}'s capture: ${JSON.stringify(response.body)}`,
      );
      let attributes = response.body.data.attributes;
      assert.strictEqual(
        attributes.status,
        'ready',
        `${who}'s capture rendered: ${attributes.error}`,
      );
      assert.strictEqual(
        attributes.captures[0].height,
        height,
        `${who}'s capture drew their own schedule and no one else's`,
      );
    }
  });

  test("the realm's own render of the card draws no one's rows", async function (assert) {
    let row = await prerenderedHtmlRowFor(db, `${BOARD_CARD}.json`);
    let errorDoc = row?.error_doc ?? null;
    assert.strictEqual(
      errorDoc,
      null,
      `the board rendered cleanly: ${JSON.stringify(errorDoc)}`,
    );
    let html = row?.isolated_html ?? '';
    assert.true(
      html.includes('board-search'),
      `the render drew the board: ${html}`,
    );
    assert.notOk(
      html.includes('board-no-search-component'),
      `the render had a search component to run the query with: ${html}`,
    );
    assert.notOk(
      html.includes('board-row'),
      `the realm's render, which has no actor, drew no schedule: ${html}`,
    );
  });
});
