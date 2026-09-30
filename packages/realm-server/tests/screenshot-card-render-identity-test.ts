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
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import { countPixelsOfColor, decodePngRGBA } from './helpers/png.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// ============================================================================
// Whose permissions a POST `_screenshot-card` capture renders with.
//
// A capture that persists is served from the MediaCache to every reader of
// the card, so what it draws must not depend on who happened to ask for it.
// It renders as the realm's owner. A capture answered only to its requester
// renders as the requester.
//
// Three realms on one server:
//
// - Lib: public. Holds the swatch type, and the probe type, whose isolated
//   template searches Private for swatches and draws a solid block of
//   SWATCH_COLOR for every row it gets back.
// - Private: the requester's. The captured realm's owner may not read it. It
//   holds one swatch.
// - Captured: the owner's, which the requester may read. It holds the probe.
//
// So a probe drawn as the requester shows the swatch, and one drawn as the
// owner shows nothing where it would be.
// ============================================================================

const LIB = 'http://127.0.0.1:4444/lib/';
const PRIVATE = 'http://127.0.0.1:4444/private/';
const CAPTURED = 'http://127.0.0.1:4444/captured/';

const OWNER = '@owner:localhost';
const REQUESTER = '@requester:localhost';

const PROBE = `${CAPTURED}probes/probe`;

const SWATCH_COLOR: [number, number, number] = [0, 170, 85];

const SWATCH_MODULE = `
  import { CardDef } from "@cardstack/base/card-api";

  export class Swatch extends CardDef {}
`;

const PROBE_MODULE = `
  import { CardDef, Component } from "@cardstack/base/card-api";

  export class Probe extends CardDef {
    static isolated = class extends Component<typeof this> {
      get query() {
        return {
          filter: {
            'item.on': {
              module: new URL('./swatch', import.meta.url).href,
              name: 'Swatch',
            },
          },
          realms: ["${PRIVATE}"],
        };
      }

      <template>
        {{#if @context.searchResultsComponent}}
          <@context.searchResultsComponent @query={{this.query}} @mode="none" as |results|>
            {{#each results.entries as |entry|}}
              <div data-entry={{entry.id}} style="width: 200px; height: 200px; background: rgb(${SWATCH_COLOR.join(', ')});"></div>
            {{/each}}
          </@context.searchResultsComponent>
        {{else}}
          <span>no search component</span>
        {{/if}}
      </template>
    };
  }
`;

function instanceOf(module: string, name: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module: rri(module), name } },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let realms: Record<string, Realm> = {};
  let request: SuperTest<Test>;
  let server: Server;
  let pagePatch: { restore: () => Promise<void> } | undefined;

  const OWNER_PERMISSIONS: RealmPermissions['user'] = [
    'read',
    'write',
    'realm-owner',
  ];

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(LIB),
          fileSystem: {
            'swatch.gts': SWATCH_MODULE,
            'probe.gts': PROBE_MODULE,
          },
          permissions: { [OWNER]: OWNER_PERMISSIONS, '*': ['read'] },
        },
        {
          realmURL: new URL(PRIVATE),
          fileSystem: {
            'swatches/one.json': instanceOf(`${LIB}swatch`, 'Swatch'),
          },
          permissions: { [REQUESTER]: OWNER_PERMISSIONS },
        },
        {
          realmURL: new URL(CAPTURED),
          fileSystem: {
            'probes/probe.json': instanceOf(`${LIB}probe`, 'Probe'),
          },
          permissions: { [OWNER]: OWNER_PERMISSIONS, [REQUESTER]: ['read'] },
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

  // Booting indexes three realms, which runs inside the first test's budget.
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
    },
  });

  // Asks for a capture of the probe as the requester. A capture that outruns
  // the server's wait is answered 503 while its job carries on, so the
  // request is repeated until it is answered.
  async function capture(
    assert: Assert,
    captureSpec?: Record<string, unknown>,
  ) {
    let token = createRealmServerJWT(
      { user: REQUESTER, sessionRoom: `session-room-${REQUESTER}` },
      realmSecretSeed,
    );
    for (let attempt = 1; ; attempt++) {
      let response = await request
        .post('/_screenshot-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            type: 'screenshot-card',
            attributes: {
              realmURL: CAPTURED,
              cardId: PROBE,
              format: 'isolated',
              ...(captureSpec ? { captureSpec } : {}),
            },
          },
        });
      if (response.status === 503 && attempt < 5) {
        continue;
      }
      assert.strictEqual(
        response.status,
        201,
        `the capture was answered: ${response.text}`,
      );
      let attributes = response.body.data.attributes;
      assert.strictEqual(
        attributes.status,
        'ready',
        `the capture rendered: ${JSON.stringify(attributes.error)}`,
      );
      return attributes.captures[0] as {
        url: string | null;
        base64: string;
      };
    }
  }

  function swatchPixels(base64: string) {
    return countPixelsOfColor(decodePngRGBA(base64), SWATCH_COLOR);
  }

  test('a persisted capture draws what the realm owner can read, and one answered only to its requester draws what the requester can', async function (assert) {
    assert.timeout(240_000);

    // A batch is never persisted, so it is the requester's own view.
    let requestOnly = await capture(assert, {
      captures: [{ name: 'probe' }],
    });
    assert.strictEqual(requestOnly.url, null, 'the batch is not persisted');
    assert.true(
      swatchPixels(requestOnly.base64) > 0,
      'drawn as the requester, the probe shows the swatch it found in Private',
    );

    let persisted = await capture(assert);
    assert.strictEqual(
      persisted.url,
      `${CAPTURED}_screenshot/probes/probe`,
      'the capture is persisted under its served URL',
    );
    assert.strictEqual(
      swatchPixels(persisted.base64),
      0,
      'drawn as the owner, the probe shows no swatch: the owner cannot read Private',
    );

    // What the served URL gives another reader is the persisted capture.
    let served = await request
      .get(new URL(persisted.url!).pathname)
      .set(
        'Authorization',
        `Bearer ${createJWT(realms[CAPTURED], OWNER, OWNER_PERMISSIONS)}`,
      )
      .buffer(true)
      .parse((res, callback) => {
        let chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    assert.strictEqual(served.status, 200, 'the served URL answers');
    assert.strictEqual(served.headers['content-type'], 'image/png');
    assert.strictEqual(
      (served.body as Buffer).toString('base64'),
      persisted.base64,
      'another reader is served the capture the requester was answered with',
    );
  });
});
