import { module, test } from 'qunit';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  LINT_TSCONFIG_FILENAME,
  parseTscOutput,
  parseTemplateLintOutput,
  sanitizeRelativePath,
} from '@cardstack/runtime-common/lint/submission-lint';

module('lint-runner | sanitizeRelativePath', () => {
  let tempDir = path.join(os.tmpdir(), 'sub-test-dir');

  test('accepts nested relative path', (assert) => {
    let rel = sanitizeRelativePath('CardListing/foo.json', tempDir);
    assert.strictEqual(rel, path.join('CardListing', 'foo.json'));
  });

  test('rejects absolute paths', (assert) => {
    assert.throws(
      () => sanitizeRelativePath('/etc/passwd', tempDir),
      /absolute/,
    );
  });

  test('rejects ".." segments', (assert) => {
    assert.throws(() => sanitizeRelativePath('foo/../../bar', tempDir), /\.\./);
  });

  test('rejects null byte', (assert) => {
    assert.throws(() => sanitizeRelativePath('ok\0.gts', tempDir), /null byte/);
  });

  test('rejects control characters', (assert) => {
    assert.throws(
      () => sanitizeRelativePath('ok\x07.gts', tempDir),
      /control characters/,
    );
  });

  test('rejects empty filename', (assert) => {
    assert.throws(() => sanitizeRelativePath('', tempDir), /required/);
  });

  test('rejects the reserved lint-tsconfig filename', (assert) => {
    assert.throws(
      () => sanitizeRelativePath(LINT_TSCONFIG_FILENAME, tempDir),
      /reserved/,
    );
  });
});

module('lint-runner | parseTscOutput', () => {
  // Matches what runtime passes: path.relative(HOST_DIR, tempDir) has NO
  // trailing slash, so the parser must tolerate that shape.
  let runtimePrefix = '../catalog/__submissions-temp__/x';

  test('returns empty array for empty output', (assert) => {
    assert.deepEqual(parseTscOutput('', runtimePrefix), []);
  });

  test('filters to errors inside submission temp path', (assert) => {
    let output = [
      '../catalog/__submissions-temp__/x/foo.gts(17,1): error TS6133: unused import',
      '../catalog/contents/todo.gts(117,47): error TS2345: unrelated existing error',
      '../catalog/__submissions-temp__/x/sub/bar.gts(3,2): error TS2322: Type mismatch',
    ].join('\n');
    let errors = parseTscOutput(output, runtimePrefix);
    assert.strictEqual(errors.length, 2);
    assert.ok(errors[0].startsWith('foo.gts (17:1)'), errors[0]);
    assert.ok(errors[1].startsWith('sub/bar.gts (3:2)'), errors[1]);
    assert.ok(errors[0].includes('TS6133'), errors[0]);
  });

  test('strips prefix cleanly when it has no trailing slash (regression)', (assert) => {
    // Regression guard: `split(prefix)[1]` used to leave a leading "/" on
    // the display path when the prefix didn't end with a slash.
    let output =
      '../catalog/__submissions-temp__/x/foo.gts(1,1): error TS1: msg';
    let errors = parseTscOutput(output, runtimePrefix);
    assert.strictEqual(errors.length, 1);
    assert.notOk(errors[0].startsWith('/'), `no leading slash: ${errors[0]}`);
    assert.ok(errors[0].startsWith('foo.gts '), errors[0]);
  });

  test('also works when prefix is passed with a trailing slash', (assert) => {
    let output =
      '../catalog/__submissions-temp__/x/foo.gts(1,1): error TS1: msg';
    let errors = parseTscOutput(
      output,
      '../catalog/__submissions-temp__/x/',
    );
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].startsWith('foo.gts '), errors[0]);
  });

  test('ignores warnings', (assert) => {
    let output =
      '../catalog/__submissions-temp__/x/foo.gts(1,1): warning TS6133: meh';
    let errors = parseTscOutput(output, runtimePrefix);
    assert.strictEqual(errors.length, 0);
  });

  test('ignores non-diagnostic noise lines', (assert) => {
    let output = [
      'random log line',
      'Compiled',
      '../catalog/__submissions-temp__/x/a.gts(2,3): error TS1234: msg',
    ].join('\n');
    let errors = parseTscOutput(output, runtimePrefix);
    assert.strictEqual(errors.length, 1);
  });
});

