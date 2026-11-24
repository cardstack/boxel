import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join, relative } from 'path';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

import {
  queryEngineFor,
  type QueryEngineCaller,
  type QueryEngineChoice,
} from '@cardstack/runtime-common/query-engine/engine-choice';

// Every place production code constructs a query engine, and the caller whose
// default in engine-choice.ts it must follow. A switch row changes that
// caller's default and the site's construction together; a site missing here,
// or one constructing the other engine, fails the guard below.
const CONSTRUCTION_SITES: Readonly<Record<string, QueryEngineCaller>> = {
  'packages/runtime-common/realm-index-query-engine.ts': 'realm-search',
  // an automation's searches over its own realm's index
  'packages/runtime-common/automation-index-hook.ts': 'realm-search',
  'packages/runtime-common/automation-run-limits.ts': 'realm-search',
  'packages/realm-server/handlers/handle-skill-validation.ts': 'realm-search',
};

const REPO = join(dirname(import.meta.filename), '..', '..', '..');

// The engine each `new <name>(` in a file constructs, from the file's imports:
// main's engine module or the `LegacyIndexQueryEngine` export is legacy; the
// query-engine/ module or the package's `IndexQueryEngine` is the new chain.
function constructedEngines(file: string): QueryEngineChoice[] {
  // Line comments go first: one inside an import list would read as a name.
  let source = readFileSync(join(REPO, file), 'utf8').replace(
    /^\s*\/\/.*$/gm,
    '',
  );
  let bound = new Map<string, QueryEngineChoice>();
  let imports = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g;
  for (let [, names, from] of source.matchAll(imports)) {
    for (let item of names.split(',')) {
      let [name, local] = item
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)
        .map((part) => part.trim());
      local ??= name;
      if (name === 'LegacyIndexQueryEngine') {
        bound.set(local, 'legacy');
      } else if (name === 'IndexQueryEngine') {
        bound.set(
          local,
          /(^|\/)index-query-engine(\.ts)?$/.test(from) &&
            !/query-engine\/index-query-engine/.test(from)
            ? 'legacy'
            : 'v2',
        );
      }
    }
  }
  return [...source.matchAll(/new\s+(\w+)\s*\(/g)]
    .map(([, name]) => bound.get(name))
    .filter((engine): engine is QueryEngineChoice => engine !== undefined);
}

// Which engine each caller reads through while the old engine is beside the
// new one: main's, until the caller's switch row moves it; the override sends
// every caller to one engine, and anything else it says is ignored.
module(basename(import.meta.filename), function () {
  test("every caller reads through main's engine until its switch", function (assert) {
    for (let caller of [
      'realm-search',
      'realm-logs',
      'federated',
      'query-fields',
      'host',
    ] as const) {
      assert.strictEqual(queryEngineFor(caller, ''), 'legacy', caller);
    }
  });

  test('the override sends every caller to one engine', function (assert) {
    assert.strictEqual(queryEngineFor('realm-search', 'v2'), 'v2');
    assert.strictEqual(queryEngineFor('host', 'legacy'), 'legacy');
  });

  test('an override it does not know is ignored', function (assert) {
    assert.strictEqual(queryEngineFor('federated', 'V2'), 'legacy');
    assert.strictEqual(queryEngineFor('federated', ''), 'legacy');
  });

  test('each production construction site builds the engine its caller is set to', function (assert) {
    let sites = execFileSync(
      'git',
      [
        'grep',
        '-lE',
        'new +(Legacy)?IndexQueryEngine *\\(',
        '--',
        'packages/*.ts',
        'packages/*.gts',
      ],
      { cwd: REPO, encoding: 'utf8' },
    )
      .split('\n')
      .filter(
        (file) =>
          file &&
          !/\/tests?\//.test(file) &&
          !/\/scripts\//.test(file) &&
          !file.startsWith('packages/query-verification/'),
      )
      .map((file) => relative(REPO, join(REPO, file)));
    assert.deepEqual(
      sites.sort(),
      Object.keys(CONSTRUCTION_SITES).sort(),
      'every production construction site is listed with its caller',
    );
    for (let [file, caller] of Object.entries(CONSTRUCTION_SITES)) {
      let engines = constructedEngines(file);
      assert.ok(engines.length > 0, `${file} constructs an engine`);
      assert.deepEqual(
        [...new Set(engines)],
        [queryEngineFor(caller, '')],
        `${file} (${caller}) constructs the engine its caller is set to`,
      );
    }
  });
});
