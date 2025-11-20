import { module, test } from 'qunit';
import { basename } from 'path';
import {
  CachingDefinitionLookup,
  Realm,
  type ModulePrerenderArgs,
  type RealmOwnerLookup,
  type Prerenderer,
  type RealmAdapter,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import {
  matrixURL,
  setupBaseRealmServer,
  setupPermissionedRealms,
} from './helpers';
import {} from '../prerender/prerenderer';
import { PgAdapter } from '@cardstack/postgres/pg-adapter';

module(basename(__filename), function () {
  module('DefinitionLookup', function (hooks) {
    let definitionLookup: CachingDefinitionLookup;
    let realmURL = 'http://127.0.0.1:4450/';
    let prerenderServerURL = realmURL.endsWith('/')
      ? realmURL.slice(0, -1)
      : realmURL;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {};
    let mockRemotePrerenderer: Prerenderer;
    let mockRealmOwnerLookup: RealmOwnerLookup;
    let realmAdapter: RealmAdapter;
    let realm: Realm;
    let dbAdapter: PgAdapter;
    let prerenderModuleCalls: number = 0;

    hooks.beforeEach(async () => {
      prerenderModuleCalls = 0;
    });
    hooks.before(async () => {
      mockRemotePrerenderer = {
        async prerenderCard() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(_args: ModulePrerenderArgs) {
          prerenderModuleCalls++;
          return Promise.resolve({
            id: 'example-id',
            status: 'ready',
            nonce: '12345',
            isShimmed: false,
            lastModified: +new Date(),
            createdAt: +new Date(),
            deps: ['dep/a', 'dep/b'],
            definitions: {
              Person: {
                type: 'definition',
                moduleURL: './person.gts',
                definition: {
                  type: 'card-def',
                  codeRef: {
                    module: './person.gts',
                    name: 'Person',
                  },
                  displayName: 'Person',
                  fields: {
                    name: {
                      type: 'contains',
                      isPrimitive: true,
                      isComputed: false,
                      fieldOrCard: {
                        module: 'https://cardstack.com/base/string',
                        name: 'default',
                      },
                      serializerName: undefined,
                    },
                  },
                },
                types: [],
              },
            },
          });
        },
      };
      mockRealmOwnerLookup = {
        async fromModule(_moduleURL: string) {
          return { realmURL: realmURL, userId: testUserId };
        },
      };
      definitionLookup = new CachingDefinitionLookup(
        dbAdapter,
        mockRemotePrerenderer,
        mockRealmOwnerLookup,
      );
    });

    hooks.after(async () => {
      // await prerenderer.stop();
    });

    hooks.afterEach(async () => {
      // await prerenderer.disposeRealm(realmURL);
    });

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealms(hooks, {
      realms: [
        {
          realmURL,
          permissions: {
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'person.gts': `
              import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
              export class Person extends CardDef {
                static displayName = "Person";
                @field name = contains(StringField);
                static isolated = class extends Component<typeof this> {
                  <template>{{@model.name}}</template>
                }
              }
            `,
            '1.json': {
              data: {
                attributes: {
                  name: 'Maple',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ realms: setupRealms, dbAdapter: pgAdapter }) {
        ({ realm, realmAdapter } = setupRealms[0]);
        permissions = {
          [realmURL]: ['read', 'write', 'realm-owner'],
        };
        dbAdapter = pgAdapter;
        definitionLookup = new CachingDefinitionLookup(
          dbAdapter,
          mockRemotePrerenderer,
          mockRealmOwnerLookup,
        );
      },
    });

    test('lookupDefinition', async function (assert) {
      let definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.equal(definition?.displayName, 'Person');
      assert.equal(prerenderModuleCalls, 1, 'prerenderModule was called once');

      // second call should hit the cache and not call prerenderModule again
      definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.equal(definition?.displayName, 'Person');
      assert.equal(prerenderModuleCalls, 1, 'prerenderModule was called once');
    });

    test('invalidation', async function (assert) {
      let definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.equal(definition?.displayName, 'Person');
      assert.equal(prerenderModuleCalls, 1, 'prerenderModule was called once');

      await definitionLookup.invalidate('http://some-realm-url');

      definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.equal(definition?.displayName, 'Person');
      assert.equal(
        prerenderModuleCalls,
        1,
        'prerenderModule was still only called once',
      );

      await definitionLookup.invalidate(realmURL);

      definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.equal(definition?.displayName, 'Person');
      assert.equal(
        prerenderModuleCalls,
        2,
        'prerenderModule was called a second time after invalidation',
      );
    });
  });
});
