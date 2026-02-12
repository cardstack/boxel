import { module, test } from 'qunit';
import { basename } from 'path';
import {
  CachingDefinitionLookup,
  internalKeyFor,
  trimExecutableExtension,
  type ErrorEntry,
  type ModuleDefinitionResult,
  type ModulePrerenderArgs,
  type ModuleRenderResponse,
  type Prerenderer,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealms,
  createVirtualNetwork,
  testCreatePrerenderAuth,
} from './helpers';
import type { PgAdapter } from '@cardstack/postgres/pg-adapter';

function buildDefinition(
  moduleURL: string,
  name: string,
): ModuleDefinitionResult {
  let moduleAlias = trimExecutableExtension(new URL(moduleURL)).href;
  return {
    type: 'definition',
    moduleURL: moduleAlias,
    definition: {
      type: 'card-def',
      codeRef: {
        module: moduleAlias,
        name,
      },
      displayName: name,
      fields: {},
    },
    types: [],
  };
}

function buildModuleError(
  moduleURL: string,
  message: string,
  deps: string[] = [],
  additionalErrors: ErrorEntry['error']['additionalErrors'] = null,
): ErrorEntry {
  return {
    type: 'module-error',
    error: {
      id: moduleURL,
      message,
      status: 404,
      title: 'Module error',
      deps,
      additionalErrors,
    },
  };
}

