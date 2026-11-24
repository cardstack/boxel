'use strict';

// Keeps BXL's SQL push-down (`@cardstack/bxl/sql`: the predicate and score
// compilers and the spreadsheet interpreter) out of browser code. The host
// bundles everything the host app, base and runtime-common import, so a
// value import of the entry from any of them ships the compilers to every
// browser. Type imports are erased and allowed.
//
// SQL_PUSH_DOWN_MODULES are the server-only modules in those packages that
// load it: `formula-sql.ts`, a query expression's SQL, which a process that
// runs queries on Postgres provides to the query grammar and the index query
// engine (runtime-common/query-expression.ts). The same rule refuses a value
// import of such a module from browser code, so the exemption cannot carry
// the compilers into the host. Adding one moves the boundary, so it is a
// reviewed change, not a way to silence the rule.
//
// Covers the entry and the deep paths the package's `./*` export pattern
// would also resolve (`@cardstack/bxl/bxl/sql/score`).

const MESSAGE =
  '`@cardstack/bxl/sql` is server-side SQL push-down: browser code reaches BXL through `@cardstack/bxl` or `@cardstack/bxl/compiler` (see eslint/bxl-sql-imports.cjs).';

const SERVER_ONLY_MESSAGE =
  '`formula-sql` is server code (it loads `@cardstack/bxl/sql`): browser code checks an expression through `query-expression.ts`, and a server provides the compiler (see eslint/bxl-sql-imports.cjs).';

const BXL_SQL_IMPORT_RULE = [
  'error',
  {
    paths: [
      { name: '@cardstack/bxl/sql', message: MESSAGE, allowTypeImports: true },
      {
        name: '@cardstack/bxl/bxl/sql',
        message: MESSAGE,
        allowTypeImports: true,
      },
    ],
    patterns: [
      {
        group: ['@cardstack/bxl/bxl/sql/*', '@cardstack/bxl/sql/*'],
        message: MESSAGE,
        allowTypeImports: true,
      },
      {
        group: ['**/formula-sql', '**/formula-sql.ts'],
        message: SERVER_ONLY_MESSAGE,
        allowTypeImports: true,
      },
    ],
  },
];

// The browser-bundled packages that lint through the root eslintrc config,
// relative to the repository root. `host` is `root: true` and declares the
// rule itself, for `app/**`.
const BXL_SQL_BROWSER_FILES = [
  'packages/base/**/*',
  'packages/runtime-common/**/*',
];

const SQL_PUSH_DOWN_MODULES = [
  'packages/runtime-common/query-v2/formula-sql.ts',
];

module.exports = {
  BXL_SQL_IMPORT_RULE,
  BXL_SQL_BROWSER_FILES,
  SQL_PUSH_DOWN_MODULES,
};
