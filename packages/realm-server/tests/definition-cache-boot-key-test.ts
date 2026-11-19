import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import {
  CachingDefinitionLookup,
  DEFINITION_CACHE_VERSION,
  MODULE_CACHE_INVALIDATED_CHANNEL,
  rri,
  type ModulePrerenderArgs,
  type ModuleRenderResponse,
  type Prerenderer,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { TRANSPILE_VERSION } from '@cardstack/runtime-common/transpile';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createVirtualNetwork,
  setupDB,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import {
  bootDefinitionCacheKeyInputs,
  computeDefinitionCacheKey,
  definitionCacheReconcilers,
  definitionCacheStartupMode,
  digestBootstrapRealmModules,
  reconcileDefinitionCacheOnBoot,
  type DefinitionCacheKeyInputs,
} from '../lib/definition-cache-key.ts';

const realmURL = 'http://127.0.0.1:4450/';
const ownerUserId = '@owner:localhost';

function moduleResponse(url: string): ModuleRenderResponse {
  let moduleURL = new URL(url);
  let withoutExtension = moduleURL.href.replace(/\.gts$/, '');
  return {
    id: url,
    status: 'ready',
    nonce: 'n',
    isShimmed: false,
    lastModified: Date.now(),
    createdAt: Date.now(),
    deps: [],
    definitions: {
      [`${withoutExtension}/Person`]: {
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
  } as ModuleRenderResponse;
}

module(basename(import.meta.filename), function () {
  module('definitionCacheStartupMode', function () {
    test('the existing opt-out wins over everything', function (assert) {
      assert.strictEqual(
        definitionCacheStartupMode(
          {
            REALM_SERVER_SKIP_MODULES_CACHE_CLEAR_ON_STARTUP: 'true',
            REALM_SERVER_DEFINITION_CACHE_ON_STARTUP: 'clear',
          },
          true,
        ),
        'skip',
      );
    });

    test('an explicit mode wins over the default', function (assert) {
      assert.strictEqual(
        definitionCacheStartupMode(
          { REALM_SERVER_DEFINITION_CACHE_ON_STARTUP: 'clear' },
          true,
        ),
        'clear',
      );
      assert.strictEqual(
        definitionCacheStartupMode(
          { REALM_SERVER_DEFINITION_CACHE_ON_STARTUP: 'keep-if-unchanged' },
          false,
        ),
        'keep-if-unchanged',
      );
    });

    test('a deployed server keeps by key; a dev server clears', function (assert) {
      assert.strictEqual(
        definitionCacheStartupMode({}, true),
        'keep-if-unchanged',
      );
      assert.strictEqual(definitionCacheStartupMode({}, false), 'clear');
      assert.strictEqual(
        definitionCacheStartupMode(
          { REALM_SERVER_DEFINITION_CACHE_ON_STARTUP: 'bogus' },
          false,
        ),
        'clear',
        'an unknown mode falls back to the default',
      );
    });
  });

  module('bootDefinitionCacheKeyInputs', function (hooks) {
    let realmDir: string;
    let indexHTML: string;

    hooks.beforeEach(function () {
      realmDir = mkdtempSync(join(tmpdir(), 'definition-cache-key-inputs-'));
      writeFileSync(join(realmDir, 'card-api.gts'), 'export const a = 1;');
      indexHTML = '<html>shell-a</html>';
    });

    hooks.afterEach(function () {
      rmSync(realmDir, { recursive: true, force: true });
    });

    async function inputsFor(
      env: Record<string, string | undefined>,
      deployed = true,
    ) {
      return await bootDefinitionCacheKeyInputs({
        env,
        deployed,
        getIndexHTML: async () => indexHTML,
        bootstrapRealmPaths: [realmDir],
      });
    }

    async function keyFor(env: Record<string, string | undefined>) {
      return computeDefinitionCacheKey(await inputsFor(env));
    }

    test('a deployed image keys on its commit and reads no module source', async function (assert) {
      let env = { BOXEL_COMMIT: 'commit-a' };
      let inputs = await inputsFor(env);
      assert.strictEqual(inputs.buildSha, 'commit-a');
      assert.strictEqual(inputs.bootstrapModulesDigest, undefined);

      let key = await keyFor(env);
      assert.strictEqual(await keyFor(env), key, 'two computations agree');
      writeFileSync(join(realmDir, 'card-api.gts'), 'export const a = 2;');
      assert.strictEqual(
        await keyFor(env),
        key,
        'a module write does not move it',
      );
      assert.notStrictEqual(
        await keyFor({ BOXEL_COMMIT: 'commit-b' }),
        key,
        'a new commit moves it',
      );
      indexHTML = '<html>shell-b</html>';
      assert.notStrictEqual(
        await keyFor(env),
        key,
        'a new host shell moves it',
      );
    });

    test('without an image commit the module sources are in the key', async function (assert) {
      let inputs = await inputsFor({});
      assert.strictEqual(
        inputs.buildSha,
        undefined,
        'a deployed server without an image commit has no build commit',
      );
      assert.strictEqual(typeof inputs.bootstrapModulesDigest, 'string');

      let key = await keyFor({});
      writeFileSync(join(realmDir, 'card-api.gts'), 'export const a = 2;');
      assert.notStrictEqual(await keyFor({}), key, 'a module write moves it');
    });
  });

  module('reconcileDefinitionCacheOnBoot', function (hooks) {
    let dbAdapter: PgAdapter;
    let virtualNetwork: VirtualNetwork;
    let prerenderModuleCalls = 0;
    let bootstrapDir: string;

    let prerenderer: Prerenderer = {
      async prerenderModule(args: ModulePrerenderArgs) {
        prerenderModuleCalls++;
        return moduleResponse(args.url);
      },
      async prerenderVisit() {
        throw new Error('not used');
      },
      async runCommand() {
        throw new Error('not used');
      },
    };

    // A fresh process: a new lookup with nothing in memory, on the same DB.
    function bootLookup() {
      let lookup = new CachingDefinitionLookup(
        dbAdapter,
        prerenderer,
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      lookup.registerRealm({
        url: realmURL,
        async getRealmOwnerUserId() {
          return ownerUserId;
        },
        async visibility() {
          return 'private';
        },
      });
      return lookup;
    }

    async function lookUp(lookup: CachingDefinitionLookup, name: string) {
      return await lookup.lookupDefinition({
        module: rri(`${realmURL}${name}.gts`),
        name: 'Person',
      });
    }

    async function baseInputs(): Promise<DefinitionCacheKeyInputs> {
      return {
        hostShellHash: 'shell-a',
        transpileVersion: TRANSPILE_VERSION,
        definitionCacheVersion: DEFINITION_CACHE_VERSION,
        buildSha: 'build-a',
        bootstrapModulesDigest: await digestBootstrapRealmModules([
          bootstrapDir,
        ]),
      };
    }

    async function boot(
      lookup: CachingDefinitionLookup,
      inputs: DefinitionCacheKeyInputs,
    ) {
      return await reconcileDefinitionCacheOnBoot({
        dbAdapter,
        definitionLookup: lookup,
        mode: 'keep-if-unchanged',
        computeKey: async () => computeDefinitionCacheKey(inputs),
      });
    }

    async function moduleRowCount() {
      let rows = (await dbAdapter.execute(
        'SELECT count(*)::int AS n FROM modules',
      )) as { n: number }[];
      return rows[0].n;
    }

    // Derives two definitions under the given key, as a first boot and its
    // traffic would, and returns the lookup that did it.
    async function populateUnder(inputs: DefinitionCacheKeyInputs) {
      let lookup = bootLookup();
      await boot(lookup, inputs);
      await lookUp(lookup, 'person');
      await lookUp(lookup, 'pet');
      prerenderModuleCalls = 0;
      return lookup;
    }

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    hooks.beforeEach(function () {
      prerenderModuleCalls = 0;
      virtualNetwork = createVirtualNetwork();
      bootstrapDir = mkdtempSync(join(tmpdir(), 'definition-cache-boot-key-'));
      mkdirSync(join(bootstrapDir, 'nested'));
      writeFileSync(join(bootstrapDir, 'card-api.gts'), 'export const a = 1;');
      writeFileSync(join(bootstrapDir, 'nested', 'string.ts'), 'export {};');
      writeFileSync(join(bootstrapDir, 'readme.md'), '# not a module');
    });

    hooks.afterEach(function () {
      rmSync(bootstrapDir, { recursive: true, force: true });
    });

    test('an unchanged boot keeps every derived definition', async function (assert) {
      let inputs = await baseInputs();
      await populateUnder(inputs);
      assert.strictEqual(await moduleRowCount(), 2, 'two rows were derived');

      let restarted = bootLookup();
      let outcome = await boot(restarted, await baseInputs());
      assert.strictEqual(outcome.outcome, 'kept');
      assert.strictEqual(await moduleRowCount(), 2, 'the rows survived');

      let person = await lookUp(restarted, 'person');
      let pet = await lookUp(restarted, 'pet');
      assert.strictEqual(person?.displayName, 'Person');
      assert.strictEqual(pet?.displayName, 'Person');
      assert.strictEqual(
        prerenderModuleCalls,
        0,
        'no definition was prerendered again',
      );
    });

    test('a first boot with no stored key clears and stores one', async function (assert) {
      await dbAdapter.execute(
        `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
         VALUES ($1, $2, '{}', '[]', 0, $3, 'public', '')`,
        {
          bind: [`${realmURL}left-over`, `${realmURL}left-over.gts`, realmURL],
        },
      );
      let outcome = await boot(bootLookup(), await baseInputs());
      assert.strictEqual(outcome.outcome, 'cleared');
      assert.strictEqual(await moduleRowCount(), 0);
      let stored = (await dbAdapter.execute(
        'SELECT key FROM definition_cache_key',
      )) as { key: string }[];
      assert.deepEqual(
        stored.map((r) => r.key),
        [computeDefinitionCacheKey(await baseInputs())],
      );
    });

    let changes: [string, (i: DefinitionCacheKeyInputs) => void][] = [
      ['the host shell hash', (i) => (i.hostShellHash = 'shell-b')],
      [
        'TRANSPILE_VERSION',
        (i) => (i.transpileVersion = i.transpileVersion + 1),
      ],
      [
        'DEFINITION_CACHE_VERSION',
        (i) => (i.definitionCacheVersion = i.definitionCacheVersion + 1),
      ],
      ['the build SHA', (i) => (i.buildSha = 'build-b')],
      ['a missing build SHA', (i) => (i.buildSha = undefined)],
    ];
    for (let [what, change] of changes) {
      test(`a change to ${what} clears and re-derives`, async function (assert) {
        await populateUnder(await baseInputs());

        let changed = await baseInputs();
        change(changed);
        let restarted = bootLookup();
        let outcome = await boot(restarted, changed);
        assert.strictEqual(outcome.outcome, 'cleared');
        assert.strictEqual(await moduleRowCount(), 0, 'the table was cleared');

        await lookUp(restarted, 'person');
        assert.strictEqual(prerenderModuleCalls, 1, 'person was re-derived');

        // And the new key is what the next boot compares against.
        let again = bootLookup();
        assert.strictEqual((await boot(again, changed)).outcome, 'kept');
        await lookUp(again, 'person');
        assert.strictEqual(prerenderModuleCalls, 1, 'kept under the new key');
      });
    }

    test('a change to a bootstrap module source clears and re-derives', async function (assert) {
      await populateUnder(await baseInputs());

      writeFileSync(join(bootstrapDir, 'nested', 'string.ts'), 'export {}; //');
      let restarted = bootLookup();
      let outcome = await boot(restarted, await baseInputs());
      assert.strictEqual(outcome.outcome, 'cleared');
      await lookUp(restarted, 'person');
      assert.strictEqual(prerenderModuleCalls, 1, 'person was re-derived');
    });

    test('a bootstrap file that is not a module does not move the key', async function (assert) {
      let before = await digestBootstrapRealmModules([bootstrapDir]);
      writeFileSync(join(bootstrapDir, 'readme.md'), '# changed');
      mkdirSync(join(bootstrapDir, 'node_modules'));
      writeFileSync(join(bootstrapDir, 'node_modules', 'x.js'), 'x');
      assert.strictEqual(
        await digestBootstrapRealmModules([bootstrapDir]),
        before,
      );
      writeFileSync(join(bootstrapDir, 'added.gts'), 'export {};');
      assert.notStrictEqual(
        await digestBootstrapRealmModules([bootstrapDir]),
        before,
        'a new module moves it',
      );
    });

    test('a matching boot drops error rows and keeps the rest', async function (assert) {
      await populateUnder(await baseInputs());
      // Stored under the same scope and user as the rows the lookup wrote, so
      // a later lookup of the module would read them.
      let [scope] = (await dbAdapter.execute(
        `SELECT url, file_alias, cache_scope, auth_user_id FROM modules WHERE url LIKE '%person%'`,
      )) as {
        url: string;
        file_alias: string | null;
        cache_scope: string;
        auth_user_id: string;
      }[];
      // An error stored by the previous process, transient-marked or not.
      for (let [name, transient] of [
        ['broken', false],
        ['stalled', true],
      ] as const) {
        await dbAdapter.execute(
          `INSERT INTO modules (url, file_alias, definitions, deps, error_doc, created_at, resolved_realm_url, cache_scope, auth_user_id)
           VALUES ($1, $7, '{}', '[]', $2, $3, $4, $5, $6)`,
          {
            bind: [
              scope.url.replace('person', name),
              JSON.stringify({
                type: 'module-error',
                error: {
                  id: `${realmURL}${name}.gts`,
                  message: 'render timed out',
                  status: 500,
                  title: 'Module error',
                  deps: [],
                  additionalErrors: null,
                  ...(transient ? { renderTimeout: true } : {}),
                },
              }),
              Date.now(),
              realmURL,
              scope.cache_scope,
              scope.auth_user_id,
              scope.file_alias?.replace('person', name) ?? null,
            ],
          },
        );
      }
      assert.strictEqual(await moduleRowCount(), 4);

      let payloads: string[] = [];
      let subscription = await dbAdapter.subscribe(
        MODULE_CACHE_INVALIDATED_CHANNEL,
        (notification) => {
          if (notification.payload) {
            payloads.push(notification.payload);
          }
        },
      );
      let restarted = bootLookup();
      let generationBefore = restarted.definitionGeneration();
      let outcome: Awaited<ReturnType<typeof boot>> | undefined;
      try {
        outcome = await boot(restarted, await baseInputs());
        let deadline = Date.now() + 5_000;
        while (!payloads.length && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      } finally {
        await subscription.unsubscribe();
      }
      assert.deepEqual(outcome, {
        outcome: 'kept',
        key: computeDefinitionCacheKey(await baseInputs()),
        errorRowsDropped: 2,
      });
      assert.ok(
        restarted.definitionGeneration() > generationBefore,
        'answers derived from the dropped rows are invalidated here',
      );
      assert.deepEqual(
        payloads,
        [JSON.stringify({ k: 'global' })],
        'and in peer processes',
      );
      assert.strictEqual(
        await moduleRowCount(),
        2,
        'only the good rows remain',
      );

      await lookUp(restarted, 'person');
      assert.strictEqual(prerenderModuleCalls, 0, 'a good row is still a hit');
      await lookUp(restarted, 'stalled');
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'a dropped error row is prerendered once again',
      );
    });

    test('a key that cannot be computed clears and forgets the stored key', async function (assert) {
      await populateUnder(await baseInputs());
      let restarted = bootLookup();
      let outcome = await reconcileDefinitionCacheOnBoot({
        dbAdapter,
        definitionLookup: restarted,
        mode: 'keep-if-unchanged',
        computeKey: async () => {
          throw new Error('host shell unreachable');
        },
      });
      assert.strictEqual(outcome.outcome, 'cleared');
      assert.strictEqual(await moduleRowCount(), 0);
      let stored = await dbAdapter.execute(
        'SELECT key FROM definition_cache_key',
      );
      assert.strictEqual(stored.length, 0, 'no stale key is left behind');
    });

    test("'clear' empties the table and 'skip' leaves it", async function (assert) {
      await populateUnder(await baseInputs());
      let skipped = await reconcileDefinitionCacheOnBoot({
        dbAdapter,
        definitionLookup: bootLookup(),
        mode: 'skip',
        computeKey: async () => 'unused',
      });
      assert.strictEqual(skipped.outcome, 'skipped');
      assert.strictEqual(await moduleRowCount(), 2, 'skip leaves the table');

      let cleared = await reconcileDefinitionCacheOnBoot({
        dbAdapter,
        definitionLookup: bootLookup(),
        mode: 'clear',
        computeKey: async () => computeDefinitionCacheKey(await baseInputs()),
      });
      assert.strictEqual(cleared.outcome, 'cleared');
      assert.strictEqual(await moduleRowCount(), 0, 'clear empties it');
    });

    // The post-deployment hook runs once the old build's tasks are gone. What
    // they wrote after a key-changing boot cleared was derived under the old
    // inputs, so the first check after the key changed clears again; a deploy
    // that left the key alone keeps the table.
    async function postDeployment(
      lookup: CachingDefinitionLookup,
      inputs: DefinitionCacheKeyInputs,
    ) {
      return await reconcileDefinitionCacheOnBoot({
        dbAdapter,
        definitionLookup: lookup,
        mode: 'keep-if-unchanged',
        computeKey: async () => computeDefinitionCacheKey(inputs),
        afterDeployment: true,
      });
    }

    test('after a deploy that changed the key, the hook clears once', async function (assert) {
      await populateUnder(await baseInputs());
      // Settle the first deploy, so the table's key predates the next one.
      await postDeployment(bootLookup(), await baseInputs());

      let changed = await baseInputs();
      changed.hostShellHash = 'shell-d';
      let newTask = bootLookup();
      assert.strictEqual((await boot(newTask, changed)).outcome, 'cleared');
      // An old-build task, still serving during the rolling deploy, writes a
      // row the new boot can't tell from its own.
      await lookUp(bootLookup(), 'person');
      assert.strictEqual(await moduleRowCount(), 1);

      let hook = await postDeployment(newTask, changed);
      assert.strictEqual(hook.outcome, 'cleared');
      assert.strictEqual(
        await moduleRowCount(),
        0,
        "the old build's row is gone",
      );

      await lookUp(newTask, 'person');
      let again = await postDeployment(newTask, changed);
      assert.strictEqual(again.outcome, 'kept', 'a second run keeps');
      assert.strictEqual(await moduleRowCount(), 1);
    });

    test('after a deploy that left the key alone, the hook keeps', async function (assert) {
      await populateUnder(await baseInputs());
      // The first deploy's hook clears once; derive again after it.
      let settled = bootLookup();
      await postDeployment(settled, await baseInputs());
      await lookUp(settled, 'person');
      await lookUp(settled, 'pet');

      let restarted = bootLookup();
      assert.strictEqual(
        (await boot(restarted, await baseInputs())).outcome,
        'kept',
      );
      prerenderModuleCalls = 0;
      let hook = await postDeployment(restarted, await baseInputs());
      assert.strictEqual(hook.outcome, 'kept');
      await lookUp(restarted, 'person');
      await lookUp(restarted, 'pet');
      assert.strictEqual(prerenderModuleCalls, 0, 'nothing is re-derived');
    });

    test('the hook clears where a boot is told to skip', async function (assert) {
      await populateUnder(await baseInputs());
      let { onBoot, afterDeployment } = definitionCacheReconcilers({
        dbAdapter,
        definitionLookup: bootLookup(),
        mode: 'skip',
        computeKey: async () => computeDefinitionCacheKey(await baseInputs()),
      });
      assert.strictEqual((await onBoot()).outcome, 'skipped');
      assert.strictEqual(
        await moduleRowCount(),
        2,
        'the boot leaves the table',
      );
      assert.strictEqual((await afterDeployment()).outcome, 'cleared');
      assert.strictEqual(await moduleRowCount(), 0, 'the hook clears it');
    });

    test('a deployed image keeps the table across a restart, and a new image clears it', async function (assert) {
      // What main.ts composes: the mode for a deployed server URL, and the
      // key from the image's commit and the host shell.
      let reconcilersFor = (commit: string, lookup: CachingDefinitionLookup) =>
        definitionCacheReconcilers({
          dbAdapter,
          definitionLookup: lookup,
          mode: definitionCacheStartupMode({ BOXEL_COMMIT: commit }, true),
          computeKey: async () =>
            computeDefinitionCacheKey(
              await bootDefinitionCacheKeyInputs({
                env: { BOXEL_COMMIT: commit },
                deployed: true,
                getIndexHTML: async () => '<html>shell</html>',
                bootstrapRealmPaths: [bootstrapDir],
              }),
            ),
        });

      let deployed = bootLookup();
      assert.strictEqual(
        (await reconcilersFor('commit-a', deployed).onBoot()).outcome,
        'cleared',
      );
      await lookUp(deployed, 'person');
      prerenderModuleCalls = 0;

      let restarted = bootLookup();
      let sameImage = reconcilersFor('commit-a', restarted);
      assert.strictEqual((await sameImage.onBoot()).outcome, 'kept');
      await lookUp(restarted, 'person');
      assert.strictEqual(
        prerenderModuleCalls,
        0,
        'a restart of the same image derives nothing again',
      );

      let next = bootLookup();
      assert.strictEqual(
        (await reconcilersFor('commit-b', next).onBoot()).outcome,
        'cleared',
      );
      await lookUp(next, 'person');
      assert.strictEqual(
        prerenderModuleCalls,
        1,
        'a new image derives it again',
      );
    });

    test('concurrent boots with one new key clear once', async function (assert) {
      await populateUnder(await baseInputs());
      let changed = await baseInputs();
      changed.hostShellHash = 'shell-c';
      let outcomes = await Promise.all([
        boot(bootLookup(), changed),
        boot(bootLookup(), changed),
      ]);
      assert.deepEqual(
        outcomes.map((o) => o.outcome).sort(),
        ['cleared', 'kept'],
        'the second boot waits for the first and sees its key',
      );
    });
  });
});