function buildModuleResponse(
  moduleURL: string,
  name: string,
  deps: string[],
  error?: ErrorEntry,
): ModuleRenderResponse {
  let definitionId = internalKeyFor({ module: moduleURL, name }, undefined);
  let definitions = error
    ? {}
    : {
        [definitionId]: buildDefinition(moduleURL, name),
      };
  return {
    id: moduleURL,
    status: error ? 'error' : 'ready',
    nonce: 'test-nonce',
    isShimmed: false,
    lastModified: Date.now(),
    createdAt: Date.now(),
    deps,
    definitions,
    error,
  };
}

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
        async prerenderFileExtract() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileRender() {
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

      await definitionLookup.invalidate('http://some-realm-url/person.gts');

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

      await definitionLookup.invalidate(`${realmURL}person.gts`);

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

    test('invalidates module cache entries without file extensions', async function (assert) {
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

      await definitionLookup.invalidate(`${realmURL}person`);

      definition = await definitionLookup.lookupDefinition({
        module: `${realmURL}person.gts`,
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person');
      assert.strictEqual(
        prerenderModuleCalls,
        2,
        'prerenderModule was called a second time after extensionless invalidation',
      );
    });

    test('invalidates cached module after module update', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}person.gts`;
      let version = 1;
      let calls = 0;

      let prerenderer: Prerenderer = {
        async prerenderCard() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileExtract() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileRender() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          let moduleAlias = trimExecutableExtension(new URL(args.url)).href;
          let definitionId = internalKeyFor(
            { module: args.url, name: 'Person' },
            undefined,
          );
          return {
            id: args.url,
            status: 'ready',
            nonce: 'test-nonce',
            isShimmed: false,
            lastModified: Date.now(),
            createdAt: Date.now(),
            deps: [],
            definitions: {
              [definitionId]: {
                type: 'definition',
                moduleURL: moduleAlias,
                definition: {
                  type: 'card-def',
                  codeRef: {
                    module: moduleAlias,
                    name: 'Person',
                  },
                  displayName: `Person v${version}`,
                  fields: {},
                },
                types: [],
              },
            },
          };
        },
      };

      let lookup = new CachingDefinitionLookup(
        dbAdapter,
        prerenderer,
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      lookup.registerRealm({
        url: realmURL,
        async getRealmOwnerUserId() {
          return testUserId;
        },
        async visibility() {
          return 'private';
        },
      });

      let definition = await lookup.lookupDefinition({
        module: moduleURL,
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person v1');
      assert.strictEqual(calls, 1, 'prerenderModule called for initial lookup');

      version = 2;
      await lookup.invalidate(moduleURL);

      definition = await lookup.lookupDefinition({
        module: moduleURL,
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person v2');
      assert.strictEqual(
        calls,
        2,
        'prerenderModule called again after update invalidation',
      );
    });

    test('invalidates cached module after module deletion', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}deleted-card.gts`;
      let modulePresent = true;
      let calls = 0;

      let prerenderer: Prerenderer = {
        async prerenderCard() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileExtract() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileRender() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          if (!modulePresent) {
            return buildModuleResponse(
              args.url,
              'DeletedCard',
              [],
              buildModuleError(args.url, 'missing deleted-card'),
            );
          }
          return buildModuleResponse(args.url, 'DeletedCard', []);
        },
      };

      let lookup = new CachingDefinitionLookup(
        dbAdapter,
        prerenderer,
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      lookup.registerRealm({
        url: realmURL,
        async getRealmOwnerUserId() {
          return testUserId;
        },
        async visibility() {
          return 'private';
        },
      });

      let definition = await lookup.lookupDefinition({
        module: moduleURL,
        name: 'DeletedCard',
      });
      assert.ok(definition, 'definition is cached before deletion');
      assert.strictEqual(calls, 1, 'prerenderModule called for initial lookup');

      modulePresent = false;
      await lookup.invalidate(moduleURL);

      await assert.rejects(
        lookup.lookupDefinition({
          module: moduleURL,
          name: 'DeletedCard',
        }),
        'lookup fails after module deletion invalidation',
      );
      assert.strictEqual(
        calls,
        2,
        'prerenderModule called again after deletion invalidation',
      );
    });

    test('invalidates module cache entries using dependency graph', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let deepModule = `${realmURL}deep-card.gts`;
      let middleModule = `${realmURL}middle-field.gts`;
      let leafModule = `${realmURL}leaf-field.gts`;
      let otherModule = `${realmURL}other-card.gts`;
      let deepAlias = trimExecutableExtension(new URL(deepModule)).href;
      let middleAlias = trimExecutableExtension(new URL(middleModule)).href;
      let leafAlias = trimExecutableExtension(new URL(leafModule)).href;
      let otherAlias = trimExecutableExtension(new URL(otherModule)).href;
      let calls = new Map<string, number>();

      let prerenderer: Prerenderer = {
        async prerenderCard() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileExtract() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileRender() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls.set(args.url, (calls.get(args.url) ?? 0) + 1);
          switch (args.url) {
            case deepModule:
              return buildModuleResponse(args.url, 'DeepCard', [
                './middle-field.gts',
              ]);
            case middleModule:
              return buildModuleResponse(args.url, 'MiddleField', [
                './leaf-field.gts',
              ]);
            case leafModule:
              return buildModuleResponse(args.url, 'LeafField', []);
            case otherModule:
              return buildModuleResponse(args.url, 'OtherCard', []);
            default:
              throw new Error(`Unexpected module URL: ${args.url}`);
          }
        },
      };

      let lookup = new CachingDefinitionLookup(
        dbAdapter,
        prerenderer,
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      lookup.registerRealm({
        url: realmURL,
        async getRealmOwnerUserId() {
          return testUserId;
        },
        async visibility() {
          return 'private';
        },
      });

      await lookup.lookupDefinition({
        module: deepModule,
        name: 'DeepCard',
      });
      await lookup.lookupDefinition({
        module: middleModule,
        name: 'MiddleField',
      });
      await lookup.lookupDefinition({
        module: leafModule,
        name: 'LeafField',
      });
      await lookup.lookupDefinition({
        module: otherModule,
        name: 'OtherCard',
      });

      let rows = (await dbAdapter.execute(
        `SELECT url FROM modules
         WHERE url IN ($1, $2, $3)
            OR file_alias IN ($4, $5, $6)`,
        {
          bind: [
            deepModule,
            middleModule,
            leafModule,
            deepAlias,
            middleAlias,
            leafAlias,
          ],
        },
      )) as { url: string }[];
      assert.strictEqual(rows.length, 3, 'module cache entries created');

      await lookup.invalidate(leafModule);

      rows = (await dbAdapter.execute(
        `SELECT url FROM modules
         WHERE url IN ($1, $2, $3)
            OR file_alias IN ($4, $5, $6)`,
        {
          bind: [
            deepModule,
            middleModule,
            leafModule,
            deepAlias,
            middleAlias,
            leafAlias,
          ],
        },
      )) as { url: string }[];
      assert.strictEqual(
        rows.length,
        0,
        'leaf invalidation clears dependent module cache entries',
      );

      rows = (await dbAdapter.execute(
        `SELECT url FROM modules
         WHERE url = $1 OR file_alias = $2`,
        {
          bind: [otherModule, otherAlias],
        },
      )) as { url: string }[];
      assert.strictEqual(
        rows.length,
        1,
        'unrelated module remains cached after invalidation',
      );

      await lookup.lookupDefinition({
        module: deepModule,
        name: 'DeepCard',
      });
      assert.strictEqual(
        calls.get(deepModule),
        2,
        'deep module was re-prerendered after invalidation',
      );
    });

    test('invalidates module cache entries for branching dependency graph', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let blogAppModule = `${realmURL}blog-app.gts`;
      let authorModule = `${realmURL}author.gts`;
      let blogCategoryModule = `${realmURL}blog-category.gts`;
      let blogPostModule = `${realmURL}blog-post.gts`;
      let otherModule = `${realmURL}other-card.gts`;

      let blogAppAlias = trimExecutableExtension(new URL(blogAppModule)).href;
      let authorAlias = trimExecutableExtension(new URL(authorModule)).href;
      let blogCategoryAlias = trimExecutableExtension(
        new URL(blogCategoryModule),
      ).href;
      let blogPostAlias = trimExecutableExtension(new URL(blogPostModule)).href;
      let otherAlias = trimExecutableExtension(new URL(otherModule)).href;

      let calls = new Map<string, number>();
      let prerenderer: Prerenderer = {
        async prerenderCard() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileExtract() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileRender() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls.set(args.url, (calls.get(args.url) ?? 0) + 1);
          switch (args.url) {
            case blogAppModule:
              return buildModuleResponse(args.url, 'BlogApp', []);
            case authorModule:
              return buildModuleResponse(args.url, 'Author', [
                './blog-app.gts',
              ]);
            case blogCategoryModule:
              return buildModuleResponse(args.url, 'BlogCategory', [
                './blog-app.gts',
              ]);
            case blogPostModule:
              return buildModuleResponse(args.url, 'BlogPost', [
                './author.gts',
                './blog-app.gts',
              ]);
            case otherModule:
              return buildModuleResponse(args.url, 'OtherCard', []);
            default:
              throw new Error(`Unexpected module URL: ${args.url}`);
          }
        },
      };

      let lookup = new CachingDefinitionLookup(
        dbAdapter,
        prerenderer,
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      lookup.registerRealm({
        url: realmURL,
        async getRealmOwnerUserId() {
          return testUserId;
        },
        async visibility() {
          return 'private';
        },
      });

      await lookup.lookupDefinition({
        module: blogAppModule,
        name: 'BlogApp',
      });
      await lookup.lookupDefinition({
        module: authorModule,
        name: 'Author',
      });
      await lookup.lookupDefinition({
        module: blogCategoryModule,
        name: 'BlogCategory',
      });
      await lookup.lookupDefinition({
        module: blogPostModule,
        name: 'BlogPost',
      });
      await lookup.lookupDefinition({
        module: otherModule,
        name: 'OtherCard',
      });

      let rows = (await dbAdapter.execute(
        `SELECT url FROM modules
         WHERE url IN ($1, $2, $3, $4, $5)
            OR file_alias IN ($6, $7, $8, $9, $10)`,
        {
          bind: [
            blogAppModule,
            authorModule,
            blogCategoryModule,
            blogPostModule,
            otherModule,
            blogAppAlias,
            authorAlias,
            blogCategoryAlias,
            blogPostAlias,
            otherAlias,
          ],
        },
      )) as { url: string }[];
      assert.strictEqual(rows.length, 5, 'module cache entries created');

      await lookup.invalidate(blogAppModule);

      rows = (await dbAdapter.execute(
        `SELECT url FROM modules
         WHERE url IN ($1, $2, $3, $4)
            OR file_alias IN ($5, $6, $7, $8)`,
        {
          bind: [
            blogAppModule,
            authorModule,
            blogCategoryModule,
            blogPostModule,
            blogAppAlias,
            authorAlias,
            blogCategoryAlias,
            blogPostAlias,
          ],
        },
      )) as { url: string }[];
      assert.strictEqual(
        rows.length,
        0,
        'blog-app invalidation clears dependent module cache entries',
      );

      rows = (await dbAdapter.execute(
        `SELECT url FROM modules
         WHERE url = $1 OR file_alias = $2`,
        {
          bind: [otherModule, otherAlias],
        },
      )) as { url: string }[];
      assert.strictEqual(
        rows.length,
        1,
        'unrelated module remains cached after branching invalidation',
      );

      await lookup.lookupDefinition({
        module: blogPostModule,
        name: 'BlogPost',
      });
      assert.strictEqual(
        calls.get(blogPostModule),
        2,
        'blog-post module was re-prerendered after invalidation',
      );
    });

    test('propagates module errors to dependents and recovers after missing modules are added', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let deepModule = `${realmURL}deep-card.gts`;
      let middleModule = `${realmURL}middle-field.gts`;
      let leafModule = `${realmURL}leaf-field.gts`;
      let state = {
        deep: false,
        middle: false,
        leaf: false,
      };

      let prerenderer: Prerenderer = {
        async prerenderCard() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileExtract() {
          throw new Error('Not implemented in mock');
        },
        async prerenderFileRender() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          switch (args.url) {
            case deepModule: {
              if (!state.deep) {
                return buildModuleResponse(
                  args.url,
                  'DeepCard',
                  [],
                  buildModuleError(args.url, 'missing deep-card'),
                );
              }
              if (!state.middle || !state.leaf) {
                return buildModuleResponse(
                  args.url,
                  'DeepCard',
                  ['./middle-field.gts'],
                  buildModuleError(args.url, 'missing middle-field', [
                    './middle-field.gts',
                  ]),
                );
              }
              return buildModuleResponse(args.url, 'DeepCard', [
                './middle-field.gts',
              ]);
            }
            case middleModule: {
              if (!state.middle) {
                return buildModuleResponse(
                  args.url,
                  'MiddleField',
                  [],
                  buildModuleError(args.url, 'missing middle-field', [
                    './leaf-field.gts',
                  ]),
                );
              }
              if (!state.leaf) {
                return buildModuleResponse(
                  args.url,
                  'MiddleField',
                  ['./leaf-field.gts'],
                  buildModuleError(args.url, 'missing leaf-field', [
                    './leaf-field.gts',
                  ]),
                );
              }
              return buildModuleResponse(args.url, 'MiddleField', [
                './leaf-field.gts',
              ]);
            }
            case leafModule: {
              if (!state.leaf) {
                return buildModuleResponse(
                  args.url,
                  'LeafField',
                  [],
                  buildModuleError(args.url, 'missing leaf-field'),
                );
              }
              return buildModuleResponse(args.url, 'LeafField', []);
            }
            default:
              throw new Error(`Unexpected module URL: ${args.url}`);
          }
        },
      };

      let lookup = new CachingDefinitionLookup(
        dbAdapter,
        prerenderer,
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      lookup.registerRealm({
        url: realmURL,
        async getRealmOwnerUserId() {
          return testUserId;
        },
        async visibility() {
          return 'private';
        },
      });

      await assert.rejects(
        lookup.lookupDefinition({
          module: deepModule,
          name: 'DeepCard',
        }),
        'deep-card errors when missing',
      );

      state.deep = true;
      await lookup.invalidate(deepModule);

      await assert.rejects(
        lookup.lookupDefinition({
          module: middleModule,
          name: 'MiddleField',
        }),
        'middle-field errors when missing',
      );
      await assert.rejects(
        lookup.lookupDefinition({
          module: deepModule,
          name: 'DeepCard',
        }),
        'deep-card errors when middle-field is missing',
      );

      let rows = (await dbAdapter.execute(
        `SELECT error_doc FROM modules WHERE url = $1`,
        {
          bind: [deepModule],
          coerceTypes: { error_doc: 'JSON' },
        },
      )) as { error_doc: ErrorEntry | null }[];
      let deepError = rows[0]?.error_doc;
      assert.strictEqual(
        deepError?.type,
        'module-error',
        'deep-card error is stored in cache',
      );
      if (deepError?.error) {
        let additionalErrors = Array.isArray(deepError.error.additionalErrors)
          ? deepError.error.additionalErrors
          : [];
        assert.ok(
          additionalErrors.some((error) =>
            String(error.message ?? '').includes('middle-field'),
          ),
          'middle-field error details are included in dependency errors',
        );
      }

      state.middle = true;
      await lookup.invalidate(middleModule);

      await assert.rejects(
        lookup.lookupDefinition({
          module: leafModule,
          name: 'LeafField',
        }),
        'leaf-field errors when missing',
      );
      await assert.rejects(
        lookup.lookupDefinition({
          module: middleModule,
          name: 'MiddleField',
        }),
        'middle-field errors when leaf-field is missing',
      );
      await assert.rejects(
        lookup.lookupDefinition({
          module: deepModule,
          name: 'DeepCard',
        }),
        'deep-card errors when leaf-field is missing',
      );

      rows = (await dbAdapter.execute(
        `SELECT error_doc FROM modules WHERE url = $1`,
        {
          bind: [deepModule],
          coerceTypes: { error_doc: 'JSON' },
        },
      )) as { error_doc: ErrorEntry | null }[];
      deepError = rows[0]?.error_doc;
      if (deepError?.error) {
        let additionalErrors = Array.isArray(deepError.error.additionalErrors)
          ? deepError.error.additionalErrors
          : [];
        assert.ok(
          additionalErrors.some((error) =>
            String(error.message ?? '').includes('leaf-field'),
          ),
          'leaf-field error details are included in dependency errors',
        );
      }

      state.leaf = true;
      await lookup.invalidate(leafModule);

      await lookup.lookupDefinition({
        module: leafModule,
        name: 'LeafField',
      });
      await lookup.lookupDefinition({
        module: middleModule,
        name: 'MiddleField',
      });
      await lookup.lookupDefinition({
        module: deepModule,
        name: 'DeepCard',
      });

      let sqlNullRows = (await dbAdapter.execute(
        `SELECT error_doc IS NULL AS is_sql_null
         FROM modules
         WHERE url = $1`,
        { bind: [deepModule] },
      )) as { is_sql_null: boolean }[];
      assert.true(
        sqlNullRows[0]?.is_sql_null,
        'deep-card error_doc is SQL NULL after recovery',
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
