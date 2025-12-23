import { module, test } from 'qunit';
import { basename } from 'path';
import {
  CachingDefinitionLookup,
  type ModulePrerenderArgs,
  type Prerenderer,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  matrixURL,
  setupBaseRealmServer,
  setupPermissionedRealms,
  createVirtualNetwork,
  testCreatePrerenderAuth,
} from './helpers';
import type { PgAdapter } from '@cardstack/postgres/pg-adapter';

module(basename(__filename), function () {
  module('DefinitionLookup', function (hooks) {
    let definitionLookup: CachingDefinitionLookup;
    let realmURL = 'http://127.0.0.1:4450/';
    let testUserId = '@user1:localhost';

    let mockRemotePrerenderer: Prerenderer;
    let dbAdapter: PgAdapter;
    let prerenderModuleCalls: number = 0;
    let virtualNetwork: VirtualNetwork;

    hooks.beforeEach(async () => {
      prerenderModuleCalls = 0;
    });
    hooks.before(async () => {
      virtualNetwork = createVirtualNetwork();
      mockRemotePrerenderer = {
        async prerenderCard() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          prerenderModuleCalls++;
          let moduleURL = new URL(args.url);
          let modulePathWithoutExtension = moduleURL.href.replace(/\.gts$/, '');
          return Promise.resolve({
            id: 'example-id',
            status: 'ready',
            nonce: '12345',
            isShimmed: false,
            lastModified: +new Date(),
            createdAt: +new Date(),
            deps: ['dep/a', 'dep/b'],
            definitions: {
              [`${modulePathWithoutExtension}/Person`]: {
                type: 'definition',
                moduleURL: moduleURL.href,
                definition: {
                  type: 'card-def',
                  codeRef: {
                    module: moduleURL.href,
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
        async prerenderFileMeta() {
          throw new Error('Not implemented in mock');
        },
      };
      definitionLookup = new CachingDefinitionLookup(
        dbAdapter,
        mockRemotePrerenderer,
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      definitionLookup.registerRealm({
        url: realmURL,
        async getRealmOwnerUserId() {
          return testUserId;
        },
        async visibility() {
          return 'private';
        },
      });
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
      onRealmSetup({ dbAdapter: pgAdapter }) {
        dbAdapter = pgAdapter;
        definitionLookup = new CachingDefinitionLookup(
          dbAdapter,
          mockRemotePrerenderer,
          virtualNetwork,
          testCreatePrerenderAuth,
        );
        definitionLookup.registerRealm({
          url: realmURL,
          async getRealmOwnerUserId() {
            return testUserId;
          },
          async visibility() {
            return 'private';
          },
        });
      },
    });

    test('lookupDefinition', async function (assert) {
      let definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person');
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'prerenderModule was called once',
      );

      // second call should hit the cache and not call prerenderModule again
      definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person');
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'prerenderModule was called once',
      );
    });

    test('invalidation', async function (assert) {
      let definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person');
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'prerenderModule was called once',
      );

      await definitionLookup.invalidate('http://some-realm-url');

      definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person');
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'prerenderModule was still only called once',
      );

      await definitionLookup.invalidate(realmURL);

      definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person');
      assert.strictEqual(
        prerenderModuleCalls,
        2,
        'prerenderModule was called a second time after invalidation',
      );
    });

    test('uses public cache scope when realm is public', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');
      await dbAdapter.execute(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES ($1, '*', true, false, false)`,
        { bind: [realmURL] },
      );

      // rebuild definition lookup to clear cached visibility
      definitionLookup = new CachingDefinitionLookup(
        dbAdapter,
        mockRemotePrerenderer,
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      definitionLookup.registerRealm({
        url: realmURL,
        async getRealmOwnerUserId() {
          return testUserId;
        },
        async visibility() {
          // after inserting '*' the realm is public
          return 'public';
        },
      });

      await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });

      let rows = (await dbAdapter.execute(
        `SELECT cache_scope, auth_user_id FROM modules WHERE url = $1`,
        { bind: [`${realmURL}person.gts`] },
      )) as { cache_scope: string; auth_user_id: string }[];

      assert.strictEqual(rows[0]?.cache_scope, 'public');
      assert.strictEqual(rows[0]?.auth_user_id, '');
    });

    test('uses realm-auth cache scope when realm is private on the same server', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });

      let rows = (await dbAdapter.execute(
        `SELECT cache_scope, auth_user_id FROM modules WHERE url = $1`,
        { bind: [`${realmURL}person.gts`] },
      )) as { cache_scope: string; auth_user_id: string }[];

      assert.strictEqual(rows[0]?.cache_scope, 'realm-auth');
      assert.strictEqual(rows[0]?.auth_user_id, testUserId);
    });

    test('uses public cache scope when requesting a public realm on another server', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');
      let remoteRealmURL = 'http://remote-realm/';
      let remoteModuleURL = `${remoteRealmURL}person.gts`;

      let handler = async (request: Request) => {
        if (request.method === 'HEAD' && request.url === remoteModuleURL) {
          return new Response(null, {
            status: 200,
            headers: {
              'x-boxel-realm-public-readable': 'true',
              'x-boxel-realm-url': remoteRealmURL,
            },
          });
        }
        return null;
      };
      virtualNetwork.mount(handler);

      try {
        let scopedLookup = definitionLookup.forRealm({
          url: realmURL,
          async getRealmOwnerUserId() {
            return testUserId;
          },
          async visibility() {
            return 'private';
          },
        });

        await scopedLookup.lookupDefinition({
          module: remoteModuleURL,
          name: 'Person',
        });

        let rows = (await dbAdapter.execute(
          `SELECT cache_scope, auth_user_id FROM modules WHERE url = $1`,
          { bind: [remoteModuleURL] },
        )) as { cache_scope: string; auth_user_id: string }[];

        assert.strictEqual(rows[0]?.cache_scope, 'public');
        assert.strictEqual(rows[0]?.auth_user_id, '');
      } finally {
        virtualNetwork.unmount(handler);
      }
    });

    test('uses realm-auth cache scope when requesting a private realm on another server', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');
      let remoteRealmURL = 'http://private-remote-realm/';
      let remoteModuleURL = `${remoteRealmURL}person.gts`;
      let requestingUserId = '@other-user:localhost';

      let handler = async (request: Request) => {
        if (request.method === 'HEAD' && request.url === remoteModuleURL) {
          return new Response(null, {
            status: 200,
            headers: {
              'x-boxel-realm-public-readable': 'false',
              'x-boxel-realm-url': remoteRealmURL,
            },
          });
        }
        return null;
      };
      virtualNetwork.mount(handler);

      try {
        let scopedLookup = definitionLookup.forRealm({
          url: realmURL,
          async getRealmOwnerUserId() {
            return requestingUserId;
          },
          async visibility() {
            return 'private';
          },
        });

        await scopedLookup.lookupDefinition({
          module: remoteModuleURL,
          name: 'Person',
        });

        let rows = (await dbAdapter.execute(
          `SELECT cache_scope, auth_user_id FROM modules WHERE url = $1`,
          { bind: [remoteModuleURL] },
        )) as { cache_scope: string; auth_user_id: string }[];

        assert.strictEqual(rows[0]?.cache_scope, 'realm-auth');
        assert.strictEqual(rows[0]?.auth_user_id, requestingUserId);
      } finally {
        virtualNetwork.unmount(handler);
      }
    });
  });
});
