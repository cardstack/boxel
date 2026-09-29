import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  DURING_PRERENDER_HEADER,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
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
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import {
  maxPrerenderHtmlJobId,
  prerenderedHtmlRowFor,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// ============================================================================
// A search fired inside a render is never scoped by a policy.
//
// A realm renders its own cards once, under its own authority, and serves the
// HTML to every viewer. The render authenticates as a realm-authority
// session, which reads what the realm ACL grants it and nothing more, so no
// policy is asked what it grants the render — however the policy is written,
// and whoever later views the HTML.
//
// Three realms on one server:
//
// - Lib: public. Holds the schedule type, whose `listOpen` is a named query,
//   and the board type, whose isolated template runs `listOpen` over Board
//   and Grants and draws the id of every row it gets back.
// - Grants: the board's owner may not read it. Its policy admits anyone to
//   their own schedules through `listOpen`, and it holds one for the board's
//   owner and one for a viewer.
// - Board: owned by the board's owner, the identity the realm renders as.
//   Holds the board and one open schedule of its own.
//
// A render whose search composed the policy for the identity it reads as
// would be answered with the owner's schedule from Grants. Grants is indexed
// before Board, so the board's first render already searches a Grants that
// could answer it.
//
// A render that fails leaves the realm's last good HTML in place, so every
// render read here is checked to be the one just made, and made cleanly:
// otherwise a render the policy broke would read as the earlier render that
// it failed to replace.
// ============================================================================

const LIB = 'http://127.0.0.1:4444/lib/';
const BOARD = 'http://127.0.0.1:4444/board/';
const GRANTS = 'http://127.0.0.1:4444/grants/';

const OWNER = '@owner:localhost';
const BOARD_OWNER = '@board-owner:localhost';
const VIEWER = '@viewer:localhost';

const BOARD_CARD = `${BOARD}boards/board`;
const BOARD_SCHEDULE = `${BOARD}schedules/open`;
const OWNERS_GRANTED_SCHEDULE = `${GRANTS}schedules/board-owner-open`;
const VIEWERS_GRANTED_SCHEDULE = `${GRANTS}schedules/viewer-open`;

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const SCHEDULE = { module: `${LIB}schedule`, name: 'ServicePlanSchedule' };

// `listOpen` does not compare against the caller, so a render resolves it and
// sends it: whatever narrows its rows is the realm's doing.
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

// Draws the id of every row its search answers with, so the HTML says
// exactly which rows the render saw. `revision` is never drawn: bumping it
// re-renders the board without changing anything the render draws.
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
          realms: ["${BOARD}", "${GRANTS}"],
        });
      }

      <template>
        <div class="board-search">
          {{#if @context.searchResultsComponent}}
            <@context.searchResultsComponent @query={{this.query}} @mode="none" as |results|>
              {{#each results.entries as |entry|}}
                <span class="board-row">{{entry.id}}</span>
              {{/each}}
            </@context.searchResultsComponent>
          {{else}}
            <span class="board-no-search-component">missing</span>
          {{/if}}
        </div>
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

function board(revision: number) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { revision },
      meta: { adoptsFrom: { module: rri(`${LIB}board`), name: 'Board' } },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let realms: Record<string, Realm> = {};
  let request: SuperTest<Test>;
  let server: Server;
  let db: PgAdapter;
  let pagePatch: { restore: () => Promise<void> } | undefined;

  const BOARD_OWNER_PERMISSIONS: RealmPermissions = {
    [BOARD_OWNER]: ['read', 'write', 'realm-owner'],
  };

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
            'schedules/board-owner-open.json': schedule(
              "The board owner's",
              BOARD_OWNER,
            ),
            'schedules/viewer-open.json': schedule("The viewer's", VIEWER),
          },
          permissions: { ...owner },
        },
        {
          realmURL: new URL(BOARD),
          fileSystem: {
            'boards/board.json': board(1),
            'schedules/open.json': schedule('Board open', OWNER),
          },
          permissions: BOARD_OWNER_PERMISSIONS,
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    for (let realm of result.realms) {
      realms[realm.url] = realm;
    }
  }

  setupCatalogTestSubset(hooks);

  // Booting indexes three realms and renders the board's HTML, which runs
  // inside the first test's budget.
  hooks.before(function (assert) {
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

  // The session a realm renders its own cards under, for one realm.
  function realmAuthoritySession(realmURL: string, permissions: string[]) {
    let sessions = JSON.parse(
      testCreatePrerenderAuth(
        BOARD_OWNER,
        { [realmURL]: permissions } as RealmPermissions,
        { realmAuthority: true },
      ),
    ) as Record<string, string>;
    return sessions[realmURL];
  }

  function userSession(user: string) {
    return createRealmServerJWT(
      { user, sessionRoom: `session-room-${user}` },
      realmSecretSeed,
    );
  }

  const LIST_OPEN = {
    operation: 'listOpen',
    on: SCHEDULE,
    realms: [BOARD, GRANTS],
  };

  function federatedSearch(token: string, opts?: { duringRender?: true }) {
    let req = request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Authorization', `Bearer ${token}`);
    if (opts?.duringRender) {
      req = req.set(DURING_PRERENDER_HEADER, '1');
    }
    return req.send(LIST_OPEN);
  }

  function ids(response: { body: { data: { id: string }[] } }): string[] {
    return response.body.data.map((entry) => entry.id).sort();
  }

  // The board's latest render: the HTML it drew, and the rows its search
  // answered with. A render that failed is a failure here, since the HTML it
  // leaves behind is an earlier render's.
  async function boardRender(assert: Assert) {
    let row = await prerenderedHtmlRowFor(db, `${BOARD_CARD}.json`);
    assert.strictEqual(
      row?.error_doc ?? null,
      null,
      `the board rendered cleanly: ${JSON.stringify(row?.error_doc)}`,
    );
    let html = row?.isolated_html ?? '';
    assert.notOk(
      html.includes('board-no-search-component'),
      `the render had a search component to run the query with: ${html}`,
    );
    let drawn = [...html.matchAll(/class="board-row"[^>]*>([^<]*)</g)].map(
      ([, id]) => id.trim(),
    );
    return { html, drawn: drawn.sort(), generation: row?.generation ?? -1 };
  }

  // Renders the board again, and answers that render.
  async function rerenderBoard(assert: Assert, revision: number) {
    let before = await prerenderedHtmlRowFor(db, `${BOARD_CARD}.json`);
    let baseline = await maxPrerenderHtmlJobId(db, BOARD);
    await realms[BOARD].write('boards/board.json', board(revision));
    await settlePrerenderHtmlJobs(db, BOARD, {
      afterJobId: baseline,
      timeout: 120_000,
    });
    let render = await boardRender(assert);
    assert.true(
      render.generation > (before?.generation ?? -1),
      `the HTML is the render just made (generation ${render.generation}, before ${before?.generation})`,
    );
    return render;
  }

  test('a search fired inside a render composes no policy fragment, whatever the policy grants', async function (assert) {
    let first = await boardRender(assert);
    assert.deepEqual(
      first.drawn,
      [BOARD_SCHEDULE],
      `the realm's first render drew its own schedule and nothing Grants holds: ${first.html}`,
    );

    let again = await rerenderBoard(assert, 2);
    assert.deepEqual(
      again.drawn,
      [BOARD_SCHEDULE],
      `and so did the render its next write asked for: ${again.html}`,
    );
  });

  test('the identity a render reads as is admitted by the policy when it searches as itself', async function (assert) {
    let response = await federatedSearch(userSession(BOARD_OWNER));

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.deepEqual(
      ids(response),
      [BOARD_SCHEDULE, OWNERS_GRANTED_SCHEDULE],
      "the board owner's own session is composed with the grant, so the render's missing row is the render's principal at work, not a grant that admits nothing",
    );

    let viewer = await federatedSearch(userSession(VIEWER));
    assert.deepEqual(
      ids(viewer),
      [VIEWERS_GRANTED_SCHEDULE],
      'and a viewer is admitted to their own row, which the render does not draw either',
    );
  });

  test('a realm-authority session is judged by the realm ACL alone, and the render marker decides nothing', async function (assert) {
    let session = realmAuthoritySession(BOARD, [
      'read',
      'write',
      'realm-owner',
    ]);

    let bare = await federatedSearch(session);
    assert.strictEqual(bare.status, 200, 'HTTP 200 status');
    assert.deepEqual(
      ids(bare),
      [BOARD_SCHEDULE],
      'without the render marker, a realm-authority session still reads Grants as a realm it cannot read',
    );

    let marked = await federatedSearch(session, { duringRender: true });
    assert.deepEqual(ids(marked), [BOARD_SCHEDULE], 'and with it, the same');

    let userMarked = await federatedSearch(userSession(BOARD_OWNER), {
      duringRender: true,
    });
    assert.deepEqual(
      ids(userMarked),
      [BOARD_SCHEDULE, OWNERS_GRANTED_SCHEDULE],
      "a user's search carrying the render marker is still that user's, and the grant admits them",
    );
  });

  test("a realm's own search answers a realm-authority session it declines with no rows", async function (assert) {
    let search = (token: string) =>
      request
        .post(`${new URL(GRANTS).pathname}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...LIST_OPEN, realms: [GRANTS] });

    let asAuthority = await search(realmAuthoritySession(GRANTS, []));
    assert.strictEqual(asAuthority.status, 200, 'HTTP 200 status');
    assert.deepEqual(
      ids(asAuthority),
      [],
      'the ACL declines the session and no policy is asked about it',
    );

    let asUser = await search(createJWT(realms[GRANTS], BOARD_OWNER));
    assert.deepEqual(
      ids(asUser),
      [OWNERS_GRANTED_SCHEDULE],
      'while the same identity as a user is admitted by the grant',
    );
  });

  // Last, since it takes the policy away.
  test('a render is byte-identical whether or not the realm it searches has a policy', async function (assert) {
    let withPolicy = await rerenderBoard(assert, 3);

    await realms[GRANTS].write(
      'realm.json',
      realmConfigCardJSON({ name: 'Grants' }),
    );
    await realms[GRANTS].indexing();
    let unscoped = await federatedSearch(userSession(BOARD_OWNER));
    assert.deepEqual(
      ids(unscoped),
      [BOARD_SCHEDULE],
      'the policy is gone: the grant no longer admits the board owner',
    );

    let withoutPolicy = await rerenderBoard(assert, 4);

    assert.deepEqual(
      withPolicy.drawn,
      [BOARD_SCHEDULE],
      `the render drew rows: ${withPolicy.html}`,
    );
    assert.strictEqual(
      withoutPolicy.html,
      withPolicy.html,
      'the same HTML, byte for byte',
    );
  });
});
