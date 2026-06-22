import QUnit from 'qunit';
const { module, test } = QUnit;

import type { ValidationStepResult } from '../src/factory-agent/index.ts';

import {
  LintValidationStep,
  type LintValidationStepConfig,
  type LintValidationDetails,
} from '../src/validators/lint-step.ts';
import type { LintResult } from '@cardstack/boxel-cli/api';
import { createMockClient } from './helpers/mock-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<LintValidationStepConfig> = {},
): LintValidationStepConfig {
  return {
    client: createMockClient(),
    realmServerUrl: 'https://example.test/',
    lintResultsModuleUrl: 'https://example.test/lint-result',
    workspaceDir: createTestWorkspace().dir,
    // Default to a no-op sequence resolver for unit tests
    getNextSequenceNumber: async () => 1,
    ...overrides,
  };
}

function makeFetchFilenames(
  filenames: string[],
): (realmUrl: string) => Promise<{ filenames: string[]; error?: string }> {
  return async () => ({ filenames });
}

function makeFetchFilenamesError(
  error: string,
): (realmUrl: string) => Promise<{ filenames: string[]; error?: string }> {
  return async () => ({ filenames: [], error });
}

function makeLintFile(
  responses: Record<string, LintResult>,
): (realmUrl: string, source: string, filename: string) => Promise<LintResult> {
  return async (_realmUrl, _source, filename) =>
    responses[filename] ?? { fixed: false, output: '', messages: [] };
}

function makeLintFileThrows(
  errorMessage: string,
): (realmUrl: string, source: string, filename: string) => Promise<LintResult> {
  return async () => {
    throw new Error(errorMessage);
  };
}