module('lint-runner | parseTemplateLintOutput', () => {
  // Simulate realistic runtime inputs: linter cwd is the catalog package;
  // tempDir is catalog/__submissions-temp__/<runId>/; JSON keys are relative
  // to the linter's cwd, so they include the __submissions-temp__ prefix.
  let catalogDir = path.join(os.tmpdir(), 'catalog');
  let tempDir = path.join(catalogDir, '__submissions-temp__', 'abc');

  test('returns empty array for empty output', (assert) => {
    assert.deepEqual(parseTemplateLintOutput('', tempDir, catalogDir), []);
  });

  test('returns empty array for invalid JSON', (assert) => {
    assert.deepEqual(
      parseTemplateLintOutput('not json', tempDir, catalogDir),
      [],
    );
  });

  test('resolves paths relative to linter cwd, not tempDir (regression)', (assert) => {
    // ember-template-lint emits keys relative to its cwd (the catalog package).
    // Without the linterCwd arg, we used to double-prefix the tempDir.
    let json = JSON.stringify({
      '__submissions-temp__/abc/foo/bar.hbs': [
        {
          rule: 'no-invalid-role',
          severity: 2,
          line: 10,
          column: 5,
          message: 'invalid role',
        },
      ],
    });
    let errors = parseTemplateLintOutput(json, tempDir, catalogDir);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].startsWith('foo/bar.hbs '), errors[0]);
    assert.notOk(
      errors[0].includes('__submissions-temp__'),
      `no temp-dir leak: ${errors[0]}`,
    );
  });

  test('ignores severity-1 warnings', (assert) => {
    let json = JSON.stringify({
      '__submissions-temp__/abc/foo.hbs': [
        {
          rule: 'style-warning',
          severity: 1,
          line: 1,
          column: 1,
          message: 'just a warning',
        },
      ],
    });
    let errors = parseTemplateLintOutput(json, tempDir, catalogDir);
    assert.strictEqual(errors.length, 0);
  });

  test('handles empty messages array', (assert) => {
    let json = JSON.stringify({ '__submissions-temp__/abc/foo.hbs': [] });
    assert.deepEqual(
      parseTemplateLintOutput(json, tempDir, catalogDir),
      [],
    );
  });

  test('handles multiple files', (assert) => {
    let json = JSON.stringify({
      '__submissions-temp__/abc/a.hbs': [
        { rule: 'r1', severity: 2, line: 1, column: 1, message: 'm1' },
      ],
      '__submissions-temp__/abc/sub/b.hbs': [
        { rule: 'r2', severity: 2, line: 2, column: 2, message: 'm2' },
      ],
    });
    let errors = parseTemplateLintOutput(json, tempDir, catalogDir);
    assert.strictEqual(errors.length, 2);
    assert.ok(
      errors.some((e) => e.startsWith('a.hbs ')),
      errors.join(' | '),
    );
    assert.ok(
      errors.some((e) => e.startsWith('sub/b.hbs ')),
      errors.join(' | '),
    );
  });

  test('handles absolute paths from linter (fallback)', (assert) => {
    // Some lint configurations emit absolute paths. Verify we still compute
    // a sensible display path.
    let abs = path.join(tempDir, 'foo.hbs');
    let json = JSON.stringify({
      [abs]: [{ rule: 'r', severity: 2, line: 1, column: 1, message: 'm' }],
    });
    let errors = parseTemplateLintOutput(json, tempDir, catalogDir);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].startsWith('foo.hbs '), errors[0]);
  });
});
