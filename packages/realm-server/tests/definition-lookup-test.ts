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
  rri,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmsCached,
  createVirtualNetwork,
  createTestPgAdapter,
  prepareTestDB,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import type { PgAdapter } from '@cardstack/postgres/pg-adapter';

function buildDefinition(
  moduleURL: string,
  name: string,
): ModuleDefinitionResult {
  let moduleAlias = trimExecutableExtension(rri(moduleURL));
  return {
    type: 'definition',
    moduleURL: moduleAlias,
    definition: {
      type: 'card-def',
      codeRef: {
        module: rri(moduleAlias),
        name,
      },
      displayName: name,
      fields: {},
      fieldDefs: {},
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
  // Internal keys produced here are URL-form; they don't depend on any
  // realm-mapping context, so an empty VirtualNetwork suffices.
  let definitionId = internalKeyFor(
    { module: rri(moduleURL), name },
    undefined,
    new VirtualNetwork(),
  );
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
    let prerenderModulePriorities: (number | undefined)[] = [];
    let forceEmptyDefinitions: boolean = false;
    let virtualNetwork: VirtualNetwork;

    hooks.beforeEach(async () => {
      prerenderModuleCalls = 0;
      prerenderModulePriorities = [];
      forceEmptyDefinitions = false;
    });
    hooks.before(async () => {
      virtualNetwork = createVirtualNetwork();
      mockRemotePrerenderer = {
        async prerenderModule(args: ModulePrerenderArgs) {
          prerenderModuleCalls++;
          prerenderModulePriorities.push(args.priority);
          if (forceEmptyDefinitions) {
            return Promise.resolve({
              id: 'example-id',
              status: 'ready' as const,
              nonce: '12345',
              isShimmed: false,
              lastModified: +new Date(),
              createdAt: +new Date(),
              deps: [],
              definitions: {},
              error: undefined,
            }) as Promise<ModuleRenderResponse>;
          }
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
                    module: rri(moduleURL.href),
                    name: 'Person',
                  },
                  displayName: 'Person',
                  fields: { name: 'f0' },
                  fieldDefs: {
                    f0: {
                      type: 'contains',
                      isPrimitive: true,
                      isComputed: false,
                      fieldOrCard: {
                        module: rri('@cardstack/base/string'),
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
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
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

    setupPermissionedRealmsCached(hooks, {
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
                    module: rri('./person'),
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
      // Start from a cold modules cache: the fixture realm's indexing
      // pre-warms its card modules (including person.gts), so without this
      // reset the first lookup below would hit a populated row and never
      // reach the prerenderer, breaking the call-count assertions.
      await dbAdapter.execute('DELETE FROM modules');
      let definition = await definitionLookup.lookupDefinition({
        module: rri(`${realmURL}person.gts`),
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
        module: rri(`${realmURL}person.gts`),
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
      // Start from a cold modules cache; see lookupDefinition above.
      await dbAdapter.execute('DELETE FROM modules');
      let definition = await definitionLookup.lookupDefinition({
        module: rri(`${realmURL}person.gts`),
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
        module: rri(`${realmURL}person.gts`),
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
        module: rri(`${realmURL}person.gts`),
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
      // Start from a cold modules cache; see lookupDefinition above.
      await dbAdapter.execute('DELETE FROM modules');
      let definition = await definitionLookup.lookupDefinition({
        module: rri(`${realmURL}person.gts`),
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
        module: rri(`${realmURL}person.gts`),
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person');
      assert.strictEqual(
        prerenderModuleCalls,
        2,
        'prerenderModule was called a second time after extensionless invalidation',
      );
    });

    test('getCachedDefinitions forwards priority to prerenderModule', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      await definitionLookup.getCachedDefinitions(`${realmURL}person.gts`, {
        priority: 10,
      });
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'prerenderModule was called once',
      );
      assert.deepEqual(
        prerenderModulePriorities,
        [10],
        'priority 10 was forwarded to prerenderModule',
      );

      // A subsequent call with a different priority on a cached entry must
      // not fire the prerenderer again — cache short-circuits.
      await definitionLookup.getCachedDefinitions(`${realmURL}person.gts`, {
        priority: 0,
      });
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'cached entry returned without re-invoking the prerenderer',
      );

      // Default-priority call (no opts) must end up at priority `undefined`
      // at the prerenderer, which the prerender server reads as 0.
      await definitionLookup.invalidate(`${realmURL}person.gts`);
      await definitionLookup.getCachedDefinitions(`${realmURL}person.gts`);
      assert.strictEqual(prerenderModuleCalls, 2);
      assert.deepEqual(
        prerenderModulePriorities,
        [10, undefined],
        'omitted priority forwards as undefined (default = 0 on the server)',
      );
    });

    test('getCachedDefinitions caches non-card modules as no-card markers', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');
      forceEmptyDefinitions = true;

      let first = await definitionLookup.getCachedDefinitions(
        `${realmURL}person.gts`,
      );
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'prerenderModule was called once',
      );
      assert.ok(first, 'returned a cache entry');
      assert.deepEqual(
        first?.definitions,
        {},
        'no-card module returns empty definitions',
      );

      // The empty-definitions row must persist to the modules table and be
      // treated as a valid cache hit on the next lookup — the prerenderer
      // must not fire a second time.
      let second = await definitionLookup.getCachedDefinitions(
        `${realmURL}person.gts`,
      );
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'second call short-circuited at the cache; prerenderModule still called once',
      );
      assert.deepEqual(
        second?.definitions,
        {},
        'second call returned the same empty-definitions row',
      );

      // Confirm the row really is in the database (not a transient in-memory
      // entry that survived only the in-flight dedupe window).
      let rows = await dbAdapter.execute(
        `SELECT url, definitions FROM modules WHERE resolved_realm_url = $1`,
        { bind: [realmURL] },
      );
      assert.strictEqual(
        rows.length,
        1,
        'modules table has exactly one row for the realm',
      );
      assert.deepEqual(
        (rows[0] as { definitions: Record<string, unknown> }).definitions,
        {},
        'persisted row has empty definitions',
      );
    });

    test('invalidates cached module after module update', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}person.gts`;
      let version = 1;
      let calls = 0;

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          let moduleAlias = trimExecutableExtension(rri(args.url));
          let definitionId = internalKeyFor(
            { module: rri(args.url), name: 'Person' },
            undefined,
            virtualNetwork,
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
                    module: rri(moduleAlias),
                    name: 'Person',
                  },
                  displayName: `Person v${version}`,
                  fields: {},
                  fieldDefs: {},
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
        module: rri(moduleURL),
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person v1');
      assert.strictEqual(calls, 1, 'prerenderModule called for initial lookup');

      version = 2;
      await lookup.invalidate(moduleURL);

      definition = await lookup.lookupDefinition({
        module: rri(moduleURL),
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
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
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
        module: rri(moduleURL),
        name: 'DeletedCard',
      });
      assert.ok(definition, 'definition is cached before deletion');
      assert.strictEqual(calls, 1, 'prerenderModule called for initial lookup');

      modulePresent = false;
      await lookup.invalidate(moduleURL);

      await assert.rejects(
        lookup.lookupDefinition({
          module: rri(moduleURL),
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
      let deepAlias = trimExecutableExtension(rri(deepModule));
      let middleAlias = trimExecutableExtension(rri(middleModule));
      let leafAlias = trimExecutableExtension(rri(leafModule));
      let otherAlias = trimExecutableExtension(rri(otherModule));
      let calls = new Map<string, number>();

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
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
        module: rri(deepModule),
        name: 'DeepCard',
      });
      await lookup.lookupDefinition({
        module: rri(middleModule),
        name: 'MiddleField',
      });
      await lookup.lookupDefinition({
        module: rri(leafModule),
        name: 'LeafField',
      });
      await lookup.lookupDefinition({
        module: rri(otherModule),
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
        module: rri(deepModule),
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

      let blogAppAlias = trimExecutableExtension(rri(blogAppModule));
      let authorAlias = trimExecutableExtension(rri(authorModule));
      let blogCategoryAlias = trimExecutableExtension(rri(blogCategoryModule));
      let blogPostAlias = trimExecutableExtension(rri(blogPostModule));
      let otherAlias = trimExecutableExtension(rri(otherModule));

      let calls = new Map<string, number>();
      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
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
        module: rri(blogAppModule),
        name: 'BlogApp',
      });
      await lookup.lookupDefinition({
        module: rri(authorModule),
        name: 'Author',
      });
      await lookup.lookupDefinition({
        module: rri(blogCategoryModule),
        name: 'BlogCategory',
      });
      await lookup.lookupDefinition({
        module: rri(blogPostModule),
        name: 'BlogPost',
      });
      await lookup.lookupDefinition({
        module: rri(otherModule),
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
        module: rri(blogPostModule),
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
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
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
          module: rri(deepModule),
          name: 'DeepCard',
        }),
        'deep-card errors when missing',
      );

      state.deep = true;
      await lookup.invalidate(deepModule);

      await assert.rejects(
        lookup.lookupDefinition({
          module: rri(middleModule),
          name: 'MiddleField',
        }),
        'middle-field errors when missing',
      );
      await assert.rejects(
        lookup.lookupDefinition({
          module: rri(deepModule),
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
          module: rri(leafModule),
          name: 'LeafField',
        }),
        'leaf-field errors when missing',
      );
      await assert.rejects(
        lookup.lookupDefinition({
          module: rri(middleModule),
          name: 'MiddleField',
        }),
        'middle-field errors when leaf-field is missing',
      );
      await assert.rejects(
        lookup.lookupDefinition({
          module: rri(deepModule),
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
        module: rri(leafModule),
        name: 'LeafField',
      });
      await lookup.lookupDefinition({
        module: rri(middleModule),
        name: 'MiddleField',
      });
      await lookup.lookupDefinition({
        module: rri(deepModule),
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
        module: rri(`${realmURL}person.gts`),
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
        module: rri(`${realmURL}person.gts`),
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
          module: rri(remoteModuleURL),
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
          module: rri(remoteModuleURL),
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

    test('re-prerenders when cached error entry expires', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}transient-error.gts`;
      let calls = 0;
      let shouldError = true;

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          if (shouldError) {
            return buildModuleResponse(args.url, 'TransientError', [], {
              type: 'module-error',
              error: {
                id: args.url,
                message: 'transient prerender failure',
                status: 500,
                title: 'Render timeout',
                deps: [],
                additionalErrors: null,
              },
            });
          }
          return buildModuleResponse(args.url, 'TransientError', []);
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

      // 1. First lookup caches the error
      await assert.rejects(
        lookup.lookupDefinition({
          module: rri(moduleURL),
          name: 'TransientError',
        }),
        /nonexistent type/,
        'lookup fails with cached error',
      );
      assert.strictEqual(calls, 1, 'prerenderModule called once');

      // 2. Error is fresh (within TTL) — should still be served from cache
      shouldError = false;
      await assert.rejects(
        lookup.lookupDefinition({
          module: rri(moduleURL),
          name: 'TransientError',
        }),
        /nonexistent type/,
        'lookup still fails with fresh cached error',
      );
      assert.strictEqual(
        calls,
        1,
        'prerenderModule not called again — error is still fresh',
      );

      // 3. Backdate created_at to simulate expired error
      await dbAdapter.execute(
        `UPDATE modules SET created_at = $1 WHERE url = $2`,
        { bind: [Date.now() - 60_000, moduleURL] },
      );

      // 4. Now the stale error should trigger a re-prerender which succeeds
      let definition = await lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'TransientError',
      });
      assert.ok(
        definition,
        'lookup succeeds after stale error is re-prerendered',
      );
      assert.strictEqual(definition?.displayName, 'TransientError');
      assert.strictEqual(
        calls,
        2,
        'prerenderModule called again after error TTL expired',
      );

      // 5. Subsequent lookups should use the now-healthy cache
      definition = await lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'TransientError',
      });
      assert.ok(definition, 'lookup succeeds from healthy cache');
      assert.strictEqual(
        calls,
        2,
        'prerenderModule not called again — healthy entry is cached',
      );
    });

    test('coalesces concurrent lookups of the same module into one prerender call', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}coalesce-same.gts`;
      let calls = 0;
      let releaseGate!: () => void;
      let gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          await gate;
          return buildModuleResponse(args.url, 'CoalesceSame', []);
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

      let p1 = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'CoalesceSame',
      });
      let p2 = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'CoalesceSame',
      });
      let p3 = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'CoalesceSame',
      });

      // Yield to the event loop so all three calls drain through the
      // buildLookupContext awaits and reach the in-flight gate before we
      // release it. setTimeout(0) crosses the macrotask boundary, which
      // drains every pending microtask — more reliable than a single
      // `await Promise.resolve()` when there are several chained awaits.
      await new Promise((resolve) => setTimeout(resolve, 0));

      releaseGate();
      let [d1, d2, d3] = await Promise.all([p1, p2, p3]);

      assert.strictEqual(
        calls,
        1,
        'prerenderModule called once for three concurrent same-module lookups',
      );
      assert.strictEqual(d1?.displayName, 'CoalesceSame');
      assert.strictEqual(d2?.displayName, 'CoalesceSame');
      assert.strictEqual(d3?.displayName, 'CoalesceSame');
    });

    test('does not coalesce concurrent lookups of different modules', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleA = `${realmURL}coalesce-a.gts`;
      let moduleB = `${realmURL}coalesce-b.gts`;
      let calls = new Map<string, number>();
      let releaseGate!: () => void;
      let gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls.set(args.url, (calls.get(args.url) ?? 0) + 1);
          await gate;
          let name = args.url === moduleA ? 'CoalesceA' : 'CoalesceB';
          return buildModuleResponse(args.url, name, []);
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

      let pA = lookup.lookupDefinition({
        module: rri(moduleA),
        name: 'CoalesceA',
      });
      let pB = lookup.lookupDefinition({
        module: rri(moduleB),
        name: 'CoalesceB',
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      releaseGate();
      let [dA, dB] = await Promise.all([pA, pB]);

      assert.strictEqual(
        calls.get(moduleA),
        1,
        'prerenderModule called once for module A',
      );
      assert.strictEqual(
        calls.get(moduleB),
        1,
        'prerenderModule called once for module B',
      );
      assert.strictEqual(dA?.displayName, 'CoalesceA');
      assert.strictEqual(dB?.displayName, 'CoalesceB');
    });

    test('shares errored prerender result with concurrent waiters and releases in-flight slot on rejection', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}coalesce-error.gts`;
      let calls = 0;
      let releaseGate!: () => void;
      let gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          await gate;
          return buildModuleResponse(args.url, 'CoalesceError', [], {
            type: 'module-error',
            error: {
              id: args.url,
              message: 'simulated prerender failure',
              status: 500,
              title: 'Render error',
              deps: [],
              additionalErrors: null,
            },
          });
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

      let p1 = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'CoalesceError',
      });
      let p2 = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'CoalesceError',
      });
      let p3 = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'CoalesceError',
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      releaseGate();
      let results = await Promise.allSettled([p1, p2, p3]);

      assert.strictEqual(
        calls,
        1,
        'prerenderModule called once for three concurrent erroring lookups',
      );
      for (let result of results) {
        assert.strictEqual(
          result.status,
          'rejected',
          'all concurrent waiters receive the shared rejection',
        );
      }

      // The error row is persisted with a fresh timestamp, so a follow-up
      // lookup should be served from the cache without re-invoking prerender.
      await assert.rejects(
        lookup.lookupDefinition({
          module: rri(moduleURL),
          name: 'CoalesceError',
        }),
        /nonexistent type/,
      );
      assert.strictEqual(
        calls,
        1,
        'follow-up lookup after settle hits cached error without a new prerender',
      );

      // Backdate the cached error past the TTL to simulate a stale error.
      // The in-flight slot must have been released for the next call to form
      // a fresh prerender gate rather than awaiting the already-settled
      // in-flight promise and returning its rejection.
      await dbAdapter.execute(
        `UPDATE modules SET created_at = $1 WHERE url = $2`,
        { bind: [Date.now() - 60_000, moduleURL] },
      );

      await assert.rejects(
        lookup.lookupDefinition({
          module: rri(moduleURL),
          name: 'CoalesceError',
        }),
        /nonexistent type/,
      );
      assert.strictEqual(
        calls,
        2,
        'stale cached error triggers a fresh prerender — in-flight slot was released after prior failure',
      );
    });

    test('invalidate drops in-flight entries so post-invalidation lookups do not join the stale promise', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}coalesce-invalidate.gts`;
      let calls = 0;
      let releaseGate!: () => void;
      let gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          let version = calls;
          await gate;
          let definitionId = internalKeyFor(
            { module: rri(args.url), name: 'CoalesceInvalidate' },
            undefined,
            virtualNetwork,
          );
          let moduleAlias = trimExecutableExtension(rri(args.url));
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
                    module: rri(moduleAlias),
                    name: 'CoalesceInvalidate',
                  },
                  displayName: `CoalesceInvalidate v${version}`,
                  fields: {},
                  fieldDefs: {},
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

      // Caller A starts the prerender and parks at the gate.
      let pA = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'CoalesceInvalidate',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Invalidate while A is still in flight; this must drop the in-flight
      // slot so caller B doesn't piggyback on A's pre-invalidation promise.
      await lookup.invalidate(moduleURL);

      let pB = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'CoalesceInvalidate',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      releaseGate();
      let [resultA, resultB] = await Promise.allSettled([pA, pB]);

      assert.strictEqual(
        calls,
        2,
        'invalidate dropped the in-flight entry so caller B triggered its own prerender',
      );
      // CS-10948: A's pre-invalidation result is dropped at persist time
      // rather than served back. lookupDefinition therefore rejects (the
      // post-skip readFromDatabaseCache misses because invalidate also
      // deleted the row). Only B — which started after the bump and ran a
      // fresh prerender — returns a Definition.
      assert.strictEqual(
        resultA.status,
        'rejected',
        'A is rejected — its pre-invalidation prerender result is discarded',
      );
      assert.strictEqual(resultB.status, 'fulfilled');
      if (resultB.status === 'fulfilled') {
        assert.strictEqual(resultB.value?.displayName, 'CoalesceInvalidate v2');
      }
    });

    test('in-flight prerender result is dropped when invalidate runs concurrently', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}stale-persist-invalidate.gts`;
      let calls = 0;
      let releaseGate!: () => void;
      let gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          await gate;
          return buildModuleResponse(args.url, 'StalePersist', []);
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

      // Caller A starts the prerender and parks at the gate.
      let pA = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'StalePersist',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Invalidate while A is mid-prerender.
      await lookup.invalidate(moduleURL);

      // Release A's prerender. Without the generation guard, A would
      // INSERT ... ON CONFLICT DO UPDATE and re-create the row that
      // invalidate just deleted.
      releaseGate();
      let result = await Promise.allSettled([pA]);
      assert.strictEqual(
        result[0].status,
        'rejected',
        'A rejects because the post-skip readFromDatabaseCache misses (row was deleted)',
      );
      assert.strictEqual(
        calls,
        1,
        'prerenderModule was still called once (no double-prerender)',
      );

      let rows = (await dbAdapter.execute(
        `SELECT url FROM modules WHERE url = $1`,
        { bind: [moduleURL] },
      )) as { url: string }[];
      assert.strictEqual(
        rows.length,
        0,
        'invalidate is honored — no zombie row from A persist',
      );
    });

    test('in-flight prerender result is dropped when clearRealmDefinitions runs concurrently', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}stale-persist-clear-realm.gts`;
      let calls = 0;
      let releaseGate!: () => void;
      let gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          await gate;
          return buildModuleResponse(args.url, 'StalePersistClearRealm', []);
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

      let pA = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'StalePersistClearRealm',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      await lookup.clearRealmDefinitions(realmURL);

      releaseGate();
      let result = await Promise.allSettled([pA]);
      assert.strictEqual(
        result[0].status,
        'rejected',
        'A rejects after clearRealmDefinitions leaves an empty cache',
      );
      assert.strictEqual(calls, 1);

      let rows = (await dbAdapter.execute(
        `SELECT url FROM modules WHERE url = $1`,
        { bind: [moduleURL] },
      )) as { url: string }[];
      assert.strictEqual(
        rows.length,
        0,
        'clearRealmDefinitions is honored — A did not re-insert the row',
      );
    });

    test('in-flight prerender result is dropped when clearAllDefinitions runs concurrently', async function (assert) {
      await dbAdapter.execute('DELETE FROM modules');

      // clearAllDefinitions drains state for every realm — including realms
      // that have never been individually invalidated. Use a fresh module
      // URL so the realm has no #generations entry going in; this guards
      // against the per-realm map missing the realm at clear time.
      let moduleURL = `${realmURL}stale-persist-clear-all.gts`;
      let calls = 0;
      let releaseGate!: () => void;
      let gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          await gate;
          return buildModuleResponse(args.url, 'StalePersistClearAll', []);
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

      let pA = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'StalePersistClearAll',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      await lookup.clearAllDefinitions();

      releaseGate();
      let result = await Promise.allSettled([pA]);
      assert.strictEqual(
        result[0].status,
        'rejected',
        'A rejects after clearAllDefinitions leaves an empty cache',
      );
      assert.strictEqual(calls, 1);

      let rows = (await dbAdapter.execute(
        `SELECT url FROM modules WHERE url = $1`,
        { bind: [moduleURL] },
      )) as { url: string }[];
      assert.strictEqual(
        rows.length,
        0,
        'clearAllDefinitions is honored — A did not re-insert the row',
      );
    });

    test('invalidate of one module does not discard in-flight prerender for an unrelated module in the same realm', async function (assert) {
      // Per-module generation scoping regression guard: a realm-wide bump
      // would spuriously discard the unrelated in-flight's result.
      await dbAdapter.execute('DELETE FROM modules');

      let moduleInvalidated = `${realmURL}scoped-invalidate-target.gts`;
      let moduleUnaffected = `${realmURL}scoped-invalidate-bystander.gts`;
      let calls = 0;
      let releaseGate!: () => void;
      let gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          await gate;
          let name =
            args.url === moduleUnaffected ? 'ScopedBystander' : 'ScopedTarget';
          return buildModuleResponse(args.url, name, []);
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

      // Bystander's prerender is in-flight.
      let pBystander = lookup.lookupDefinition({
        module: rri(moduleUnaffected),
        name: 'ScopedBystander',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Invalidate a DIFFERENT module in the same realm. With realm-wide
      // bumps this would trip the bystander's generation check; with
      // per-module bumps scoped to uniqueInvalidations, it shouldn't.
      await lookup.invalidate(moduleInvalidated);

      releaseGate();
      let definition = await pBystander;
      assert.strictEqual(
        definition?.displayName,
        'ScopedBystander',
        'bystander persisted normally — invalidate scope respected',
      );
      assert.strictEqual(calls, 1);

      let rows = (await dbAdapter.execute(
        `SELECT url FROM modules WHERE url = $1`,
        { bind: [moduleUnaffected] },
      )) as { url: string }[];
      assert.strictEqual(
        rows.length,
        1,
        'bystander row is persisted, not spuriously discarded',
      );
    });

    test('a settled in-flight promise does not delete a newer in-flight under the same key', async function (assert) {
      // Identity-check regression guard. Without the identity check in
      // loadDefinitionCacheEntry's .finally, A's settle would delete B's
      // freshly-installed entry and cause D to race a third prerender.
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}identity-check.gts`;
      let calls = 0;
      let gates: Array<{ release: () => void; promise: Promise<void> }> = [];

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          let release!: () => void;
          let promise = new Promise<void>((resolve) => {
            release = resolve;
          });
          gates.push({ release, promise });
          await promise;
          return buildModuleResponse(args.url, 'Identity', []);
        },
      };

      // setTimeout(0) is not reliable here: readFromDatabaseCache runs on
      // the I/O phase of the event loop, which fires after timers, so a
      // single macrotask yield can return before A has entered the
      // prerender mock. Poll until the expected number of prerenders have
      // started, with a generous bound for slow test environments.
      let waitForCalls = async (expected: number): Promise<void> => {
        let deadline = Date.now() + 5000;
        while (calls < expected) {
          if (Date.now() > deadline) {
            throw new Error(
              `waitForCalls timed out: expected ${expected}, saw ${calls}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
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

      // A enters #inFlight; parks at gates[0].
      let pA = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'Identity',
      });
      await waitForCalls(1);

      // invalidate drops A's #inFlight entry synchronously.
      await lookup.invalidate(moduleURL);

      // B re-enters #inFlight under the same key with a fresh pending.
      let pB = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'Identity',
      });
      await waitForCalls(2);

      // C joins B's pending (same key, B is still in-flight).
      let pC = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'Identity',
      });
      // Give C a chance to either coalesce or start its own prerender.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.strictEqual(
        calls,
        2,
        'C coalesced into B without adding a prerender',
      );

      // Settle A. Its .finally must NOT delete B's entry.
      gates[0].release();
      await Promise.allSettled([pA]);

      // D should STILL coalesce into B. If A's finally deleted B's entry,
      // D would create a third prerender here.
      let pD = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'Identity',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.strictEqual(
        calls,
        2,
        "D coalesced into B — A's settle did not delete B's #inFlight entry",
      );

      // Release B; everyone converges.
      gates[1].release();
      let [rB, rC, rD] = await Promise.allSettled([pB, pC, pD]);
      assert.strictEqual(rB.status, 'fulfilled');
      assert.strictEqual(rC.status, 'fulfilled');
      assert.strictEqual(rD.status, 'fulfilled');
    });

    test('in-flight prerender persists normally when no invalidate runs', async function (assert) {
      // Regression guard against the generation check skipping persist
      // in the happy path (no concurrent invalidation).
      await dbAdapter.execute('DELETE FROM modules');

      let moduleURL = `${realmURL}stale-persist-happy-path.gts`;
      let calls = 0;
      let releaseGate!: () => void;
      let gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
        async prerenderModule(args: ModulePrerenderArgs) {
          calls++;
          await gate;
          return buildModuleResponse(args.url, 'StalePersistHappy', []);
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

      let pA = lookup.lookupDefinition({
        module: rri(moduleURL),
        name: 'StalePersistHappy',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      releaseGate();
      let definition = await pA;
      assert.strictEqual(definition?.displayName, 'StalePersistHappy');
      assert.strictEqual(calls, 1);

      let rows = (await dbAdapter.execute(
        `SELECT url FROM modules WHERE url = $1`,
        { bind: [moduleURL] },
      )) as { url: string }[];
      assert.strictEqual(
        rows.length,
        1,
        'persist proceeded normally when nothing invalidated mid-flight',
      );
    });
  });

  // Lightweight tests for the modules-table diagnostics persistence.
  // Uses createTestPgAdapter + an in-memory CachingDefinitionLookup directly
  // rather than the heavier setupPermissionedRealmsCached fixture, because
  // we only need a working pg adapter + a registered fake realm. Spinning
  // up the real realm-server / prerender-server / Chromium for a SQL-shape
  // assertion would dwarf the test's actual cost (and was timing out the
  // outer 60s qunit budget on cold runs).
  module('module-cache timing diagnostics', function (hooks) {
    let adapter: PgAdapter;
    let definitionLookup: CachingDefinitionLookup;
    let realmURL = 'http://127.0.0.1:4451/';
    let testUserId = '@user1:localhost';
    let nextPrerenderMeta:
      | import('@cardstack/runtime-common').PrerenderResponseMeta
      | undefined;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
      let virtualNetwork = createVirtualNetwork();
      let mockPrerenderer: Prerenderer = {
        async prerenderModule(args: ModulePrerenderArgs) {
          let moduleURL = new URL(args.url);
          let modulePathWithoutExtension = moduleURL.href.replace(/\.gts$/, '');
          return Promise.resolve({
            id: 'example-id',
            status: 'ready',
            nonce: '12345',
            isShimmed: false,
            lastModified: +new Date(),
            createdAt: +new Date(),
            deps: ['dep/a'],
            definitions: {
              [`${modulePathWithoutExtension}/Person`]: {
                type: 'definition',
                moduleURL: moduleURL.href,
                definition: {
                  type: 'card-def',
                  codeRef: { module: rri(moduleURL.href), name: 'Person' },
                  displayName: 'Person',
                  fields: {},
                  fieldDefs: {},
                },
                types: [],
              },
            },
            ...(nextPrerenderMeta ? { meta: nextPrerenderMeta } : {}),
          });
        },
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
      };
      definitionLookup = new CachingDefinitionLookup(
        adapter,
        mockPrerenderer,
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
      // Insert the user permission row required by the lookup's
      // permission probe — the row connects userId → realm so the lookup's
      // cache scope resolves cleanly.
      await adapter.execute(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES ($1, $2, true, true, true)`,
        { bind: [realmURL, testUserId] },
      );
    });

    hooks.afterEach(async function () {
      await adapter.close();
      nextPrerenderMeta = undefined;
    });

    test('persists diagnostics from prerender meta on module rows', async function (assert) {
      nextPrerenderMeta = {
        requestId: 'req-test-123',
        diagnostics: {
          renderStage: 'waiting-stability',
          launchMs: 12,
          renderElapsedMs: 4321,
          totalElapsedMs: 4334,
        },
      };
      let definition = await definitionLookup.lookupDefinition({
        module: rri(`${realmURL}person.gts`),
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person');

      let rows = (await adapter.execute(
        `SELECT diagnostics FROM modules WHERE url = $1`,
        { bind: [`${realmURL}person.gts`] },
      )) as { diagnostics: unknown }[];
      assert.strictEqual(rows.length, 1, 'one modules row was written');
      let raw = rows[0].diagnostics;
      let persisted =
        typeof raw === 'string'
          ? (JSON.parse(raw) as Record<string, any>)
          : (raw as Record<string, any>);
      assert.strictEqual(persisted?.requestId, 'req-test-123');
      assert.strictEqual(persisted?.renderStage, 'waiting-stability');
      assert.strictEqual(persisted?.renderElapsedMs, 4321);
      assert.strictEqual(persisted?.launchMs, 12);
      assert.strictEqual(persisted?.totalElapsedMs, 4334);
    });

    test('persists null diagnostics when prerender returns no meta', async function (assert) {
      let definition = await definitionLookup.lookupDefinition({
        module: rri(`${realmURL}person.gts`),
        name: 'Person',
      });
      assert.strictEqual(definition?.displayName, 'Person');

      let rows = (await adapter.execute(
        `SELECT diagnostics FROM modules WHERE url = $1`,
        { bind: [`${realmURL}person.gts`] },
      )) as { diagnostics: unknown }[];
      assert.strictEqual(rows.length, 1, 'one modules row was written');
      assert.strictEqual(
        rows[0].diagnostics,
        null,
        'diagnostics is null when meta is absent',
      );
    });
  });

  // Lightweight tests for the worker pre-warm path. Like the timing
  // diagnostics module above, these use createTestPgAdapter + an in-memory
  // CachingDefinitionLookup rather than the heavier
  // setupPermissionedRealmsCached fixture — pre-warm runs in the worker,
  // which has no realm-server / prerender / Chromium, so we only need a pg
  // adapter, a fake registered realm for the reader, and a mock prerenderer.
  module('module pre-warm (worker bare lookup)', function (hooks) {
    let adapter: PgAdapter;
    let realmURL = 'http://127.0.0.1:4452/';
    let testUserId = '@user1:localhost';
    let prerenderModuleCalls = 0;
    let prerenderModulePriorities: (number | undefined)[] = [];

    function buildMockPrerenderer(): Prerenderer {
      return {
        async prerenderModule(args: ModulePrerenderArgs) {
          prerenderModuleCalls++;
          prerenderModulePriorities.push(args.priority);
          let moduleURL = new URL(args.url);
          let modulePathWithoutExtension = moduleURL.href.replace(/\.gts$/, '');
          return Promise.resolve({
            id: 'example-id',
            status: 'ready',
            nonce: '12345',
            isShimmed: false,
            lastModified: +new Date(),
            createdAt: +new Date(),
            deps: [],
            definitions: {
              [`${modulePathWithoutExtension}/Person`]: {
                type: 'definition',
                moduleURL: moduleURL.href,
                definition: {
                  type: 'card-def',
                  codeRef: { module: rri(moduleURL.href), name: 'Person' },
                  displayName: 'Person',
                  fields: {},
                  fieldDefs: {},
                },
                types: [],
              },
            },
          }) as Promise<ModuleRenderResponse>;
        },
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
      };
    }

    let fakeRealm = {
      url: realmURL,
      async getRealmOwnerUserId() {
        return testUserId;
      },
      async visibility(): Promise<'private'> {
        return 'private';
      },
    };

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
      prerenderModuleCalls = 0;
      prerenderModulePriorities = [];
      // The reader's prerender (on a cache miss) resolves permissions for
      // the realm owner; the populate path likewise prerenders as the owner.
      await adapter.execute(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES ($1, $2, true, true, true)`,
        { bind: [realmURL, testUserId] },
      );
    });

    hooks.afterEach(async function () {
      await adapter.close();
    });

    test('explicit-context populate persists where the self-resolving lookup no-ops', async function (assert) {
      let virtualNetwork = createVirtualNetwork();

      // The indexer worker constructs a bare CachingDefinitionLookup and
      // never registers the realm — registerRealm is only reached via
      // forRealm, which the realm-server alone calls. Reproduce that.
      let workerLookup = new CachingDefinitionLookup(
        adapter,
        buildMockPrerenderer(),
        virtualNetwork,
        testCreatePrerenderAuth,
      );

      // Self-resolving path: with no registered realm and no requesting
      // realm, buildLookupContext returns null, so getCachedDefinitions is a
      // silent no-op — it never reaches the prerenderer and persists
      // nothing. This is the bug pre-warm was silently hitting.
      let noOp = await workerLookup.getCachedDefinitions(
        `${realmURL}person.gts`,
      );
      assert.strictEqual(
        noOp,
        undefined,
        'self-resolving lookup on a bare worker lookup returns undefined',
      );
      assert.strictEqual(
        prerenderModuleCalls,
        0,
        'no-op path never reached the prerenderer',
      );
      let afterNoOp = await adapter.execute('SELECT url FROM modules');
      assert.strictEqual(
        afterNoOp.length,
        0,
        'no-op path persisted zero module rows',
      );

      // Explicit-context path: pre-warm supplies the same context the
      // visit-phase reader produces (realm-auth / realm-owner user id), so
      // the read-through populate persists a row.
      let entry = await workerLookup.populateDefinitionCacheEntry({
        moduleURL: `${realmURL}person.gts`,
        realmURL,
        resolvedRealmURL: realmURL,
        cacheScope: 'realm-auth',
        cacheUserId: testUserId,
        prerenderUserId: testUserId,
        priority: 10,
      });
      assert.ok(entry, 'explicit-context populate returned an entry');
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'explicit-context populate fired the prerenderer once',
      );
      assert.deepEqual(
        prerenderModulePriorities,
        [10],
        'job priority forwarded to the prerenderer',
      );
      let afterPopulate = await adapter.execute(
        `SELECT url FROM modules WHERE resolved_realm_url = $1`,
        { bind: [realmURL] },
      );
      assert.ok(
        afterPopulate.length > 0,
        'explicit-context populate persisted module rows',
      );

      // The key it wrote must be the one the visit-phase reader reads. A
      // realm-scoped reader (registered realm, same realm-auth/owner key)
      // reads the pre-warmed row without re-firing the prerenderer —
      // proving the warm key matches the read key (no silent mismatch).
      let readerLookup = new CachingDefinitionLookup(
        adapter,
        buildMockPrerenderer(),
        createVirtualNetwork(),
        testCreatePrerenderAuth,
      );
      readerLookup.registerRealm(fakeRealm);
      let cached = await readerLookup.getCachedDefinitions(
        `${realmURL}person.gts`,
      );
      assert.ok(cached, 'realm-scoped reader read the pre-warmed row');
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'reader hit the cache the pre-warm wrote — no second prerender',
      );
    });

    test('pre-warm does not persist error entries for modules that fail to prerender', async function (assert) {
      // The realm-wide `.gts`/`.gjs` sweep speculatively warms every card
      // module, so it also touches `.gts` files that aren't cards and fail
      // to prerender (a non-card `realm.gts`). A non-missing prerender
      // error must NOT be persisted — that would pollute the modules cache
      // with error rows no reader asked for.
      let erroringModule = `${realmURL}realm.gts`;
      let errorPrerenderer: Prerenderer = {
        async prerenderModule(args: ModulePrerenderArgs) {
          prerenderModuleCalls++;
          return Promise.resolve({
            id: args.url,
            status: 'error',
            nonce: '12345',
            isShimmed: false,
            lastModified: +new Date(),
            createdAt: +new Date(),
            deps: [],
            definitions: {},
            error: {
              type: 'module-error',
              error: {
                id: args.url,
                message: 'simulated non-card module render failure',
                status: 500,
                title: 'Module error',
                deps: [],
                additionalErrors: null,
              },
            },
          }) as Promise<ModuleRenderResponse>;
        },
        async prerenderVisit() {
          throw new Error('Not implemented in mock');
        },
        async runCommand() {
          throw new Error('Not implemented in mock');
        },
      };
      let workerLookup = new CachingDefinitionLookup(
        adapter,
        errorPrerenderer,
        createVirtualNetwork(),
        testCreatePrerenderAuth,
      );

      let entry = await workerLookup.populateDefinitionCacheEntry({
        moduleURL: erroringModule,
        realmURL,
        resolvedRealmURL: realmURL,
        cacheScope: 'realm-auth',
        cacheUserId: testUserId,
        prerenderUserId: testUserId,
        priority: 0,
      });
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'pre-warm did attempt the prerender',
      );
      assert.strictEqual(
        entry,
        undefined,
        'pre-warm returns undefined for a module that failed to prerender',
      );
      let rows = await adapter.execute(
        `SELECT url, error_doc FROM modules WHERE url = $1`,
        { bind: [erroringModule] },
      );
      assert.strictEqual(
        rows.length,
        0,
        'pre-warm persisted no row (no error_doc) for the failed module',
      );
    });
  });
});
