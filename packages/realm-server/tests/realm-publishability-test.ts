import { module, test } from 'qunit';
import { basename, join } from 'path';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { ensureDirSync, copySync, pathExistsSync, removeSync } from 'fs-extra';
import { dirSync, type DirResult } from 'tmp';
import type { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';

import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  DEFAULT_PERMISSIONS,
  param,
  query,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';

import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmSecretSeed,
  runTestRealmServer,
  setupBaseRealmServer,
  setupDB,
} from './helpers';
import { createJWT as createRealmServerJWT } from '../utils/jwt';
import type { RealmServer } from '../server';

const ownerUserId = '@mango:localhost';
const realmServerURL = new URL('http://127.0.0.1:4460/test/');

module(basename(__filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let publisher: QueuePublisher;
  let runner: QueueRunner;
  let testRealmServer: RealmServer;
  let testRealmHttpServer: Server;
  let request: SuperTest<Test>;
  let tempDir: DirResult;
  let virtualNetwork: VirtualNetwork;

  setupBaseRealmServer(hooks, matrixURL);

  setupDB(hooks, {
    beforeEach: async (_dbAdapter, _publisher, _runner) => {
      dbAdapter = _dbAdapter;
      publisher = _publisher;
      runner = _runner;

      tempDir = dirSync({ unsafeCleanup: true });
      let realmsRootPath = join(
        tempDir.name,
        'realm_server_publishability_test',
      );
      let testRealmDir = join(realmsRootPath, 'test');
      ensureDirSync(testRealmDir);
      copySync(join(__dirname, 'cards'), testRealmDir);

      virtualNetwork = createVirtualNetwork();

      let result = await runTestRealmServer({
        virtualNetwork,
        testRealmDir,
        realmsRootPath,
        realmURL: realmServerURL,
        dbAdapter,
        publisher,
        runner,
        matrixURL,
        permissions: {
          '*': ['read', 'write'],
          [ownerUserId]: DEFAULT_PERMISSIONS,
        },
      });

      testRealmServer = result.testRealmServer;
      testRealmHttpServer = result.testRealmHttpServer;
      request = supertest(testRealmHttpServer);
    },
    afterEach: async () => {
      await closeServer(testRealmHttpServer);
      if (pathExistsSync(tempDir.name)) {
        removeSync(tempDir.name);
      }
    },
  });

  test('reports publishable realm when there are no private dependencies', async function (assert) {
    let { url, realm } = await createRealm({
      name: 'Publishable Realm',
      files: {
        'source-card.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class SourceCard extends CardDef {
            @field label = contains(StringField);
          }
        `,
      },
    });

    let response = await request
      .get(`${url}_has-private-dependencies`)
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, ownerUserId, DEFAULT_PERMISSIONS)}`,
      );

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.true(
      response.body.data.attributes.publishable,
      'Realm is publishable',
    );
    assert.deepEqual(
      response.body.data.attributes.violations,
      [],
      'No violations reported',
    );
  });

  // FIXME add ignored deleted records and data: resources
  test('lists direct dependencies on private realms', async function (assert) {
    let { url: privateRealmURL } = await createRealm({
      name: 'Private Realm',
      files: {
        'secret-card.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class SecretCard extends CardDef {
            @field name = contains(StringField);
          }
        `,
      },
    });

    let { url: sourceRealmURL, realm: sourceRealm } = await createRealm({
      name: 'Source Realm',
      files: {
        'source-card.gts': `
          import {
            contains,
            field,
            linksTo,
            CardDef,
          } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          import { SecretCard } from "${privateRealmURL}secret-card";

          export class SourceCard extends CardDef {
            @field label = contains(StringField);
            @field secret = linksTo(() => SecretCard);
          }
        `,
      },
    });

    let response = await request
      .get(`${sourceRealmURL}_has-private-dependencies`)
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(sourceRealm, ownerUserId, DEFAULT_PERMISSIONS)}`,
      );

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.false(
      response.body.data.attributes.publishable,
      'Realm is not publishable',
    );

    // FIXME why is there source-card/SourceCard and source-card.gts
    assert.deepEqual(
      response.body.data.attributes.violations,
      [
        {
          resource: `${sourceRealmURL}source-card/SourceCard`,
          externalDependencies: [
            {
              dependency: `${privateRealmURL}secret-card/SecretCard`,
              via: [],
              realmURL: privateRealmURL,
              realmVisibility: 'private',
            },
          ],
        },
        {
          resource: `${sourceRealmURL}source-card.gts`,
          externalDependencies: [
            {
              dependency: `${privateRealmURL}secret-card/SecretCard`,
              via: [],
              realmURL: privateRealmURL,
              realmVisibility: 'private',
            },
          ],
        },
      ],
      'Violation references private dependency',
    );
  });

  test('traces transitive dependencies through public realms', async function (assert) {
    let { url: privateRealmURL } = await createRealm({
      name: 'Deep Private Realm',
      files: {
        'secret-card.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class SecretCard extends CardDef {
            @field name = contains(StringField);
          }
        `,
      },
    });

    let { realm: publicRealm, url: publicRealmURL } = await createRealm({
      name: 'Intermediate Public Realm',
      files: {
        'public-card.gts': `
          import {
            contains,
            field,
            linksTo,
            CardDef,
          } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          import { SecretCard } from "${privateRealmURL}secret-card";

          export class PublicCard extends CardDef {
            @field title = contains(StringField);
            @field secret = linksTo(() => SecretCard);
          }
        `,
      },
    });
    await makeRealmPublic(publicRealmURL);
    await publicRealm.realmIndexUpdater.fullIndex();

    let { url: sourceRealmURL, realm: sourceRealm } = await createRealm({
      name: 'Source Realm With Transitive Dependency',
      files: {
        'source-card.gts': `
          import {
            contains,
            field,
            linksTo,
            CardDef,
          } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          import { PublicCard } from "${publicRealmURL}public-card";

          export class SourceCard extends CardDef {
            @field label = contains(StringField);
            @field publicCard = linksTo(() => PublicCard);
          }
        `,
      },
    });

    let response = await request
      .get(`${sourceRealmURL}_has-private-dependencies`)
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(sourceRealm, ownerUserId, DEFAULT_PERMISSIONS)}`,
      );

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.false(
      response.body.data.attributes.publishable,
      'Realm is not publishable due to private dependency',
    );
    assert.deepEqual(
      response.body.data.attributes.violations,
      [
        {
          resource: `${sourceRealmURL}source-card/SourceCard`,
          externalDependencies: [
            {
              dependency: `${privateRealmURL}secret-card`,
              via: [`${publicRealmURL}public-card`],
              realmURL: privateRealmURL,
              realmVisibility: 'private',
            },
          ],
        },
      ],
      'Violation records transitive dependency chain',
    );
  });

  async function createRealm({
    name,
    files,
  }: {
    name: string;
    files?: Record<string, string | object>;
  }): Promise<{ realm: Realm; url: string }> {
    let endpoint = `realm-${uuidv4()}`;

    let response = await request
      .post('/_create-realm')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${realmServerToken(ownerUserId)}`)
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            attributes: {
              name,
              endpoint,
            },
          },
        }),
      );

    if (response.status !== 201) {
      throw new Error(
        `Failed to create realm (${response.status}): ${response.text}`,
      );
    }

    let realmURL: string = response.body.data.id;
    let realm = getRealm(realmURL);

    if (files && Object.keys(files).length > 0) {
      await seedRealm(realm, files);
    } else {
      await realm.realmIndexUpdater.fullIndex();
    }

    return {
      realm,
      url: realmURL,
    };
  }

  function getRealm(realmURL: string): Realm {
    let normalized = realmURL;
    let realm = testRealmServer.testingOnlyRealms.find(
      (candidate) => candidate.url === normalized,
    );
    if (!realm) {
      throw new Error(`Realm ${realmURL} not found`);
    }
    return realm;
  }

  async function makeRealmPublic(realmURL: string) {
    await query(dbAdapter, [
      `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES (`,
      param(realmURL),
      `,`,
      param('*'),
      `,`,
      param(true),
      `,`,
      param(false),
      `,`,
      param(false),
      `)`,
    ]);
  }
});

async function seedRealm(realm: Realm, files: Record<string, string | object>) {
  for (let [path, contents] of Object.entries(files)) {
    let payload =
      typeof contents === 'string' ? contents : JSON.stringify(contents);
    await realm.write(path, payload);
  }
  await realm.realmIndexUpdater.fullIndex();
}

function realmServerToken(userId: string) {
  return createRealmServerJWT(
    { user: userId, sessionRoom: 'session-room-test' },
    realmSecretSeed,
  );
}
