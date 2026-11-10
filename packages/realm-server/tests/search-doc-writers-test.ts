import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

// Only the index writer writes a promoted search doc, because a
// spilled doc's markers and its `boxel_index_spill` rows must change together.
// SQL that assigns `search_doc` anywhere else would strand markers or values.

const repoRoot = join(import.meta.dirname, '..', '..', '..');

// Files allowed to issue SQL that writes `search_doc`, with why.
const ALLOWED = new Map<string, string>([
  [
    'packages/runtime-common/index-writer.ts',
    'the index writer: stages and promotes rows (its upserts name columns generically)',
  ],
  [
    'packages/realm-test-harness/src/database.ts',
    "rewrites a cloned test database's URLs in place, refs and markers included",
  ],
]);

// A SQL assignment to the column: `search_doc =` followed by an SQL-looking
// right-hand side (a function, a placeholder, EXCLUDED, a literal, a cast).
// A JavaScript property write (`row.search_doc = …`) is not SQL, so a
// preceding `.` excludes the match.
const SQL_WRITE =
  /(?<![.\w])search_doc\s*=\s*(?:[A-Za-z_]+\s*\(|\$\d|EXCLUDED\b|'|\()/;

module(basename(import.meta.filename), function () {
  test('only the index writer writes search_doc in SQL', function (assert) {
    let files = execFileSync(
      'git',
      ['ls-files', '--', 'packages/*.ts', 'packages/*.gts', 'packages/*.js'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .split('\n')
      .filter(
        (f) =>
          f &&
          !f.includes('/tests/') &&
          !f.includes('/migrations') &&
          !f.includes('node_modules'),
      );
    let writers = files.filter((file) =>
      SQL_WRITE.test(readFileSync(join(repoRoot, file), 'utf8')),
    );
    assert.deepEqual(
      writers.filter((file) => !ALLOWED.has(file)),
      [],
      'no module outside the allow list assigns search_doc in SQL',
    );
    assert.ok(files.length > 100, `scanned ${files.length} files`);
  });
});
