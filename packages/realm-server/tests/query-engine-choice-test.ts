import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

import {
  IndexQueryEngine,
  LegacyIndexQueryEngine,
} from '@cardstack/runtime-common';
import {
  indexQueryEngineFor,
  queryEngineFor,
  type QueryEngineCaller,
  type QueryEngineChoice,
} from '@cardstack/runtime-common/query-engine/engine-choice';

// The engine each caller reads through while the old engine is beside the
// new one. A switch row moves one caller here and nowhere else: its line is
// the switch.
const CALLER_ENGINES: Readonly<Record<QueryEngineCaller, QueryEngineChoice>> = {
  'realm-search': 'v2',
  automations: 'v2',
  'skill-validation': 'v2',
  'realm-logs': 'v2',
  federated: 'legacy',
  'query-fields': 'legacy',
  host: 'legacy',
};

// Every production file that chooses a query engine, and the callers it names
// when it does: by building one (`indexQueryEngineFor(caller, ...)`), or, for
// a caller that reads through no engine, by asking which one its caller is set
// to (`queryEngineFor(caller)`). Only engine-choice.ts constructs an engine
// itself.
const CONSTRUCTION_SITES: Readonly<Record<string, QueryEngineCaller[]>> = {
  'packages/runtime-common/realm-index-query-engine.ts': [
    'realm-search',
    'query-fields',
  ],
  // A realm's log search, and a log's line count in its file meta.
  'packages/runtime-common/realm.ts': ['realm-logs', 'realm-logs'],
  // A federated `_search` of one realm's logs.
  'packages/realm-server/handlers/handle-search.ts': ['realm-logs'],
  'packages/runtime-common/automation-index-hook.ts': ['automations'],
  'packages/runtime-common/automation-run-limits.ts': ['automations'],
  'packages/realm-server/handlers/handle-skill-validation.ts': [
    'skill-validation',
  ],
};

const CHOOSER = 'packages/runtime-common/query-engine/engine-choice.ts';

const REPO = join(dirname(import.meta.filename), '..', '..', '..');

function productionFilesMatching(pattern: string): string[] {
  return execFileSync(
    'git',
    ['grep', '-lE', pattern, '--', 'packages/*.ts', 'packages/*.gts'],
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
    .sort();
}

// The callers a file names in its `indexQueryEngineFor(` and `queryEngineFor(`
// calls (line comments left out, so a comment never reads as a call).
function namedCallers(file: string): string[] {
  let source = readFileSync(join(REPO, file), 'utf8').replace(
    /^\s*\/\/.*$/gm,
    '',
  );
  return [...source.matchAll(/\b(?:indexQ|q)ueryEngineFor\(\s*'([^']+)'/g)].map(
    ([, caller]) => caller,
  );
}

module(basename(import.meta.filename), function () {
  test('each caller reads through the engine its row sets', function (assert) {
    for (let [caller, engine] of Object.entries(CALLER_ENGINES)) {
      assert.strictEqual(
        queryEngineFor(caller as QueryEngineCaller, ''),
        engine,
        caller,
      );
    }
  });

  test('the override sends every caller to one engine', function (assert) {
    assert.strictEqual(queryEngineFor('realm-search', 'legacy'), 'legacy');
    assert.strictEqual(queryEngineFor('host', 'v2'), 'v2');
  });

  test('an override it does not know is ignored', function (assert) {
    assert.strictEqual(queryEngineFor('federated', 'V2'), 'legacy');
    assert.strictEqual(queryEngineFor('realm-search', ''), 'v2');
  });

  test('indexQueryEngineFor builds the engine its caller is set to', function (assert) {
    let stub = {} as never;
    for (let [caller, engine] of Object.entries(CALLER_ENGINES)) {
      let built = indexQueryEngineFor(
        caller as QueryEngineCaller,
        stub,
        stub,
        stub,
      );
      assert.true(
        engine === 'v2'
          ? built instanceof IndexQueryEngine
          : built instanceof LegacyIndexQueryEngine,
        `${caller} gets the ${engine} engine`,
      );
    }
  });

  test('only the chooser constructs an engine', function (assert) {
    assert.deepEqual(
      productionFilesMatching('new +(Legacy)?IndexQueryEngine *\\('),
      [CHOOSER],
      'every other production file builds its engine through indexQueryEngineFor',
    );
  });

  test('each production construction site names the callers it is listed with', function (assert) {
    assert.deepEqual(
      productionFilesMatching('(indexQ|q)ueryEngineFor\\(').filter(
        (file) => file !== CHOOSER,
      ),
      Object.keys(CONSTRUCTION_SITES).sort(),
      'every site that builds an engine is listed',
    );
    for (let [file, callers] of Object.entries(CONSTRUCTION_SITES)) {
      assert.deepEqual(
        namedCallers(file).sort(),
        [...callers].sort(),
        `${file} names its callers`,
      );
    }
  });
});
