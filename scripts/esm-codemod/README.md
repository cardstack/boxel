# CS-11449 — ts-node → native-Node ESM codemod

Tooling for migrating the **node-run package cluster** off `ts-node` and onto
native Node (≥24) TypeScript execution (type-stripping). Native Node ESM is far
stricter than ts-node / Vite about module resolution, so the swap surfaces a
predictable set of breakages. This directory automates the mechanical ones.

The host (Vite/Embroider) build **masks** every error below — a green host build
does not mean a package is node-loadable. Verify by actually `import()`-ing the
entry under native node.

## Usage

```sh
# Apply all automated rules across the cluster (idempotent):
node scripts/esm-codemod/run.mjs

# Preview without writing:
node scripts/esm-codemod/run.mjs --dry
```

Individual rules can be run on specific files, e.g.
`node scripts/esm-codemod/lodash-to-lodash-es.mjs <file>...`.

## The node-run cluster

Packages Node executes directly (NOT bundled by Vite):
`runtime-common`, `postgres`, `billing`, `realm-server`, `realm-test-harness`,
`ai-bot`, `bot-runner`, `matrix`, `software-factory`.

## Error taxonomy

Each error was found by `import()`-ing a service entry under native node and
reading the first failure, then fixing and repeating. Classes marked
**automated** are handled by `run.mjs`; **manual** ones are listed in the next
section.

| #   | Symptom                                                                             | Cause                                                                                                        | Fix                                                                                  |                                                                                |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 1   | `ERR_MODULE_NOT_FOUND` resolving a relative import `./foo`                          | Node does no extension search or directory-index resolution                                                  | append `./foo.ts` / `./foo.gts` / `./foo/index.ts`; bare `'.'` → `'./index.ts'`      | automated (`add-relative-extensions`)                                          |
| 2   | `ERR_MODULE_NOT_FOUND` resolving a workspace pkg subpath (`@cardstack/billing/x`)   | workspace package has no `exports` map → Node looks for `index.js`                                           | add an `exports` map pointing at `.ts` + `"type":"module"`                           | **manual**                                                                     |
| 3   | `Cannot find module '.../lodash/merge'` (`Did you mean lodash/merge.js?`)           | `lodash` is CJS-only with no exports map                                                                     | repo-wide switch to `lodash-es` named imports                                        | automated (`lodash-to-lodash-es`)                                              |
| 4   | `does not provide an export named 'X'` from a CJS pkg (`fs-extra`, `debug`)         | Node can't statically read named exports from these CJS modules                                              | default-import + destructure                                                         | automated (`cjs-named-to-default`) — extend `CJS_PACKAGES` as new ones surface |
| 5   | `ERR_MODULE_NOT_FOUND` on a CJS pkg deep import (`matrix-js-sdk/lib/x`)             | no exports map; ESM won't add `.js` or pick a file over a same-named dir                                     | append `.js`                                                                         | **manual** (small, package-specific)                                           |
| 6   | `Cannot find module '.../scripts/x.js'`                                             | a stray CJS file was renamed `.cjs` (because the pkg is now `type:module`) but the import still says `.js`   | update the import to `.cjs`                                                          | **manual**                                                                     |
| 7   | `ReferenceError: __dirname is not defined`                                          | CJS globals don't exist under ESM                                                                            | `import.meta.dirname` / `import.meta.filename`                                       | automated (`dirname-to-import-meta`)                                           |
| 8   | wrong path built from `import.meta.url`                                             | `import.meta.url` is a `file://` URL string, not a path                                                      | use `import.meta.dirname`                                                            | **manual** (rare — was a WIP bug)                                              |
| 9   | `ReferenceError: exports is not defined` when a consumer runs the dep via `ts-node` | once a dep ships an `exports` map Node handles its `.ts` natively, colliding with a still-`ts-node` consumer | the dep + all its node-run consumers must drop ts-node in the same change (big-bang) | **manual** (coordination)                                                      |
| 10  | in-source `spawn('ts-node', ['--transpileOnly', 'entry', …])`                       | child processes also need native node                                                                        | `spawn('node', ['entry.ts', …])` (or `process.execPath`)                             | **manual** (few sites, varied shapes)                                          |

### Invocation sites (automated — `ts-node-to-node`)

`ts-node --transpileOnly <entry>` → `node <entry>.ts` in `package.json` scripts,
`*.sh`, and `mise-tasks`. The extensionless entry must gain `.ts` because Node
does no extension search for the CLI entry point. Handles shell line-continuation
(`exec ts-node \`↵`--transpileOnly main`). Skips (and reports) two forms it can't
safely rewrite: `qunit --require ts-node/register/transpile-only …` and inline
`ts-node … -e/--eval …`.

## Not automated — do by hand

These are too package-specific or too coupled for a blind codemod:

1. **`exports` maps + `"type":"module"`** per workspace package (class #2). Each
   map mirrors that package's directory layout. A wildcard
   `"./*":["./*.ts","./*/index.ts"]` does **not** work — Node exports won't fall
   through on file-not-found, so add an explicit entry per directory-index
   subpath. Never set `--preserve-symlinks` (it breaks type-stripping for
   pnpm-symlinked workspace deps, which only works because Node resolves to
   realpath outside `node_modules` first).
2. **The qunit test-runner bootstrap.** `qunit --require ts-node/register` has no
   node equivalent; each test package needs a `node tests/index.ts`-style
   bootstrap that installs the `QUnit` global, a TAP reporter, `QUnit.start()`,
   and a failure-based exit code. Affects `ai-bot`, `bot-runner`, `realm-server`
   (via `run-qunit-with-test-pg.sh` / `measure-test-file.sh`), `software-factory`.
3. **Remove the `ts-node` devDependency** from each package once its test runner
   is converted.
4. **CJS deep imports** needing `.js` (class #5) and **`.cjs` import path fixes**
   (class #6) — verify against the actual file on disk.

## Verifying a package loads

```sh
cd packages/realm-server
node --eval 'import("./main.ts").then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})'
```

Reaching a runtime error (e.g. "REALM_SERVER_SECRET_SEED not set") means the full
module graph linked — the migration succeeded for that entry.
