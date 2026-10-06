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
          await setupPermissionedRealm(hooks, {});
        };
      `,
      errors: [perTestIndex('setupPermissionedRealm')],
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
