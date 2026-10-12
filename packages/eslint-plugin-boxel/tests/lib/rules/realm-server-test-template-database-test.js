'use strict';

const rule = require('../../../lib/rules/realm-server-test-template-database');
const RuleTester = require('eslint').RuleTester;

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const IMPORTS = `
import {
  setupDB,
  runTestRealmServer,
  runTestRealmServerWithRealms,
  setupPermissionedRealm,
} from './helpers';
`;

function perTestIndex(starter) {
  return { messageId: 'perTestIndex', data: { starter } };
}

function uncachedSetup(helper) {
  return { messageId: 'uncachedSetup', data: { helper } };
}

ruleTester.run('realm-server-test-template-database', rule, {
  valid: [
    // A template database: each test starts from a copy of the indexed realms.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          templateDatabase,
          beforeEach: async (dbAdapter, publisher, runner) => {
            await runTestRealmServer({ dbAdapter, publisher, runner });
          },
        });
      `,
    },
    // \`before\` brings the realms up once for the whole module.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          before: async (dbAdapter, publisher, runner) => {
            await runTestRealmServer({ dbAdapter, publisher, runner });
          },
        });
      `,
    },
    // A \`beforeEach\` that brings up no realm.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          beforeEach: async (dbAdapter) => {
            await dbAdapter.execute('DELETE FROM users');
          },
        });
      `,
    },
    // The realms start in a function from another module, which the rule does
    // not follow.
    {
      code: `${IMPORTS}
        import { startServer } from './shared';
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher, runner) => {
            await startServer(dbAdapter, publisher, runner);
          },
        });
      `,
    },
    // A recursive local function that never brings up a realm terminates.
    {
      code: `${IMPORTS}
        async function settle(n) {
          if (n > 0) {
            await settle(n - 1);
          }
        }
        setupDB(hooks, {
          beforeEach: async () => {
            await settle(3);
          },
        });
      `,
    },
    // Options the rule cannot read.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          ...shared,
          beforeEach: async (dbAdapter, publisher, runner) => {
            await runTestRealmServer({ dbAdapter, publisher, runner });
          },
        });
      `,
    },
    {
      code: `${IMPORTS}
        setupDB(hooks, options);
      `,
    },
    // An uncached setup helper brought up once for the module.
    {
      code: `${IMPORTS}
        setupPermissionedRealm(hooks, {
          mode: 'before',
          fixture: 'simple',
          permissions,
        });
      `,
    },
    // The cached variants.
    {
      code: `
        import {
          setupPermissionedRealmCached,
          setupPermissionedRealmsCached,
        } from './helpers';
        setupPermissionedRealmCached(hooks, { fixture: 'simple', permissions });
        setupPermissionedRealmsCached(hooks, { realms });
      `,
    },
    // Options the rule cannot read.
    {
      code: `${IMPORTS}
        setupPermissionedRealm(hooks, { mode, fixture: 'simple', permissions });
        setupPermissionedRealm(hooks, { ...shared, permissions });
        setupPermissionedRealm(hooks, options);
      `,
    },
    // The helper's own template hook.
    {
      code: `${IMPORTS}
        setupPermissionedRealm(hooks, {
          fixture: 'simple',
          permissions,
          dbTemplateDatabase,
        });
      `,
    },
    // A realm built but never started indexes nothing.
    {
      code: `
        import { setupDB, createRealm } from './helpers';
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher) => {
            ({ realm } = await createRealm({ dir, dbAdapter, publisher }));
          },
        });
      `,
    },
    // \`start()\` on a realm no factory built.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          beforeEach: async () => {
            await runner.start();
          },
        });
      `,
    },
    // A starter named only in a type.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          beforeEach: async () => {
            let server: Awaited<ReturnType<typeof runTestRealmServer>> | undefined;
            servers.push(server);
          },
        });
      `,
    },
    // The shared simple realm server, with its template.
    {
      code: `
        import {
          setupDB,
          setupSimpleRealmServerTemplate,
          startSimpleRealmServer,
        } from './helpers';
        let templateDatabase = setupSimpleRealmServerTemplate(hooks);
        setupDB(hooks, {
          templateDatabase,
          beforeEach: async (dbAdapter, publisher, runner) => {
            server = await startSimpleRealmServer({ dbAdapter, publisher, runner });
          },
        });
      `,
    },
    // A namespace member that is not a starter.
    {
      code: `
        import * as helpers from './helpers';
        helpers.setupDB(hooks, {});
        setupDB(hooks, {
          beforeEach: async () => {
            await helpers.insertUser();
          },
        });
      `,
    },
    // A local parameter that shares a starter's name is not the starter.
    {
      code: `${IMPORTS}
        function make(runTestRealmServer) {
          setupDB(hooks, {
            beforeEach: async () => {
              await runTestRealmServer();
            },
          });
        }
      `,
    },
  ],

  invalid: [
    // A starter called directly in the hook.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher, runner) => {
            await runTestRealmServer({ dbAdapter, publisher, runner });
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
    // Through a local function declaration.
    {
      code: `${IMPORTS}
        async function startSearchRealmServer({ dbAdapter, publisher, runner }) {
          return await runTestRealmServerWithRealms({ dbAdapter, publisher, runner });
        }
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher, runner) => {
            await startSearchRealmServer({ dbAdapter, publisher, runner });
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServerWithRealms')],
    },
    // Through a local arrow function, declared after the hook.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher, runner) => {
            await start(dbAdapter, publisher, runner);
          },
        });
        const start = async (dbAdapter, publisher, runner) => {
          await runTestRealmServer({ dbAdapter, publisher, runner });
        };
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
    // Through two levels of local functions.
    {
      code: `${IMPORTS}
        async function startServer(args) {
          return runTestRealmServer(args);
        }
        async function start(args) {
          await prepare();
          return startServer(args);
        }
        async function prepare() {}
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher, runner) => {
            await start({ dbAdapter, publisher, runner });
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
    // The hook given as a reference to a local function.
    {
      code: `${IMPORTS}
        async function start(dbAdapter, publisher, runner) {
          await runTestRealmServer({ dbAdapter, publisher, runner });
        }
        setupDB(hooks, { beforeEach: start });
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
    // Method shorthand, inside a nested module.
    {
      code: `${IMPORTS}
        module('federated search', function (hooks) {
          setupDB(hooks, {
            async beforeEach(dbAdapter, publisher, runner) {
              await runTestRealmServer({ dbAdapter, publisher, runner });
            },
            afterEach: stop,
          });
        });
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
    // An aliased import is matched by the name it imports.
    {
      code: `
        import { setupDB, runTestRealmServer as startRealm } from './helpers';
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher, runner) => {
            await startRealm({ dbAdapter, publisher, runner });
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
    // A starter reached through a namespace import.
    {
      code: `
        import * as helpers from './helpers';
        import { setupDB } from './helpers';
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher, runner) => {
            await helpers.runTestRealmServerWithRealms({ dbAdapter, publisher, runner });
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServerWithRealms')],
    },
    // A starter in a nested callback counts: setup usually runs its callbacks.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher, runner) => {
            await Promise.all(
              realms.map((realm) =>
                runTestRealmServerWithRealms({ realm, dbAdapter, publisher, runner }),
              ),
            );
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServerWithRealms')],
    },
    // The shared simple realm server, without its template.
    {
      code: `
        import { setupDB, startSimpleRealmServer } from './helpers';
        setupDB(hooks, {
          beforeEach: async (db, p, r) => {
            server = await startSimpleRealmServer({
              dbAdapter: db,
              publisher: p,
              runner: r,
            });
          },
        });
      `,
      errors: [perTestIndex('startSimpleRealmServer')],
    },
    // A realm built by a factory and started in the hook.
    {
      code: `
        import { setupDB, createRealm } from './helpers';
        let realm;
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher) => {
            ({ realm } = await createRealm({ dir, dbAdapter, publisher }));
            await realm.start();
          },
        });
      `,
      errors: [perTestIndex('createRealm')],
    },
    {
      code: `
        import { setupDB, createRealm } from './helpers';
        setupDB(hooks, {
          beforeEach: async (dbAdapter, publisher) => {
            let { realm } = await createRealm({ dir, dbAdapter, publisher });
            await realm.start();
          },
        });
      `,
      errors: [perTestIndex('createRealm')],
    },
    // \`setupDB\` aliased, or through a namespace import.
    {
      code: `
        import { setupDB as setup, runTestRealmServer } from './helpers';
        setup(hooks, {
          beforeEach: async () => {
            await runTestRealmServer();
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
    {
      code: `
        import * as helpers from './helpers';
        helpers.setupDB(hooks, {
          beforeEach: async () => {
            await helpers.runTestRealmServer();
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
    // A template property that holds no template.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          templateDatabase: undefined,
          beforeEach: async () => {
            await runTestRealmServer();
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
    // An uncached setup helper at module level, in its default mode.
    {
      code: `${IMPORTS}
        module('permissions', function (hooks) {
          setupPermissionedRealm(hooks, { fixture: 'simple', permissions });
        });
      `,
      errors: [uncachedSetup('setupPermissionedRealm')],
    },
    // The same with the mode spelled out, aliased.
    {
      code: `
        import { setupPermissionedRealms as setupRealms } from './helpers';
        setupRealms(hooks, { mode: 'beforeEach', realms });
      `,
      errors: [uncachedSetup('setupPermissionedRealms')],
    },
    // Through a namespace import.
    {
      code: `
        import * as helpers from './helpers';
        helpers.setupPermissionedRealm(hooks, { fixture: 'simple', permissions });
      `,
      errors: [uncachedSetup('setupPermissionedRealm')],
    },
    // A starter passed as a value rather than called.
    {
      code: `${IMPORTS}
        setupDB(hooks, {
          beforeEach: async () => {
            await retry(runTestRealmServer);
          },
        });
      `,
      errors: [perTestIndex('runTestRealmServer')],
    },
  ],
});
