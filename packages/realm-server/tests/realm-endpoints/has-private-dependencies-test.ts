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
} from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import type { RealmServer } from '../../server';

const ownerUserId = '@mango:localhost';
const realmServerURL = new URL('http://127.0.0.1:4460/test/');

module(`realm-endpoints/${basename(__filename)}`, function (hooks) {
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
      copySync(join(__dirname, '..', 'cards'), testRealmDir);

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

          // Ensure data: dependencies are ignored
          import "data:text/javascript,export%20default%200;";

          export class SourceCard extends CardDef {
            @field label = contains(StringField);
          }
        `,
        'source-instance.json': {
          data: {
            type: 'card',
            attributes: {
              label: 'Public Label',
            },
            meta: {
              adoptsFrom: {
                module: './source-card',
                name: 'SourceCard',
              },
            },
          },
        },
      },
    });

    let response = await request
      .get(`${new URL(url).pathname}_has-private-dependencies`)
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
        'source-instance.json': {
          data: {
            type: 'card',
            attributes: {
              label: 'Secret label',
            },
            meta: {
              adoptsFrom: {
                module: './source-card',
                name: 'SourceCard',
              },
            },
          },
        },
      },
    });

    let response = await request
      .get(`${new URL(sourceRealmURL).pathname}_has-private-dependencies`)
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

    assert.strictEqual(
      response.body.data.attributes.violations.length,
      1,
      'one violating resource is reported',
    );
    let violation = response.body.data.attributes.violations[0];
    assert.strictEqual(
      violation.resource,
      `${sourceRealmURL}source-instance.json`,
      'violation references the offending instance',
    );
    assert.true(
      violation.externalDependencies.some((dep: any) =>
        String(dep.dependency).startsWith(`${privateRealmURL}secret-card`),
      ),
      'dependency points into the private realm',
    );
    assert.true(
      violation.externalDependencies.every(
        (dep: any) => dep.realmURL === privateRealmURL,
      ),
      'dependencies report the private realm URL',
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
        'public-instance.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Public bridge',
            },
            meta: {
              adoptsFrom: {
                module: './public-card',
                name: 'PublicCard',
              },
            },
          },
        },
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
        'source-instance.json': {
          data: {
            type: 'card',
            attributes: {
              label: 'Transitive label',
            },
            meta: {
              adoptsFrom: {
                module: './source-card',
                name: 'SourceCard',
              },
            },
          },
        },
      },
    });

    let response = await request
      .get(`${new URL(sourceRealmURL).pathname}_has-private-dependencies`)
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
    assert.strictEqual(
      response.body.data.attributes.violations.length,
      1,
      'one violating resource is reported',
    );
    let transitiveViolation = response.body.data.attributes.violations[0];
    assert.strictEqual(
      transitiveViolation.resource,
      `${sourceRealmURL}source-instance.json`,
      'violation references the offending instance',
    );
    assert.true(
      transitiveViolation.externalDependencies.some((dep: any) =>
        String(dep.dependency).startsWith(`${privateRealmURL}secret-card`),
      ),
      'dependency points into the private realm',
    );
    assert.true(
      transitiveViolation.externalDependencies.some((dep: any) =>
        String(dep.via?.[0] ?? '').startsWith(`${publicRealmURL}public-card`),
      ),
      'dependency chain records the public realm hop',
    );

    assert.true(
      transitiveViolation.externalDependencies.every(
        (dep: any) => dep.realmURL === privateRealmURL,
      ),
      'dependencies report the private realm URL',
    );
  });

  test('detects private dependencies referenced through local modules', async function (assert) {
    let { url: privateRealmURL } = await createRealm({
      name: 'Private Realm For Local Modules',
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
      name: 'Source Realm With Local Modules',
      files: {
        'helper-card.gts': `
          import {
            contains,
            field,
            linksTo,
            CardDef,
          } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          import { SecretCard } from "${privateRealmURL}secret-card";

          export class HelperCard extends CardDef {
            @field label = contains(StringField);
            @field secret = linksTo(() => SecretCard);
          }
        `,
        'source-card.gts': `
          import {
            contains,
            field,
            linksTo,
            CardDef,
          } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          import { HelperCard } from "./helper-card";

          export class SourceCard extends CardDef {
            @field label = contains(StringField);
            @field helper = linksTo(() => HelperCard);
          }
        `,
        'source-instance.json': {
          data: {
            type: 'card',
            attributes: {
              label: 'Local helper label',
            },
            meta: {
              adoptsFrom: {
                module: './source-card',
                name: 'SourceCard',
              },
            },
          },
        },
      },
    });

    let response = await request
      .get(`${new URL(sourceRealmURL).pathname}_has-private-dependencies`)
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(sourceRealm, ownerUserId, DEFAULT_PERMISSIONS)}`,
      );

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.false(
      response.body.data.attributes.publishable,
      'Realm is not publishable due to helper referencing private realm',
    );
    assert.strictEqual(
      response.body.data.attributes.violations.length,
      1,
      'one violating resource is reported',
    );
    let violation = response.body.data.attributes.violations[0];
    assert.strictEqual(
      violation.resource,
      `${sourceRealmURL}source-instance.json`,
      'instance is identified as violating resource',
    );
    assert.true(
      violation.externalDependencies.some((dep: any) =>
        String(dep.dependency).startsWith(`${privateRealmURL}secret-card`),
      ),
      'violation references the private realm dependency',
    );
  });

  test('handles circular dependencies', async function (assert) {
    let { url: privateRealmURL, realm: privateRealm } = await createRealm({
      name: 'Circular Private Realm',
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
      name: 'Source Realm With Cycle',
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
        'source-instance.json': {
          data: {
            type: 'card',
            attributes: {
              label: 'Circular secret label',
            },
            meta: {
              adoptsFrom: {
                module: './source-card',
                name: 'SourceCard',
              },
            },
          },
        },
      },
    });

    await privateRealm.write(
      'secret-card.gts',
      `
        import {
          contains,
          field,
          linksTo,
          CardDef,
        } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { SourceCard } from "${sourceRealmURL}source-card";

        export class SecretCard extends CardDef {
          @field name = contains(StringField);
          @field source = linksTo(() => SourceCard);
        }
      `,
    );
    await privateRealm.realmIndexUpdater.fullIndex();

    let response = await request
      .get(`${new URL(sourceRealmURL).pathname}_has-private-dependencies`)
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
    assert.strictEqual(
      response.body.data.attributes.violations.length,
      1,
      'one violating resource is reported despite circular dependency',
    );
  });

  test('ignores deleted instances', async function (assert) {
    let { url: privateRealmURL } = await createRealm({
      name: 'Private Realm For Deletion',
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

    let { url, realm } = await createRealm({
      name: 'Realm with deleted instance',
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
        'source-instance.json': {
          data: {
            type: 'card',
            attributes: {
              label: 'Temporary',
            },
            meta: {
              adoptsFrom: {
                module: './source-card',
                name: 'SourceCard',
              },
            },
          },
        },
      },
    });

    await realm.delete('source-instance.json');
    await realm.realmIndexUpdater.fullIndex();

    let response = await request
      .get(`${new URL(url).pathname}_has-private-dependencies`)
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, ownerUserId, DEFAULT_PERMISSIONS)}`,
      );

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.true(
      response.body.data.attributes.publishable,
      'Realm is publishable after instance deletion',
    );
    assert.deepEqual(
      response.body.data.attributes.violations,
      [],
      'No violations reported once the offending instance is deleted',
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
    await dbAdapter.execute(`
      INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
      VALUES ('${realmURL}', '*', true, false, false)
    `);
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
