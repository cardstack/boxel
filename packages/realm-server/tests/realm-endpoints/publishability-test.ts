import { module, test } from 'qunit';
import { basename } from 'path';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import type { Realm } from '@cardstack/runtime-common';
import {
  DEFAULT_PERMISSIONS,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import {
  createJWT,
  matrixURL,
  setupBaseRealmServer,
  setupPermissionedRealm,
  setupPermissionedRealms,
} from '../helpers';

const ownerUserId = '@mango:localhost';

module(`realm-endpoints/${basename(__filename)}`, function (hooks) {
  setupBaseRealmServer(hooks, matrixURL);

  module('with a publishable realm', function (hooks) {
    let request: SuperTest<Test>;
    let testRealm: Realm;

    setupPermissionedRealm(hooks, {
      permissions: {
        [ownerUserId]: ['read', 'write', 'realm-owner'],
      },
      fileSystem: {
        'source-card.gts': `
              import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              import CreateAiAssistantRoomCommand from "@cardstack/boxel-host/commands/create-ai-assistant-room";

              // Ensure data: dependencies are ignored
              import "data:text/javascript,export%20default%200;";

              export class SourceCard extends CardDef {
                @field label = contains(StringField);

                command = CreateAiAssistantRoomCommand;

                <template>
                  label: <span class='label'>{{@fields.label}}</span>

                  <style scoped>
                    .label { font-weight: bold; }
                  </style>
                </template>
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
      onRealmSetup({ testRealm: realm, request: req }) {
        testRealm = realm;
        request = req;
      },
    });

    test('reports publishable realm when there are no private dependencies', async function (assert) {
      let response = await request
        .get('/_publishability')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, ownerUserId, DEFAULT_PERMISSIONS)}`,
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
  });

  module('with additional realms', function () {
    module('lists direct dependencies on private realms', function (hooks) {
      let sourceRealm: Realm;
      let privateRealm: Realm;
      let request: SuperTest<Test>;
      let sourceRealmURL = new URL('http://127.0.0.1:4460/source/');
      let privateRealmURL = new URL('http://127.0.0.1:4461/private/');

      setupPermissionedRealms(hooks, {
        realms: [
          {
            realmURL: privateRealmURL.href,
            permissions: {
              [ownerUserId]: DEFAULT_PERMISSIONS,
            },
            fileSystem: {
              'secret-card.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class SecretCard extends CardDef {
            @field name = contains(StringField);
          }
        `,
            },
          },
          {
            realmURL: sourceRealmURL.href,
            permissions: {
              [ownerUserId]: DEFAULT_PERMISSIONS,
            },
            fileSystem: {
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
          },
        ],
        onRealmSetup({ realms }) {
          sourceRealm = realms.find(
            ({ realm }) => realm.url === sourceRealmURL.href,
          )!.realm;
          privateRealm = realms.find(
            ({ realm }) => realm.url === privateRealmURL.href,
          )!.realm;
          request = supertest(
            realms.find(({ realm }) => realm.url === sourceRealmURL.href)!
              .realmHttpServer,
          );
        },
      });

      test('lists direct dependencies on private realms', async function (assert) {
        let response = await request
          .get(`${new URL(sourceRealm.url).pathname}_publishability`)
          .set('Accept', SupportedMimeType.JSONAPI)
          .set(
            'Authorization',
            `Bearer ${createJWT(
              sourceRealm,
              ownerUserId,
              DEFAULT_PERMISSIONS,
            )}`,
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
          `${sourceRealm.url}source-instance.json`,
          'violation references the offending instance',
        );
        assert.true(
          violation.externalDependencies.some((dep: any) =>
            String(dep.dependency).startsWith(`${privateRealm.url}secret-card`),
          ),
          'dependency points into the private realm',
        );
        assert.true(
          violation.externalDependencies.every(
            (dep: any) => dep.realmURL === privateRealm.url,
          ),
          'dependencies report the private realm URL',
        );
      });
    });

    module(
      'detects private dependencies referenced through local modules',
      function (hooks) {
        let sourceRealm: Realm;
        let request: SuperTest<Test>;
        let sourceRealmURL = new URL('http://127.0.0.1:4462/source/');
        let privateRealmURL = new URL('http://127.0.0.1:4463/private/');

        setupPermissionedRealms(hooks, {
          realms: [
            {
              realmURL: privateRealmURL.href,
              permissions: {
                [ownerUserId]: DEFAULT_PERMISSIONS,
              },
              fileSystem: {
                'secret-card.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class SecretCard extends CardDef {
            @field name = contains(StringField);
          }
        `,
              },
            },
            {
              realmURL: sourceRealmURL.href,
              permissions: {
                [ownerUserId]: DEFAULT_PERMISSIONS,
              },
              fileSystem: {
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
            },
          ],
          onRealmSetup({ realms }) {
            sourceRealm = realms.find(
              ({ realm }) => realm.url === sourceRealmURL.href,
            )!.realm;
            request = supertest(
              realms.find(({ realm }) => realm.url === sourceRealmURL.href)!
                .realmHttpServer,
            );
          },
        });

        test('detects private dependencies referenced through local modules', async function (assert) {
          let response = await request
            .get(`${new URL(sourceRealm.url).pathname}_publishability`)
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(
                sourceRealm,
                ownerUserId,
                DEFAULT_PERMISSIONS,
              )}`,
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
            `${sourceRealm.url}source-instance.json`,
            'instance is identified as violating resource',
          );
          assert.true(
            violation.externalDependencies.some((dep: any) =>
              String(dep.dependency).startsWith(
                `${privateRealmURL}secret-card`,
              ),
            ),
            'violation references the private realm dependency',
          );
        });
      },
    );

    module(
      'detects private dependencies served by another realm server',
      function (hooks) {
        let sourceRealm: Realm;
        let request: SuperTest<Test>;
        let sourceRealmURL = new URL('http://127.0.0.1:4464/source/');
        let remoteRealmURL = new URL('http://127.0.0.1:4465/remote/');

        setupPermissionedRealms(hooks, {
          realms: [
            {
              realmURL: remoteRealmURL.href,
              permissions: {
                [ownerUserId]: DEFAULT_PERMISSIONS,
              },
              fileSystem: {
                'secret-card.gts': `
            import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";

            export class SecretCard extends CardDef {
              @field name = contains(StringField);
            }
          `,
              },
            },
            {
              realmURL: sourceRealmURL.href,
              permissions: {
                [ownerUserId]: DEFAULT_PERMISSIONS,
              },
              fileSystem: {
                'source-card.gts': `
            import {
              contains,
              field,
              linksTo,
              CardDef,
            } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";
            import { SecretCard } from "${remoteRealmURL}secret-card";

            export class SourceCard extends CardDef {
              @field label = contains(StringField);
              @field secret = linksTo(() => SecretCard);
            }
          `,
                'source-instance.json': {
                  data: {
                    type: 'card',
                    attributes: {
                      label: 'Remote secret label',
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
            },
          ],
          onRealmSetup({ realms }) {
            sourceRealm = realms.find(
              ({ realm }) => realm.url === sourceRealmURL.href,
            )!.realm;
            request = supertest(
              realms.find(({ realm }) => realm.url === sourceRealmURL.href)!
                .realmHttpServer,
            );
          },
        });

        test('detects private dependencies served by another realm server', async function (assert) {
          let response = await request
            .get(`${new URL(sourceRealm.url).pathname}_publishability`)
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(
                sourceRealm,
                ownerUserId,
                DEFAULT_PERMISSIONS,
              )}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.false(
            response.body.data.attributes.publishable,
            'Realm is not publishable due to remote private dependency',
          );
          assert.strictEqual(
            response.body.data.attributes.violations.length,
            1,
            'one violating resource is reported',
          );
          let remoteViolation = response.body.data.attributes.violations[0];
          assert.strictEqual(
            remoteViolation.resource,
            `${sourceRealm.url}source-instance.json`,
            'violation references the local instance',
          );
          assert.true(
            remoteViolation.externalDependencies.some((dep: any) =>
              String(dep.dependency).startsWith(`${remoteRealmURL}secret-card`),
            ),
            'violation references the remote realm dependency',
          );
        });
      },
    );

    module('handles circular dependencies', function (hooks) {
      let sourceRealm: Realm;
      let privateRealm: Realm;
      let request: SuperTest<Test>;
      let sourceRealmURL = new URL('http://127.0.0.1:4466/source/');
      let privateRealmURL = new URL('http://127.0.0.1:4467/private/');

      setupPermissionedRealms(hooks, {
        realms: [
          {
            realmURL: privateRealmURL.href,
            permissions: {
              [ownerUserId]: DEFAULT_PERMISSIONS,
            },
            fileSystem: {
              'secret-card.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class SecretCard extends CardDef {
            @field name = contains(StringField);
          }
        `,
            },
          },
          {
            realmURL: sourceRealmURL.href,
            permissions: {
              [ownerUserId]: DEFAULT_PERMISSIONS,
            },
            fileSystem: {
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
          },
        ],
        onRealmSetup({ realms }) {
          sourceRealm = realms.find(
            ({ realm }) => realm.url === sourceRealmURL.href,
          )!.realm;
          privateRealm = realms.find(
            ({ realm }) => realm.url === privateRealmURL.href,
          )!.realm;
          request = supertest(
            realms.find(({ realm }) => realm.url === sourceRealmURL.href)!
              .realmHttpServer,
          );
        },
      });

      test('handles circular dependencies', async function (assert) {
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
          .get(`${new URL(sourceRealm.url).pathname}_publishability`)
          .set('Accept', SupportedMimeType.JSONAPI)
          .set(
            'Authorization',
            `Bearer ${createJWT(
              sourceRealm,
              ownerUserId,
              DEFAULT_PERMISSIONS,
            )}`,
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
    });

    module('ignores deleted instances', function (hooks) {
      let sourceRealm: Realm;
      let request: SuperTest<Test>;
      let sourceRealmURL = new URL('http://127.0.0.1:4468/source/');
      let privateRealmURL = new URL('http://127.0.0.1:4469/private/');

      setupPermissionedRealms(hooks, {
        realms: [
          {
            realmURL: privateRealmURL.href,
            permissions: {
              [ownerUserId]: DEFAULT_PERMISSIONS,
            },
            fileSystem: {
              'secret-card.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class SecretCard extends CardDef {
            @field name = contains(StringField);
          }
        `,
            },
          },
          {
            realmURL: sourceRealmURL.href,
            permissions: {
              [ownerUserId]: DEFAULT_PERMISSIONS,
            },
            fileSystem: {
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
          },
        ],
        onRealmSetup({ realms }) {
          sourceRealm = realms.find(
            ({ realm }) => realm.url === sourceRealmURL.href,
          )!.realm;
          request = supertest(
            realms.find(({ realm }) => realm.url === sourceRealmURL.href)!
              .realmHttpServer,
          );
        },
      });

      test('ignores deleted instances', async function (assert) {
        await sourceRealm.delete('source-instance.json');
        await sourceRealm.realmIndexUpdater.fullIndex();

        let response = await request
          .get(`${new URL(sourceRealm.url).pathname}_publishability`)
          .set('Accept', SupportedMimeType.JSONAPI)
          .set(
            'Authorization',
            `Bearer ${createJWT(
              sourceRealm,
              ownerUserId,
              DEFAULT_PERMISSIONS,
            )}`,
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
    });
  });
});