function makeReadFile(
  contents: Record<string, string>,
): (
  realmUrl: string,
  path: string,
) => Promise<{ ok: boolean; content?: string; error?: string }> {
  return async (_realmUrl, path) => {
    let content = contents[path];
    if (content != null) {
      return { ok: true, content };
    }
    return { ok: false, error: `File not found: ${path}` };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

module('LintValidationStep', function () {
  test('no lintable files returns passed', async function (assert) {
    let step = new LintValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'Cards/my-card.json',
          'index.json',
          'realm.json',
        ]),
        readFileFn: makeReadFile({}),
        lintFileFn: makeLintFile({}),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.strictEqual(result.step, 'lint');
    assert.strictEqual(result.errors.length, 0);
    assert.deepEqual(result.files, []);
  });

  test('files exist and all pass lint', async function (assert) {
    let step = new LintValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'hello.gts',
          'hello.test.gts',
          'index.json',
        ]),
        readFileFn: makeReadFile({
          'hello.gts': 'export class Hello {}',
          'hello.test.gts': 'import { test } from "qunit";',
        }),
        lintFileFn: makeLintFile({
          'hello.gts': { ok: true, fixed: false, output: '', messages: [] },
          'hello.test.gts': {
            ok: true,
            fixed: false,
            output: '',
            messages: [],
          },
        }),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.strictEqual(result.step, 'lint');
    assert.deepEqual(result.files, ['hello.gts', 'hello.test.gts']);
    assert.ok(result.details, 'has details');

    let details = result.details as unknown as LintValidationDetails;
    assert.strictEqual(details.filesChecked, 2);
    assert.strictEqual(details.filesWithErrors, 0);
    assert.strictEqual(details.totalViolations, 0);
  });

  test('files with lint errors returns failed with violations', async function (assert) {
    let step = new LintValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        readFileFn: makeReadFile({
          'hello.gts': 'let x = 1;',
        }),
        lintFileFn: makeLintFile({
          'hello.gts': {
            ok: true,
            fixed: false,
            output: 'let x = 1;',
            messages: [
              {
                ruleId: 'no-unused-vars',
                severity: 2,
                message: "'x' is assigned a value but never used",
                line: 1,
                column: 5,
              },
            ],
          },
        }),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.strictEqual(result.step, 'lint');
    assert.ok(result.errors.length > 0, 'has errors');
    assert.ok(result.details, 'has details');

    let details = result.details as unknown as LintValidationDetails;
    assert.strictEqual(details.filesChecked, 1);
    assert.strictEqual(details.filesWithErrors, 1);
    assert.strictEqual(details.totalViolations, 1);
    assert.strictEqual(details.violations[0].rule, 'no-unused-vars');
    assert.strictEqual(details.violations[0].file, 'hello.gts');
    assert.strictEqual(details.violations[0].line, 1);
  });

  test('warnings do not cause failure', async function (assert) {
    let step = new LintValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        readFileFn: makeReadFile({
          'hello.gts': 'export const x = 1;',
        }),
        lintFileFn: makeLintFile({
          'hello.gts': {
            ok: true,
            fixed: false,
            output: 'export const x = 1;',
            messages: [
              {
                ruleId: 'no-css-position-fixed',
                severity: 1,
                message: 'Avoid position: fixed',
                line: 5,
                column: 1,
              },
            ],
          },
        }),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed, 'warnings only should pass');
    assert.strictEqual(result.errors.length, 0, 'no errors for warnings');
  });

  test('file read failure treated as lint error (not silently skipped)', async function (assert) {
    let step = new LintValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts', 'broken.gts']),
        readFileFn: makeReadFile({
          'hello.gts': 'export class Hello {}',
          // broken.gts not in map → readFile returns { ok: false }
        }),
        lintFileFn: makeLintFile({
          'hello.gts': { ok: true, fixed: false, output: '', messages: [] },
        }),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed, 'read failure should cause lint failure');
    assert.ok(result.errors.length > 0, 'has errors for unreadable file');
    assert.ok(
      result.errors[0].message.includes('broken.gts'),
      'error mentions the unreadable file',
    );

    let details = result.details as unknown as LintValidationDetails;
    assert.strictEqual(details.filesChecked, 2, 'both files counted');
    assert.strictEqual(
      details.filesWithErrors,
      1,
      'unreadable file counted as error',
    );
  });

  test('lintFile throws returns failed with error message', async function (assert) {
    let step = new LintValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        readFileFn: makeReadFile({
          'hello.gts': 'export class Hello {}',
        }),
        lintFileFn: makeLintFileThrows('Lint service unavailable'),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].message.includes('Lint service unavailable'));
  });

  test('fetchFilenames fails returns failed with error', async function (assert) {
    let step = new LintValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenamesError('Network timeout'),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.ok(result.errors[0].message.includes('Network timeout'));
  });

  test('.test.gts files are linted (all lintable extensions eligible)', async function (assert) {
    let step = new LintValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'hello.gts',
          'hello.test.gts',
          'utils.ts',
          'helper.js',
          'template.gjs',
          'data.json',
        ]),
        readFileFn: makeReadFile({
          'hello.gts': 'export class Hello {}',
          'hello.test.gts': 'import { test } from "qunit";',
          'utils.ts': 'export const x = 1;',
          'helper.js': 'export const y = 2;',
          'template.gjs': '<template>hi</template>',
        }),
        lintFileFn: makeLintFile({}),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.deepEqual(result.files, [
      'hello.gts',
      'hello.test.gts',
      'helper.js',
      'template.gjs',
      'utils.ts',
    ]);
  });

  test('issueId is used for slug derivation in artifact naming', async function (assert) {
    let step = new LintValidationStep(
      makeConfig({
        issueId: 'Issues/sticky-note-define-core',
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        readFileFn: makeReadFile({
          'hello.gts': 'export class Hello {}',
        }),
        lintFileFn: makeLintFile({}),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    let details = result.details as unknown as LintValidationDetails;
    assert.ok(
      details.lintResultId.includes('lint_sticky-note-define-core'),
      `lintResultId "${details.lintResultId}" includes issue slug`,
    );
  });

  test('formatForContext with passing result and details', function (assert) {
    let step = new LintValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'lint',
      passed: true,
      errors: [],
      details: {
        lintResultId: 'Validations/lint_validation-1',
        filesChecked: 3,
        filesWithErrors: 0,
        totalViolations: 0,
        violations: [],
      },
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('PASSED'));
    assert.ok(formatted.includes('3'));
    assert.ok(formatted.includes('no lint errors'));
  });

  test('formatForContext with empty pass returns empty string', function (assert) {
    let step = new LintValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'lint',
      passed: true,
      errors: [],
    };

    let formatted = step.formatForContext(result);
    assert.strictEqual(formatted, '');
  });

  test('formatForContext with failing result and detailed violations', function (assert) {
    let step = new LintValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'lint',
      passed: false,
      errors: [{ message: 'hello.gts:1 [no-unused-vars] x is unused' }],
      details: {
        lintResultId: 'Validations/lint_validation-1',
        filesChecked: 2,
        filesWithErrors: 1,
        totalViolations: 1,
        violations: [
          {
            rule: 'no-unused-vars',
            file: 'hello.gts',
            line: 1,
            message: "'x' is assigned a value but never used",
          },
        ],
      },
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('FAILED'));
    assert.ok(formatted.includes('2 file(s) checked'));
    assert.ok(formatted.includes('1 violation(s)'));
    assert.ok(formatted.includes('no-unused-vars'));
    assert.ok(formatted.includes('hello.gts'));
  });

  test('formatForContext without details falls back to errors', function (assert) {
    let step = new LintValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'lint',
      passed: false,
      errors: [{ message: 'Lint service failed' }],
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('FAILED'));
    assert.ok(formatted.includes('Lint service failed'));
  });
});
